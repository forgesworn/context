import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reportTaskCosts } from '../scripts/task-cost-report.mjs';
const hash = 'a'.repeat(64), rev = 'b'.repeat(40), stamp = '2026-01-02T00:00:00.000Z';
function pair(i, category, repo) { return { id: `p${i}`, category, repository: { name: repo, revision: rev, qualificationEvidence: 'operator attestation' }, taskDefinitionSha256: hash, acceptanceDefinitionSha256: hash, baselineOrder: i % 2 ? 2 : 1, assistedOrder: i % 2 ? 1 : 2, roles: [{ role: 'host', provider: 'local', model: 'model', effort: 'medium', settingsSha256: hash }], acceptanceCheckIds: ['test'] }; }
function fixture() { const pairs = ['orientation', 'diagnosis', 'impact', 'code-change'].flatMap((c, n) => [pair(n * 2, c, 'repo-a'), pair(n * 2 + 1, c, 'repo-b')]); return { protocol: { version: 1, experimentId: 'x', lockedAt: '2026-01-01T00:00:00.000Z', measurementDefinitionSha256: hash, pairs }, receipts: pairs.flatMap(p => ['baseline', 'assisted'].map(arm => receipt(p, arm))) }; }
function receipt(p, arm) { return { version: 1, experimentId: 'x', pairId: p.id, arm, sessionId: `${p.id}-${arm}`, startedAt: stamp, repository: structuredClone(p.repository), taskDefinitionSha256: hash, acceptanceDefinitionSha256: hash, measurementDefinitionSha256: hash, order: p[`${arm}Order`], retrievalMode: arm === 'baseline' ? 'efficient-rg-file-read' : 'context', cacheState: 'cold', contamination: { observed: false, notes: 'checked' }, roles: structuredClone(p.roles), coverage: { allAttemptsRecorded: true, host: true, workers: true, review: true }, attempts: [{ id: 'host', phase: 'host', role: 'host', outcome: 'accepted', dispatched: true, usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningOutputTokens: 1 }, variableInferenceCost: { amountGbp: arm === 'baseline' ? .10 : .08, basis: 'attributed-billing', source: 'invoice GBP', asOf: stamp }, elapsedMs: 10 }], toolCalls: 1, sourceReads: 1, scanRefreshMs: 1, reviewSeconds: 10, elapsedMs: 20, acceptance: { checks: [{ id: 'test', passed: true, evidence: 'run' }], accepted: true, materialRegression: false }, notes: [] }; }
test('synthetic eight-pair exact twenty percent evidence passes', () => assert.equal(reportTaskCosts(fixture()).status, 'passed'));
test('a decimal amount infinitesimally above four fifths fails without a tolerance', () => { const x = fixture(); x.receipts.filter(r => r.arm === 'assisted').forEach(r => r.attempts[0].variableInferenceCost.amountGbp = .08000000000000001); assert.equal(reportTaskCosts(x).status, 'failed'); });
test('a decimal review increase fails even when floating aggregate totals collide', () => { const x = fixture(); x.receipts.forEach(r => r.reviewSeconds = .1); x.receipts[1].reviewSeconds = .10000000000000002; assert.equal(reportTaskCosts(x).status, 'failed'); });
test('failed retry cost is included and can fail threshold', () => { const x = fixture(); x.receipts[1].attempts.push(structuredClone(x.receipts[1].attempts[0])); x.receipts[1].attempts[1].id = 'retry'; x.receipts[1].attempts[1].outcome = 'failed'; assert.equal(reportTaskCosts(x).status, 'failed'); });
test('unknown host billing, coverage and elapsed block qualification', () => { const x = fixture(); x.receipts[0].coverage.host = null; x.receipts[0].attempts[0].variableInferenceCost.amountGbp = null; x.receipts[0].elapsedMs = null; assert.equal(reportTaskCosts(x).status, 'incomplete'); });
test('subscription estimate never qualifies', () => { const x = fixture(); x.receipts[0].attempts[0].variableInferenceCost.basis = 'fixed-subscription'; assert.equal(reportTaskCosts(x).aggregate.baseline.amountGbp, null); });
test('quality and review failures are failed once data complete', () => { const x = fixture(); x.receipts[0].acceptance.accepted = false; assert.equal(reportTaskCosts(x).status, 'failed'); x.receipts[0].acceptance.accepted = true; x.receipts[1].reviewSeconds = 11; assert.equal(reportTaskCosts(x).status, 'failed'); });
test('zero baseline is incomplete and token subsets are not double counted', () => { const x = fixture(); x.receipts.filter(r => r.arm === 'baseline').forEach(r => r.attempts[0].variableInferenceCost.amountGbp = 0); const out = reportTaskCosts(x); assert.equal(out.status, 'incomplete'); assert.equal(out.aggregate.assisted.tokens.inputTokens.completeTotal, 80); });
test('schema and locked controls reject unsafe values, keys, mismatches', () => { const x = fixture(); x.extra = 1; assert.throws(() => reportTaskCosts(x)); const y = fixture(); y.receipts[0].order = 2; assert.throws(() => reportTaskCosts(y)); const z = fixture(); z.receipts[0].toolCalls = Number.MAX_SAFE_INTEGER + 1; assert.throws(() => reportTaskCosts(z)); });
test('draft, missing arms, contamination and missing retrieval controls remain incomplete', () => { const x = fixture(); x.protocol.lockedAt = null; x.receipts.pop(); x.receipts[0].contamination.observed = true; assert.equal(reportTaskCosts(x).status, 'incomplete'); const y = fixture(); y.receipts[0].retrievalMode = 'context'; assert.throws(() => reportTaskCosts(y)); });
test('a locked partial trial is useful incomplete output, and local zero cost is enforced', () => { const x = fixture(); x.receipts.pop(); assert.equal(reportTaskCosts(x).status, 'incomplete'); const y = fixture(); y.receipts[0].attempts[0].variableInferenceCost = { amountGbp: .01, basis: 'local-no-provider-charge', source: 'local', asOf: stamp }; assert.throws(() => reportTaskCosts(y)); });
test('invalid calendar dates, duplicate receipt roles and values beyond safe totals reject', () => { const x = fixture(); x.receipts[0].startedAt = '2026-02-31T00:00:00Z'; assert.throws(() => reportTaskCosts(x)); const y = fixture(); y.protocol.pairs[0].roles.push({ role: 'worker', provider: 'p', model: 'm', effort: 'e', settingsSha256: hash }); y.receipts[0].roles = [structuredClone(y.protocol.pairs[0].roles[0]), structuredClone(y.protocol.pairs[0].roles[0])]; assert.throws(() => reportTaskCosts(y)); });
test('CLI emits JSON for regular input and rejects malformed, oversized, invalid UTF-8, symlink and directory inputs', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-report-')); const input = path.join(dir, 'trial.json'); try {
    fs.writeFileSync(input, JSON.stringify(fixture()));
    const script = path.resolve('scripts/task-cost-report.mjs');
    const run = file => spawnSync(process.execPath, [script, '--input', file]);
    const output = execFileSync(process.execPath, [script, '--input', input], { encoding: 'utf8' });
    assert.equal(JSON.parse(output).status, 'passed');
    fs.writeFileSync(input, '{');
    assert.notEqual(run(input).status, 0);
    fs.writeFileSync(input, Buffer.alloc(1024 * 1024 + 1));
    assert.notEqual(run(input).status, 0);
    fs.writeFileSync(input, Buffer.from([0xc3, 0x28]));
    assert.notEqual(run(input).status, 0);
    const link = path.join(dir, 'link.json');
    fs.symlinkSync(input, link);
    assert.notEqual(run(link).status, 0);
    assert.notEqual(run(dir).status, 0);
}
finally {
    fs.rmSync(dir, { recursive: true, force: true });
} });

