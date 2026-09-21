import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CATEGORIES = ['orientation', 'diagnosis', 'impact', 'code-change'];
const ARMS = ['baseline', 'assisted'];
const SHA = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const MAX = 1024 * 1024;
const counters = ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens'];
const metrics = ['reviewSeconds', 'elapsedMs', 'toolCalls', 'sourceReads', 'scanRefreshMs'];
const rule = { pairCount: 8, minCostReductionPct: 20, maxReviewTimeIncreaseSeconds: 0 };
function fail(message) { throw new Error(message); }
function obj(value, keys, at) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        fail(`${at} must be an object`);
    const actual = Object.keys(value);
    if (actual.length !== keys.length || actual.some(k => !keys.includes(k)))
        fail(`${at} has unknown or missing keys`);
    return value;
}
function string(value, at) {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096)
        fail(`${at} must be a nonblank bounded string`);
    return value;
}
function nullableString(value, at) { return value === null ? value : string(value, at); }
function number(value, at, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && (!Number.isSafeInteger(value))))
        fail(`${at} must be a nonnegative ${integer ? 'safe integer' : 'finite number'}`);
    return value;
}
function nullableNumber(value, at, integer = false) { return value === null ? value : number(value, at, integer); }
function boolOrNull(value, at) { if (value !== null && typeof value !== 'boolean')
    fail(`${at} must be boolean or null`); return value; }
function iso(value, at) {
    string(value, at);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10))
        fail(`${at} must be an ISO UTC timestamp`);
    return value;
}
function hash(value, at, revision = false) { string(value, at); if (!(revision ? REVISION : SHA).test(value))
    fail(`${at} has invalid hash`); return value; }
function array(value, at, max) { if (!Array.isArray(value) || value.length > max)
    fail(`${at} must be a bounded array`); return value; }
