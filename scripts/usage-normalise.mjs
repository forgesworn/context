import { createHash } from 'node:crypto';

const MAX_RECORDS = 100000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,200}$/;
const NAME_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const METRICS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens'];
const HASH_RE = /^[0-9a-f]{64}$/;

const fail = () => { throw new Error('Invalid usage record'); };

function sha256(s) { return createHash('sha256').update(s, 'utf8').digest('hex'); }

function checkId(v) { if (typeof v !== 'string' || !ID_RE.test(v)) fail(); return v; }
function checkName(v) { if (v === null) return null; if (typeof v !== 'string' || !NAME_RE.test(v)) fail(); return v; }

function checkAt(v) {
  if (typeof v !== 'string' || !AT_RE.test(v)) fail();
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) fail();
  const iso = new Date(ms).toISOString();
  if (iso.slice(0, 10) !== v.slice(0, 10)) fail();
  return iso;
}

function metricOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail();
  return v;
}

function safeAdd(a, b) {
  const s = a + b;
  if (!Number.isSafeInteger(s)) fail();
  return s;
}

function emptyMetrics() {
  return { inputTokens: null, outputTokens: null, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningOutputTokens: null };
}

function normaliseCodex(usage) {
  if (usage === null || usage === undefined) return emptyMetrics();
  if (typeof usage !== 'object' || Array.isArray(usage)) fail();
  const input = metricOrNull(usage.input_tokens);
  const output = metricOrNull(usage.output_tokens);
  const cached = metricOrNull(usage.cached_input_tokens);
  const cacheWrite = metricOrNull(usage.cache_write_input_tokens);
  const reasoning = metricOrNull(usage.reasoning_output_tokens);
  const total = metricOrNull(usage.total_tokens);
  if (total !== null) {
    if (input === null || output === null) fail();
    if (safeAdd(input, output) !== total) fail();
  }
  if (cached !== null && input !== null && cached > input) fail();
  if (cacheWrite !== null && input !== null && cacheWrite > input) fail();
  if (cached !== null && cacheWrite !== null && input !== null && safeAdd(cached, cacheWrite) > input) fail();
  if (reasoning !== null && output !== null && reasoning > output) fail();
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    reasoningOutputTokens: reasoning,
  };
}

function normaliseClaude(usage) {
  if (usage === null || usage === undefined) return emptyMetrics();
  if (typeof usage !== 'object' || Array.isArray(usage)) fail();
  const input = metricOrNull(usage.input_tokens);
  const output = metricOrNull(usage.output_tokens);
  const cacheRead = metricOrNull(usage.cache_read_input_tokens);
  const cacheCreate = metricOrNull(usage.cache_creation_input_tokens);
  const inputTokens = (input !== null && cacheRead !== null && cacheCreate !== null)
    ? safeAdd(safeAdd(input, cacheRead), cacheCreate)
    : null;
  return {
    inputTokens,
    outputTokens: output,
    cachedInputTokens: cacheRead,
    cacheWriteInputTokens: cacheCreate,
    reasoningOutputTokens: null,
  };
}

function normaliseOllama(usage) {
  if (usage === null || usage === undefined) return emptyMetrics();
  if (typeof usage !== 'object' || Array.isArray(usage)) fail();
  const prompt = metricOrNull(usage.prompt);
  const completion = metricOrNull(usage.completion);
  const total = metricOrNull(usage.total);
  if (total !== null) {
    if (prompt === null || completion === null) fail();
    if (safeAdd(prompt, completion) !== total) fail();
  }
  return {
    inputTokens: prompt,
    outputTokens: completion,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    reasoningOutputTokens: null,
  };
}

function metricsEqual(a, b) {
  for (const m of METRICS) if (a[m] !== b[m]) return false;
  return true;
}

export function normaliseUsage(client, records) {
  if (client !== 'codex' && client !== 'claude' && client !== 'ollama') fail();
  if (!Array.isArray(records) || records.length > MAX_RECORDS) fail();

  const map = new Map();
  let duplicates = 0;

  for (const rec of records) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) fail();
    const sessionId = checkId(rec.sessionId);
    const responseId = checkId(rec.responseId);
    const at = checkAt(rec.at);
    const model = checkName(rec.model);
    const effort = checkName(rec.effort);
    const usage = client === 'codex'
      ? normaliseCodex(rec.usage)
      : client === 'claude'
        ? normaliseClaude(rec.usage)
        : normaliseOllama(rec.usage);
    const key = sessionId + '\0' + responseId;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        sessionId, responseId, at, model, effort, usage, conflict: false,
      });
      continue;
    }
    if (prev.conflict) {
      duplicates++;
      if (at < prev.at) prev.at = at;
      continue;
    }
    if (prev.model !== model || prev.effort !== effort || !metricsEqual(prev.usage, usage)) {
      prev.conflict = true;
      prev.model = null;
      prev.effort = null;
      prev.usage = emptyMetrics();
      if (at < prev.at) prev.at = at;
      duplicates++;
      continue;
    }
    duplicates++;
    if (at < prev.at) prev.at = at;
  }

  const entries = [...map.values()].map((e) => {
    const id = sha256(client + '\0' + e.sessionId + '\0' + e.responseId);
    const sessionIdHash = sha256(e.sessionId);
    const responseIdHash = sha256(e.responseId);
    if (!HASH_RE.test(id) || !HASH_RE.test(sessionIdHash) || !HASH_RE.test(responseIdHash)) fail();
    return {
      id, sessionIdHash, responseIdHash, at: e.at, model: e.model, effort: e.effort,
      usage: e.usage, conflict: e.conflict,
    };
  });

  entries.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const totals = {};
  for (const m of METRICS) {
    let knownSubtotal = 0;
    let unknownRecords = 0;
    for (const e of entries) {
      const v = e.usage[m];
      if (v === null) unknownRecords++;
      else knownSubtotal = safeAdd(knownSubtotal, v);
    }
    const completeTotal = entries.length === 0 || unknownRecords > 0 ? null : knownSubtotal;
    totals[m] = { knownSubtotal, completeTotal, unknownRecords };
  }

  let ttKnownSubtotal = 0;
  let ttUnknown = 0;
  for (const e of entries) {
    const i = e.usage.inputTokens;
    const o = e.usage.outputTokens;
    if (i === null || o === null) ttUnknown++;
    else ttKnownSubtotal = safeAdd(ttKnownSubtotal, safeAdd(i, o));
  }
  const totalTokens = {
    knownSubtotal: ttKnownSubtotal,
    completeTotal: entries.length === 0 || ttUnknown > 0 ? null : ttKnownSubtotal,
    unknownRecords: ttUnknown,
  };

  const conflicts = entries.reduce((n, e) => n + (e.conflict ? 1 : 0), 0);

  return {
    version: 1,
    client,
    records: entries,
    duplicates,
    conflicts,
    totals,
    totalTokens,
  };
}
