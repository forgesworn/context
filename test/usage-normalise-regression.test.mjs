import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseUsage } from '../scripts/usage-normalise.mjs';

const rec = (usage, at = '2026-09-22T00:00:00Z') => ({ sessionId: 's', responseId: 'r', model: null, effort: null, at, usage });
test('a missing output preserves independently observed input/cache', () => {
  const r = normaliseUsage('codex', [rec({ input_tokens: 10, cached_input_tokens: 2 })]);
  assert.equal(r.totals.inputTokens.completeTotal, 10);
  assert.equal(r.totals.cachedInputTokens.completeTotal, 2);
  assert.equal(r.totals.outputTokens.completeTotal, null);
});
test('conflicted identity still retains earliest third timestamp', () => {
  const r = normaliseUsage('codex', [rec({input_tokens:1,output_tokens:1}, '2026-09-22T00:00:03Z'), rec({input_tokens:2,output_tokens:1}, '2026-09-22T00:00:02Z'), rec({input_tokens:1,output_tokens:1}, '2026-09-22T00:00:01Z')]);
  assert.equal(Date.parse(r.records[0].at), Date.parse('2026-09-22T00:00:01Z'));
});
test('timestamp comparison uses time, not optional fraction spelling', () => {
  const r = normaliseUsage('codex', [rec({}, '2026-09-22T00:00:00.1Z'), rec({}, '2026-09-22T00:00:00Z')]);
  assert.equal(Date.parse(r.records[0].at), Date.parse('2026-09-22T00:00:00Z'));
});
test('malformed total is rejected even when primary metrics are missing', () => {
  assert.throws(() => normaliseUsage('codex', [rec({ total_tokens: -1 })]));
});
