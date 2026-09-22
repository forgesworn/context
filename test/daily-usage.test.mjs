import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startUsage, finishUsage, importUsage, importWorkerUsage, summariseUsage } from '../scripts/daily-usage.mjs';

const at = second => `2026-09-22T09:00:${String(second).padStart(2,'0')}.000Z`;
const spec = (changes = {}) => ({version:1,taskId:'task-1',developerId:'dev-1',accountId:null,repositoryId:'context',category:'development',client:'codex',sessionId:'session-1',from:at(10),to:at(20),phase:'host',contextUsed:true,accepted:null,reviewSeconds:null,coverage:{allAttempts:null,hostPreparation:null,workers:null,review:null},...changes});
const request = (id, second = 12, extra = {}) => ({type:'token_usage_record',timestamp:at(second),payload:{session_id:'session-1',response_id:id,turn_id:'turn-1',usage:{input_tokens:20,output_tokens:4,cached_input_tokens:10,cache_write_input_tokens:0,reasoning_output_tokens:2,total_tokens:24},...extra}});
const context = [{type:'session_meta',payload:{id:'session-1'}},{type:'turn_context',payload:{turn_id:'turn-1',model:'gpt-6-astra',effort:'high'}}];
const log = events => events.map(e => JSON.stringify(e)).join('\n')+'\n';
const importFixture = (events = [request('response-1')], changes = {}) => importUsage(log([...context,...events]),spec(changes));
const rehash = r => {const {integritySha256,...body}=r;return {...body,integritySha256:createHash('sha256').update(JSON.stringify(body)).digest('hex')};};

const workerSpec = (changes = {}) => ({...spec(),client:'ollama',sessionId:'ollama-workers',phase:'worker',attemptId:'attempt-1',at:at(12),...changes});
const workerReceipt = (changes = {}) => ({model:'deepseek-v4.1-flash:cloud',think:false,status:'success',promptSha256:'a'.repeat(64),reportedTokens:{prompt:10,completion:5,total:15},...changes});
const workerImport = (changes = {}, metadata = {}) => importWorkerUsage(JSON.stringify(workerReceipt(changes)),workerSpec(metadata));

test('worker import strips private data and keeps requested model, unknown cache and asserted outcome separate',()=>{
  const r=workerImport({httpError:{body:'PRIVATE'},task:'PRIVATE',endpoint:'PRIVATE',routeReason:'PRIVATE'});
  assert(!JSON.stringify(r).includes('PRIVATE'));
  assert.equal(r.usage.totalTokens.completeTotal,15);
  assert.equal(r.usage.records[0].effort,'false');
  assert.equal(r.usage.totals.cachedInputTokens.completeTotal,null);
  assert.equal(r.metadata.accepted,null);
  assert(r.warnings.includes('worker-model-and-effort-requested'));
  assert.equal(summariseUsage([r]).workerAttempts.success,1);
});
test('worker copies deduplicate but a repair with the same prompt counts separately',()=>{
  const a=workerImport(),b=workerImport({task:'different ignored text'}),c=workerImport({}, {attemptId:'attempt-2'});
  const out=summariseUsage([a,a,b,c]);
  assert.equal(out.duplicateReceipts,1);assert.equal(out.duplicateRequests,1);
  assert.equal(out.workerAttempts.success,2);assert.equal(out.cohorts[0].totalTokens.completeTotal,30);
});
test('worker status retains failures and unknown attempts instead of inventing zero usage',()=>{
  for(const status of ['refused','unknown','busy','refused-pending']){
    const r=workerImport({status,reportedTokens:{prompt:null,completion:null,total:null}});
    const out=summariseUsage([r]);
    assert.equal(out.workerAttempts[status],1);assert.equal(out.cohorts[0].totalTokens.completeTotal,null);
    assert.equal(out.tasks.unknown,1);
    assert.throws(()=>workerImport({status}));
  }
  for(const status of ['truncated','unusable']){
    const out=summariseUsage([workerImport({status})]);
    assert.equal(out.workerAttempts[status],1);assert.equal(out.cohorts[0].totalTokens.completeTotal,15);
  }
});
test('worker identity, time, shape, metrics and source must be explicit and valid',()=>{
  for(const changes of [{attemptId:null},{at:at(20)},{at:'2026-02-31T09:00:12Z'},{sessionId:'another'},{client:'codex'},{phase:'host'},{extra:'private'}]) assert.throws(()=>workerImport({},changes));
  for(const changes of [{status:'invented'},{think:null},{promptSha256:'wrong'},{reportedTokens:{prompt:10,completion:5,total:99}},{reportedTokens:{prompt:true,completion:5,total:6}}]) assert.throws(()=>workerImport(changes));
  assert.throws(()=>importWorkerUsage('{PRIVATE',workerSpec()),/^Error: Invalid daily usage input$/);
  assert.throws(()=>importWorkerUsage(JSON.stringify(workerReceipt()),workerSpec(),{sha256:'b'.repeat(64),bytes:1}));
});
test('same worker attempt cannot move accounts or tasks, conflict in counters, or change status',()=>{
  const a=workerImport();
  for(const changes of [{taskId:'other'},{accountId:'other'},{repositoryId:'other'}]) assert.throws(()=>summariseUsage([a,workerImport({},changes)]));
  assert.throws(()=>summariseUsage([a,workerImport({reportedTokens:{prompt:10,completion:6,total:16}})]));
  assert.throws(()=>summariseUsage([a,workerImport({status:'truncated'})]));
  // Unrelated attempts can overlap even when assigned to different tasks.
  assert.equal(summariseUsage([a,workerImport({}, {attemptId:'other',taskId:'other'})]).tasks.count,2);
});
test('host and worker receipts aggregate one task without mixing provider cohorts',()=>{
  const out=summariseUsage([importFixture(),workerImport()]);
  assert.equal(out.tasks.count,1);assert.deepEqual(out.tasks.rows[0].clients,['codex','ollama']);
  assert.deepEqual(out.cohorts.map(c=>c.totalTokens.completeTotal),[24,15]);
  assert.equal(out.interpretation.cashSavings,null);
});
test('summary enforces worker limitations even with a recomputed checksum',()=>{
  const r=workerImport();r.warnings=r.warnings.filter(w=>w!=='worker-cache-and-reasoning-unknown');
  assert.throws(()=>summariseUsage([rehash(r)]));
  const changed=workerImport();changed.metadata.sessionIdHash='b'.repeat(64);
  assert.throws(()=>summariseUsage([rehash(changed)]));
});

