# Synthetic SQLite scale probe

This isolated prototype evaluates a possible Node index adapter using public generated data.  It does not index repositories, integrate with ContextVault, encrypt its database or establish enterprise readiness.  No production dependency or public API has changed.

Run on the pinned Node 24 runtime:

```sh
node --test benchmarks/scale/sqlite.test.mjs
node benchmarks/scale/sqlite.mjs --records 10000
node benchmarks/scale/sqlite.mjs --records 100000
```

An explicit `--records 1000000` tier is available but has not yet been qualified.  Each run uses a temporary database and removes its generated database on completion.  The schema stores five outgoing edges per primary record, plus ten auxiliary records with different content and no edges to check scope filtering.

The eight tests cover deterministic corpus generation, basic scoped queries, generation replacement with pinned old reads, rollback on record-generator failure and dangling edges, literal FTS input, and parameter validation.  The CLI additionally tests different content under the same record IDs across scopes.

## Initial measurements

21 September 2026, macOS arm64, Node 24.21.0, SQLite 3.53.4.  Single runs, 32 warm samples per query type.  Measurements are observations, not performance thresholds.

| Primary records / edges | Primary build | Database including auxiliary scope | Warm unique-term search p95 |
| --- | --- | --- | --- |
| 10,000 / 50,000 | 0.47 seconds | 11,735,040 bytes | 0.271 ms |
| 100,000 / 500,000 | 6.62 seconds | 118,878,208 bytes | 0.226 ms |

Both runs found all 32 sampled expected record IDs and passed the CLI checks.  These are synthetic exact-term queries, not evidence of real-task answer quality.  The first query in a process is not a cold OS-cache measurement.  Reported recall fields currently check record IDs despite using `ExpectedSourceHits` in their names.

A subsequent run added 32 common-term queries matching every primary record while returning ten rows.  At 100,000 records / 500,000 edges, build time was 4.80 seconds, unique-term p95 0.124 ms, and common-term p50/p95 149.66/300.68 ms.  The CLI checked the ten expected IDs on every common-term query.  All eight probe tests and CLI assertions passed.  Variation between runs is expected; these are individual measurements, not a capacity guarantee.

The common-term result demonstrates the next design problem: a small result count does not imply bounded internal search work.  Qualify explicit posting-list work budgets and incomplete-result reporting before integrating this adapter into agent queries.

## Adapter decision

### Separate posting-page experiment

`postings.mjs` evaluates the [bounded search design](../../docs/BOUNDED-SEARCH-DESIGN.md): a composite `(scope, generation, term, id)` primary key, ID-only exact-token pages, capped materialised posting rows and generation-bound continuation. It does not replace the FTS baseline. All 14 new tests pass, alongside the eight baseline tests.

```sh
node --test benchmarks/scale/postings.test.mjs benchmarks/scale/sqlite.test.mjs
node benchmarks/scale/postings-bench.mjs --records 10000
node benchmarks/scale/postings-bench.mjs --records 100000
node benchmarks/scale/postings-bench.mjs --records 1000000
```

Final rerun, 21 September 2026: macOS arm64, Node 24.21.0, SQLite 3.53.4. Eight warm-up rounds then 32 samples per query type; nearest-rank percentiles. Each tier passed exact expected-ID, row-count, completeness and query-plan checks. Deep pages start twenty records from the end, using keyset continuation rather than OFFSET.

| Records (zero edges) | Build ms | Database bytes | Peak RSS bytes | Common p95 ms | Unique p95 ms | Deep p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| 10,000 | 69.964 | 1,630,208 | 56,786,944 | 0.034084 | 0.034916 | 0.036334 |
| 100,000 | 711.905 | 16,482,304 | 66,961,408 | 0.031042 | 0.031958 | 0.033041 |
| 1,000,000 | 7,689.925 | 162,115,584 | 125,386,752 | 0.039459 | 0.288500 | 0.061584 |

The measured plan was `SEARCH postings USING PRIMARY KEY (scope=? AND generation=? AND term=? AND id>?)`, with no full scan or temporary sort. Common/deep pages each materialise ten posting rows; unique queries materialise one. Internal SQLite work remains unmeasured. A full page conservatively returns incomplete, requiring continuation to establish exhaustion. Tests cover this boundary, empty generations, duplicate IDs, failed builds, distinct scope contents, pinned generations and cursor reuse after reopening.

These are single-run observations, not latency guarantees. This is **not** a like-for-like speedup comparison with the earlier FTS/graph baseline: it returns IDs only, stores no graph edges and does not rank or fetch payloads. It demonstrates a useful access pattern, not enterprise readiness. Query timing includes the runner's awaited synchronous call. Tokenisation lowercases text before extracting ASCII-pattern tokens; it is not production Unicode tokenisation. The exposed database handle and plain cursor are benchmark conveniences, not security boundaries.

Remaining posting-prototype hardening includes constructor-failure handle cleanup, schema compatibility checks, adversarial cursor objects, stronger iterator-cleanup tests and interrupted-process durability. Successful reopen/transaction tests do not prove crash durability. None of this changes the plaintext-private-data prohibition below.

Continue evaluating SQLite for the Node adapter.  It provides a useful baseline for transactional generations and indexed lookup without adding a dependency to the experiment.  It is not selected as the production storage implementation yet.

Open gates:

- Internal SQLite work remains unmeasured.  SQL LIMIT bounds returned rows, not posting scans, sorting, CPU or elapsed time.
- The shared FTS table filters results by scope but does not provide tenant workload isolation.  Production access domains need appropriate partitioning and authorisation before search.
- The synchronous adapter cannot cancel an in-flight SQLite query.  Worker isolation and enforceable budgets remain design/implementation work.
- Full generations are rebuilt; incremental refresh, deletions, rename handling and high-degree hubs are not covered.
- Persistent reopening, empty-generation identity, durable crash recovery, duplicate CLI flags and some cleanup paths still need hardening.
- The prototype uses plaintext synthetic data only.  Do not use it for private repositories before encryption and key custody are implemented and reviewed.
- The regular five-edge graph and exact identifiers need more demanding fixtures before capacity conclusions.
