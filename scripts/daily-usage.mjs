import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normaliseUsage } from './usage-normalise.mjs';

const MAX_LOG = 64 * 1024 * 1024, MAX_REPORT = 16 * 1024 * 1024;
const MAX_EVENTS = 100000, MAX_LINE = 4 * 1024 * 1024;
const MAX_SUMMARY_INPUT = 32 * 1024 * 1024;
const METRICS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens'];
const HASH = /^[0-9a-f]{64}$/;
const LABEL = /^[A-Za-z0-9_.:-]{1,200}$/;
const COVERAGE = ['allAttempts', 'hostPreparation', 'workers', 'review'];
const SPEC_KEYS = ['version', 'taskId', 'developerId', 'accountId', 'repositoryId', 'category', 'client', 'sessionId', 'from', 'to', 'phase', 'contextUsed', 'accepted', 'reviewSeconds', 'coverage'];
const invalid = () => { throw new Error('Invalid daily usage input'); };
const hash = x => createHash('sha256').update(x).digest('hex');
const digest = x => hash(JSON.stringify(x));
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => { if (!object(x) || Object.keys(x).length !== keys.length || Object.keys(x).some(k => !keys.includes(k))) invalid(); };
const label = x => { if (typeof x !== 'string' || !LABEL.test(x)) invalid(); return x; };
const bool = x => { if (x !== null && typeof x !== 'boolean') invalid(); };
const count = x => { if (!Number.isSafeInteger(x) || x < 0) invalid(); return x; };
const add = (a, b) => count(a + b);
function parse(text) { try { return JSON.parse(text); } catch { invalid(); } }
function stamp(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x)) invalid();
  const n = Date.parse(x);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 19) !== x.slice(0, 19)) invalid();
  return new Date(n).toISOString();
}
function validateSpec(s) {
  exact(s, SPEC_KEYS);
  if (s.version !== 1 || !['codex', 'claude', 'ollama'].includes(s.client)) invalid();
  if (s.client === 'ollama' && (s.phase !== 'worker' || s.sessionId !== 'ollama-workers')) invalid();
  for (const k of ['taskId', 'developerId', 'repositoryId', 'sessionId']) label(s[k]);
  if (s.accountId !== null) label(s.accountId);
  if (!['development', 'ecosystem-task', 'evaluation'].includes(s.category) || !['host', 'preparation', 'worker', 'review'].includes(s.phase)) invalid();
  if (stamp(s.from) >= stamp(s.to)) invalid();
  bool(s.contextUsed); bool(s.accepted);
  if (s.reviewSeconds !== null && (typeof s.reviewSeconds !== 'number' || !Number.isFinite(s.reviewSeconds) || s.reviewSeconds < 0)) invalid();
  exact(s.coverage, COVERAGE); COVERAGE.forEach(k => bool(s.coverage[k]));
  return { ...s, from: stamp(s.from), to: stamp(s.to), coverage: { ...s.coverage } };
}

const PROFILE_KEYS = ['version', 'taskId', 'developerId', 'accountId', 'repositoryId', 'category', 'client', 'sessionId', 'phase', 'contextUsed'];
export function startUsage(profile, at = new Date().toISOString()) {
  exact(profile, PROFILE_KEYS);
  if (!['codex', 'claude'].includes(profile.client)) invalid();
  const from = stamp(at);
  // Reuse the import contract; the temporary end is validation only.
  const spec = validateSpec({ ...profile, from, to: new Date(Date.parse(from) + 1).toISOString(),
    accepted: null, reviewSeconds: null, coverage: Object.fromEntries(COVERAGE.map(k => [k, null])) });
  const body = { schema: 'context-usage-start-v1', profile: Object.fromEntries(PROFILE_KEYS.map(k => [k, spec[k]])), from };
  return { ...body, integritySha256: digest(body) };
}

export function finishUsage(boundary, at = new Date().toISOString()) {
  exact(boundary, ['schema', 'profile', 'from', 'integritySha256']);
  const expected = startUsage(boundary.profile, boundary.from);
  if (boundary.schema !== expected.schema || boundary.from !== expected.from || boundary.integritySha256 !== expected.integritySha256) invalid();
  return validateSpec({ ...expected.profile, from: expected.from, to: stamp(at), accepted: null,
    reviewSeconds: null, coverage: Object.fromEntries(COVERAGE.map(k => [k, null])) });
}

