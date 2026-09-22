import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normaliseUsage } from '../scripts/usage-normalise.mjs';

const h = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const at = (n) => `2024-01-0${n}T00:00:00.000Z`;

function codexRec(over = {}) {
  return {
    sessionId: 's1', responseId: 'r1', at: at(1), model: 'm', effort: 'e',
    usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 2, cache_write_input_tokens: 1, reasoning_output_tokens: 3 },
    ...over,
  };
}
function claudeRec(over = {}) {
  return {
    sessionId: 's1', responseId: 'r1', at: at(1), model: 'm', effort: 'e',
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 3 },
    ...over,
  };
}

test('codex no double count: input includes cached/cache_write', () => {
  const out = normaliseUsage('codex', [codexRec()]);
  const u = out.records[0].usage;
  assert.equal(u.inputTokens, 10);
  assert.equal(u.cachedInputTokens, 2);
  assert.equal(u.cacheWriteInputTokens, 1);
  assert.equal(u.outputTokens, 5);
  assert.equal(u.reasoningOutputTokens, 3);
  assert.equal(out.totalTokens.knownSubtotal, 15);
});

test('claude additive cache, nested cache_creation ignored', () => {
  const rec = claudeRec({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 3, cache_creation: { ephemeral_5m_input_tokens: 999 } } });
  const out = normaliseUsage('claude', [rec]);
  const u = out.records[0].usage;
  assert.equal(u.inputTokens, 17);
  assert.equal(u.cachedInputTokens, 4);
  assert.equal(u.cacheWriteInputTokens, 3);
  assert.equal(u.reasoningOutputTokens, null);
  assert.equal(out.totalTokens.knownSubtotal, 22);
});

test('claude all-null when any of three parts missing', () => {
  const rec = claudeRec({ usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4 } });
  const out = normaliseUsage('claude', [rec]);
  assert.equal(out.records[0].usage.inputTokens, null);
  assert.equal(out.records[0].usage.cacheWriteInputTokens, null);
  assert.equal(out.totalTokens.completeTotal, null);
  assert.equal(out.totalTokens.unknownRecords, 1);
});

test('codex missing required counters yields nulls, record retained', () => {
  const out = normaliseUsage('codex', [codexRec({ usage: { cached_input_tokens: 1 } })]);
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].usage.inputTokens, null);
  assert.equal(out.records[0].usage.outputTokens, null);
  assert.equal(out.totals.inputTokens.unknownRecords, 1);
  assert.equal(out.totals.inputTokens.knownSubtotal, 0);
  assert.equal(out.totals.inputTokens.completeTotal, null);
});

test('codex null usage -> all null metrics', () => {
  const out = normaliseUsage('codex', [codexRec({ usage: null })]);
  assert.equal(out.records[0].usage.inputTokens, null);
  assert.equal(out.records[0].usage.outputTokens, null);
  assert.equal(out.records[0].usage.cachedInputTokens, null);
});

test('claude null usage -> all null', () => {
  const out = normaliseUsage('claude', [claudeRec({ usage: null })]);
  const u = out.records[0].usage;
  assert.deepEqual(u, { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningOutputTokens: null });
});

test('codex total_tokens mismatch throws', () => {
  assert.throws(() => normaliseUsage('codex', [codexRec({ usage: { input_tokens: 1, output_tokens: 1, total_tokens: 99 } })])
  , /Invalid usage record/);
});

test('codex cached sum exceeding input throws', () => {
  assert.throws(() => normaliseUsage('codex', [codexRec({ usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 1, cache_write_input_tokens: 1 } })]), /Invalid usage record/);
});

test('codex reasoning exceeding output throws', () => {
  assert.throws(() => normaliseUsage('codex', [codexRec({ usage: { input_tokens: 5, output_tokens: 1, reasoning_output_tokens: 2 } })]), /Invalid usage record/);
});

test('exact duplicates counted, earliest at retained', () => {
  const out = normaliseUsage('codex', [
    codexRec({ at: at(1) }),
    codexRec({ at: at(2) }),
  ]);
  assert.equal(out.records.length, 1);
  assert.equal(out.duplicates, 1);
  assert.equal(out.conflicts, 0);
  assert.equal(Date.parse(out.records[0].at), Date.parse(at(1)));
});

test('duplicates ignore timestamp differences', () => {
  const out = normaliseUsage('codex', [
    codexRec({ at: '2024-06-15T10:00:00Z' }),
    codexRec({ at: '2024-06-15T11:00:00.500Z' }),
  ]);
  assert.equal(out.records.length, 1);
  assert.equal(Date.parse(out.records[0].at), Date.parse('2024-06-15T10:00:00Z'));
});

