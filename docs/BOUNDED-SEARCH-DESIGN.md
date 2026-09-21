# Bounded search experiment

21 September 2026. Design for an isolated public-fixture experiment, not an API commitment.

## Decision

Evaluate a composite posting index keyed by `(scope, generation, term, recordId)` alongside the existing FTS baseline. Exact-token pages use an indexed keyset range, not an FTS match followed by sorting. Keep payload fetching, graph expansion and relevance ranking out of this first experiment so their costs cannot hide inside a posting-row counter.

Each request names a scope, immutable generation, one normalised token, output limit and maximum posting rows. Fetch at most the smaller of the two limits. Do not fetch an uncounted lookahead row. A full page conservatively reports incomplete, even when it happens to be the final page; a subsequent empty page proves exhaustion. Continuation binds scope, generation, token and last record ID.

This bounds posting rows materialised by the application. It does **not** bound SQLite page reads, CPU, lock waits or wall time. Inspect the query plan for an indexed range without a temporary sort, and measure common-term performance as the corpus grows. Keep `internalWorkMeasured: false` until internal work is genuinely measured. Do not call this a hard execution budget.

## Boundaries

- IDs only: fetching text later requires its own byte and record budgets.
- Single ASCII token only: no equivalence claim with phrase search, Unicode tokenisation, multi-term retrieval or ranking.
- Deterministic ID order is not relevance order or exact global top-k.
- A plain cursor is experiment state, not authorisation or a secure service token. A future service must validate current access on every page.
- Scope keys prevent accidental result mixing in this fixture, not timing leakage or tenant resource interference.
- Full transactional generations first. Incremental refresh, reader leases and garbage collection remain separate work.
- Public generated data only. Even token-only indexes leak private repository information.

## Acceptance before integration

Prove capped rows, complete pagination, scope/generation/query cursor binding, immutable old-generation reads, empty-generation identity, rollback and persistent reopening. Record query plans and reproducible common/unique-token measurements. Preserve existing package and benchmark gates.

Next design gate: combine multi-term candidate selection with explicit ranking/incompleteness semantics, bounded payload retrieval and cancellable execution. Do not silently promote this simplified experiment to production search.
