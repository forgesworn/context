import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, statSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { importCliUsage, importUsage, importWorkerUsage, summariseUsage, startUsage, finishUsage } from '../scripts/daily-usage.mjs';

const at='2026-11-02T00:01:00.000Z';
const spec=(client='codex',extra={})=>({version:1,taskId:'startup',developerId:'owner',accountId:'account-'+client,repositoryId:'context',category:'development',client,sessionId:'session-'+client,from:'2026-11-02T00:00:00.000Z',to:'2026-11-02T01:00:00.000Z',phase:'review',contextUsed:true,accepted:null,reviewSeconds:null,coverage:{allAttempts:null,hostPreparation:null,workers:null,review:null},attemptId:'attempt-1',at,exitCode:0,...(client==='claude'?{freshSession:true}:{}),...extra});
const jsonl=events=>events.map(e=>JSON.stringify(e)).join('\n')+'\n';
const codex=(usage={input_tokens:100,cached_input_tokens:60,cache_write_input_tokens:20,output_tokens:10,reasoning_output_tokens:3})=>[
  {type:'thread.started',thread_id:'session-codex'},{type:'turn.started'},
  {type:'item.completed',item:{type:'agent_message',text:'PRIVATE_PROSE /secret/path https://private.invalid secret-token'}},
  {type:'turn.completed',usage},
];
const claude=(usage={input_tokens:10,cache_read_input_tokens:70,cache_creation_input_tokens:20,output_tokens:12,output_tokens_details:{thinking_tokens:4},cache_creation:{ephemeral_1h_input_tokens:20}})=>[
  {type:'system',subtype:'init',session_id:'session-claude'},
  {type:'assistant',session_id:'session-claude',message:{id:'request-1',content:'PRIVATE_PROSE',usage:{input_tokens:999,output_tokens:999}}},
  {type:'result',session_id:'session-claude',uuid:'result-1',usage,modelUsage:{'claude-opus-5-5':{inputTokens:999}},total_cost_usd:999,result:'PRIVATE_PROSE'},
];
const kimi=()=>[{type:'system.version',role:'system',version:'2.4.1'},{role:'assistant',content:'PRIVATE_PROSE'},{type:'session.resume_hint',session_id:'session-kimi',command:'PRIVATE_PROSE'}];
const rehash=receipt=>{const {integritySha256,...body}=receipt;return {...body,integritySha256:createHash('sha256').update(JSON.stringify(body)).digest('hex')};};

test('Codex invocation imports only terminal turn usage, keeps subsets and strips source prose',()=>{
  const receipt=importCliUsage(jsonl(codex()),spec());
  assert.equal(receipt.schema,'context-daily-cli-usage-v1');
  assert.equal(receipt.usage.totalTokens.completeTotal,110);
  assert.deepEqual(receipt.usage.records[0].usage,{inputTokens:100,outputTokens:10,cachedInputTokens:60,cacheWriteInputTokens:20,reasoningOutputTokens:3});
  assert.equal(receipt.usage.records[0].model,null);
  assert.equal(receipt.metadata.accepted,null);
  assert.equal(receipt.interpretation.cashSavings,null);
  assert.ok(receipt.warnings.includes('cli-invocation-time-attribution'));
  assert.ok(!JSON.stringify(receipt).includes('PRIVATE_PROSE'));
  assert.ok(!JSON.stringify(receipt).includes('/secret/path'));
});

test('Claude invocation uses the result aggregate once, keeps explicit thinking and does not import price estimates',()=>{
  const receipt=importCliUsage(jsonl(claude()),spec('claude'));
  assert.equal(receipt.usage.totalTokens.completeTotal,112);
  assert.equal(receipt.usage.records[0].usage.inputTokens,100);
  assert.equal(receipt.usage.records[0].usage.reasoningOutputTokens,4);
  assert.equal(receipt.usage.records[0].model,'claude-opus-5-5');
  assert.ok(!JSON.stringify(receipt).includes('999'));
  const mixed=claude();mixed.at(-1).modelUsage.other={inputTokens:1};
  assert.equal(importCliUsage(jsonl(mixed),spec('claude')).usage.records[0].model,null);
  assert.throws(()=>importCliUsage(jsonl(claude({input_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:2,output_tokens_details:{thinking_tokens:3}})),spec('claude')));
});