test('conflict on differing metrics; nulls and conflict:true', () => {
  const other = codexRec({ at: at(2), usage: { input_tokens: 1, output_tokens: 1 } });
  const out = normaliseUsage('codex', [codexRec({ at: at(1) }), other]);
  assert.equal(out.conflicts, 1);
  assert.equal(out.duplicates, 1);
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].conflict, true);
  assert.equal(out.records[0].model, null);
  assert.equal(out.records[0].effort, null);
  assert.equal(Date.parse(out.records[0].at), Date.parse(at(1)));
  assert.equal(out.records[0].usage.inputTokens, null);
});

test('conflict absorbing even if later equal', () => {
  const a = codexRec({ at: at(1), usage: { input_tokens: 1, output_tokens: 1 } });
  const b = codexRec({ at: at(2), usage: { input_tokens: 2, output_tokens: 2 } });
  const c = codexRec({ at: at(3), usage: { input_tokens: 1, output_tokens: 1 } });
  const out = normaliseUsage('codex', [a, b, c]);
  assert.equal(out.conflicts, 1);
  assert.equal(out.duplicates, 2);
  assert.equal(out.records[0].conflict, true);
  assert.equal(out.records[0].usage.inputTokens, null);
});

test('ids unique across sessions', () => {
  const r1 = codexRec({ sessionId: 'sA', responseId: 'r1' });
  const r2 = codexRec({ sessionId: 'sB', responseId: 'r1' });
  const out = normaliseUsage('codex', [r1, r2]);
  assert.equal(out.records.length, 2);
  assert.notEqual(out.records[0].id, out.records[1].id);
});

test('malformed identity throws generic', () => {
  assert.throws(() => normaliseUsage('codex', [codexRec({ sessionId: 'bad id with spaces' })]), /^Error: Invalid usage record$/);
  assert.throws(() => normaliseUsage('codex', [codexRec({ sessionId: '' })]), /Invalid usage record/);
  assert.throws(() => normaliseUsage('codex', [codexRec({ responseId: 'x'.repeat(201) })]), /Invalid usage record/);
});

test('malformed calendar timestamp throws', () => {
  assert.throws(() => normaliseUsage('codex', [codexRec({ at: '2024-13-01T00:00:00Z' })]), /Invalid usage record/);
  assert.throws(() => normaliseUsage('codex', [codexRec({ at: 'not-a-time' })]), /Invalid usage record/);
});

test('malformed numeric counts throw', () => {
  assert.throws(() => normaliseUsage('codex', [codexRec({ usage: { input_tokens: -1, output_tokens: 1 } })]), /Invalid usage record/);
  assert.throws(() => normaliseUsage('codex', [codexRec({ usage: { input_tokens: 1.5, output_tokens: 1 } })]), /Invalid usage record/);
  assert.throws(() => normaliseUsage('codex', [codexRec({ usage: { input_tokens: Number.MAX_SAFE_INTEGER + 10, output_tokens: 1 } })]), /Invalid usage record/);
});

test('numeric aggregate overflow throws generic', () => {
  const big = Number.MAX_SAFE_INTEGER - 1;
  const r1 = codexRec({ sessionId: 'a', responseId: 'r1', usage: { input_tokens: big, output_tokens: 0 } });
  const r2 = codexRec({ sessionId: 'b', responseId: 'r2', usage: { input_tokens: big, output_tokens: 0 } });
  assert.throws(() => normaliseUsage('codex', [r1, r2]), /Invalid usage record/);
});

test('empty records input', () => {
  const out = normaliseUsage('codex', []);
  assert.deepEqual(out.records, []);
  assert.equal(out.duplicates, 0);
  assert.equal(out.conflicts, 0);
  for (const m of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens']) {
    assert.equal(out.totals[m].knownSubtotal, 0);
    assert.equal(out.totals[m].completeTotal, null);
    assert.equal(out.totals[m].unknownRecords, 0);
  }
  assert.equal(out.totalTokens.knownSubtotal, 0);
  assert.equal(out.totalTokens.completeTotal, null);
  assert.equal(out.totalTokens.unknownRecords, 0);
});

test('completeTotal null if any unknown record in metric', () => {
  const known = codexRec({ sessionId: 'a', responseId: 'r1', usage: { input_tokens: 3, output_tokens: 3 } });
  const unknown = codexRec({ sessionId: 'b', responseId: 'r2', usage: { input_tokens: 3, output_tokens: 3 } });
  const out = normaliseUsage('codex', [known, { ...unknown, usage: { input_tokens: 3, output_tokens: 3, cached_input_tokens: null } }]);
  assert.equal(out.totals.cachedInputTokens.knownSubtotal, 0);
  assert.equal(out.totals.cachedInputTokens.completeTotal, null);
  assert.equal(out.totals.cachedInputTokens.unknownRecords, 2);
  assert.equal(out.totals.inputTokens.completeTotal, 6);
});

test('deterministic ordering by at then id', () => {
  const a = codexRec({ sessionId: 'aaa', responseId: 'r', at: at(1) });
  const b = codexRec({ sessionId: 'bbb', responseId: 'r', at: at(1) });
  const c = codexRec({ sessionId: 'ccc', responseId: 'r', at: at(2) });
  const out1 = normaliseUsage('codex', [c, b, a]);
  const out2 = normaliseUsage('codex', [a, b, c]);
  assert.deepEqual(out1.records.map(r => r.at), out2.records.map(r => r.at));
  assert.deepEqual(out1.records.map(r => r.id), out2.records.map(r => r.id));
  const ids = out1.records.map(r => r.id);
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted);
});

