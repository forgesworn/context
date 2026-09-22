import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseUsage } from '../scripts/usage-normalise.mjs';

const AT = '2024-01-01T00:00:00.000Z';
const SID = 'session-1';
const RID = 'resp-1';

function rec(overrides = {}) {
  return {
    sessionId: SID,
    responseId: RID,
    at: AT,
    model: 'llama3',
    effort: null,
    usage: { prompt: 10, completion: 5, total: 15 },
    ...overrides,
  };
}

function assertThrowsFor(client, records) {
  assert.throws(() => normaliseUsage(client, records));
}

test('ollama: normal counts including zero', () => {
  const out = normaliseUsage('ollama', [
    rec({ usage: { prompt: 0, completion: 0, total: 0 } }),
    rec({ responseId: 'r2', usage: { prompt: 100, completion: 200, total: 300 } }),
  ]);
  assert.equal(out.client, 'ollama');
  assert.equal(out.records.length, 2);
  for (const r of out.records) {
    assert.equal(r.usage.cachedInputTokens, null);
    assert.equal(r.usage.cacheWriteInputTokens, null);
    assert.equal(r.usage.reasoningOutputTokens, null);
  }
  const sorted = [...out.records].sort((a, b) => a.usage.inputTokens - b.usage.inputTokens);
  assert.equal(sorted[0].usage.inputTokens, 0);
  assert.equal(sorted[0].usage.outputTokens, 0);
  assert.equal(sorted[1].usage.inputTokens, 100);
  assert.equal(sorted[1].usage.outputTokens, 200);
  assert.equal(out.totals.inputTokens.knownSubtotal, 100);
  assert.equal(out.totals.outputTokens.knownSubtotal, 200);
  assert.equal(out.totals.inputTokens.completeTotal, 100);
  assert.equal(out.totals.outputTokens.completeTotal, 200);
  assert.equal(out.totals.cachedInputTokens.unknownRecords, 2);
  assert.equal(out.totals.cachedInputTokens.completeTotal, null);
  assert.equal(out.totalTokens.knownSubtotal, 300);
  assert.equal(out.totalTokens.completeTotal, 300);
  assert.equal(out.totalTokens.unknownRecords, 0);
  assert.equal(out.duplicates, 0);
  assert.equal(out.conflicts, 0);
});

test('ollama: unknown counters (null/missing usage)', () => {
  const out = normaliseUsage('ollama', [
    rec({ usage: null }),
    rec({ responseId: 'r2', usage: undefined }),
  ]);
  assert.equal(out.records.length, 2);
  for (const r of out.records) {
    assert.equal(r.usage.inputTokens, null);
    assert.equal(r.usage.outputTokens, null);
  }
  assert.equal(out.totals.inputTokens.unknownRecords, 2);
  assert.equal(out.totals.inputTokens.knownSubtotal, 0);
  assert.equal(out.totals.inputTokens.completeTotal, null);
  assert.equal(out.totalTokens.unknownRecords, 2);
  assert.equal(out.totalTokens.completeTotal, null);
});

test('ollama: partial counters', () => {
  const out = normaliseUsage('ollama', [
    rec({ usage: { prompt: 10 } }),
    rec({ responseId: 'r2', usage: { completion: 7 } }),
  ]);
  const a = out.records.find((r) => r.usage.inputTokens === 10);
  const b = out.records.find((r) => r.usage.outputTokens === 7);
  assert.equal(a.usage.outputTokens, null);
  assert.equal(b.usage.inputTokens, null);
  assert.equal(out.totals.inputTokens.unknownRecords, 1);
  assert.equal(out.totals.inputTokens.knownSubtotal, 10);
  assert.equal(out.totals.inputTokens.completeTotal, null);
  assert.equal(out.totals.outputTokens.unknownRecords, 1);
  assert.equal(out.totals.outputTokens.knownSubtotal, 7);
  assert.equal(out.totalTokens.unknownRecords, 2);
  assert.equal(out.totalTokens.completeTotal, null);
});

test('ollama: invalid counts rejected', () => {
  assertThrowsFor('ollama', [rec({ usage: { prompt: -1, completion: 0, total: -1 } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: 1.5, completion: 0 } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: Number.MAX_SAFE_INTEGER + 1 } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: true } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: '10' } })]);
  assertThrowsFor('ollama', [rec({ usage: { completion: false } })]);
});

test('ollama: total provided without both inputs rejected', () => {
  assertThrowsFor('ollama', [rec({ usage: { total: 15 } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: 10, total: 15 } })]);
  assertThrowsFor('ollama', [rec({ usage: { completion: 5, total: 15 } })]);
});

