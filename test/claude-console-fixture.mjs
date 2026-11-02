// Native Claude protocol double. Edits/tests are real; no model inference.
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { consoleFixture } from './agent-console-fixture.mjs'

export async function claudeConsoleFixture(dist) {
  const f = await consoleFixture(dist)
  const executable = join(f.temp, 'fake-claude'), mode = join(f.temp, 'mode.txt')
  await writeFile(mode, 'normal')
  await writeFile(executable, '#!/usr/bin/env node\n' + `
import{createInterface}from'node:readline';import{appendFileSync,readFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const args=process.argv.slice(2),session=args.find(a=>a.startsWith('--session-id=')||a.startsWith('--resume='))?.split('=')[1];
const mode=readFileSync(${JSON.stringify(mode)},'utf8'),trace=${JSON.stringify(f.trace)};
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
appendFileSync(trace,JSON.stringify({argv:args})+'\\n');let objective='',phase='';
const result=error=>send({type:'result',subtype:error?'error_during_execution':'success',is_error:!!error,session_id:session,result:error?'Owner declined':'Changed source.txt and verified the regression.'});
const ask=(id,tool,input)=>{phase=id;send({type:'control_request',request_id:id,request:{subtype:'can_use_tool',tool_name:tool,input,permission_suggestions:[{type:'setMode',mode:'bypassPermissions',destination:'session'}]}})};
const regression="import{readFileSync}from'node:fs';import assert from'node:assert/strict';assert.equal(readFileSync('source.txt','utf8'),'after\\\\n')\\n";
function writeRequest(){ask('write','Write',{file_path:process.cwd()+'/source.txt',content:'after\\n'})}
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);appendFileSync(trace,JSON.stringify(m)+'\\n');
 if(m.type==='control_request'){
  const r=m.request;let response={};
  if(r.subtype==='initialize')response={account:{apiProvider:mode==='provider-change'?'other-provider':'fixture-native-provider',email:'PRIVATE_ACCOUNT_MARKER'},current_permission_mode:'manual',session_state:'idle'};
  else if(r.subtype==='get_settings')response={applied:mode==='missing-settings'?{}:{model:mode==='model-change'?'other-model':'fixture-native-model'},effective:{env:{SECRET_TOKEN:'PRIVATE_SECRET_MARKER'},sandbox:{enabled:true,autoAllowBashIfSandboxed:false}}};
  else if(r.subtype==='interrupt'){}else throw Error('Unexpected host control');
  send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response}});
  if(r.subtype==='interrupt'&&objective.includes('interrupt-result'))result(false);
 }else if(m.type==='user'){
  objective=m.message.content;
  send({type:'system',subtype:'init',session_id:session,cwd:mode==='wrong-cwd'?'/wrong':process.cwd(),model:'fixture-native-model'});
  if(mode==='wrong-cwd')return;
  if(objective.includes('bad-session')){send({type:'result',subtype:'success',is_error:false,session_id:'unowned',result:'Wrong session'});return}
  if(objective.includes('interrupt-ack-only')||objective.includes('interrupt-result'))return;
  if(objective.includes('unsupported')){send({type:'control_request',request_id:'unsupported',request:{subtype:'elicitation',input:{}}});return}
  if(objective.includes('oversized')){ask('oversized','Write',{content:'x'.repeat(25000)});return}
  if(objective.includes('secret-question')){ask('secret','AskUserQuestion',{questions:[{header:'Secret',question:'Password?',isSecret:true}]});return}
  send({type:'stream_event',session_id:session,event:{type:'content_block_delta',delta:{type:'text_delta',text:'Inspecting the selected fixture.'}}});
  if(objective.includes('ask-question'))ask('question','AskUserQuestion',{questions:[{header:'Verification',question:'Which verification should I run?',options:[{label:'Regression',description:'Run the regression test.'}],multiSelect:false}]});
  else if(objective.includes('cancel-request')){ask('cancelled','Bash',{command:'do-not-run'});setTimeout(()=>{send({type:'control_cancel_request',request_id:'cancelled'});result(false)},100)}
  else if(objective.includes('read-only'))result(false);
  else writeRequest();
 }else if(m.type==='control_response'){
  const r=m.response.response;
  if(!r||r.behavior!=='allow'){result(true);return}
  if(phase==='question'){
   if(r.updatedInput.answers?.['Which verification should I run?']!=='Run the regression test.')throw Error('Missing native question answer');writeRequest();
  }else if(phase==='write'){
   if(r.updatedPermissions||JSON.stringify(r.updatedInput)!==JSON.stringify({file_path:process.cwd()+'/source.txt',content:'after\\n'}))throw Error('Approval changed native input or permissions');
   writeFileSync('source.txt','after\\n');writeFileSync('regression.test.mjs',regression);
   const output=execFileSync(process.execPath,['--test','--test-reporter=tap','regression.test.mjs'],{encoding:'utf8'});
   send({type:'assistant',session_id:session,message:{content:[{type:'tool_use',id:'test',name:'Bash',input:{command:'node --test --test-reporter=tap regression.test.mjs'}}]}});
   send({type:'user',session_id:session,message:{content:[{type:'tool_result',tool_use_id:'test',content:output,is_error:false}]}});
   result(false);
  }
 }
});
`)
  await chmod(executable, 0o700)
  return { ...f, codexExecutable: f.executable, executable, mode }
}
