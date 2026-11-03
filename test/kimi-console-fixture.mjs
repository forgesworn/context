// Deterministic ACP protocol double; actual fixture edits and regression, no inference.
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { consoleFixture } from './agent-console-fixture.mjs'
export async function kimiConsoleFixture(dist) {
  const f = await consoleFixture(dist), executable = join(f.temp, 'fake-kimi'), mode = join(f.temp, 'mode.txt')
  await writeFile(mode, 'normal')
  await writeFile(executable, '#!/usr/bin/env node\n' + `
import{createInterface}from'node:readline';import{appendFileSync,readFileSync,writeFileSync}from'node:fs';import{execFileSync}from'node:child_process';
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n'),trace=${JSON.stringify(f.trace)},mode=readFileSync(${JSON.stringify(mode)},'utf8');
const thread='session_00000000-0000-4000-8000-000000000001',tool='owned-tool';let promptId,objective='',phase='';
appendFileSync(trace,JSON.stringify({argv:process.argv.slice(2)})+'\\n');
const update=u=>send({method:'session/update',params:{sessionId:thread,update:u}});
const done=reason=>send({id:promptId,result:{stopReason:reason}});
const form=multi=>({sessionId:thread,mode:'form',message:'Which verification should I run?',requestedSchema:{type:'object',properties:{verification:multi?{type:'array',title:'Verification',minItems:1,items:{anyOf:[{const:'Regression',description:'Run the regression test.'},{const:'Lint',description:'Run lint.'}]}}:{type:'string',title:'Which verification should I run?',oneOf:[{const:'Regression',description:'Run the regression test.'},{const:'None',description:'Skip tests.'}]}},required:['verification']}});
const nativeInput={command:'node --test --test-reporter=tap regression.test.mjs',source:'after\\n'};
function approve(){phase='approval';update({sessionUpdate:'tool_call',toolCallId:tool,title:'Bash',kind:'execute',status:'pending',...(objective.includes('streamed-input')?{content:[{type:'content',content:{type:'text',text:JSON.stringify(nativeInput)}}]}:objective.includes('partial-input')?{content:[{type:'content',content:{type:'text',text:'{"command":'}}]}:objective.includes('display-only')?{}:{rawInput:nativeInput})});send({id:'approval',method:'session/request_permission',params:{sessionId:thread,toolCall:{toolCallId:tool,title:'Bash',content:[{type:'content',content:{type:'text',text:'Review the exact fixture operation'}}]},options:[{optionId:'once',kind:'allow_once',name:'Allow once'},{optionId:'always',kind:'allow_always',name:'Allow for session'},{optionId:'reject',kind:'reject_once',name:'Reject'}]}});
if(objective.includes('changed-preview'))setTimeout(()=>update({sessionUpdate:'tool_call_update',toolCallId:tool,rawInput:{command:'changed operation'}}),100);
if(objective.includes('cancel-request'))setTimeout(()=>{send({method:'$/cancel_request',params:{requestId:'approval'}});done('end_turn')},100)
}
const regression="import{test}from'node:test';import{readFileSync}from'node:fs';import assert from'node:assert/strict';test('exact contents',()=>assert.equal(readFileSync('source.txt','utf8'),'after\\\\n'))\\n";
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);appendFileSync(trace,JSON.stringify(m)+'\\n');
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:mode==='no-resume'?{}:{resume:{}}}}});
 else if(['session/new','session/resume'].includes(m.method))send({id:m.id,result:{sessionId:mode==='wrong-session'&&m.method==='session/resume'?'session_00000000-0000-4000-8000-000000000099':thread,configOptions:mode==='missing-settings'?[]:[{id:'model',currentValue:mode==='model-change'?'native-provider/other-model':mode==='provider-change'?'other-provider/native-model':'native-provider/native-model'},{id:'mode',currentValue:'default'}]}});
 else if(m.method==='session/prompt'){
 promptId=m.id;objective=m.params.prompt[0].text;update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Inspecting the selected fixture.'}});
 if(objective.includes('cancel-ack-only')||objective.includes('cancel-result')||objective.includes('cancel-success'))return;
 if(objective.includes('bad-session')){send({method:'session/update',params:{sessionId:'unowned',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Wrong session'}}}});return}
 if(objective.includes('unsupported')){send({id:'unsupported',method:'terminal/create',params:{sessionId:thread,command:'do-not-run'}});return}
 if(objective.includes('secret')){const p=form(false);p.requestedSchema.properties.verification.format='password';send({id:'form',method:'elicitation/create',params:p});return}
 if(objective.includes('url-form')){send({id:'form',method:'elicitation/create',params:{sessionId:thread,mode:'url',message:'Login',url:'https://example.invalid'}});return}
 if(objective.includes('ask-question')||objective.includes('multi-question')){phase='form';send({id:'form',method:'elicitation/create',params:form(objective.includes('multi-question'))})}
 else if(objective.includes('read-only')){update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:' Verified the saved session.'}});done('end_turn')}
 else approve();
 }else if(m.method==='session/cancel'){
 if(objective.includes('cancel-result'))done('cancelled');else if(objective.includes('cancel-success'))done('end_turn');
 }else if(m.id==='form'){
 if(m.result?.action!=='accept'){done('end_turn');return}
 const v=m.result.content.verification;if(v!=='Regression'&&JSON.stringify(v)!=='["Regression","Lint"]')throw Error('Wrong native form answer');approve();
 }else if(m.id==='approval'){
 if(m.result?.outcome?.outcome==='cancelled'){if(!objective.includes('cancel-request'))done('cancelled');return}
 if(m.result?.outcome?.optionId!=='once'){done('end_turn');return}
 writeFileSync('source.txt','after\\n');writeFileSync('regression.test.mjs',regression);
 const output=execFileSync(process.execPath,['--test','--test-reporter=tap','regression.test.mjs'],{encoding:'utf8'});
 update({sessionUpdate:'tool_call_update',toolCallId:tool,status:'completed',rawOutput:output});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:' Changed source.txt and verified the regression.'}});done('end_turn');
 }
});
`)
  await chmod(executable, 0o700)
  return { ...f, codexExecutable: f.executable, executable, mode }
}
