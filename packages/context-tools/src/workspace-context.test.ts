import { afterEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { WorkspaceStore, initialiseWorkspaceStore, workspaceKey } from './workspace-store.js'
import { RepositoryNavigation } from './repository-navigation.js'
import { RepositoryCoordination } from './repository-coordination.js'
import { discoverWorkspace } from './workspace-catalogue.js'
const exec=promisify(execFile),paths:string[]=[],stores:WorkspaceStore[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const store of stores.splice(0))store.close();for(const path of paths.splice(0))await rm(path,{recursive:true,force:true})})
async function fixture(){
 const parent=await realpath(await mkdtemp(join(tmpdir(),'z1p-workspace-test-')));paths.push(parent)
 const root=join(parent,'first'),second=join(parent,'second'),cache=join(parent,'.private');await mkdir(root);await mkdir(second)
 for(const directory of [root,second]){
  await writeFile(join(directory,'a.ts'),'export const originalMarker = 1\n');await writeFile(join(directory,'b.ts'),'export const unchangedMarker = 2\n')
  await exec('git',['init','-q',directory]);await exec('git',['-C',directory,'add','.']);await exec('git',['-C',directory,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','-qm','fixture'])
 }
 const worktree=join(parent,'first-worktree');await exec('git',['-C',root,'worktree','add','--detach',worktree])
 await initialiseWorkspaceStore(cache);const store=new WorkspaceStore(cache);stores.push(store)
 return {parent,root,second,worktree,cache,store}
}
it('reopens current indexes, invalidates cursor identity and incrementally reuses only hash-matching files',async()=>{
 const f=await fixture();let navigation=new RepositoryNavigation(f.root,undefined,f.store)
 const cold=await navigation.refresh();expect(cold.reuse).toEqual({restored:false,reusedFiles:0,parsedFiles:2,removedFiles:0})
 navigation=new RepositoryNavigation(f.root,undefined,f.store);expect(await navigation.restoreFromCache()).toBe(true)
 const restored=await navigation.status();expect(restored.generation).not.toBe(cold.generation);expect(restored.reuse?.restored).toBe(true)
 expect((await navigation.search({term:'originalMarker'})).results).toHaveLength(1)
 await writeFile(join(f.root,'a.ts'),'export const replacementMarker = 3\n')
 const next=new RepositoryNavigation(f.root,undefined,f.store);expect(await next.restoreFromCache()).toBe(false);expect(next.built).toBe(false)
 const changed=await next.refresh();expect(changed.reuse?.reusedFiles).toBe(1);expect(changed.reuse?.parsedFiles).toBe(1)
 expect((await next.search({term:'originalMarker'})).results).toHaveLength(0)
 expect((await next.search({term:'replacementMarker'})).results).toHaveLength(1)
 await rm(join(f.root,'b.ts'));await writeFile(join(f.root,'c.ts'),'export const addedMarker = 4\n')
 const deleted=await next.refresh();expect(deleted.reuse?.removedFiles).toBe(1);expect((await next.search({term:'unchangedMarker'})).results).toHaveLength(0)
})
it('rejects a snapshot that lacks a newly eligible file and indexes it on refresh',async()=>{
 // A snapshot from a release that did not index HTML lists no .html files; the live walk does.
 const f=await fixture();await new RepositoryNavigation(f.root,undefined,f.store).refresh()
 await mkdir(join(f.root,'site'));await writeFile(join(f.root,'site','index.html'),'<h1>siteMarker</h1>\n')
 const next=new RepositoryNavigation(f.root,undefined,f.store);expect(await next.restoreFromCache()).toBe(false);expect(next.built).toBe(false)
 const refreshed=await next.refresh();expect(refreshed.reuse).toEqual({restored:false,reusedFiles:2,parsedFiles:1,removedFiles:0})
 expect((await next.search({term:'siteMarker'})).results.map(r=>r.path)).toEqual(['site/index.html'])
})
it('does not reuse foreign-root snapshots or policy-excluded evidence',async()=>{
 const f=await fixture(),a=new RepositoryNavigation(f.root,undefined,f.store);await a.refresh()
 f.store.put(workspaceKey('index',f.second),'index',f.store.get(workspaceKey('index',f.root)))
 const b=new RepositoryNavigation(f.second,undefined,f.store);expect(await b.restoreFromCache()).toBe(false)
 await writeFile(join(f.root,'.gitignore'),'a.ts\n')
 const changed=new RepositoryNavigation(f.root,undefined,f.store);expect(await changed.restoreFromCache()).toBe(false);await changed.refresh()
 expect((await changed.search({term:'originalMarker'})).results).toHaveLength(0)
 const catalogue=await discoverWorkspace(f.parent,f.store)
 expect(catalogue.repositories.map(r=>r.root).sort()).toEqual([f.root,f.second,f.worktree].sort())
})
it('shares advisory claims and addressed notes across processes/worktrees without cross-project leakage',async()=>{
 const f=await fixture(),otherStore=new WorkspaceStore(f.cache);stores.push(otherStore)
 const a=new RepositoryCoordination(f.store),b=new RepositoryCoordination(otherStore),stranger=new RepositoryCoordination(f.store)
 const update=(expectedRoot:string,slot:string)=>({expectedRoot,slot,label:slot,task:'Change source',paths:['src/'],state:'working' as const,expectedRevision:0,ttlSeconds:900})
 const first=await a.update(update(f.root,'a')),second=await b.update(update(f.worktree,'b'))
 expect(second.conflicts[0].agentId).toBe(first.agent.agentId);expect(second.conflicts[0].sameCheckout).toBe(false)
 await expect(a.update(update(f.root,'a'))).rejects.toThrow(/revision changed/)
 const message={expectedRoot:f.root,slot:'a',recipientAgentId:second.agent.agentId,messageId:randomUUID(),text:'I am editing src/x.ts; please take its tests.'}
 await expect(a.send({...message,recipientAgentId:'__proto__'})).rejects.toThrow(/publish activity/)
 expect((await a.send(message)).duplicate).toBe(false);expect((await a.send(message)).duplicate).toBe(true)
 await expect(a.send({...message,text:'different'})).rejects.toThrow(/different content/)
 const read={expectedRoot:f.worktree,afterMessage:0,offset:0,maxBytes:16384}
 expect((await b.read(read)).messages[0].text).toBe(message.text)
 expect((await stranger.read(read)).messages).toHaveLength(0)
 expect((await b.read({...read,expectedRoot:f.second})).agents).toHaveLength(0)
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+901000)
 expect((await b.read(read)).agents.every(agent=>!agent.active)).toBe(true)
 const third=await stranger.update(update(f.root,'c'));expect(third.conflicts).toHaveLength(0)
 await expect(a.update({...update(f.root,'invalid'),paths:['../outside']})).rejects.toThrow()
 await expect(a.update({...update(f.root,'invalid'),paths:['src//']})).rejects.toThrow()
})

it('indexes real source above one MiB while declaring excluded oversized bundle-named outputs',async()=>{
 const f=await fixture()
 await writeFile(join(f.root,'large.ts'),'export const largeSourceMarker = 1;\n'+'// filler\n'.repeat(120000))
 await writeFile(join(f.root,'planner-bundle.js'),'x'.repeat(2*1024*1024+1))
 const navigation=new RepositoryNavigation(f.root,undefined,f.store),status=await navigation.refresh()
 expect(status.exclusions.oversizedFiles).toBe(1)
 expect((await navigation.search({term:'largeSourceMarker'})).results).toHaveLength(1)
 expect((await navigation.status()).freshness).toBe('current')
 const next=new RepositoryNavigation(f.root,undefined,f.store);expect(await next.restoreFromCache()).toBe(true)
})

it('records inaccessible candidates without aborting discovery of accessible checkouts',async()=>{
 const f=await fixture(),denied=join(f.parent,'denied');await mkdir(denied)
 if(process.platform==='win32'||process.getuid?.()===0)return
 await chmod(denied,0o000)
 try{const catalogue=await discoverWorkspace(f.parent,f.store);expect(catalogue.repositories.length).toBe(3);expect(catalogue.skipped.some(entry=>entry.path===denied)).toBe(true)}finally{await chmod(denied,0o700)}
})

it('does not inherit another repository’s activity after replacing its Git directory at the same path',async()=>{
 const f=await fixture(),coordination=new RepositoryCoordination(f.store)
 await coordination.update({expectedRoot:f.second,slot:'old',label:'old project',task:'Old work',paths:['.'],state:'working',expectedRevision:0,ttlSeconds:900})
 await rename(f.second,join(f.parent,'old-second'));await mkdir(f.second);await exec('git',['init','-q',f.second])
 expect((await coordination.read({expectedRoot:f.second,offset:0,afterMessage:0,maxBytes:16384})).agents).toHaveLength(0)
})
