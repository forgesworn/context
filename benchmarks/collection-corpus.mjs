// Benchmarks/collection-corpus.mjs — synthetic retrieval fixture driver.

import { createHash } from 'node:crypto';
import { retrieveView } from '../packages/context/dist/retrieval.js';

export const BENCHMARK_LIMITS = Object.freeze({
  maxCollections: 32,
  maxRecordsPerCollection: 128,
  maxBytesPerCall: 8192,
  maxRecordsPerCall: 4,
});

const HEX64 = /^[0-9a-f]{64}$/;
const OWNER = '1d'.repeat(32);
const V1_ID = '2e'.repeat(32);
const V1_HEAD = '3f'.repeat(32);

function sha64(label) {
  return createHash('sha256').update(label).digest('hex');
}

function fail(msg) {
  throw new Error(`[collection-corpus] ${msg}`);
}

export function partitionBenchmarkRecords(records, observedAt) {
  if (!Array.isArray(records) || records.length === 0) fail('records must be non-empty array');
  if (records.length > 4096) fail('records exceeds 4096');
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) fail('observedAt required');

  const seen = new Set();
  for (const rec of records) {
    if (!rec || typeof rec.id !== 'string' || !HEX64.test(rec.id)) fail('invalid record id');
    if (seen.has(rec.id)) fail(`duplicate record id ${rec.id}`);
    seen.add(rec.id);
  }

  const slices = [];
  for (let i = 0; i < records.length; i += BENCHMARK_LIMITS.maxRecordsPerCollection) {
    slices.push(records.slice(i, i + BENCHMARK_LIMITS.maxRecordsPerCollection));
  }

  return slices.map((slice, index) => {
    const first = index === 0;
    const id = first ? V1_ID : sha64(`context-repo/benchmark/collection/${index}`);
    const head = first ? V1_HEAD : sha64(`context-repo/benchmark/head/${index}`);
    return Object.freeze({
      id,
      owner: OWNER,
      title: 'Context repository benchmark',
      scope: 'personal',
      epoch: 1,
      head,
      revision: 1,
      updatedAt: observedAt,
      role: 'write',
      uploaded: false,
      records: slice,
    });
  });
}

function validateViews(views) {
  if (!Array.isArray(views)) fail('views must be array');
  if (views.length < 1 || views.length > BENCHMARK_LIMITS.maxCollections) {
    fail(`views length ${views.length} not in 1..${BENCHMARK_LIMITS.maxCollections}`);
  }
  const ids = new Set();
  for (const v of views) {
    if (!v || typeof v.id !== 'string' || !HEX64.test(v.id)) fail('invalid view.id');
    if (ids.has(v.id)) fail(`duplicate view.id ${v.id}`);
    ids.add(v.id);
    if (!Array.isArray(v.records) || v.records.length === 0) fail('view.records non-empty');
    if (v.records.length > BENCHMARK_LIMITS.maxRecordsPerCollection) {
      fail(`view.records exceeds ${BENCHMARK_LIMITS.maxRecordsPerCollection}`);
    }
  }
}

export function measureBenchmarkRetrieval(views, query, countTokens) {
  validateViews(views);
  if (typeof countTokens !== 'function') fail('countTokens must be function');
  if (typeof query !== 'string') fail('query must be string');

  let retrievedTokens = 0;
  let bytesUsed = 0;
  const sources = new Set();
  const collections = [];

  for (const view of views) {
    const payload = retrieveView(view, {
      query,
      maxBytes: BENCHMARK_LIMITS.maxBytesPerCall,
      maxRecords: BENCHMARK_LIMITS.maxRecordsPerCall,
      includeRelated: false,
    });
    const serialized = JSON.stringify(payload);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > BENCHMARK_LIMITS.maxBytesPerCall) {
      fail(`payload bytes ${bytes} exceeds ${BENCHMARK_LIMITS.maxBytesPerCall}`);
    }
    if (!Array.isArray(payload.records) || payload.availableRecords !== view.records.length || payload.bytesUsed !== bytes) {
      fail('retrieval returned inconsistent coverage or byte accounting');
    }
    const recs = payload.records;
    if (recs.length > BENCHMARK_LIMITS.maxRecordsPerCall) {
      fail(`payload.records ${recs.length} exceeds ${BENCHMARK_LIMITS.maxRecordsPerCall}`);
    }
    const tokens = countTokens(serialized);
    if (!Number.isSafeInteger(tokens) || tokens < 0) fail('countTokens returned invalid');

    retrievedTokens += tokens;
    bytesUsed += bytes;
    for (const rec of recs) {
      if (rec && typeof rec.source === 'string') sources.add(rec.source);
    }
    collections.push(Object.freeze({
      collection: view.id,
      availableRecords: payload.availableRecords,
      returnedRecords: recs.length,
      retrievedTokens: tokens,
      bytesUsed: bytes,
    }));
  }

  return Object.freeze({
    retrievalCalls: views.length,
    retrievedTokens,
    bytesUsed,
    returnedSources: Object.freeze([...sources].sort()),
    collections: Object.freeze(collections),
  });
}