// Explicit files only. No directory discovery, network, subprocesses or source execution.
function regularPath(filename, directory = false) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)) invalid();
  const p = path.resolve(filename), parts = p.split(path.sep).filter(Boolean);
  let current = path.parse(p).root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink() || (i < parts.length - 1 || directory ? !st.isDirectory() : !st.isFile())) invalid();
  }
  return p;
}
function readFile(filename, max) {
  const p = regularPath(filename);
  const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > max) invalid();
    // Bounded read even if a file grows while being read.
    const bytes = Buffer.alloc(before.size), read = fs.readSync(fd, bytes, 0, bytes.length, 0);
    const after = fs.fstatSync(fd), now = fs.lstatSync(regularPath(p));
    if (read !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || now.dev !== before.dev || now.ino !== before.ino) invalid();
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha256: hash(bytes), bytes: bytes.length };
  } finally { fs.closeSync(fd); }
}
function writeReport(filename, report) {
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  if (bytes.length > MAX_REPORT || !path.isAbsolute(filename)) invalid();
  const parent = regularPath(path.dirname(filename), true);
  const parentIdentity = fs.statSync(parent);
  const p = path.join(parent, path.basename(filename));
  const fd = fs.openSync(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let success = false;
  try {
    const now = fs.statSync(regularPath(parent, true));
    if (now.ino !== parentIdentity.ino || now.dev !== parentIdentity.dev) invalid();
    fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); success = true;
  } finally {
    const created = fs.fstatSync(fd); fs.closeSync(fd);
    if (!success) {
      const now = fs.lstatSync(p, { throwIfNoEntry: false });
      if (now && now.ino === created.ino && now.dev === created.dev) fs.unlinkSync(p);
    }
  }
}

export function importUsage(text, inputSpec, source = null) {
  const spec = validateSpec(inputSpec);
  if (spec.client === 'ollama') invalid();
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_LOG) invalid();
  const lines = text.split('\n'); if (lines.length > MAX_EVENTS + 1) invalid();
  if (source !== null) {
    exact(source, ['sha256', 'bytes']);
    if (typeof source.sha256 !== 'string' || !HASH.test(source.sha256) || source.sha256 !== hash(text) || source.bytes !== Buffer.byteLength(text)) invalid();
  }
  const projections = [], contexts = new Map();
  const stats = { events: 0, recognisedUsage: 0, otherSession: 0, outsideWindow: 0, cumulativeIgnored: 0, missingIdentity: 0, otherEvents: 0 };
  let matchingSessionMetadata = false;
  const warnings = new Set(['usage-event-time-attribution', 'billing-not-collected', 'coverage-is-operator-asserted']);
  for (const line of lines) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line) > MAX_LINE) invalid();
    const e = parse(line); if (!object(e)) invalid();
    stats.events++;
    if (spec.client === 'codex' && e.type === 'session_meta') matchingSessionMetadata = e.payload?.id === spec.sessionId;
    if (spec.client === 'codex' && e.type === 'turn_context') {
      const p = e.payload;
      if (matchingSessionMetadata && object(p) && typeof p.turn_id === 'string') contexts.set(p.turn_id, {model: p.model ?? null, effort: p.effort ?? null});
      continue;
    }
    if (spec.client === 'codex' && e.type === 'event_msg' && e.payload?.type === 'token_count') { stats.cumulativeIgnored++; continue; }
    const relevant = spec.client === 'codex' ? e.type === 'token_usage_record' : e.type === 'assistant';
    if (!relevant) { stats.otherEvents++; continue; }
    stats.recognisedUsage++;
    const p = spec.client === 'codex' ? e.payload : e;
    if (!object(p)) invalid();
    const sid = spec.client === 'codex' ? p.session_id : p.sessionId;
    if (typeof sid !== 'string') { stats.missingIdentity++; warnings.add('missing-session-identity'); continue; }
    if (sid !== spec.sessionId) { stats.otherSession++; continue; }
    const at = stamp(e.timestamp);
    if (at < spec.from || at >= spec.to) { stats.outsideWindow++; continue; }
    const responseId = spec.client === 'codex' ? p.response_id : p.message?.id;
    if (typeof responseId !== 'string') { stats.missingIdentity++; warnings.add('missing-response-identity'); continue; }
    const context = contexts.get(p.turn_id);
    projections.push({sessionId: sid, responseId, at,
      model: spec.client === 'codex' ? context?.model ?? null : p.message?.model ?? null,
      effort: spec.client === 'codex' ? context?.effort ?? null : null,
      usage: spec.client === 'codex' ? p.usage ?? null : p.message?.usage ?? null});
  }
  const usage = normaliseUsage(spec.client, projections);
  for (const warning of usageWarnings(usage, stats)) warnings.add(warning);
  const { sessionId, ...metadata } = spec;
  const report = { schema: 'context-daily-usage-v1', toolVersion: 1,
    metadata: { ...metadata, sessionIdHash: hash(sessionId) },
    source: source ?? { sha256: hash(text), bytes: Buffer.byteLength(text) }, stats,
    warnings: [...warnings].sort(), usage,
    interpretation: { scope: 'observed-selected-request-usage', taskCoverage: 'not-independently-verified', cashSavings: null, tokenSavings: null } };
  return { ...report, integritySha256: digest(report) };
}