test('empty unlocked draft returns incomplete without reduction percentage', () => {
  const draft = fixture();
  draft.protocol.lockedAt = null;
  draft.receipts = [];
  const report = reportTaskCosts(draft);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.reductionPct, null);
});

test('aggregate input subtotal exceeding MAX_SAFE_INTEGER throws safe integer error', () => {
  const draft = fixture();
  const baseline = draft.receipts.filter(r => r.arm === 'baseline');
  baseline[0].attempts[0].usage.inputTokens = Number.MAX_SAFE_INTEGER;
  for (let i = 1; i < baseline.length; i++) {
    baseline[i].attempts[0].usage.inputTokens = 10;
  }
  assert.throws(() => reportTaskCosts(draft), /safe integer/i);
});

test('single unknown cached baseline keeps other token metrics independent and complete', () => {
  const draft = fixture();
  const baseline = draft.receipts.filter(r => r.arm === 'baseline');
  baseline[0].attempts[0].usage.cachedInputTokens = null;
  const report = reportTaskCosts(draft);
  const baselineTokens = report.aggregate.baseline.tokens;
  assert.equal(report.status, 'incomplete');
  assert.equal(baselineTokens.cachedInputTokens.knownSubtotal, 14);
  assert.equal(baselineTokens.cachedInputTokens.completeTotal, null);
  assert.equal(baselineTokens.cachedInputTokens.unknownAttempts, 1);
  assert.equal(baselineTokens.inputTokens.completeTotal, 80);
  assert.equal(baselineTokens.outputTokens.completeTotal, 40);
  assert.equal(baselineTokens.reasoningOutputTokens.completeTotal, 8);
});