test('Codex request usage excludes cumulative counters and source content', () => {
  const r=importFixture([request('response-1'),{type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:99999999}}}},{type:'response_item',payload:{secret:'DO-NOT-OUTPUT'}}]);
  assert.equal(r.usage.totalTokens.completeTotal,24);
  assert.equal(r.stats.cumulativeIgnored,1);
  assert.equal(r.usage.records[0].model,'gpt-6-astra');
  assert.equal(r.interpretation.cashSavings,null);
  assert(!JSON.stringify(r).includes('DO-NOT-OUTPUT'));
  assert(!JSON.stringify(r).includes('response-1'));
  assert(!JSON.stringify(r).includes('session-1'));
});
test('window is inclusive/exclusive and session is exact',()=>{
  const r=importFixture([request('before',9),request('start',10),request('last',19),request('end',20),request('other',12,{session_id:'other'})]);
  assert.equal(r.usage.records.length,2);assert.equal(r.stats.outsideWindow,2);assert.equal(r.stats.otherSession,1);
});
test('old cumulative-only Codex exports are visibly incomplete, never zero total',()=>{
  const r=importFixture([{type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100}}}}]);
  assert.equal(r.usage.totalTokens.completeTotal,null);assert(r.warnings.includes('no-selected-request-usage'));
});
test('missing usage and matching missing identities remain visible',()=>{
  const r=importFixture([request('r',12,{usage:null}),request(undefined),{type:'token_usage_record',timestamp:at(12),payload:{}}]);
  assert.equal(r.usage.records.length,1);assert.equal(r.usage.totalTokens.completeTotal,null);assert.equal(r.stats.missingIdentity,2);
});
test('malformed matching events fail without exposing private data',()=>{
  for(const e of [request('r',12,{usage:{input_tokens:-1}}),{...request('r'),timestamp:'PRIVATE'},request('bad/id')]) assert.throws(()=>importFixture([e]));
});
test('Claude usage includes both cache input components once',()=>{
  const event={type:'assistant',timestamp:at(12),sessionId:'session-1',message:{id:'msg-1',model:'claude-sonnet-5',content:[{text:'PRIVATE'}],usage:{input_tokens:5,cache_read_input_tokens:10,cache_creation_input_tokens:20,output_tokens:3,cache_creation:{ephemeral_5m_input_tokens:20}}}};
  const r=importUsage(log([event,event]),spec({client:'claude'}));
  assert.equal(r.usage.totalTokens.completeTotal,38);assert.equal(r.usage.duplicates,1);assert.equal(r.usage.records[0].effort,null);
  assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('conflicting Claude partial messages are unknown rather than summed',()=>{
  const a={type:'assistant',timestamp:at(12),sessionId:'session-1',message:{id:'msg-1',model:'claude-opus-5',usage:{input_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:1}}};
  const b=structuredClone(a);b.message.usage.output_tokens=2;
  const r=importUsage(log([a,b]),spec({client:'claude'}));
  assert.equal(r.usage.conflicts,1);assert.equal(r.usage.totalTokens.completeTotal,null);
});
test('unknown Claude cache counters preserve known output, not zero input',()=>{
  const r=importUsage(log([{type:'assistant',timestamp:at(12),sessionId:'session-1',message:{id:'msg',usage:{input_tokens:1,output_tokens:2}}}]),spec({client:'claude'}));
  assert.equal(r.usage.totals.inputTokens.completeTotal,null);assert.equal(r.usage.totals.outputTokens.completeTotal,2);
});
test('invalid JSON, invalid calendar, invalid spec keys and nonboolean assertions reject',()=>{
  assert.throws(()=>importUsage('{',spec()));
  for(const changes of [{from:'2026-02-31T00:00:00Z'},{from:at(20)},{secret:'x'},{contextUsed:1},{accountId:'a/b'},{coverage:{}}]) assert.throws(()=>importFixture([],changes));
});
test('summary deduplicates exact receipts, counts failed tasks and separates models/accounts',()=>{
  const a=importFixture([], {accepted:false});
  const b=importFixture([request('r')], {taskId:'task-2',accountId:'account-2',accepted:true});
  // Different session because two task windows cannot overlap on one session.
  const c=importUsage(log([request('r',12,{session_id:'s2'})]),spec({sessionId:'s2',taskId:'task-3',accountId:'account-3'}));
  const result=summariseUsage([a,a,c]);
  assert.equal(result.duplicateReceipts,1);assert.equal(result.tasks.count,2);assert.equal(result.tasks.rejected,1);assert.equal(result.tasks.unknown,1);
  assert.equal(result.cohorts[0].accountId,'account-3');assert.equal(result.interpretation.monthlySpend,null);
  assert.throws(()=>summariseUsage([a,b]));
});
test('summary accepts disjoint windows, retains category and does not infer savings',()=>{
  const a=importFixture([request('r1',12)],{accepted:true});
  const b=importFixture([request('r2',22)],{from:at(20),to:at(30),accepted:true});
  const r=summariseUsage([a,b]);assert.equal(r.tasks.count,1);assert.equal(r.cohorts[0].totalTokens.completeTotal,48);assert.equal(r.cohorts[0].category,'development');assert.equal(r.interpretation.tokenSavings,null);
});
test('duplicate request across adjacent same-task windows is globally counted once',()=>{
  const a=importFixture([request('r',12)]);
  const b=importFixture([request('r',22)],{from:at(20),to:at(30)});
  const before=JSON.stringify([a,b]);const out=summariseUsage([b,a]);
  assert.equal(out.duplicateRequests,1);assert.equal(out.cohorts[0].totalTokens.completeTotal,24);
  assert.equal(JSON.stringify([a,b]),before);
  const conflicting=importFixture([request('r',22)],{taskId:'other-task',from:at(20),to:at(30)});
  assert.throws(()=>summariseUsage([a,conflicting]));
});
test('summary rejects edited metrics/checksums and contradictory task attribution',()=>{
  const a=importFixture();const broken=structuredClone(a);broken.usage.totalTokens.completeTotal=999;
  assert.throws(()=>summariseUsage([broken]));assert.throws(()=>summariseUsage([rehash(broken)]));
  const b=importFixture([request('r2',22)],{from:at(20),to:at(30),repositoryId:'other'});
  assert.throws(()=>summariseUsage([a,b]));
});
test('empty and oversize summary arrays fail',()=>{assert.throws(()=>summariseUsage([]));assert.throws(()=>summariseUsage(Array(33).fill(importFixture())));});
test('re-exporting the same task request counts once across different receipts',()=>{
  const a=importFixture();
  const b=importFixture([request('response-1'),{type:'response_item',payload:{content:'ignored'}}]);
  const out=summariseUsage([a,b]);
  assert.equal(out.duplicateRequests,1);assert.equal(out.cohorts[0].totalTokens.completeTotal,24);
});
test('one task can include Codex host and Claude review with separate usage cohorts',()=>{
  const a=importFixture();
  const b=importUsage(log([{type:'assistant',timestamp:at(12),sessionId:'c',message:{id:'m',model:'claude-opus-5',usage:{input_tokens:1,cache_read_input_tokens:0,cache_creation_input_tokens:0,output_tokens:2}}}]),spec({client:'claude',sessionId:'c',phase:'review',accountId:'claude-account'}));
  const out=summariseUsage([a,b]);assert.equal(out.tasks.count,1);assert.equal(out.cohorts.length,2);assert.deepEqual(out.tasks.rows[0].clients,['claude','codex']);
});
test('session metadata switching cannot contaminate a selected turn model',()=>{
  const r=importFixture([{type:'session_meta',payload:{id:'other'}},{type:'turn_context',payload:{turn_id:'turn-1',model:'wrong',effort:'low'}},request('r')]);
  assert.equal(r.usage.records[0].model,'gpt-6-astra');
});
test('public importer rejects arbitrary source metadata and raw parse errors generically',()=>{
  assert.throws(()=>importUsage('{PRIVATE-TEXT',spec()),/^Error: Invalid daily usage input$/);
  assert.throws(()=>importUsage('',spec(),{sha256:'a'.repeat(64),bytes:0,secret:'PRIVATE'}));
});
test('summary cannot remove mandatory missing-usage warnings using a recomputed checksum',()=>{
  const a=importFixture([request('r',12,{usage:null})]);a.warnings=[];
  assert.throws(()=>summariseUsage([rehash(a)]));
});

const script=path.resolve('scripts/daily-usage.mjs');
function fixture(fn){const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'daily-usage-'));try{fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
function setup(dir){const input=path.join(dir,'events.jsonl'),sp=path.join(dir,'spec.json'),out=path.join(dir,'out.json');fs.writeFileSync(input,log([...context,request('r')]));fs.writeFileSync(sp,JSON.stringify(spec()));return{input,sp,out};}
test('CLI import/summary produce private outputs and refuse overwrite',()=>fixture(dir=>{
  const {input,sp,out}=setup(dir);const args=['import','--input',input,'--spec',sp,'--out',out];
  assert.equal(run(...args).status,0);assert.equal(fs.statSync(out).mode & 0o777,0o600);
  assert.equal(run(...args).status,2);const summary=path.join(dir,'summary.json');
  assert.equal(run('summary','--input',out,'--input',out,'--out',summary).status,0);
  assert.equal(JSON.parse(fs.readFileSync(summary)).duplicateReceipts,1);
}));
test('CLI rejects symlink source/spec/ancestors/output parents, invalid UTF8 and directories',()=>fixture(dir=>{
  const {input,sp,out}=setup(dir),link=path.join(dir,'link');fs.symlinkSync(input,link);
  const go=(i=input,s=sp,o=out)=>run('import','--input',i,'--spec',s,'--out',o);
  assert.equal(go(link).status,2);assert.equal(go(input,link).status,2);assert.equal(go(dir).status,2);
  const parent=path.join(dir,'parent');fs.symlinkSync(dir,parent);
  assert.equal(go(path.join(parent,'events.jsonl')).status,2);assert.equal(go(input,sp,path.join(parent,'new.json')).status,2);
  fs.writeFileSync(input,Buffer.from([0xc3,0x28]));const failure=go();assert.equal(failure.status,2);assert(!failure.stderr.includes(dir));assert(!fs.existsSync(out));
}));
test('CLI bounds a sparse oversized log and does not expose paths in errors',()=>fixture(dir=>{
  const {input,sp,out}=setup(dir);fs.truncateSync(input,64*1024*1024+1);
  const r=run('import','--input',input,'--spec',sp,'--out',out);assert.equal(r.status,2);assert.equal(r.stdout,'');assert(!r.stderr.includes(input));assert(!fs.existsSync(out));
}));

test('CLI imports a raw helper receipt privately, summarises it and rejects unsafe paths and oversize input',()=>fixture(dir=>{
  const input=path.join(dir,'receipt.json'),sp=path.join(dir,'spec.json'),out=path.join(dir,'out.json');
  fs.writeFileSync(input,JSON.stringify(workerReceipt()));fs.writeFileSync(sp,JSON.stringify(workerSpec()));
  const go=(i=input,o=out)=>run('import-worker','--input',i,'--spec',sp,'--out',o);
  assert.equal(go().status,0);assert.equal(fs.statSync(out).mode&0o777,0o600);
  assert.equal(go().status,2);
  const summary=path.join(dir,'summary.json');assert.equal(run('summary','--input',out,'--out',summary).status,0);
  assert.equal(JSON.parse(fs.readFileSync(summary)).workerAttempts.success,1);
  const link=path.join(dir,'link');fs.symlinkSync(input,link);assert.equal(go(link,path.join(dir,'no.json')).status,2);
  fs.truncateSync(input,4*1024*1024+1);const failed=go(input,path.join(dir,'too-large.json'));
  assert.equal(failed.status,2);assert(!failed.stderr.includes(dir));assert.equal(failed.stdout,'');
}));

const profile = (changes = {}) => {
  const {from, to, accepted, reviewSeconds, coverage, ...p} = spec();
  return {...p, ...changes};
};
test('captured boundaries feed an import with inclusive start and exclusive finish',()=>{
  for (const client of ['codex','claude']) {
    const start=startUsage(profile({client}),at(10));
    const finished=finishUsage(start,at(20));
    assert.deepEqual(finished,spec({client}));
    assert.equal(finished.accepted,null);
    assert(Object.values(finished.coverage).every(x=>x===null));
  }
  const s=finishUsage(startUsage(profile(),at(10)),at(20));
  const r=importUsage(log([...context,request('before',9),request('start',10),request('inside',19),request('end',20)]),s);
  assert.equal(r.usage.records.length,2);
  assert.equal(r.stats.outsideWindow,2);
});
test('capture refuses malformed identities, inherited outcome assertions and worker profiles',()=>{
  for(const changes of [{client:'ollama'},{sessionId:''},{repositoryId:'private/path'},{accepted:true},{coverage:{}},{contextUsed:1},{version:2}])
    assert.throws(()=>startUsage(profile(changes),at(10)));
  for(const bad of ['2026-02-31T00:00:00Z','yesterday',null]) assert.throws(()=>startUsage(profile(),bad));
});
test('finish rejects damaged boundaries and equal or reversed clocks',()=>{
  const start=startUsage(profile(),at(10));
  for(const changes of [{schema:'other'},{from:at(11)},{integritySha256:'0'.repeat(64)},{profile:profile({taskId:'other'})},{extra:true}])
    assert.throws(()=>finishUsage({...start,...changes},at(20)));
  for(const t of [at(9),at(10),'invalid']) assert.throws(()=>finishUsage(start,t));
  assert.deepEqual(start,startUsage(profile(),at(10))); // Finish never mutates the boundary.
});
test('CLI start and finish create private reusable import specs without overwriting boundaries',()=>fixture(dir=>{
  const p=path.join(dir,'profile.json'),start=path.join(dir,'start.json'),out=path.join(dir,'spec.json');
  fs.writeFileSync(p,JSON.stringify(profile()));
  const before=Date.now();
  assert.equal(run('start','--spec',p,'--out',start).status,0);
  const boundary=JSON.parse(fs.readFileSync(start));
  assert(Date.parse(boundary.from)>=before && Date.parse(boundary.from)<=Date.now());
  assert.equal(run('start','--spec',p,'--out',start).status,2);
  const finished=run('finish','--input',start,'--out',out);
  assert.equal(finished.status,0,finished.stderr);
  const s=JSON.parse(fs.readFileSync(out));
  assert.equal(s.from,boundary.from);assert(s.to>s.from);assert.equal(s.accepted,null);
  for(const f of [start,out]) assert.equal(fs.statSync(f).mode&0o777,0o600);
  assert.equal(run('finish','--input',start,'--out',out).status,2);
  assert.deepEqual(JSON.parse(fs.readFileSync(start)),boundary);
  const input=path.join(dir,'events.jsonl'),receipt=path.join(dir,'usage.json');
  fs.writeFileSync(input,log([...context,{...request('captured'),timestamp:s.from}]));
  assert.equal(run('import','--input',input,'--spec',out,'--out',receipt).status,0);
  assert.equal(JSON.parse(fs.readFileSync(receipt)).usage.records.length,1);
}));
test('capture CLI validates flags and preserves existing bounded private-path rules',()=>fixture(dir=>{
  const p=path.join(dir,'profile.json'),out=path.join(dir,'out.json'),link=path.join(dir,'link');
  fs.writeFileSync(p,JSON.stringify(profile()));fs.symlinkSync(p,link);
  for(const args of [
    ['start','--input',p],['finish','--spec',p],['start','--spec',p,'--input',p],
    ['start','--spec',p,'--spec',p],['start','--spec',link],['finish','--input',link]
  ]) {
    const r=run(...args,'--out',out);assert.equal(r.status,2);assert(!r.stderr.includes(dir));assert.equal(r.stdout,'');
  }
  fs.truncateSync(p,65537);
  assert.equal(run('start','--spec',p,'--out',out).status,2);
  assert.equal(run('finish','--input',p,'--out',out).status,2);
  assert(!fs.existsSync(out));
}));
