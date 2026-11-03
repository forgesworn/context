// External helper double: validates controller integration, never contacts a provider.
import { writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { consoleFixture } from './agent-console-fixture.mjs'

export async function ollamaConsoleFixture(dist) {
  const f = await consoleFixture(dist), profile = join(f.temp, 'ollama-profile.json'), mode = join(f.temp, 'worker-mode'), workerTrace = join(f.temp, 'worker-trace.jsonl'), helper = join(f.temp, 'worker-helper.mjs')
  await writeFile(join(f.root, 'source.mjs'), "export const value = 'before'\n")
  f.git(['add', 'source.mjs']); f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'bounded worker source fixture'])
  const settings = { version: 1, python: process.execPath, helper, engineeringAdapter: helper, endpoint: 'http://127.0.0.1:11435', model: 'deepseek-v4.1-flash:cloud', think: 'false', maxOutput: 4096, timeoutSeconds: 5, routeReason: 'Deterministic fixture only; no model inference', verification: { executable: process.execPath, args: ['--test', '--test-reporter=tap', 'regression.test.mjs'], timeoutSeconds: 10 } }
  await writeFile(profile, JSON.stringify(settings), { mode: 0o600 }); await chmod(profile, 0o600)
  await writeFile(mode, '')
  await writeFile(helper, `
import{readFileSync,writeFileSync,appendFileSync,mkdirSync}from'node:fs';import{join}from'node:path';
const args=process.argv.slice(2),commands=['status','inventory','check','run','review'],command=args.find(a=>commands.includes(a)),get=k=>args[args.indexOf(k)+1],endpoint=get('--endpoint'),mode=readFileSync(${JSON.stringify(mode)},'utf8');
appendFileSync(${JSON.stringify(workerTrace)},JSON.stringify({command,args})+'\\n');
if(command==='status')console.log(JSON.stringify({endpoint,pending:mode==='pending'}));
else if(command==='inventory')console.log(JSON.stringify({endpoint,models:mode==='no-models'?[]:['deepseek-v4.1-flash:cloud']}));
else if(command==='check')console.log(JSON.stringify({status:'ready'}));
else if(command==='review'){const data={disposition:get('--disposition'),reason:get('--reason')};writeFileSync(join(get('--output-dir'),'review.json'),JSON.stringify(data),{mode:0o600,flag:'wx'});console.log(JSON.stringify(data))}
else if(command==='run'){
 const out=get('--output-dir');mkdirSync(out,{mode:0o700});
 if(mode==='hold'){setInterval(()=>{},1000)}else{
 const status=['refused','truncated','unknown','unusable'].includes(mode)?mode:'success';
 const receipt={status,model:get('--model'),endpoint,think:false,doneReason:status==='truncated'?'length':'stop',reportedTokens:{prompt:12,completion:20,total:32},duration:0.01};if(mode==='wrong-model')receipt.model='unexpected';
 writeFileSync(join(out,'receipt.json'),JSON.stringify(receipt),{mode:0o600});
 const regression="import test from 'node:test';import assert from 'node:assert/strict';import {value} from './source.mjs';test('fixture value',()=>assert.equal(value,'after'));\\n";
 const changes=[{path:mode==='outside'?'outside.mjs':'source.mjs',content:"export const value = 'after'\\n"},{path:'regression.test.mjs',content:regression}];
 if(mode==='duplicate')changes.push(changes[0]);if(mode==='oversized')changes[0].content='a'.repeat(26000);if(mode==='ill-formed')changes[0].content=String.fromCharCode(0xd800);
 let draft={summary:'Proposed fixture update. These are draft claims, not executed checks.',changes:mode==='readonly'?[]:changes};if(mode==='commands')draft.commands=['touch should-not-exist'];
 writeFileSync(join(out,'answer.txt'),mode==='malformed'?'not json':JSON.stringify(draft),{mode:0o600});console.log(JSON.stringify(receipt));if(status!=='success')process.exitCode=2;
 }
}else process.exitCode=2;
`)
  return { ...f, profile, settings, mode, workerTrace }
}