test('Kimi captures an invocation with unknown counters rather than zero usage or inferred model',()=>{
  const receipt=importCliUsage(jsonl(kimi()),spec('kimi'));
  assert.equal(receipt.usage.records.length,1);
  assert.ok(Object.values(receipt.usage.records[0].usage).every(v=>v===null));
  assert.equal(receipt.usage.totalTokens.knownSubtotal,0);
  assert.equal(receipt.usage.totalTokens.completeTotal,null);
  assert.equal(receipt.usage.totalTokens.unknownRecords,1);
  assert.equal(receipt.usage.records[0].model,null);
  assert.ok(receipt.warnings.includes('kimi-stream-counters-not-qualified'));
  const boundary=startUsage(Object.fromEntries(Object.entries(spec('kimi')).filter(([k])=>!['from','to','attemptId','at','exitCode','accepted','reviewSeconds','coverage'].includes(k))),'2026-11-02T00:00:00.000Z');
  assert.equal(finishUsage(boundary,at).client,'kimi');
});

test('Claude CLI imports require a fresh-session assertion because resumed aggregate scope is not qualified',()=>{
  const unqualified=spec('claude');delete unqualified.freshSession;
  assert.throws(()=>importCliUsage(jsonl(claude()),unqualified));
  assert.throws(()=>importCliUsage(jsonl(claude()),spec('claude',{freshSession:false})));
  assert.ok(importCliUsage(jsonl(claude()),spec('claude')).warnings.includes('claude-main-loop-only'));
});

test('four-host summary separates invocation counts and accounts while retaining legacy worker receipt support',()=>{
  const {attemptId,at:time,exitCode,...metadata}=spec('ollama',{sessionId:'ollama-workers',phase:'worker'});
  const worker=importWorkerUsage(JSON.stringify({status:'success',promptSha256:'a'.repeat(64),model:'deepseek-v4.1-flash:cloud',think:false,reportedTokens:{prompt:20,completion:5,total:25}}),{...metadata,attemptId,at:time});
  const summary=summariseUsage([importCliUsage(jsonl(codex()),spec()),importCliUsage(jsonl(claude()),spec('claude')),importCliUsage(jsonl(kimi()),spec('kimi')),worker]);
  assert.equal(summary.schema,'context-daily-summary-v2');
  assert.equal(summary.cliInvocations,3);
  assert.equal(summary.workerAttempts.success,1);
  assert.deepEqual(summary.tasks.rows[0].clients,['claude','codex','kimi','ollama']);
  assert.equal(summary.tasks.unknown,1);
  const c=summary.cohorts.find(c=>c.client==='codex');
  assert.equal(c.observedRequests,null);assert.equal(c.observedInvocations,1);
  assert.equal(c.totalTokens.completeTotal,110);
  assert.equal(summary.cohorts.find(c=>c.client==='kimi').totalTokens.completeTotal,null);
  assert.equal(summariseUsage([worker]).schema,'context-daily-summary-v1');
  assert.equal(summary.interpretation.tokenSavings,null);
});

test('same invocation copies deduplicate; status, counter and attribution conflicts reject',()=>{
  const a=importCliUsage(jsonl(codex()),spec());
  const b=importCliUsage(jsonl(codex()),spec('codex',{at:'2026-11-02T00:02:00.000Z'}));
  const summary=summariseUsage([a,a,b]);
  assert.equal(summary.duplicateReceipts,1);assert.equal(summary.duplicateRequests,1);
  assert.equal(summary.cliInvocations,1);assert.equal(summary.cohorts[0].totalTokens.completeTotal,110);
  assert.throws(()=>summariseUsage([a,importCliUsage(jsonl(codex()),spec('codex',{exitCode:1}))]));
  assert.throws(()=>summariseUsage([a,importCliUsage(jsonl(codex({input_tokens:200,output_tokens:10})),spec())]));
  assert.throws(()=>summariseUsage([a,importCliUsage(jsonl(codex()),spec('codex',{taskId:'different'}))]));
  const distinct=importCliUsage(jsonl(codex()),spec('codex',{attemptId:'attempt-2'}));
  assert.equal(summariseUsage([a,distinct]).cliInvocations,2);
});

test('aggregate and transcript receipts for one session cannot silently double-count, even across different windows',()=>{
  const {attemptId,at:time,exitCode,...metadata}=spec();
  const transcript=importUsage(jsonl([{type:'token_usage_record',timestamp:at,payload:{session_id:metadata.sessionId,response_id:'request-1',usage:{input_tokens:100,output_tokens:10}}}]),metadata);
  const invocation=importCliUsage(jsonl(codex()),spec());
  assert.throws(()=>summariseUsage([transcript,invocation]));
  const later=importCliUsage(jsonl(codex()),spec('codex',{from:'2026-11-02T02:00:00.000Z',to:'2026-11-02T03:00:00.000Z',at:'2026-11-02T02:01:00.000Z'}));
  assert.throws(()=>summariseUsage([later,transcript]));
});

