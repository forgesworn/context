// Deterministic protocol double. No model/provider inference is used here.
import { mkdtemp, mkdir, realpath, writeFile, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export async function consoleFixture(dist) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'z1p-console-wire-')))
  const workspace = join(temp, 'workspace'), root = join(workspace, 'project'), cache = join(temp, 'cache'), control = join(temp, 'control'), trace = join(temp, 'trace.jsonl'), executable = join(temp, 'fake-codex')
  const { initialiseWorkspaceStore, WorkspaceStore } = await import(pathToFileURL(join(dist, 'workspace-store.js')))
  const { discoverWorkspace, gitEnvironment } = await import(pathToFileURL(join(dist, 'workspace-catalogue.js')))
  await mkdir(root, { recursive: true }); await writeFile(join(root, 'source.txt'), 'before\n')
  const git = args => execFileSync('git', ['-C', root, ...args], { env: gitEnvironment(), stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  await initialiseWorkspaceStore(cache); await initialiseWorkspaceStore(control)
  const store = new WorkspaceStore(cache); try { await discoverWorkspace(workspace, store) } finally { store.close() }
  await writeFile(executable, '#!/usr/bin/env node\n' + `
import {createInterface} from 'node:readline';import{appendFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const root=process.cwd(),thread='fixture-owned-thread';let turn=0,phase='',fileMode=false;
const regressionText="import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(readFileSync('source.txt','utf8'),'after\\\\n')\\n";
const event=(method,params)=>send({method,params:{threadId:thread,...params}});
const settings=()=>({thread:{id:thread,cwd:root,status:{type:'idle'}},cwd:root,model:'fixture-configured-model',modelProvider:'fixture-configured-provider',approvalPolicy:'on-request',sandbox:{type:'workspaceWrite'}});
const complete=status=>event('turn/completed',{turn:{id:'turn-'+turn,status,items:[],error:null}});
createInterface({input:process.stdin}).on('line',line=>{
const m=JSON.parse(line);appendFileSync(${JSON.stringify(trace)},JSON.stringify(m)+'\\n');
if(m.method==='initialize')send({id:m.id,result:{userAgent:'fixture'}});
else if(m.method==='initialized'){}
else if(['thread/start','thread/resume'].includes(m.method))send({id:m.id,result:settings()});
else if(m.method==='turn/start'){
 turn++;fileMode=m.params.input[0].text.includes('file-preview');send({id:m.id,result:{turn:{id:'turn-'+turn,status:'inProgress',items:[],error:null}}});event('turn/started',{turn:{id:'turn-'+turn,status:'inProgress'}});
 event('item/agentMessage/delta',{turnId:'turn-'+turn,delta:'Inspecting the selected fixture.'});
 if(turn===1&&m.params.input[0].text.includes('ask-question')){phase='question';send({id:'question',method:'item/tool/requestUserInput',params:{threadId:thread,turnId:'turn-'+turn,itemId:'question-item',questions:[{id:'scope',header:'Scope',question:'Which verification should I run?',isOther:true,isSecret:false,options:null}],isBlocking:true,autoResolutionMs:null}})}
 else ask();
}else if(m.method==='turn/interrupt'){send({id:m.id,result:{}});setTimeout(()=>complete('interrupted'),30)}
else if(m.id==='question'){
 event('serverRequest/resolved',{requestId:m.id});if(!m.result?.answers?.scope?.answers?.length){complete('failed');return}ask();
}else if(m.id==='approval'){
 event('serverRequest/resolved',{requestId:m.id});if(m.result?.decision!=='accept'){complete('interrupted');return}
 writeFileSync('source.txt','after\\n');writeFileSync('regression.test.mjs',regressionText);
 let output,exit=0;try{output=execFileSync(process.execPath,['--test','regression.test.mjs'],{encoding:'utf8'})}catch(e){exit=1;output=String(e.stdout)}
 event('item/completed',{turnId:'turn-'+turn,item:{type:'commandExecution',command:'node --test regression.test.mjs',cwd:root,status:exit?'failed':'completed',exitCode:exit,aggregatedOutput:output}});
 event('item/completed',{turnId:'turn-'+turn,item:{type:'agentMessage',text:'Changed source.txt and ran the regression.'}});complete(exit?'failed':'completed');
}});
function ask(){phase='approval';if(fileMode){event('item/started',{turnId:'turn-'+turn,item:{id:'file-edit',type:'fileChange',changes:[{path:root+'/source.txt',kind:{type:'update'},diff:'@@ -1 +1 @@\\n-before\\n+after\\n'},{path:root+'/regression.test.mjs',kind:{type:'add'},diff:regressionText}]}});send({id:'approval',method:'item/fileChange/requestApproval',params:{threadId:thread,turnId:'turn-'+turn,itemId:'file-edit',grantRoot:null,reason:'Apply the reviewed two-file fixture change'}})}else send({id:'approval',method:'item/commandExecution/requestApproval',params:{threadId:thread,turnId:'turn-'+turn,itemId:'test-command',command:'node --test regression.test.mjs',cwd:root,reason:'Verify the requested fixture change'}})}
`)
  await chmod(executable, 0o700)
  return { temp, workspace, root, cache, control, executable, trace, cleanup: () => rm(temp, { recursive: true, force: true }) }
}
