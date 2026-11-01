// Copied into an independent tarball installation by the package smoke test.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
const cli=process.argv[2],parent=process.cwd(),cache=join(parent,'private-cache')
const run=args=>JSON.parse(execFileSync(process.execPath,[cli,'workspace',...args,'--cache-dir',cache],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}))
run(['init'])
const a=join(parent,'shared-one'),b=join(parent,'shared-two'),wt=join(parent,'shared-worktree')
for(const root of [a,b]){
 await mkdir(root);await writeFile(join(root,'source.ts'),'export const sharedPrivateMarker = 7\n')
 const git=args=>execFileSync('git',['-C',root,...args],{env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_'))),stdio:'pipe'})
 git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','-qm','fixture'])
}
execFileSync('git',['-C',a,'worktree','add','--detach',wt],{stdio:'pipe',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('GIT_')))})
const discovered=run(['discover',parent]);assert.ok(discovered.repositories.some(r=>r.root===wt))
const partial=run(['warm',parent,'--max-repositories','1','--priority',a]);assert.equal(partial.completed,1);assert.equal(partial.resumeRequired,true)
const resumed=run(['warm',parent,'--resume']);assert.equal(resumed.resumeRequired,false);assert.equal(resumed.failed,0)
// A resumed owner invalidates a previously spawned but unregistered worker ticket.
const { WorkspaceStore: TicketStore } = await import('@forgesworn/context-tools')
const { createHash } = await import('node:crypto')
const key=(kind,root)=>kind+':'+createHash('sha256').update(root).digest('hex')
const ticketStore=new TicketStore(cache),savedRun=ticketStore.get(key('warm',parent))
ticketStore.put(key('warm',parent),'warm',{...savedRun,workerTicket:'new-owner-ticket',pendingRoot:a})
ticketStore.remove(key('index',a));ticketStore.close()
assert.throws(()=>run(['index',a,'--warm-workspace',parent,'--warm-ticket','stale-parent-ticket']))
const checked=new TicketStore(cache);assert.equal(checked.get(key('index',a)),undefined);checked.put(key('warm',parent),'warm',savedRun);checked.close()
run(['index',a])
const warm=run(['index',a]);assert.equal(warm.restored,true);assert.equal(warm.status.reuse.parsedFiles,0)
const open=async()=>{const client=new Client({name:'independent-workspace-agent',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'session','--cache-dir',cache],cwd:parent,stderr:'pipe'}));return client}
const call=async(client,name,root,args={})=>{const result=await client.callTool({name,arguments:{expectedRoot:root,...args}});assert.notEqual(result.isError,true,result.content[0].text);return JSON.parse(result.content[0].text)}
const first=await open(),second=await open()
try{
 assert.equal((await first.listTools()).tools.length,9)
 const publish={slot:'agent',label:'test agent',task:'Edit source',paths:['source.ts'],state:'working',expectedRevision:0,ttlSeconds:900}
 const [x,y]=await Promise.all([call(first,'repository_activity',a,publish),call(second,'repository_activity',wt,publish)])
 const board=await call(first,'repository_coordination',a)
 assert.equal(board.agents.length,2);assert.ok(board.agents.some(row=>row.checkout.root===wt))
 assert.equal(x.conflicts.length+y.conflicts.length,1)
 const note={slot:'agent',recipientAgentId:y.agent.agentId,messageId:randomUUID(),text:'Please work on tests while I edit source.ts.'}
 const sent=await call(first,'repository_message',a,note);assert.equal(sent.duplicate,false)
 assert.equal((await call(first,'repository_message',a,note)).duplicate,true)
 const inbox=await call(second,'repository_coordination',wt);assert.equal(inbox.messages[0].text,note.text)
 assert.equal((await call(second,'repository_coordination',b)).agents.length,0)
 assert.equal((await call(second,'repository_coordination',b)).messages.length,0)
 const status=await call(first,'repository_status',a);assert.equal(status.reuse.restored,true)
 await writeFile(join(a,'source.ts'),'export const newerPrivateMarker = 8\n')
 const old=await call(first,'repository_status',a);assert.equal(old.freshness,'stale')
 const fresh=await call(second,'repository_refresh',a);assert.equal(fresh.reuse.parsedFiles,1)
 assert.equal((await call(second,'repository_search',a,{term:'sharedPrivateMarker',format:'json'})).results.length,0)
}finally{await first.close();await second.close()}
for(const name of await readdir(cache))if(name!=='key')assert.ok(!(await readFile(join(cache,name))).includes(Buffer.from('sharedPrivateMarker')))
// A hard timer must survive the disappearance of the batch parent, even while
// the index process blocks its own event loop.
const watchdog=new URL('../dist/workspace-watchdog.js',new URL('file://'+cli)).pathname
const pidFile=join(parent,'orphan-index-pids.json')
const busyWorker="import{fork}from'node:child_process';import{writeFileSync}from'node:fs';const w=fork(process.argv[1],[String(process.pid),'350'],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]});w.once('message',()=>{writeFileSync(process.argv[2],JSON.stringify({worker:process.pid,watchdog:w.pid}));while(true){}})"
const launcher="import{spawn}from'node:child_process';const child=spawn(process.execPath,['--input-type=module','-e',process.argv[1],process.argv[2],process.argv[3]],{stdio:'ignore'});child.unref();process.exit(0)"
execFileSync(process.execPath,['--input-type=module','-e',launcher,busyWorker,watchdog,pidFile],{stdio:'pipe'})
let orphan
const stopped=pid=>{try{return /Z/.test(execFileSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}))}catch{return true}}
try{
 const deadline=Date.now()+5000
 while(Date.now()<deadline){
  try{orphan=JSON.parse(await readFile(pidFile,'utf8'))}catch{}
  if(orphan&&stopped(orphan.worker)&&stopped(orphan.watchdog))break
  await new Promise(resolve=>setTimeout(resolve,25))
 }
 assert.ok(orphan,'orphan worker started')
 assert.ok(stopped(orphan.worker),'independent watchdog terminated the blocked orphan index')
 assert.ok(stopped(orphan.watchdog),'watchdog cleaned itself up')
}finally{
 if(orphan)for(const pid of [orphan.worker,orphan.watchdog])if(!stopped(pid)){try{process.kill(pid,'SIGKILL')}catch{}}
}
// Crash a real SQLite writer mid-transaction, then verify rollback on reopening.
const { WorkspaceStore } = await import('@forgesworn/context-tools')
assert.throws(()=>execFileSync(process.execPath,['--input-type=module','-e',"import {WorkspaceStore} from '@forgesworn/context-tools';const s=new WorkspaceStore(process.argv[1]);s.transaction(()=>{s.put('board:crash','board',{unexpected:'uncommitted'});process.kill(process.pid,'SIGKILL')})",cache],{stdio:'pipe'}))
const recovered=new WorkspaceStore(cache)
try{assert.equal(recovered.get('board:crash'),undefined);assert.ok(recovered.info().entries>0)}finally{recovered.close()}
console.log('Packed workspace: encrypted restart, batch resume, independent agents, worktree overlaps, addressed notes, deduplication, isolation and source freshness passed.')

await rm(b,{recursive:true,force:true})
assert.equal(run(['forget-index',b]).removed,true)
const forgotten=new WorkspaceStore(cache);try{assert.equal(forgotten.has(key('index',b)),false)}finally{forgotten.close()}
const missing=run(['warm',parent,'--missing-only']);assert.equal(missing.mode,'missing-only')
