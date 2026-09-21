import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { PostingIndex } from './postings.mjs';
import { recordsFor, recordId, needleTerm } from './corpus.mjs';

function parseArgs(argv) {
  let n = 10000;
  let seen = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--records') {
      if (seen) throw new Error('duplicate --records');
      seen = true;
      const v = argv[++i];
      if (v === undefined) throw new Error('--records needs value');
      const num = Number(v);
      if (![10000, 100000, 1000000].includes(num)) throw new Error('invalid N');
      n = num;
    } else throw new Error('unexpected argument: ' + a);
  }
  return n;
}

function pct(sorted, q) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[idx];
}

function sameIds(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const N = parseArgs(process.argv.slice(2));
let dir = null;
let index = null;
let exitCode = 0;
const out = {
  n: N,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  correctness: false,
  caveat: 'ID-only exact-token pages; no ranking, payload fetch, graph, hard deadline or internal SQLite work bound',
};

try {
  dir = await mkdtemp(join(tmpdir(), 'z1p-postings-bench-'));
  const dbPath = join(dir, 'index.db');
  index = new PostingIndex(dbPath);

  const t0 = performance.now();
  await index.build('bench', 'g1', recordsFor(N));
  const buildMs = performance.now() - t0;

  await index.close();
  out.buildMs = buildMs;
  out.dbBytes = (await stat(dbPath)).size;
  index = null;

  index = new PostingIndex(dbPath);
  out.sqliteVersion = index.db.prepare('select sqlite_version() as v').get().v;
  const plan = index.explainSearchPlan('bench', 'g1', 'shared');
  out.queryPlan = plan;
  const planStr = plan.join(' ');
  if (!planStr.includes('SEARCH') || !planStr.includes('PRIMARY KEY')) throw new Error('plan missing SEARCH PRIMARY KEY');
  if (planStr.includes('SCAN')) throw new Error('plan uses SCAN');
  if (planStr.includes('TEMP B-TREE')) throw new Error('plan uses TEMP B-TREE');

  for (let s = 0; s < 8; s++) {
    const term = needleTerm((s * 7919) % N);
    await index.search('bench', 'g1', term, { limit: 10, maxPostings: 10 });
    await index.search('bench', 'g1', 'shared', { limit: 10, maxPostings: 10 });
    await index.search('bench', 'g1', 'shared', { limit: 10, maxPostings: 10, cursor: { version: 1, scope: 'bench', generation: 'g1', term: 'shared', after: recordId(N - 21) } });
  }

  const samples = { common: [], unique: [], deep: [] };
  let ok = true;
  for (let s = 0; s < 32; s++) {
    {
      const t = performance.now();
      const r = await index.search('bench', 'g1', 'shared', { limit: 10, maxPostings: 10 });
      samples.common.push(performance.now() - t);
      if (r.internalWorkMeasured !== false) ok = false;
      if (r.postingsRead !== r.ids.length || r.ids.length > 10) ok = false;
      if (r.complete !== false) ok = false;
      const exp = [];
      for (let i = 0; i < 10; i++) exp.push(recordId(i));
      if (!sameIds(r.ids, exp)) ok = false;
    }
    {
      const term = needleTerm((s * 7919) % N);
      const t = performance.now();
      const r = await index.search('bench', 'g1', term, { limit: 10, maxPostings: 10 });
      samples.unique.push(performance.now() - t);
      if (r.internalWorkMeasured !== false) ok = false;
      if (r.postingsRead !== r.ids.length || r.ids.length > 10) ok = false;
      if (r.complete !== true) ok = false;
      if (!sameIds(r.ids, [recordId((s * 7919) % N)])) ok = false;
    }
    {
      const t = performance.now();
      const r = await index.search('bench', 'g1', 'shared', { limit: 10, maxPostings: 10, cursor: { version: 1, scope: 'bench', generation: 'g1', term: 'shared', after: recordId(N - 21) } });
      samples.deep.push(performance.now() - t);
      if (r.internalWorkMeasured !== false) ok = false;
      if (r.postingsRead !== r.ids.length || r.ids.length > 10) ok = false;
      if (r.complete !== false) ok = false;
      const exp = [];
      for (let i = N - 20; i <= N - 11; i++) exp.push(recordId(i));
      if (!sameIds(r.ids, exp)) ok = false;
    }
  }
  if (!ok) throw new Error('assertion failure');

  out.maxRSSBytes = process.resourceUsage().maxRSS * 1024;
  out.heapUsedBytes = process.memoryUsage().heapUsed;
  out.correctness = true;
  for (const [name, arr] of Object.entries(samples)) {
    const sorted = arr.slice().sort((a, b) => a - b);
    out[name] = {
      p50: pct(sorted, 0.5),
      p95: pct(sorted, 0.95),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      n: sorted.length,
    };
  }
  out.corpus = { records: N, edges: 0 };
  out.workloadNote = 'corpus counts are records only; not equivalent to graph workload';
} catch (e) {
  exitCode = 1;
  out.error = String(e && e.message ? e.message : e);
} finally {
  let cleanupError;
  try { if (index) await index.close(); } catch (error) { cleanupError = error; }
  try { if (dir) await rm(dir, { recursive: true, force: true }); } catch (error) { if (!cleanupError) cleanupError = error; }
  if (cleanupError) {
    process.exitCode = 1;
    out.correctness = false;
    out.cleanupError = String(cleanupError);
  }
}

console.log(JSON.stringify(out));
if (exitCode) process.exitCode = exitCode;
