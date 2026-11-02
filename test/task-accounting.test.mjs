import test from 'node:test';
import assert from 'node:assert/strict';
import { importCliUsage, importKimiUsage, reconcileTaskUsage, summariseUsage } from '../scripts/daily-usage.mjs';

const from = '2026-11-02T00:00:00.000Z', to = '2026-11-02T01:00:00.000Z', at = '2026-11-02T00:10:00.000Z';
const spec = (client = 'codex', phase = 'host') => ({ version: 1, taskId: 'feature', developerId: 'owner', repositoryId: 'context', accountId: null, category: 'development', client, sessionId: 'session-' + client,
  from, to, phase, contextUsed: true, accepted: true, reviewSeconds: 10, coverage: { allAttempts: null, hostPreparation: null, workers: null, review: null }, attemptId: client + '-attempt', at, exitCode: 0 });
const jsonl = events => events.map(e => JSON.stringify(e)).join('\n');
const receipt = () => importCliUsage(jsonl([{ type: 'thread.started', thread_id: 'session-codex' }, { type: 'turn.started' }, { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 10 } }]), spec());
const inventory = r => ({ version: 1, taskId: 'feature', repositoryId: 'context', inventoryComplete: true,
  phases: { preparation: 'not-used', host: 'used', worker: 'not-used', review: 'not-used' }, attempts: [{ id: 'host-1', client: 'codex', phase: 'host', receiptSha256: r.integritySha256 }] });
const wire = () => [{ type: 'metadata', protocol_version: '1.5', created_at: Date.parse(from) }, { type: 'turn.prompt', agentId: 'main', text: 'PRIVATE' },
  { type: 'usage.record', agentId: 'main', usageScope: 'turn', model: 'kimi-code/k3.1-pro', time: Date.parse(at), usage: { inputOther: 10, output: 3, inputCacheRead: 20, inputCacheCreation: 5 } },
  { type: 'agent.status.updated', usage: { total: { inputOther: 999999 } } }, { type: 'prompt.completed', agentId: 'main' }];
const kimi = (events = wire(), extra = {}) => importKimiUsage(jsonl(events), { ...spec('kimi'), freshSession: true, ...extra }, { sessionId: 'session-kimi', private: 'PRIVATE' });

test('whole task totals require a reconciled explicit inventory', () => {
  const r = receipt(), i = inventory(r), result = reconcileTaskUsage([r], i);
  assert.equal(result.completeAsDeclared, true); assert.equal(result.independentlyVerified, false); assert.equal(result.taskTotalTokens, 110);
  assert.equal(result.interpretation.billing, null);
  i.inventoryComplete = false;
  assert.equal(reconcileTaskUsage([r], i).taskTotalTokens, null);
});

test('missing attempts, undeclared receipts and unknown phases prevent complete task totals', () => {
  const r = receipt(), i = inventory(r);
  i.attempts.push({ id: 'repair-2', client: 'claude', phase: 'host', receiptSha256: null });
  const result = reconcileTaskUsage([r], i);
  assert.deepEqual(result.missingAttempts, ['repair-2']); assert.equal(result.taskTotalTokens, null); assert.equal(result.observed.totalTokens.knownSubtotal, 110);
  const unknown = inventory(r); unknown.phases.preparation = 'unknown';
  assert.deepEqual(reconcileTaskUsage([r], unknown).unresolvedPhases, ['preparation']);
  const undeclared = inventory(r); undeclared.attempts = [];
  assert.deepEqual(reconcileTaskUsage([r], undeclared).unassignedReceipts, [r.integritySha256]);
  assert.equal(reconcileTaskUsage([], inventory(r)).taskTotalTokens, null);
});

test('inventories reject attribution conflicts and reuse of one receipt for two attempts', () => {
  const r = receipt(), i = inventory(r);
  i.attempts.push({ ...i.attempts[0], id: 'another' }); assert.throws(() => reconcileTaskUsage([r], i));
  const wrong = inventory(r); wrong.repositoryId = 'elsewhere'; assert.throws(() => reconcileTaskUsage([r], wrong));
  const phase = inventory(r); phase.attempts[0].phase = 'review'; assert.throws(() => reconcileTaskUsage([r], phase));
});

test('Kimi 1.5 wire imports additive counters once, excluding cumulative status and prose', () => {
  const r = kimi(); assert.equal(r.usage.totalTokens.completeTotal, 38);
  assert.deepEqual(r.usage.records[0].usage, { inputTokens: 35, outputTokens: 3, cachedInputTokens: 20, cacheWriteInputTokens: 5, reasoningOutputTokens: null });
  assert.equal(r.usage.records[0].model, 'kimi-code/k3.1-pro'); assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  assert.equal(summariseUsage([r]).cliInvocations, 1);
});

test('Kimi wire keeps missing fields and other agents explicit', () => {
  const events = wire(); delete events[2].usage.inputCacheRead;
  events.splice(3, 0, { ...events[2], agentId: 'other-agent', usage: { inputOther: 1000, output: 1000, inputCacheRead: 0, inputCacheCreation: 0 } });
  const r = kimi(events); assert.equal(r.usage.totalTokens.completeTotal, null); assert.equal(r.usage.records[0].usage.outputTokens, 3);
  assert.ok(r.warnings.includes('kimi-other-agents-excluded'));
  assert.equal(reconcileTaskUsage([r], { ...inventory(r), attempts: [{ id: 'kimi', client: 'kimi', phase: 'host', receiptSha256: r.integritySha256 }] }).taskTotalTokens, null);
});

test('Kimi wire rejects ambiguous duplicate events, resumed prompts, wrong identity and invalid counters', () => {
  const duplicate = wire(); duplicate.splice(3, 0, duplicate[2]); assert.throws(() => kimi(duplicate));
  const resumed = wire(); resumed.push({ type: 'turn.prompt', agentId: 'main' }); assert.throws(() => kimi(resumed));
  const negative = wire(); negative[2].usage.output = -1; assert.throws(() => kimi(negative));
  const version = wire(); version[0].protocol_version = 'future'; assert.throws(() => kimi(version));
  assert.throws(() => kimi(wire(), { freshSession: false }));
  assert.throws(() => importKimiUsage(jsonl(wire()), { ...spec('kimi'), freshSession: true }, { sessionId: 'wrong' }));
});