test('missing or failed terminal usage stays unknown and a failed invocation retains reported paid usage',()=>{
  const failed=importCliUsage(jsonl(codex().slice(0,2).concat({type:'turn.failed',error:{message:'PRIVATE_PROSE'}})),spec('codex',{exitCode:1}));
  assert.equal(failed.usage.totalTokens.completeTotal,null);
  assert.ok(failed.warnings.includes('cli-status-failed'));
  const paid=importCliUsage(jsonl(codex()),spec('codex',{exitCode:1}));
  assert.equal(paid.usage.totalTokens.completeTotal,110);
  const partial=importCliUsage(jsonl(codex().slice(0,2)),spec('codex',{exitCode:null}));
  assert.equal(partial.usage.totalTokens.completeTotal,null);
  const noResult=importCliUsage(jsonl(claude().slice(0,1)),spec('claude',{exitCode:null}));
  assert.equal(noResult.usage.totalTokens.completeTotal,null);
});

test('wrong identity, ambiguous multi-turn/result streams and malformed counters reject',()=>{
  for(const [events,profile] of [[codex(),spec('codex',{sessionId:'wrong'})],[claude(),spec('claude',{sessionId:'wrong'})],[kimi(),spec('kimi',{sessionId:'wrong'})],[codex().concat({type:'turn.started'}),spec()],[claude().concat(claude().at(-1)),spec('claude')],[[],spec('kimi')],[codex({input_tokens:-1,output_tokens:0}),spec()],[codex(),spec('codex',{exitCode:256})],[codex(),spec('codex',{at:'2026-11-02T01:00:00.000Z'})]])assert.throws(()=>importCliUsage(jsonl(events),profile));
  assert.throws(()=>importCliUsage('{bad',spec()));
  assert.throws(()=>importCliUsage(jsonl(codex()),spec(),{sha256:'0'.repeat(64),bytes:1}));
  assert.equal(importCliUsage(jsonl(codex()),spec('codex',{attemptId:'a'.repeat(200)})).usage.records.length,1);
});

test('a terminal result followed by more turn data is not a qualified single invocation',()=>{
  const misplaced=codex().filter(e=>e.type!=='turn.started').concat({type:'turn.started'});
  assert.throws(()=>importCliUsage(jsonl(misplaced),spec()));
  assert.throws(()=>importCliUsage(jsonl(claude().concat({type:'assistant',message:{content:'new unfinished turn'}})),spec('claude')));
  assert.throws(()=>importCliUsage(jsonl(kimi().concat({role:'assistant',content:'new unfinished turn'})),spec('kimi')));
});

test('receipt validation rejects a forged known Kimi total and supports bounded repeated summary input',()=>{
  const a=importCliUsage(jsonl(kimi()),spec('kimi'));
  const forged=structuredClone(a);forged.usage.records[0].usage.inputTokens=0;
  assert.throws(()=>summariseUsage([rehash(forged)]));
  assert.equal(summariseUsage([a,a]).duplicateReceipts,1);
});

test('CLI imports explicit files privately, rejects linked inputs/overwrites, and never emits capture prose',()=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'context-cli-usage-')));
  try{
    const source=join(dir,'capture.jsonl'),profile=join(dir,'spec.json'),out=join(dir,'receipt.json');
    writeFileSync(source,jsonl(codex()));writeFileSync(profile,JSON.stringify(spec()));
    const command=[resolve('scripts/daily-usage.mjs'),'import-run','--input',source,'--spec',profile,'--out',out];
    const stdout=execFileSync(process.execPath,command,{encoding:'utf8'});
    assert.equal(JSON.parse(stdout).schema,'context-daily-cli-usage-v1');
    assert.equal(statSync(out).mode&0o777,0o600);
    assert.ok(!stdout.includes('PRIVATE_PROSE'));assert.ok(!readFileSync(out,'utf8').includes('PRIVATE_PROSE'));
    assert.throws(()=>execFileSync(process.execPath,command,{stdio:'pipe'}));
    const linked=join(dir,'linked.jsonl');symlinkSync(source,linked);
    const badOut=join(dir,'bad.json');
    assert.throws(()=>execFileSync(process.execPath,[command[0],'import-run','--input',linked,'--spec',profile,'--out',badOut],{stdio:'pipe'}));
    assert.equal(existsSync(badOut),false);
    writeFileSync(source,Buffer.from([255]));
    assert.throws(()=>execFileSync(process.execPath,[command[0],'import-run','--input',source,'--spec',profile,'--out',badOut],{stdio:'pipe'}));
  }finally{rmSync(dir,{recursive:true,force:true})}
});