// The helper has no request ID or wall-clock timestamp. Both must be supplied
// explicitly from task evidence, never inferred from a filename or prompt hash.
export function importWorkerUsage(text, inputSpec, source = null) {
  exact(inputSpec, [...SPEC_KEYS, 'attemptId', 'at']);
  const { attemptId, at, ...base } = inputSpec;
  const spec = validateSpec(base);
  if (spec.client !== 'ollama') invalid();
  label(attemptId);
  const timestamp = stamp(at);
  if (timestamp < spec.from || timestamp >= spec.to) invalid();
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_LINE) invalid();
  if (source !== null) {
    exact(source, ['sha256', 'bytes']);
    if (source.sha256 !== hash(text) || source.bytes !== Buffer.byteLength(text)) invalid();
  }
  const receipt = parse(text);
  if (!object(receipt) || !['success', 'truncated', 'unusable', 'refused', 'unknown', 'busy', 'refused-pending'].includes(receipt.status)) invalid();
  // Only a small projection leaves private storage. Task prose, endpoint,
  // route reasons, provider error bodies and any extra fields are discarded.
  if (typeof receipt.promptSha256 !== 'string' || !HASH.test(receipt.promptSha256)) invalid();
  const model = label(receipt.model);
  const effort = typeof receipt.think === 'boolean' ? String(receipt.think) : receipt.think;
  if (!['false', 'true', 'low', 'high', 'max'].includes(effort)) invalid();
  exact(receipt.reportedTokens, ['prompt', 'completion', 'total']);
  for (const value of Object.values(receipt.reportedTokens)) if (value !== null) count(value);
  const terminal = ['success', 'truncated', 'unusable'].includes(receipt.status);
  if (!terminal && Object.values(receipt.reportedTokens).some(v => v !== null)) invalid();
  const usage = normaliseUsage('ollama', [{ sessionId: spec.sessionId, responseId: attemptId,
    at: timestamp, model, effort, usage: receipt.reportedTokens }]);
  const stats = { events: 1, recognisedUsage: 1, otherSession: 0, outsideWindow: 0,
    cumulativeIgnored: 0, missingIdentity: 0, otherEvents: 0 };
  const warnings = [...usageWarnings(usage, stats), `worker-status-${receipt.status}`,
    'worker-identity-and-time-operator-supplied', 'worker-model-and-effort-requested',
    'worker-cache-and-reasoning-unknown'].sort();
  const { sessionId, ...metadata } = spec;
  const report = { schema: 'context-daily-usage-v1', toolVersion: 1,
    metadata: { ...metadata, sessionIdHash: hash(sessionId) },
    source: source ?? { sha256: hash(text), bytes: Buffer.byteLength(text) }, stats, warnings, usage,
    interpretation: { scope: 'observed-selected-request-usage', taskCoverage: 'not-independently-verified', cashSavings: null, tokenSavings: null } };
  return { ...report, integritySha256: digest(report) };
}

function usageWarnings(usage, stats) {
  const warnings = ['usage-event-time-attribution', 'billing-not-collected', 'coverage-is-operator-asserted'];
  if (!usage.records.length) warnings.push('no-selected-request-usage');
  if (usage.conflicts) warnings.push('conflicting-request-usage');
  if (usage.totalTokens.completeTotal === null) warnings.push('incomplete-token-counters');
  if (usage.records.some(r => r.model === null)) warnings.push('unknown-model');
  if (usage.records.some(r => r.effort === null)) warnings.push('unknown-effort');
  if (stats.missingIdentity) warnings.push('missing-usage-identity');
  return warnings.sort();
}