test('no mutation of input records', () => {
  const rec = codexRec();
  const snapshot = JSON.stringify(rec);
  normaliseUsage('codex', [rec]);
  assert.equal(JSON.stringify(rec), snapshot);
});

test('no raw ids or sensitive text in output', () => {
  const secret = 'sk-verysecret-value';
  const out = normaliseUsage('codex', [codexRec({ sessionId: 'uniqueSessionRaw', responseId: 'uniqueResponseRaw', usage: { input_tokens: 1, output_tokens: 1 } })]);
  for (const r of out.records) {
    assert.equal(r.usage.note, undefined);
    assert.equal(r.usage.secret, undefined);
    assert.equal(r.cachedInputTokens, undefined);
    assert.ok(!('sessionId' in r));
    assert.ok(!('responseId' in r));
    assert.ok(!JSON.stringify(r).includes('uniqueSessionRaw'));
    assert.ok(!JSON.stringify(r).includes('uniqueResponseRaw'));
    assert.ok(!JSON.stringify(r).includes(secret));
  }
  assert.ok(!JSON.stringify(out).includes('uniqueSessionRaw'));
});

test('hashes are lowercase SHA256 of raw ids and composite', () => {
  const out = normaliseUsage('claude', [claudeRec()]);
  const r = out.records[0];
  assert.equal(r.sessionIdHash, h('s1'));
  assert.equal(r.responseIdHash, h('r1'));
  assert.equal(r.id, h('claude\0s1\0r1'));
  assert.match(r.sessionIdHash, /^[0-9a-f]{64}$/);
});

test('extra keys in record and usage ignored', () => {
  const rec = codexRec({ extra: 'ignore', usage: { input_tokens: 1, output_tokens: 1, secret: 'text' } });
  const out = normaliseUsage('codex', [rec]);
  assert.equal(out.records[0].usage.inputTokens, 1);
  assert.equal(out.records[0].extra, undefined);
});

test('invalid client throws', () => {
  assert.throws(() => normaliseUsage('other', []), /Invalid usage record/);
});

test('claude reasoning always null, does not add thinking', () => {
  const out = normaliseUsage('claude', [claudeRec({ usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, thinking: 'secret thought' } })]);
  assert.equal(out.records[0].usage.reasoningOutputTokens, null);
  assert.ok(!JSON.stringify(out).includes('secret thought'));
});

test('claude zero cache is known, not missing', () => {
  const out = normaliseUsage('claude', [claudeRec({ usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })]);
  assert.equal(out.records[0].usage.inputTokens, 5);
  assert.equal(out.records[0].usage.cachedInputTokens, 0);
  assert.equal(out.records[0].usage.cacheWriteInputTokens, 0);
});

test('empty output preserves independent known metrics when another missing', () => {
  const rec = { sessionId: 's', responseId: 'r', model: null, effort: null, at: '2026-09-22T00:00:00Z', usage: { input_tokens: 10, cached_input_tokens: 2 } };
  const r = normaliseUsage('codex', [rec]);
  assert.equal(r.totals.inputTokens.completeTotal, 10);
  assert.equal(r.totals.cachedInputTokens.completeTotal, 2);
  assert.equal(r.totals.outputTokens.completeTotal, null);
});

test('conflicted identity still retains earliest third timestamp', () => {
  const mk = (usage, a) => ({ sessionId: 's', responseId: 'r', model: null, effort: null, at: a, usage });
  const r = normaliseUsage('codex', [
    mk({ input_tokens: 1, output_tokens: 1 }, '2026-09-22T00:00:03Z'),
    mk({ input_tokens: 2, output_tokens: 1 }, '2026-09-22T00:00:02Z'),
    mk({ input_tokens: 1, output_tokens: 1 }, '2026-09-22T00:00:01Z'),
  ]);
  assert.equal(Date.parse(r.records[0].at), Date.parse('2026-09-22T00:00:01Z'));
});

test('timestamp canonicalisation compares chronologically across fraction spelling', () => {
  const mk = (a) => ({ sessionId: 's', responseId: 'r', model: null, effort: null, at: a, usage: {} });
  const r = normaliseUsage('codex', [mk('2026-09-22T00:00:00.1Z'), mk('2026-09-22T00:00:00Z')]);
  assert.equal(Date.parse(r.records[0].at), Date.parse('2026-09-22T00:00:00Z'));
});

test('malformed total is rejected even when primary metrics are missing', () => {
  assert.throws(() => normaliseUsage('codex', [{ sessionId: 's', responseId: 'r', model: null, effort: null, at: '2026-09-22T00:00:00Z', usage: { total_tokens: -1 } }]));
});