function exactSet(a, b) { return a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]); }
function sum(values, at, integer = false) { const total = values.reduce((n, v) => n + v, 0); return number(total, at, integer); }
function decimal(value) {
    const [mantissa, exponentText] = String(value).toLowerCase().split('e');
    const exponent = Number(exponentText || 0), [whole, fraction = ''] = mantissa.split('.');
    const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0';
    return { digits: BigInt(digits), scale: fraction.length - exponent };
}
function decimalSum(values) {
    const parts = values.map(decimal), scale = Math.max(...parts.map(x => x.scale));
    return { digits: parts.reduce((total, x) => total + x.digits * 10n ** BigInt(scale - x.scale), 0n), scale };
}
function decimalAtMost(assisted, baseline, left, right) {
    const a = decimalSum(assisted), b = decimalSum(baseline), scale = Math.max(a.scale, b.scale);
    return a.digits * BigInt(left) * 10n ** BigInt(scale - a.scale) <= b.digits * BigInt(right) * 10n ** BigInt(scale - b.scale);
}
function qualifiesCost(a) {
    const cost = a.variableInferenceCost;
    return cost.amountGbp !== null && cost.source !== null && cost.asOf !== null && (a.dispatched === false || ['attributed-billing', 'local-no-provider-charge'].includes(cost.basis));
}
function role(value, at) {
    obj(value, ['role', 'provider', 'model', 'effort', 'settingsSha256'], at);
    string(value.role, `${at}.role`);
    string(value.provider, `${at}.provider`);
    string(value.model, `${at}.model`);
    string(value.effort, `${at}.effort`);
    hash(value.settingsSha256, `${at}.settingsSha256`);
    return value;
}
function repository(value, at) {
    obj(value, ['name', 'revision', 'qualificationEvidence'], at);
    string(value.name, `${at}.name`);
    hash(value.revision, `${at}.revision`, true);
    string(value.qualificationEvidence, `${at}.qualificationEvidence`);
    return value;
}
function sameRole(a, b) { return a.role === b.role && a.provider === b.provider && a.model === b.model && a.effort === b.effort && a.settingsSha256 === b.settingsSha256; }
function sameRepo(a, b) { return a.name === b.name && a.revision === b.revision && a.qualificationEvidence === b.qualificationEvidence; }
function protocol(value) {
    obj(value, ['version', 'experimentId', 'lockedAt', 'measurementDefinitionSha256', 'pairs'], 'protocol');
    if (value.version !== 1)
        fail('protocol.version must be 1');
    string(value.experimentId, 'protocol.experimentId');
    if (value.lockedAt !== null)
        iso(value.lockedAt, 'protocol.lockedAt');
    hash(value.measurementDefinitionSha256, 'protocol.measurementDefinitionSha256');
    array(value.pairs, 'protocol.pairs', 8);
    if (value.pairs.length !== 8)
        fail('protocol requires eight pairs');
    const ids = new Set(), repos = new Set(), categories = new Map();
    value.pairs.forEach((p, i) => {
        const at = `protocol.pairs[${i}]`;
        obj(p, ['id', 'category', 'repository', 'taskDefinitionSha256', 'acceptanceDefinitionSha256', 'baselineOrder', 'assistedOrder', 'roles', 'acceptanceCheckIds'], at);
        string(p.id, `${at}.id`);
        if (ids.has(p.id))
            fail('duplicate pair id');
        ids.add(p.id);
        if (!CATEGORIES.includes(p.category))
            fail(`${at}.category invalid`);
        categories.set(p.category, (categories.get(p.category) || 0) + 1);
        repository(p.repository, `${at}.repository`);
        repos.add(p.repository.name);
        hash(p.taskDefinitionSha256, `${at}.taskDefinitionSha256`);
        hash(p.acceptanceDefinitionSha256, `${at}.acceptanceDefinitionSha256`);
        if (![1, 2].includes(p.baselineOrder) || p.assistedOrder !== 3 - p.baselineOrder)
            fail(`${at} orders must be opposite`);
        array(p.roles, `${at}.roles`, 32);
        if (!p.roles.length)
            fail(`${at} requires a role`);
        const roleIds = new Set();
        p.roles.forEach((r, j) => { role(r, `${at}.roles[${j}]`); if (roleIds.has(r.role))
            fail('duplicate role'); roleIds.add(r.role); });
        array(p.acceptanceCheckIds, `${at}.acceptanceCheckIds`, 32);
        if (!p.acceptanceCheckIds.length || new Set(p.acceptanceCheckIds).size !== p.acceptanceCheckIds.length)
            fail(`${at}.acceptanceCheckIds invalid`);
        p.acceptanceCheckIds.forEach((x, j) => string(x, `${at}.acceptanceCheckIds[${j}]`));
    });
    if (repos.size !== 2)
        fail('protocol requires exactly two repositories');
    for (const category of CATEGORIES)
        if (categories.get(category) !== 2)
            fail('protocol requires two pairs per category');
    for (const repo of repos)
        for (const category of CATEGORIES)
            if (!value.pairs.some(p => p.repository.name === repo && p.category === category))
                fail('each repository requires one task per category');
    value.pairs.forEach((p, i) => { if (p.baselineOrder !== (i % 2 ? 2 : 1))
        fail('baseline order must alternate across pairs'); });
    return value;
}
function attempt(value, at, pair) {
    obj(value, ['id', 'phase', 'role', 'outcome', 'dispatched', 'usage', 'variableInferenceCost', 'elapsedMs'], at);
    string(value.id, `${at}.id`);
    if (!['host', 'worker', 'scan-refresh', 'other'].includes(value.phase))
        fail(`${at}.phase invalid`);
    nullableString(value.role, `${at}.role`);
    if (!['accepted', 'failed', 'refused', 'cancelled', 'unknown'].includes(value.outcome))
        fail(`${at}.outcome invalid`);
    boolOrNull(value.dispatched, `${at}.dispatched`);
    if (value.role === null && value.dispatched !== false)
        fail(`${at} unmapped role needs dispatched:false`);
    if (value.role !== null && !pair.roles.some(r => r.role === value.role))
        fail(`${at} role is not locked`);
    if (['host', 'worker'].includes(value.phase) && value.role === null)
        fail(`${at} host/worker needs a role`);
    obj(value.usage, counters, `${at}.usage`);
    counters.forEach(k => nullableNumber(value.usage[k], `${at}.usage.${k}`, true));
    if (value.usage.inputTokens !== null && value.usage.cachedInputTokens !== null && value.usage.cachedInputTokens > value.usage.inputTokens)
        fail(`${at} cached input exceeds input`);
    if (value.usage.outputTokens !== null && value.usage.reasoningOutputTokens !== null && value.usage.reasoningOutputTokens > value.usage.outputTokens)
        fail(`${at} reasoning output exceeds output`);
    obj(value.variableInferenceCost, ['amountGbp', 'basis', 'source', 'asOf'], `${at}.variableInferenceCost`);
    nullableNumber(value.variableInferenceCost.amountGbp, `${at}.variableInferenceCost.amountGbp`);
    if (!['attributed-billing', 'dated-rate-estimate', 'local-no-provider-charge', 'fixed-subscription', 'unknown'].includes(value.variableInferenceCost.basis))
        fail(`${at}.variableInferenceCost.basis invalid`);
    nullableString(value.variableInferenceCost.source, `${at}.variableInferenceCost.source`);
    if (value.variableInferenceCost.asOf !== null)
        iso(value.variableInferenceCost.asOf, `${at}.variableInferenceCost.asOf`);
    if (value.variableInferenceCost.basis === 'local-no-provider-charge' && value.variableInferenceCost.amountGbp !== null && value.variableInferenceCost.amountGbp !== 0)
        fail(`${at} local-no-provider-charge must be zero`);
    nullableNumber(value.elapsedMs, `${at}.elapsedMs`);
    if (value.dispatched === false) {
        if (counters.some(k => (value.usage[k] || 0) !== 0) || (value.variableInferenceCost.amountGbp || 0) !== 0)
            fail(`${at} undispatched attempt has usage or cost`);
        if (value.variableInferenceCost.source === null || value.variableInferenceCost.asOf === null)
            fail(`${at} undispatched attempt needs cost source and date`);
    }
    return value;
}
function receipt(value, at, p) {
    obj(value, ['version', 'experimentId', 'pairId', 'arm', 'sessionId', 'startedAt', 'repository', 'taskDefinitionSha256', 'acceptanceDefinitionSha256', 'measurementDefinitionSha256', 'order', 'retrievalMode', 'cacheState', 'contamination', 'roles', 'coverage', 'attempts', 'toolCalls', 'sourceReads', 'scanRefreshMs', 'reviewSeconds', 'elapsedMs', 'acceptance', 'notes'], at);
    if (value.version !== 1 || value.experimentId !== p.experimentId)
        fail(`${at} version or experiment mismatch`);
    string(value.pairId, `${at}.pairId`);
    if (!ARMS.includes(value.arm))
        fail(`${at}.arm invalid`);
    string(value.sessionId, `${at}.sessionId`);
    iso(value.startedAt, `${at}.startedAt`);
    repository(value.repository, `${at}.repository`);
    if (!sameRepo(value.repository, p.pair.repository) || value.taskDefinitionSha256 !== p.pair.taskDefinitionSha256 || value.acceptanceDefinitionSha256 !== p.pair.acceptanceDefinitionSha256 || value.measurementDefinitionSha256 !== p.measurementDefinitionSha256)
        fail(`${at} controls mismatch`);
    if (value.order !== p.pair[`${value.arm}Order`])
        fail(`${at} order mismatch`);
    if (value.retrievalMode !== (value.arm === 'baseline' ? 'efficient-rg-file-read' : 'context'))
        fail(`${at} retrieval mode mismatch`);
    if (!['cold', 'warm', 'unknown'].includes(value.cacheState))
        fail(`${at}.cacheState invalid`);
    obj(value.contamination, ['observed', 'notes'], `${at}.contamination`);
    boolOrNull(value.contamination.observed, `${at}.contamination.observed`);
    string(value.contamination.notes, `${at}.contamination.notes`);
    array(value.roles, `${at}.roles`, 32);
    if (value.roles.length !== p.pair.roles.length || new Set(value.roles.map(r => r.role)).size !== value.roles.length || value.roles.some((r, i) => { role(r, `${at}.roles[${i}]`); return !p.pair.roles.some(x => sameRole(x, r)); }))
        fail(`${at} role controls mismatch`);
    obj(value.coverage, ['allAttemptsRecorded', 'host', 'workers', 'review'], `${at}.coverage`);
    Object.entries(value.coverage).forEach(([k, v]) => boolOrNull(v, `${at}.coverage.${k}`));
    array(value.attempts, `${at}.attempts`, 1000);
    const ids = new Set();
    value.attempts.forEach((a, i) => { attempt(a, `${at}.attempts[${i}]`, p.pair); if (ids.has(a.id))
        fail(`${at} duplicate attempt id`); ids.add(a.id); });
    metrics.forEach(k => nullableNumber(value[k], `${at}.${k}`, k === 'toolCalls' || k === 'sourceReads'));
    obj(value.acceptance, ['checks', 'accepted', 'materialRegression'], `${at}.acceptance`);
    array(value.acceptance.checks, `${at}.acceptance.checks`, 32);
    if (!exactSet(value.acceptance.checks.map(c => c.id), p.pair.acceptanceCheckIds))
        fail(`${at} acceptance check ids mismatch`);
    value.acceptance.checks.forEach((c, i) => { obj(c, ['id', 'passed', 'evidence'], `${at}.acceptance.checks[${i}]`); string(c.id, 'check.id'); boolOrNull(c.passed, 'check.passed'); nullableString(c.evidence, 'check.evidence'); });
    boolOrNull(value.acceptance.accepted, `${at}.acceptance.accepted`);
    boolOrNull(value.acceptance.materialRegression, `${at}.acceptance.materialRegression`);
    array(value.notes, `${at}.notes`, 64);
    value.notes.forEach((n, i) => string(n, `${at}.notes[${i}]`));
    return value;
}
function armSummary(receipt) {
    if (!receipt)
        return null;
    const reasons = [];
    for (const key of Object.keys(receipt.coverage))
        if (receipt.coverage[key] !== true)
            reasons.push(`coverage:${key}`);
    if (!receipt.attempts.some(a => a.phase === 'host'))
        reasons.push('no-host-attempt');
    receipt.attempts.forEach(a => { if (a.outcome === 'unknown')
        reasons.push('unknown-outcome'); if (a.dispatched === null)
        reasons.push('unknown-dispatch'); if (a.dispatched !== false && counters.some(k => a.usage[k] === null))
        reasons.push('missing-token-usage'); if (!qualifiesCost(a))
        reasons.push('missing-qualified-cost'); });
    if (receipt.cacheState === 'unknown')
        reasons.push('unknown-cache-state');
    if (receipt.contamination.observed !== false)
        reasons.push('contamination-unknown-or-observed');
    metrics.forEach(k => { if (receipt[k] === null)
        reasons.push(`missing-${k}`); });
    if (receipt.acceptance.accepted === null || receipt.acceptance.materialRegression === null || receipt.acceptance.checks.some(c => c.passed === null || c.evidence === null))
        reasons.push('unknown-acceptance');
    const tokenSummary = Object.fromEntries(counters.map(k => { const known = receipt.attempts.filter(a => a.usage[k] !== null).map(a => a.usage[k]); const unknown = receipt.attempts.filter(a => a.dispatched !== false && a.usage[k] === null).length; return [k, { knownSubtotal: sum(known, `tokens.${k}`, true), completeTotal: unknown ? null : sum(known, `tokens.${k}`, true), unknownAttempts: unknown }]; }));
    const costs = receipt.attempts.filter(qualifiesCost).map(a => a.variableInferenceCost.amountGbp);
    return { attemptCount: receipt.attempts.length, acceptedTaskCount: receipt.acceptance.accepted === true ? 1 : 0, amountGbp: reasons.includes('missing-qualified-cost') ? null : sum(costs, 'amountGbp'), knownAmountGbp: sum(costs, 'knownAmountGbp'), tokens: tokenSummary, reviewSeconds: receipt.reviewSeconds, elapsedMs: receipt.elapsedMs, toolCalls: receipt.toolCalls, sourceReads: receipt.sourceReads, scanRefreshMs: receipt.scanRefreshMs, incompleteReasons: [...new Set(reasons)] };
}
function aggregate(arms) {
    if (arms.some(a => !a))
        return null;
    const totals = {};
    for (const k of ['attemptCount', 'acceptedTaskCount', 'knownAmountGbp', ...metrics])
        totals[k] = arms.some(a => a[k] === null) ? null : sum(arms.map(a => a[k]), `aggregate.${k}`, ['attemptCount', 'acceptedTaskCount', 'toolCalls', 'sourceReads'].includes(k));
    totals.amountGbp = arms.some(a => a.amountGbp === null) ? null : sum(arms.map(a => a.amountGbp), 'aggregate.amountGbp');
    totals.tokens = Object.fromEntries(counters.map(k => [k, { knownSubtotal: sum(arms.map(a => a.tokens[k].knownSubtotal), `aggregate.${k}`, true), completeTotal: arms.some(a => a.tokens[k].completeTotal === null) ? null : sum(arms.map(a => a.tokens[k].completeTotal), `aggregate.${k}`, true), unknownAttempts: sum(arms.map(a => a.tokens[k].unknownAttempts), `aggregate.${k}`, true) }]));
    return totals;
}
export function reportTaskCosts(input) {
    obj(input, ['protocol', 'receipts'], 'input');
    const p = protocol(input.protocol);
    array(input.receipts, 'receipts', 16);
    if (input.receipts.length > 16)
        fail('at most sixteen receipts');
    const seen = new Set(), sessions = new Set(), received = new Map();
    input.receipts.forEach((r, i) => { const pair = p.pairs.find(x => x.id === r.pairId); if (!pair)
        fail(`receipts[${i}] unknown pair`); receipt(r, `receipts[${i}]`, { pair, experimentId: p.experimentId, measurementDefinitionSha256: p.measurementDefinitionSha256 }); if (p.lockedAt !== null && Date.parse(r.startedAt) <= Date.parse(p.lockedAt))
        fail('receipt must start strictly after lock'); const key = `${r.pairId}:${r.arm}`; if (seen.has(key) || sessions.has(r.sessionId))
        fail('duplicate arm or session'); seen.add(key); sessions.add(r.sessionId); received.set(key, r); });
    const pairs = p.pairs.map(pair => ({ id: pair.id, category: pair.category, baseline: armSummary(received.get(`${pair.id}:baseline`)), assisted: armSummary(received.get(`${pair.id}:assisted`)) }));
    const baseline = aggregate(pairs.map(x => x.baseline)), assisted = aggregate(pairs.map(x => x.assisted));
    const reasons = [];
    if (p.lockedAt === null)
        reasons.push('draft-protocol');
    pairs.forEach(x => ARMS.forEach(a => { if (!x[a])
        reasons.push(`missing-arm:${x.id}:${a}`);
    else
        reasons.push(...x[a].incompleteReasons.map(r => `${x.id}:${a}:${r}`)); }));
    if (baseline && baseline.amountGbp === 0)
        reasons.push('zero-baseline-cost');
    const complete = reasons.length === 0;
    const quality = pairs.every(x => ARMS.every(a => x[a] && x[a].acceptedTaskCount === 1 && received.get(`${x.id}:${a}`).acceptance.checks.every(c => c.passed) && !received.get(`${x.id}:${a}`).acceptance.materialRegression));
    const rawReductionPct = baseline && assisted && baseline.amountGbp !== null && assisted.amountGbp !== null && baseline.amountGbp > 0 ? (1 - assisted.amountGbp / baseline.amountGbp) * 100 : null;
    const reductionPct = rawReductionPct === null || !Number.isFinite(rawReductionPct) ? null : rawReductionPct;
    const costsFor = arm => pairs.flatMap(x => received.get(`${x.id}:${arm}`).attempts.filter(qualifiesCost).map(a => a.variableInferenceCost.amountGbp));
    const reviewFor = arm => pairs.map(x => received.get(`${x.id}:${arm}`).reviewSeconds);
    let status = 'incomplete';
    if (complete)
        status = quality && decimalAtMost(costsFor('assisted'), costsFor('baseline'), 5, 4) && decimalAtMost(reviewFor('assisted'), reviewFor('baseline'), 1, 1) ? 'passed' : 'failed';
    return { status, decisionRule: { ...rule }, limitations: ['Operator-supplied declarations are not authenticated; this tool does not read evidence references or infer provider prices.', 'Known subtotals are partial and costs include all recorded attempts.'], incompleteReasons: [...new Set(reasons)], reductionPct, pairs, aggregate: { baseline, assisted } };
}
function cli() {
    const args = process.argv.slice(2);
    if (args[0] === '--help') {
        process.stdout.write('Usage: node task-cost-report.mjs --input /absolute/path.json\n');
        return;
    }
    if (args.length !== 2 || args[0] !== '--input' || !args[1].startsWith('/'))
        fail('use --input ABSOLUTE_PATH');
    let fd;
    try {
        fd = fs.openSync(args[1], fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > MAX)
            fail('input must be a regular file no larger than 1MiB');
        const bytes = Buffer.alloc(MAX + 1);
        const length = fs.readSync(fd, bytes, 0, bytes.length, null);
        if (length > MAX)
            fail('input exceeds 1MiB');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length));
        process.stdout.write(`${JSON.stringify(reportTaskCosts(JSON.parse(text)))}\n`);
    }
    finally {
        if (fd !== undefined)
            fs.closeSync(fd);
    }
}
if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
    try {
        cli();
    }
    catch (error) {
        process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
        process.exitCode = 1;
    }
}