function totals(records) {
  const one = values => ({knownSubtotal: values.filter(v => v !== null).reduce(add, 0), completeTotal: !values.length || values.includes(null) ? null : values.reduce(add, 0), unknownRecords: values.filter(v => v === null).length});
  return { metrics: Object.fromEntries(METRICS.map(m => [m, one(records.map(r => r.usage[m]))])),
    totalTokens: one(records.map(r => r.usage.inputTokens === null || r.usage.outputTokens === null ? null : add(r.usage.inputTokens, r.usage.outputTokens))) };
}
function validateReceipt(r) {
  exact(r, ['schema', 'toolVersion', 'metadata', 'source', 'stats', 'warnings', 'usage', 'interpretation', 'integritySha256']);
  const {integritySha256, ...body} = r;
  if (r.schema !== 'context-daily-usage-v1' || r.toolVersion !== 1 || !HASH.test(integritySha256) || digest(body) !== integritySha256) invalid();
  exact(r.metadata, [...SPEC_KEYS.filter(k => k !== 'sessionId'), 'sessionIdHash']);
  const { sessionIdHash, ...m } = r.metadata;
  if (!HASH.test(sessionIdHash)) invalid();
  validateSpec({...m, sessionId: m.client === 'ollama' ? 'ollama-workers' : 'validation-placeholder'});
  if (m.client === 'ollama' && sessionIdHash !== hash('ollama-workers')) invalid();
  exact(r.source, ['sha256', 'bytes']); if (!HASH.test(r.source.sha256)) invalid(); count(r.source.bytes);
  if (r.source.bytes > MAX_LOG) invalid();
  exact(r.usage, ['version', 'client', 'records', 'duplicates', 'conflicts', 'totals', 'totalTokens']);
  if (r.usage.version !== 1 || r.usage.client !== m.client || !Array.isArray(r.usage.records) || r.usage.records.length > MAX_EVENTS) invalid();
  count(r.usage.duplicates); count(r.usage.conflicts);
  const ids = new Set();
  for (const a of r.usage.records) {
    exact(a, ['id', 'sessionIdHash', 'responseIdHash', 'at', 'model', 'effort', 'usage', 'conflict']);
    if (![a.id, a.sessionIdHash, a.responseIdHash].every(v => typeof v === 'string' && HASH.test(v)) || a.sessionIdHash !== sessionIdHash || ids.has(a.id)) invalid();
    ids.add(a.id);
    if (stamp(a.at) < stamp(m.from) || stamp(a.at) >= stamp(m.to)) invalid();
    for (const k of ['model', 'effort']) if (a[k] !== null) label(a[k]);
    if (typeof a.conflict !== 'boolean') invalid();
    exact(a.usage, METRICS); METRICS.forEach(k => { if (a.usage[k] !== null) count(a.usage[k]); });
    if (a.conflict && (a.model !== null || a.effort !== null || METRICS.some(k => a.usage[k] !== null))) invalid();
    const u = a.usage;
    if (u.inputTokens !== null && [u.cachedInputTokens, u.cacheWriteInputTokens].some(v => v !== null && v > u.inputTokens)) invalid();
    if (u.inputTokens !== null && u.cachedInputTokens !== null && u.cacheWriteInputTokens !== null && add(u.cachedInputTokens, u.cacheWriteInputTokens) > u.inputTokens) invalid();
    if (u.outputTokens !== null && u.reasoningOutputTokens !== null && u.reasoningOutputTokens > u.outputTokens) invalid();
    if (m.client === 'claude' && u.reasoningOutputTokens !== null) invalid();
  }
  const recomputed = totals(r.usage.records);
  if (JSON.stringify(recomputed.metrics) !== JSON.stringify(r.usage.totals) || JSON.stringify(recomputed.totalTokens) !== JSON.stringify(r.usage.totalTokens) || r.usage.records.filter(a => a.conflict).length !== r.usage.conflicts) invalid();
  // These fields are not copied into summaries; enforce bounded code-only metadata.
  exact(r.stats, ['events', 'recognisedUsage', 'otherSession', 'outsideWindow', 'cumulativeIgnored', 'missingIdentity', 'otherEvents']);
  Object.values(r.stats).forEach(count);
  if (!Array.isArray(r.warnings) || r.warnings.length > 32 || r.warnings.some(w => typeof w !== 'string' || !/^[a-z-]{1,80}$/.test(w))) invalid();
  if (usageWarnings(r.usage, r.stats).some(w => !r.warnings.includes(w))) invalid();
  if (m.client === 'ollama') {
    for (const w of ['worker-identity-and-time-operator-supplied', 'worker-model-and-effort-requested', 'worker-cache-and-reasoning-unknown']) if (!r.warnings.includes(w)) invalid();
    const statuses = r.warnings.filter(w => w.startsWith('worker-status-'));
    if (statuses.length !== 1 || !['success', 'truncated', 'unusable', 'refused', 'unknown', 'busy', 'refused-pending'].some(s => statuses[0] === `worker-status-${s}`)) invalid();
    if (r.usage.records.length !== 1) invalid();
    const u = r.usage.records[0].usage;
    if ([u.cachedInputTokens, u.cacheWriteInputTokens, u.reasoningOutputTokens].some(v => v !== null)) invalid();
    if (!['worker-status-success', 'worker-status-truncated', 'worker-status-unusable'].includes(statuses[0]) && (u.inputTokens !== null || u.outputTokens !== null)) invalid();
  }
  if (JSON.stringify(r.interpretation) !== JSON.stringify({scope:'observed-selected-request-usage',taskCoverage:'not-independently-verified',cashSavings:null,tokenSavings:null})) invalid();
  return r;
}