test('ollama: inconsistent known total rejected', () => {
  assertThrowsFor('ollama', [rec({ usage: { prompt: 10, completion: 5, total: 16 } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: 10, completion: 5, total: 0 } })]);
});

test('ollama: invalid total rejected', () => {
  assertThrowsFor('ollama', [rec({ usage: { prompt: 10, completion: 5, total: -1 } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: 10, completion: 5, total: 1.5 } })]);
  assertThrowsFor('ollama', [rec({ usage: { prompt: 10, completion: 5, total: true } })]);
});

test('ollama: record not an object usage rejected', () => {
  assertThrowsFor('ollama', [rec({ usage: [] })]);
  assertThrowsFor('ollama', [rec({ usage: 'nope' })]);
});

test('ollama: duplicate same attempt counted once', () => {
  const out = normaliseUsage('ollama', [rec(), rec()]);
  assert.equal(out.records.length, 1);
  assert.equal(out.duplicates, 1);
  assert.equal(out.conflicts, 0);
  assert.equal(out.totalTokens.knownSubtotal, 15);
});

test('ollama: distinct attempts same usage count twice', () => {
  const out = normaliseUsage('ollama', [
    rec(),
    rec({ responseId: 'r2' }),
  ]);
  assert.equal(out.records.length, 2);
  assert.equal(out.duplicates, 0);
  assert.equal(out.conflicts, 0);
  assert.equal(out.totalTokens.knownSubtotal, 30);
});

test('ollama: conflicting attempt marked unknown', () => {
  const out = normaliseUsage('ollama', [
    rec(),
    rec({ usage: { prompt: 10, completion: 5, total: 15 }, model: 'other' }),
  ]);
  assert.equal(out.records.length, 1);
  const e = out.records[0];
  assert.equal(e.conflict, true);
  assert.equal(e.model, null);
  assert.equal(e.effort, null);
  assert.equal(e.usage.inputTokens, null);
  assert.equal(e.usage.outputTokens, null);
  assert.equal(out.conflicts, 1);
  assert.equal(out.totalTokens.unknownRecords, 1);
  assert.equal(out.totalTokens.completeTotal, null);
});

test('unsupported clients still reject', () => {
  assertThrowsFor('openai', [rec()]);
  assertThrowsFor('gemini', [rec()]);
  assertThrowsFor(null, [rec()]);
  assertThrowsFor(undefined, [rec()]);
});

test('codex behaviour preserved', () => {
  const out = normaliseUsage('codex', [
    { sessionId: 's1', responseId: 'r1', at: AT, model: 'gpt-5', effort: 'high',
      usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, cache_write_input_tokens: 5, reasoning_output_tokens: 20, total_tokens: 150 } },
  ]);
  assert.equal(out.client, 'codex');
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].usage.inputTokens, 100);
  assert.equal(out.records[0].usage.outputTokens, 50);
  assert.equal(out.records[0].usage.cachedInputTokens, 10);
  assert.equal(out.records[0].usage.cacheWriteInputTokens, 5);
  assert.equal(out.records[0].usage.reasoningOutputTokens, 20);
  assert.equal(out.totalTokens.knownSubtotal, 150);
  assert.equal(out.totalTokens.completeTotal, 150);
});

test('claude behaviour preserved', () => {
  const out = normaliseUsage('claude', [
    { sessionId: 's1', responseId: 'r1', at: AT, model: 'claude-3', effort: null,
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } },
  ]);
  assert.equal(out.client, 'claude');
  assert.equal(out.records[0].usage.inputTokens, 17);
  assert.equal(out.records[0].usage.outputTokens, 20);
  assert.equal(out.records[0].usage.cachedInputTokens, 3);
  assert.equal(out.records[0].usage.cacheWriteInputTokens, 4);
  assert.equal(out.records[0].usage.reasoningOutputTokens, null);
});

test('ollama: record format and hashes', () => {
  const out = normaliseUsage('ollama', [rec()]);
  const e = out.records[0];
  assert.equal(typeof e.id, 'string');
  assert.match(e.id, /^[0-9a-f]{64}$/);
  assert.match(e.sessionIdHash, /^[0-9a-f]{64}$/);
  assert.match(e.responseIdHash, /^[0-9a-f]{64}$/);
  assert.equal(e.at, AT);
  assert.deepEqual(Object.keys(e).sort(), ['at','conflict','effort','id','model','responseIdHash','sessionIdHash','usage'].sort());
});
