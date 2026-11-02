import { parseArgs } from 'node:util'
import { execFile, fork } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { isAbsolute, resolve } from 'node:path'
import { WorkspaceStore, initialiseWorkspaceStore, workspaceKey } from './workspace-store.js'
import { discoverWorkspace, describeCheckout, gitEnvironment, type WorkspaceCatalogue } from './workspace-catalogue.js'
import { RepositoryNavigation } from './repository-navigation.js'
import type { WorkspaceActivitySnapshot } from './workspace-activity-types.js'
import { renderWorkspaceActivity } from './workspace-activity-render.js'
const exec=promisify(execFile)
const ACTIVITY_ONLY=['all','json','repo','limit','max-bytes'] as const
/** A workspace result written as plain text rather than JSON (activity's default view). */
export class WorkspaceCliText {constructor(readonly text:string){}}
/** Compact transport keeps the activity snapshot inside its encoded byte budget. */
export class WorkspaceCliJson {constructor(readonly value:WorkspaceActivitySnapshot){}}
interface WarmRun {version:1;mode?:'fresh'|'missing-only';runId:string;ownerPid:number;ownerHost:string;workerPid?:number;workerTicket?:string;pendingRoot?:string;workspace:string;startedAt:number;finishedAt?:number;roots:string[];results:Record<string,{outcome:'indexed'|'failed';verifiedAt:number;durationMs:number;result?:unknown;error?:string}>}
export async function runWorkspaceCli(args:string[]){
 if(args[0]==='dashboard'){
  const {runWorkspaceDashboardCli}=await import('./workspace-dashboard.js')
  return new WorkspaceCliText(await runWorkspaceDashboardCli(args.slice(1)))
 }
 const {positionals,values}=parseArgs({args,allowPositionals:true,options:{'cache-dir':{type:'string'},resume:{type:'boolean'},'missing-only':{type:'boolean'},'max-repositories':{type:'string'},'timeout-ms':{type:'string'},priority:{type:'string',multiple:true},'warm-workspace':{type:'string'},'warm-ticket':{type:'string'},all:{type:'boolean'},json:{type:'boolean'},repo:{type:'string'},limit:{type:'string'},'max-bytes':{type:'string'}}})
 const [operation,input]=positionals
 const directory=values['cache-dir']
 if(!directory||positionals.length>(operation==='init'?1:2)||!['init','discover','warm','status','index','forget-index','activity'].includes(operation))throw new Error('workspace init|discover ROOT|warm ROOT|status ROOT|index ROOT|forget-index ROOT|activity ROOT --cache-dir ABS [--resume] [--priority ABS] [--max-repositories N] [--timeout-ms N] | activity: [--all] [--json] [--repo ABS] [--limit N] [--max-bytes N] [--timeout-ms N]')
 if(operation!=='activity'&&ACTIVITY_ONLY.some(flag=>values[flag]!==undefined))throw new Error('--all, --json, --repo, --limit and --max-bytes are only supported by workspace activity')
 if(operation==='activity'&&Object.keys(values).some(key=>key!=='cache-dir'&&key!=='timeout-ms'&&!(ACTIVITY_ONLY as readonly string[]).includes(key)))throw new Error('workspace activity accepts only --cache-dir, --all, --json, --repo, --limit, --max-bytes and --timeout-ms')
 if(operation==='init') {if(input)throw new Error('workspace init takes no root');await initialiseWorkspaceStore(directory);return {initialised:true,cacheDirectory:directory}}
 if(!input||!isAbsolute(input)||resolve(input)!==input||(operation!=='forget-index'&&await realpath(input)!==input))throw new Error('workspace operation requires a canonical absolute root')
 if(operation==='activity'){
  const integer=(name:'limit'|'max-bytes'|'timeout-ms')=>{const raw=values[name];if(raw===undefined)return undefined;if(!/^[0-9]+$/.test(raw))throw new Error(`--${name} must be a whole number`);return Number(raw)}
  const repositoryRoot=values.repo
  if(repositoryRoot!==undefined&&(!isAbsolute(repositoryRoot)||resolve(repositoryRoot)!==repositoryRoot))throw new Error('--repo requires an absolute canonical checkout root from the saved catalogue')
  const options={includeInactive:values.all===true,repositoryRoot,limit:integer('limit'),maxBytes:integer('max-bytes'),timeoutMs:integer('timeout-ms')}
  const { readWorkspaceActivity }=await import('./workspace-activity.js')
  const store=new WorkspaceStore(directory,undefined,{readOnly:true})
  let snapshot
  try{snapshot=await readWorkspaceActivity(input,store,options)}finally{store.close()}
  return values.json?new WorkspaceCliJson(snapshot):new WorkspaceCliText(renderWorkspaceActivity(snapshot,{includeInactive:options.includeInactive,maxRows:500}))
 }
 const store=new WorkspaceStore(directory)
 try{
  if(operation==='discover'){const catalogue=await discoverWorkspace(input,store);return {...catalogue,repositories:catalogue.repositories.map(repo=>({...repo,commonDirectory:undefined}))}}
  if(operation==='forget-index'){store.remove(workspaceKey('index',input));return {removed:true,root:input}}
  if(operation==='index'){
   if(values['warm-workspace']||values['warm-ticket']) {
    if(!values['warm-workspace']||!values['warm-ticket'])throw new Error('incomplete warm worker ticket')
    store.transaction(()=>{
     const key=workspaceKey('warm',values['warm-workspace']!),live=store.get<WarmRun>(key)
     if(!live||live.workerTicket!==values['warm-ticket']||live.pendingRoot!==input)throw new Error('warm worker ticket is no longer current; no indexing started')
     live.workerPid=process.pid;store.put(key,'warm',live)
    })
   }
   const started=performance.now()
   const timeout=Number(values['timeout-ms']??120000)
   if(!Number.isInteger(timeout)||timeout<100||timeout>120000)throw new Error('invalid index timeout')
   const watchdog=fork(fileURLToPath(new URL('./workspace-watchdog.js',import.meta.url)),[String(process.pid),String(timeout+2000)],{stdio:['ignore','ignore','ignore','ipc'],execArgv:[]})
   await new Promise<void>((resolve,reject)=>{
    watchdog.once('message',message=>{if(message==='ready')resolve();else reject(new Error('invalid watchdog startup'))})
    watchdog.once('error',reject);watchdog.once('exit',()=>reject(new Error('index watchdog exited before startup')))
   })
   try {
   const checkout=await describeCheckout(input),navigation=new RepositoryNavigation(input,undefined,store)
   const signal=AbortSignal.timeout(timeout)
   const restored=await navigation.restoreFromCache(signal)
   let status=restored?await navigation.status(signal):await navigation.refresh(signal)
   if(status.freshness!=='current')status=await navigation.refresh(signal)
   return {root:input,head:checkout.head,branch:checkout.branch,status,durationMs:performance.now()-started,restored}
   } finally {
    if(watchdog.exitCode===null&&watchdog.signalCode===null){
     const exited=once(watchdog,'exit');if(watchdog.connected)watchdog.send('finished');await exited
    }
   }
  }
  const runKey=workspaceKey('warm',input)
  if(operation==='status'){
   const catalogue=store.get<WorkspaceCatalogue>(workspaceKey('catalogue',input)),run=store.get<WarmRun>(runKey)
   return {workspace:input,cache:store.info(),catalogue:catalogue?{discoveredAt:catalogue.discoveredAt,checkouts:catalogue.repositories.length,retainedIndexes:catalogue.repositories.filter(repo=>store.has(workspaceKey('index',repo.root))).length,scope:catalogue.scope}:null,run:run?{mode:run.mode??'fresh',startedAt:run.startedAt,finishedAt:run.finishedAt,planned:run.roots.length,completed:Object.keys(run.results).length,indexed:Object.values(run.results).filter(r=>r.outcome==='indexed').length,failures:Object.entries(run.results).filter(([,r])=>r.outcome==='failed').map(([root,r])=>({root,error:r.error})),freshness:'individual results were verified at their recorded time; use repository tools for current checks'}:null}
  }
  if(values.resume&&values['missing-only'])throw new Error('resume uses its captured mode; do not combine --resume and --missing-only')
  const limit=Number(values['max-repositories']??2000),timeout=Number(values['timeout-ms']??120000)
  if(!Number.isInteger(limit)||limit<1||limit>2000||!Number.isInteger(timeout)||timeout<100||timeout>120000)throw new Error('workspace warm bounds: 1–2000 repositories, 100–120000 ms per checkout')
  const alive=(pid:number|undefined)=>{if(!pid||pid===process.pid)return false;try{process.kill(pid,0);return true}catch{return false}}
  const previous=store.get<WarmRun>(runKey)
  if(previous&&!previous.finishedAt&&(previous.ownerHost!==hostname()||alive(previous.ownerPid)||alive(previous.workerPid)))throw new Error('a previous workspace warm run or its bounded index worker is still active; reconcile it before resuming')
  let run=values.resume?previous:undefined
  if(values.resume&&!run)throw new Error('no interrupted warm run to resume')
  if(!run){
   const catalogue=await discoverWorkspace(input,store)
   const priority=values.priority??[]
   if(priority.some(p=>!catalogue.repositories.some(repo=>repo.root===p)))throw new Error('priority checkout is not in the discovered workspace')
   const roots=catalogue.repositories.map(repo=>repo.root).filter(root=>!values['missing-only']||priority.includes(root)||!store.has(workspaceKey('index',root))).sort((a,b)=>{const x=priority.indexOf(a),y=priority.indexOf(b);return (x<0?priority.length:x)-(y<0?priority.length:y)||a.localeCompare(b)})
   run={version:1,mode:values['missing-only']?'missing-only':'fresh',runId:randomUUID(),ownerPid:process.pid,ownerHost:hostname(),workspace:input,startedAt:Date.now(),roots,results:{}}
  }
  const current=run
  store.transaction(()=>{
   const live=store.get<WarmRun>(runKey)
   if(live&&!live.finishedAt&&(live.ownerHost!==hostname()||alive(live.ownerPid)||alive(live.workerPid)))throw new Error('another workspace warm run acquired this catalogue')
   current.ownerPid=process.pid;current.ownerHost=hostname();delete current.workerPid;delete current.workerTicket;delete current.pendingRoot;store.put(runKey,'warm',current)
  })
  const save=()=>store.transaction(()=>{const live=store.get<WarmRun>(runKey);if(live?.runId!==current.runId||live.ownerPid!==process.pid)throw new Error('workspace warm ownership changed');store.put(runKey,'warm',current)})
  const deadline=performance.now()+30*60_000
  let processed=0
  for(const root of run.roots){
   if(processed>=limit||performance.now()>=deadline)break
   if(run.results[root])continue
   const started=performance.now()
   run.workerTicket=randomUUID();run.pendingRoot=root;save()
   try{
    const work=exec(process.execPath,['--max-old-space-size=768',process.argv[1],'workspace','index',root,'--cache-dir',directory,'--timeout-ms',String(timeout),'--warm-workspace',input,'--warm-ticket',run.workerTicket],{env:gitEnvironment(),timeout:timeout+4000,maxBuffer:1024*1024,killSignal:'SIGKILL'})
    const {stdout}=await work
    run.results[root]={outcome:'indexed',verifiedAt:Date.now(),durationMs:performance.now()-started,result:JSON.parse(stdout)}
   }catch(error){const e=error as {killed?:boolean;signal?:string;code?:unknown};run.results[root]={outcome:'failed',verifiedAt:Date.now(),durationMs:performance.now()-started,error:e.killed||e.signal?'index worker stopped at its time/memory/process bound':'index failed; inspect this checkout with workspace index (no automatic source/quota exclusions changed)'}}
   delete run.workerPid;delete run.workerTicket;delete run.pendingRoot;processed++;save()
   process.stderr.write(JSON.stringify({workspaceWarm:true,completed:Object.keys(run.results).length,total:run.roots.length,root,outcome:run.results[root].outcome,durationMs:Math.round(run.results[root].durationMs)})+'\n')
  }
  if(Object.keys(run.results).length===run.roots.length)run.finishedAt=Date.now()
  run.ownerPid=0;save()
  return {workspace:input,mode:run.mode??'fresh',startedAt:run.startedAt,finishedAt:run.finishedAt,planned:run.roots.length,completed:Object.keys(run.results).length,indexed:Object.values(run.results).filter(r=>r.outcome==='indexed').length,failed:Object.values(run.results).filter(r=>r.outcome==='failed').length,resumeRequired:!run.finishedAt,cache:store.info()}
 }finally{store.close()}
}
