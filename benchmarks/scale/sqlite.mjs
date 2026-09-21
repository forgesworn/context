// Isolated, synchronous benchmark harness for Z1P Core scale evaluation.
// Public synthetic data only; no network; no private repositories.
//
// ARCHITECTURE BOUNDARY / NON-CLAIMS
// - This evaluates indexed local query over synthetic data BEFORE any v2 crypto work.
//   Every SQL statement names both scope and generation explicitly; there is no
//   "global query then filter in JS" path.
// - Generations are built transactionally and the current pointer is switched only
//   after all records and edges are inserted. A failed build leaves the prior
//   generation untouched. This is NOT a production encrypted index, and it is not
//   an access-control proof.
// - The synchronous API is NOT a cancellable production worker. Deadline handling,
//   if any, can only be best-effort between synchronous calls. It is never a bound
//   on internal SQLite/FTS engine work; LIMIT does not bound internal engine work.
// - Counters are exact per-result (rows returned). Internal engine work is reported
//   as unmeasured, and FTS relevance is not claimed to be exact top-k.

import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  recordsFor,
  edgesFor,
  recordId,
  needleTerm,
  expectedEdgeTargets,
  CORPUS_LIMITS,
} from "./corpus.mjs";

const MAX_LIMIT = 100;

function assertName(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f]/.test(value)) {
    throw new TypeError(`${label} must be a nonempty string of length 1..128 without control chars`);
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !/^r\d{7}$/.test(value)) {
    throw new TypeError(`${label} must match ^r\\d{7}$`);
  }
}

function assertLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be a safe integer in [1, ${MAX_LIMIT}]`);
  }
}

// Treat caller text as a literal FTS phrase by wrapping in a quoted phrase and
// doubling any embedded double quotes. Never interprets raw FTS grammar.
function toLiteralFtsPhrase(term) {
  if (typeof term !== "string" || term.length === 0) {
    throw new TypeError("search term must be a nonempty string");
  }
  return `"${term.replace(/"/g, '""')}"`;
}

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE records (
  scope TEXT NOT NULL,
  generation TEXT NOT NULL,
  id TEXT NOT NULL,
  source TEXT NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (scope, generation, id)
);
CREATE TABLE edges (
  scope TEXT NOT NULL,
  generation TEXT NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  kind TEXT NOT NULL,
  PRIMARY KEY (scope, generation, source, target, kind),
  FOREIGN KEY (scope, generation, source) REFERENCES records (scope, generation, id),
  FOREIGN KEY (scope, generation, target) REFERENCES records (scope, generation, id)
);
CREATE INDEX edges_forward ON edges (scope, generation, source, kind, target);
CREATE INDEX edges_reverse ON edges (scope, generation, target, kind, source);
CREATE TABLE current (
  scope TEXT PRIMARY KEY,
  generation TEXT NOT NULL
);
CREATE VIRTUAL TABLE records_fts USING fts5 (
  scope UNINDEXED,
  generation UNINDEXED,
  id UNINDEXED,
  text
);
`;

export class ScaleIndex {
  #db;
  #closed = false;

  constructor(path) {
    if (typeof path !== "string" || path.length === 0) {
      throw new TypeError("path must be a nonempty string");
    }
    this.#db = new DatabaseSync(path);
    this.#db.exec(SCHEMA);
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  build(scope, generation, recordsIterable, edgesIterable) {
    assertName(scope, "scope");
    assertName(generation, "generation");
    if (recordsIterable == null || edgesIterable == null) {
      throw new TypeError("recordsIterable and edgesIterable are required");
    }

    const existing = this.#db
      .prepare("SELECT 1 AS present FROM current WHERE scope = ?")
      .get(scope);

    const genPresent = this.#db
      .prepare("SELECT 1 AS present FROM records WHERE scope = ? AND generation = ? LIMIT 1")
      .get(scope, generation);
    if (genPresent) {
      throw new Error(`generation already present for scope: ${scope}/${generation}`);
    }
    void existing;

    const insertRecord = this.#db.prepare(
      "INSERT INTO records (scope, generation, id, source, text) VALUES (?, ?, ?, ?, ?)"
    );
    const insertEdge = this.#db.prepare(
      "INSERT INTO edges (scope, generation, source, target, kind) VALUES (?, ?, ?, ?, ?)"
    );
    const insertFts = this.#db.prepare(
      "INSERT INTO records_fts (scope, generation, id, text) VALUES (?, ?, ?, ?)"
    );
    const knownId = this.#db.prepare(
      "SELECT 1 AS present FROM records WHERE scope = ? AND generation = ? AND id = ? LIMIT 1"
    );
    const switchCurrent = this.#db.prepare(
      "INSERT INTO current (scope, generation) VALUES (?, ?) " +
        "ON CONFLICT (scope) DO UPDATE SET generation = excluded.generation"
    );

    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of recordsIterable) {
        if (record == null || typeof record !== "object") {
          throw new TypeError("record must be an object");
        }
        assertId(record.id, "record.id");
        assertName(record.source, "record.source");
        if (typeof record.text !== "string") {
          throw new TypeError("record.text must be a string");
        }
        insertRecord.run(scope, generation, record.id, record.source, record.text);
        insertFts.run(scope, generation, record.id, record.text);
      }

      for (const edge of edgesIterable) {
        if (edge == null || typeof edge !== "object") {
          throw new TypeError("edge must be an object");
        }
        assertId(edge.source, "edge.source");
        assertId(edge.target, "edge.target");
        assertName(edge.kind, "edge.kind");
        if (!knownId.get(scope, generation, edge.source)) {
          throw new Error(`dangling edge source: ${edge.source}`);
        }
        if (!knownId.get(scope, generation, edge.target)) {
          throw new Error(`dangling edge target: ${edge.target}`);
        }
        insertEdge.run(scope, generation, edge.source, edge.target, edge.kind);
      }

      switchCurrent.run(scope, generation);
      this.#db.exec("COMMIT");
    } catch (err) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        // best-effort rollback; preserve original error
      }
      throw err;
    }
  }

  activeGeneration(scope) {
    assertName(scope, "scope");
    const row = this.#db
      .prepare("SELECT generation FROM current WHERE scope = ?")
      .get(scope);
    return row ? row.generation : undefined;
  }

  lookup(scope, generation, id) {
    assertName(scope, "scope");
    assertName(generation, "generation");
    assertId(id, "id");
    const row = this.#db
      .prepare(
        "SELECT id, source, text FROM records WHERE scope = ? AND generation = ? AND id = ?"
      )
      .get(scope, generation, id);
    return row ? { id: row.id, source: row.source, text: row.text } : undefined;
  }

  search(scope, generation, term, limit) {
    assertName(scope, "scope");
    assertName(generation, "generation");
    assertLimit(limit);
    const phrase = toLiteralFtsPhrase(term);
    const rows = this.#db
      .prepare(
        "SELECT r.id AS id, r.source AS source, r.text AS text " +
          "FROM records_fts f JOIN records r " +
          "ON r.scope = f.scope AND r.generation = f.generation AND r.id = f.id " +
          "WHERE f.scope = ? AND f.generation = ? AND records_fts MATCH ? " +
          "ORDER BY r.id ASC LIMIT ?"
      )
      .all(scope, generation, phrase, limit);
    const results = rows.map((r) => ({ id: r.id, source: r.source, text: r.text }));
    return {
      results,
      count: results.length,
      internalWorkMeasured: false,
      relevanceTopKExact: false,
    };
  }

  neighbours(scope, generation, id, limit) {
    assertName(scope, "scope");
    assertName(generation, "generation");
    assertId(id, "id");
    assertLimit(limit);
    const rows = this.#db
      .prepare(
        "SELECT target FROM edges " +
          "WHERE scope = ? AND generation = ? AND source = ? AND kind = 'calls' " +
          "ORDER BY target ASC LIMIT ?"
      )
      .all(scope, generation, id, limit);
    const results = rows.map((r) => r.target);
    return {
      results,
      count: results.length,
      internalWorkMeasured: false,
    };
  }
}

// ---------------------------------------------------------------------------
// CLI: node benchmarks/scale/sqlite.mjs [--records N]
// ---------------------------------------------------------------------------

const ALLOWED_RECORDS = new Set([10000, 100000, 1000000]);
const QUERY_SAMPLES = 32;

function parseArgs(argv) {
  let records = 10000;
  let sawRecords = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--records") {
      const value = argv[i + 1];
      if (value === undefined) throw new Error("--records requires a value");
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) throw new Error(`invalid --records value: ${value}`);
      records = parsed;
      sawRecords = true;
      i++;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (sawRecords && !ALLOWED_RECORDS.has(records)) {
    throw new Error(`--records must be one of 10000, 100000, 1000000 (got ${records})`);
  }
  return { records };
}

function summariseLatencies(samples) {
  if (samples.length === 0) return { n: 0, p50: null, p95: null, min: null, max: null, mean: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const total = samples.reduce((acc, v) => acc + v, 0);
  return {
    n: samples.length,
    p50: pick(0.5),
    p95: pick(0.95),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: total / samples.length,
  };
}

async function runCli(argv) {
  const { records } = parseArgs(argv);
  const edgeCount = records * 5;
  const dir = await mkdtemp(join(tmpdir(), "z1p-scale-"));
  const dbPath = join(dir, "scale.db");
  const out = {
    nodeVersion: process.version,
    sqliteVersion: null,
    records,
    edges: edgeCount,
    buildMs: null,
    databaseBytes: null,
    peakRssBytes: null,
    peakRssUnits: "bytes (process.resourceUsage().maxRSS is KiB on POSIX; converted)",
    heapUsedBytes: null,
    firstQuery: { ms: null, note: "first query in this process; not a true cold-OS-cache claim" },
    warmLookup: null,
    warmSearch: null,
    warmNeighbours: null,
    counters: {
      searchReturnedRows: null,
      neighboursReturnedRows: null,
      internalWorkMeasured: false,
      relevanceTopKExact: false,
    },
    recall: {
      lookupExpectedSourceHits: 0,
      lookupSampled: 0,
      searchExpectedSourceHits: 0,
      searchSampled: 0,
    },
    scopeIsolationOk: false,
    deadline: "best-effort between synchronous calls only; not a bound on internal engine work",
    correctness: false,
  };

  const index = new ScaleIndex(dbPath);
  try {
    const sqliteRow = index && new DatabaseSync(":memory:");
    // sqlite version via a separate handle (index owns its own).
    {
      const probe = new DatabaseSync(":memory:");
      try {
        out.sqliteVersion = probe.prepare("SELECT sqlite_version() AS v").get().v;
      } finally {
        probe.close();
      }
      sqliteRow.close();
    }

    const buildStart = performance.now();
    index.build("bench", "gen-1", recordsFor(records), edgesFor(records));
    out.buildMs = performance.now() - buildStart;

    // Scope isolation fixture: same record IDs under a different scope.
    // Uses auxiliary record text to avoid materialising the primary records.
    const auxiliaryRecords = Array.from(recordsFor(10), (r) => ({ ...r, text: "scopeonlysecret" }));
    index.build("bench-other", "gen-1", auxiliaryRecords, []);
    out.auxiliaryRecords = 10;
    out.auxiliaryEdges = 0;
    out.totalStoredRecords = records + 10;
    out.totalStoredEdges = edgeCount;
    out.buildTimeScope = "primary";

    const expectedCurrent = "gen-1";
    if (index.activeGeneration("bench") !== expectedCurrent) throw new Error("active generation mismatch");

    // First query: separate from warm distribution.
    const firstStart = performance.now();
    const firstLookup = index.lookup("bench", "gen-1", recordId(0));
    out.firstQuery.ms = performance.now() - firstStart;
    if (!firstLookup || firstLookup.id !== recordId(0)) throw new Error("first lookup failed");

    const warmLookup = [];
    const warmSearch = [];
    const warmNeighbours = [];

    for (let s = 0; s < QUERY_SAMPLES; s++) {
      const target = (s * 7919) % records;
      const id = recordId(target);

      let t0 = performance.now();
      const rec = index.lookup("bench", "gen-1", id);
      warmLookup.push(performance.now() - t0);
      out.recall.lookupSampled++;
      if (rec && rec.id === id) out.recall.lookupExpectedSourceHits++;

      t0 = performance.now();
      const searchRes = index.search("bench", "gen-1", needleTerm(target), 10);
      warmSearch.push(performance.now() - t0);
      out.recall.searchSampled++;
      out.counters.searchReturnedRows = searchRes.count;
      if (searchRes.results.length === 1 && searchRes.results[0].id === id) {
        out.recall.searchExpectedSourceHits++;
      }

      t0 = performance.now();
      const nb = index.neighbours("bench", "gen-1", id, 5);
      warmNeighbours.push(performance.now() - t0);
      out.counters.neighboursReturnedRows = nb.count;

      // Scope isolation: identical IDs under other scope must be independent.
      if (s === 0) {
        const other = index.lookup("bench-other", "gen-1", id);
        const leak = index.search("bench-other", "gen-1", needleTerm(target), 10);
        if (!other || other.text === rec.text || leak.count !== 0 || index.search("bench", "gen-1", "scopeonlysecret", 10).count !== 0 || index.search("bench-other", "gen-1", "scopeonlysecret", 10).count !== 10 || index.neighbours("bench-other", "gen-1", id, 5).count !== 0) {
          throw new Error("scope isolation check failed");
        }
        out.scopeIsolationOk = true;
      }
    }

    out.warmLookup = summariseLatencies(warmLookup);
    out.warmSearch = summariseLatencies(warmSearch);
    out.warmNeighbours = summariseLatencies(warmNeighbours);
    const commonTermSearch = [];
    for (let i = 0; i < QUERY_SAMPLES; i++) {
      const t0 = performance.now();
      const res = index.search("bench", "gen-1", "shared", 10);
      const elapsed = performance.now() - t0;
      commonTermSearch.push(elapsed);
      if (res.count !== 10) {
        throw new Error(`Expected 10 results, got ${res.count}`);
      }
      for (let j = 0; j < res.results.length; j++) {
        const row = res.results[j];
        const expectedId = recordId(j);
        if (row.id !== expectedId) {
          throw new Error(`Expected row id ${expectedId} at position ${j}, got ${row.id}`);
        }
      }
    }
    out.commonTermSearch = summariseLatencies(commonTermSearch);
    out.heapUsedBytes = process.memoryUsage().heapUsed;

    const nb0 = index.neighbours("bench", "gen-1", recordId(0), 5);
    const expected = expectedEdgeTargets(records, 0);
    const nbOk =
      nb0.count === 5 && nb0.results.length === 5 && nb0.results.every((v, i) => v === expected[i]);
    if (!nbOk) throw new Error("neighbour expectation mismatch");

    out.correctness =
      out.recall.lookupSampled === out.recall.lookupExpectedSourceHits &&
      out.recall.searchSampled === out.recall.searchExpectedSourceHits &&
      out.scopeIsolationOk === true;

    if (typeof process.report?.getReport === "function") {
      const report = process.report.getReport();
      if (report && report.header && typeof report.header.heapUsed === "number") {
        out.heapUsedBytes = report.header.heapUsed;
      }
    }
    const usage = process.resourceUsage();
    // maxRSS is reported in KiB on POSIX; convert explicitly.
    out.peakRssBytes = usage.maxRSS * 1024;

    index.close();
    const fileStat = await stat(dbPath);
    out.databaseBytes = fileStat.size;
  } finally {
    try {
      index.close();
    } catch {}
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {}
  }

  process.stdout.write(`${JSON.stringify(out)}\n`);
  if (!out.correctness) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runCli(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });
}

export { CORPUS_LIMITS };