export function summariseUsage(receipts) {
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > 32) invalid();
  const unique = [], seen = new Set(), requestIds = new Map(), tasks = new Map(), cohorts = new Map();
  let duplicateReceipts = 0, duplicateRequests = 0, totalBytes = 0, totalRecords = 0;
  for (const r of receipts) {
    totalBytes += Buffer.byteLength(JSON.stringify(r));
    if (totalBytes > MAX_SUMMARY_INPUT) invalid();
    validateReceipt(r);
    if (seen.has(r.integritySha256)) { duplicateReceipts++; continue; }
    seen.add(r.integritySha256);
    const m = r.metadata;
    for (const old of unique) {
      const n = old.metadata;
      if (m.client !== 'ollama' && n.client === m.client && n.sessionIdHash === m.sessionIdHash && stamp(m.from) < stamp(n.to) && stamp(n.from) < stamp(m.to) &&
          (n.taskId !== m.taskId || n.accountId !== m.accountId || n.repositoryId !== m.repositoryId || n.phase !== m.phase)) invalid();
    }
    unique.push(r);
    const task = {taskId:m.taskId, developerId:m.developerId, repositoryId:m.repositoryId, category:m.category, contextUsed:m.contextUsed, accepted:m.accepted, reviewSeconds:m.reviewSeconds};
    if (tasks.has(m.taskId) && JSON.stringify(tasks.get(m.taskId).task) !== JSON.stringify(task)) invalid();
    if (!tasks.has(m.taskId)) tasks.set(m.taskId, {task, clients:new Set(), accountIds:new Set()});
    tasks.get(m.taskId).clients.add(m.client); tasks.get(m.taskId).accountIds.add(m.accountId);
    totalRecords += r.usage.records.length;
    if (totalRecords > MAX_EVENTS) invalid();
    for (const a of r.usage.records) {
      const attribution = JSON.stringify([m.taskId, m.developerId, m.accountId, m.repositoryId, m.phase]);
      const workerStatus = m.client === 'ollama' ? r.warnings.find(w => w.startsWith('worker-status-')).slice('worker-status-'.length) : null;
      if (requestIds.has(a.id)) {
        const old = requestIds.get(a.id);
        const {at: oldAt, ...oldData} = old.record, {at: newAt, ...newData} = a;
        if (old.attribution !== attribution || old.workerStatus !== workerStatus || JSON.stringify(oldData) !== JSON.stringify(newData)) invalid();
        if (stamp(newAt) < stamp(oldAt)) old.record.at = stamp(newAt);
        duplicateRequests++; continue;
      }
      const record = {...a, usage:{...a.usage}};
      requestIds.set(a.id, {attribution, record, workerStatus});
      const key = JSON.stringify([m.client, m.accountId, m.category, a.model, a.effort, m.contextUsed]);
      if (!cohorts.has(key)) cohorts.set(key, {client:m.client, accountId:m.accountId, category:m.category, model:a.model, effort:a.effort, contextUsed:m.contextUsed, records:[], taskIds:new Set()});
      const cohort = cohorts.get(key); cohort.records.push(record); cohort.taskIds.add(m.taskId);
    }
  }
  const taskRows = [...tasks.values()].map(t => ({...t.task,clients:[...t.clients].sort(),accountIds:[...t.accountIds].sort()})).sort((a,b) => a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0);
  return {schema:'context-daily-summary-v1', receiptCount:unique.length, duplicateReceipts, duplicateRequests,
    workerAttempts: Object.fromEntries(['success', 'truncated', 'unusable', 'refused', 'unknown', 'busy', 'refused-pending'].map(status => [status, [...requestIds.values()].filter(r => r.workerStatus === status).length])),
    tasks:{count:taskRows.length, accepted:taskRows.filter(t => t.accepted === true).length, rejected:taskRows.filter(t => t.accepted === false).length, unknown:taskRows.filter(t => t.accepted === null).length, rows:taskRows},
    coverage:unique.map(r => ({receiptSha256:r.integritySha256,taskId:r.metadata.taskId,phase:r.metadata.phase,from:r.metadata.from,to:r.metadata.to,asserted:r.metadata.coverage,warnings:r.warnings,sourceStats:r.stats,observedRequests:r.usage.records.length})),
    cohorts:[...cohorts.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,c]) => ({client:c.client,accountId:c.accountId,category:c.category,model:c.model,effort:c.effort,contextUsed:c.contextUsed,taskIds:[...c.taskIds].sort(),observedRequests:c.records.length,...totals(c.records)})),
    interpretation:{scope:'observed-usage-not-a-controlled-comparison', taskCoverage:'not-independently-verified', monthlySpend:null, cashSavings:null, tokenSavings:null}};
}

