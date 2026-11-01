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
 const publish={slot:'agent',label:'test agent',task:'Edit source '+ 'fixture metadata '.repeat(30),paths:['source.ts'],state:'working',expectedRevision:0,ttlSeconds:900}
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
 // Owner-visible read-only activity: actual installed CLI, not source imports.
 const beforeView=await call(first,'repository_coordination',a)
 const view=run(['activity',parent,'--json'])
 assert.equal(view.rows.length,2)
 assert.equal(new Set(view.rows.map(row=>row.agentId)).size,2)
 assert.ok(view.rows.every(row=>row.active))
 assert.ok(!JSON.stringify(view).includes(note.text),'activity must not disclose addressed notes')
 assert.ok(!JSON.stringify(view).includes('commonDirectory'),'only owner-visible checkout fields are returned')
 const printedBudget=Buffer.byteLength(JSON.stringify(view))+64
 const boundedJson=execFileSync(process.execPath,[cli,'workspace','activity',parent,'--cache-dir',cache,'--json','--max-bytes',String(printedBudget)],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
 assert.ok(Buffer.byteLength(boundedJson)<=printedBudget,'activity JSON stdout must fit the requested byte budget')
 const single=run(['activity',parent,'--json','--repo',a]);assert.equal(single.rows.length,1);assert.equal(single.rows[0].checkoutRoot,a)
 const limited=run(['activity',parent,'--json','--limit','1']);assert.equal(limited.rows.length,1);assert.equal(limited.complete,false)
 const human=execFileSync(process.execPath,[cli,'workspace','activity',parent,'--cache-dir',cache],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
 assert.match(human,/test agent/);assert.match(human,/Edit source/);assert.match(human,/advisory/i)
 const afterView=await call(first,'repository_coordination',a);assert.equal(afterView.boardRevision,beforeView.boardRevision)
 // A shell-only host uses the installed package and a stable task connection.
 const shellInput=[
  {id:1,name:'repository_refresh'},
  {id:2,name:'repository_search',arguments:{term:'sharedPrivateMarker',format:'json'}},
  {id:3,name:'repository_status',arguments:{expectedRoot:b}},
  {id:4,name:'close'},
 ].map(value=>JSON.stringify(value)).join('\n')+'\n'
 const shellOutput=execFileSync(process.execPath,[cli,'connect',a,'--cache-dir',cache,'--label','installed shell host','--task','Inspect installed source','--path','source.ts'],{input:shellInput,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000})
 const shellFrames=shellOutput.trimEnd().split('\n').map(line=>JSON.parse(line))
 assert.equal(shellFrames.length,5);assert.equal(shellFrames[0].event,'ready');assert.equal(shellFrames[0].nativeToolDiscovery,false)
 assert.equal(shellFrames[0].activity.agent.checkout.root,a)
 assert.equal(shellFrames[1].isError,false);assert.equal(shellFrames[2].result.generation,shellFrames[1].result.generation)
 assert.ok(shellFrames[2].result.results[0].text.includes('sharedPrivateMarker'))
 assert.equal(shellFrames[3].isError,true);assert.equal(shellFrames[4].isError,false)
 const shellAgentId=shellFrames[0].activity.agent.agentId
 const afterShell=await call(first,'repository_coordination',a)
 assert.equal(afterShell.agents.find(row=>row.agentId===shellAgentId).state,'done')
 assert.equal(afterShell.agents.find(row=>row.agentId===shellAgentId).active,false)
 await call(first,'repository_activity',a,{...publish,state:'done',expectedRevision:1})
 assert.equal(run(['activity',parent,'--json']).rows.length,1)
 const history=run(['activity',parent,'--json','--all']);assert.equal(history.rows.length,3);assert.equal(history.rows.filter(row=>!row.active).length,2)
 assert.throws(()=>run(['activity',parent,'--json','--repo',parent]))
 const badRoot=join(parent,'missing\u001b[31m\nFORGED\u202e')
 let failure
 try{run(['activity',badRoot])}catch(error){failure=error}
 assert.ok(failure)
 const diagnostic=String(failure.stderr)
 assert.ok(!/[\u001b\u202e]/u.test(diagnostic),'activity error output must be terminal-safe')
 assert.equal(diagnostic.trimEnd().split('\n').length,1,'activity error must not forge terminal lines')
 assert.ok(Buffer.byteLength(diagnostic)<=4096)
 const absentCache=join(parent,'existing-key-missing-db');await mkdir(absentCache,{mode:0o700})
 await writeFile(join(absentCache,'key'),await readFile(join(cache,'key')),{mode:0o600})
 assert.throws(()=>execFileSync(process.execPath,[cli,'workspace','activity',parent,'--cache-dir',absentCache],{stdio:'pipe'}))
 assert.deepEqual(await readdir(absentCache),['key'],'the activity viewer must not initialise a lost database')


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