function main(args) {
  const command = args.shift();
  if (!['start', 'finish', 'import', 'import-worker', 'summary'].includes(command) || args.length % 2) invalid();
  const opts = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--input', '--spec', '--out'].includes(key) || (opts.has(key) && (key !== '--input' || command !== 'summary'))) invalid();
    opts.set(key, [...(opts.get(key) ?? []), args[i+1]]);
  }
  if (!opts.has('--out')) invalid();
  if (command === 'start' || command === 'finish') {
    const inputKey = command === 'start' ? '--spec' : '--input';
    if (opts.size !== 2 || !opts.has(inputKey)) invalid();
    const input = parse(readFile(opts.get(inputKey)[0], 65536).text);
    const result = command === 'start' ? startUsage(input) : finishUsage(input);
    writeReport(opts.get('--out')[0], result);
    process.stdout.write(JSON.stringify({status:'written',schema:result.schema ?? 'context-usage-import-spec-v1',sha256:digest(result)}) + '\n');
    return;
  }
  if (!opts.has('--input')) invalid();
  let report;
  if (command === 'import' || command === 'import-worker') {
    if (!opts.has('--spec') || opts.size !== 3) invalid();
    const spec = parse(readFile(opts.get('--spec')[0], 65536).text);
    const input = readFile(opts.get('--input')[0], command === 'import-worker' ? MAX_LINE : MAX_LOG);
    report = (command === 'import-worker' ? importWorkerUsage : importUsage)(input.text, spec, {sha256:input.sha256,bytes:input.bytes});
    validateReceipt(report);
  } else {
    if (opts.size !== 2 || opts.get('--input').length > 32) invalid();
    const receipts = []; let totalBytes = 0;
    for (const p of opts.get('--input')) {
      const input = readFile(p, Math.min(MAX_REPORT, MAX_SUMMARY_INPUT - totalBytes));
      totalBytes += input.bytes; receipts.push(parse(input.text));
    }
    report = summariseUsage(receipts);
  }
  writeReport(opts.get('--out')[0], report);
  process.stdout.write(JSON.stringify({status:'written',schema:report.schema,sha256:digest(report)}) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch { process.stderr.write('daily-usage: invalid, changing or inaccessible input/output\n'); process.exitCode = 2; }
}
