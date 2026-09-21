# Overnight scale work: handoff

21 September 2026. Historical overnight checkpoint, recorded before the subsequent source-shipment PR. At this checkpoint the changes were local only. Package publication and deployment are separate from a source merge.

## Completed

- Saved the bounded posting-page design in `BOUNDED-SEARCH-DESIGN.md`.
- Integrated worker-written `benchmarks/scale/postings.mjs`, its 14 tests and a reproducible measurement runner. No package/public API changes.
- Qualified generated corpora at 10k, 100k and 1m records, with zero edges in this separate experiment. See the scale README for exact measurements and limitations.
- Fresh baseline: `npm run check` passed 59 tests and independent package smoke; both token benchmark gates passed. `node --test benchmarks/scale/postings.test.mjs benchmarks/scale/sqlite.test.mjs` passed 22 tests. `git diff --check` passed before this documentation update.
- Corrected the architecture review's historical recall-failure status.

## What this proves

An exact-token composite index can serve stable bounded ID pages without the full-match sorting behaviour of the original common-term FTS probe. Application-materialised posting rows are capped. SQLite internal work and hard deadlines are not measured/enforced; ranked multi-term evidence retrieval is not implemented.

## Worker routing and cost evidence

Used `ollama-workers`: Qwen first, then Flash after two inadequate drafts per packet. Qwen drafts were rejected; accepted implementation came from DeepSeek V4.1 Flash, with reviewed mechanical integration. No Pro or frontier coding fallback. All calls used thinking=false. No 402 occurred.

Helper receipts: `/private/tmp/z1p-overnight-workers`. Reported token totals: Qwen 18,612; Flash 17,087; combined 35,699. Three busy dispatch receipts have unknown counts; they were blocked by the endpoint guard. Four Qwen inference drafts were rejected, one Flash response accepted, two Flash responses partially retained. These counts are not billing or cash-savings evidence. The shared endpoint was frequently occupied by another live session; its requests were not interrupted or replayed.

## Next bounded packets

1. Strengthen posting-prototype lifecycle and input tests: constructor failure, malformed cursor shapes, invalid source records, iterator cleanup on consumer-side validation failure, exact expected pagination IDs and cross-generation content differences. Repair with workers, keeping the public API untouched.
2. Resolve multi-term search semantics before implementation: deterministic candidate order, ranking over examined candidates only, global query budget across continuations, explicit exhaustion/truncation reasons and independently budgeted payload bytes. Do not promise exact global top-k under arbitrary budgets.
3. Prototype cancellable execution and test slow/blocked queries. SQLite keyset LIMIT is not a deadline or CPU cap.
4. Add skewed graph hubs and staged edits/deletes, then incremental refresh and interrupted-publication tests. Keep immutable generation pinning.
5. Complete real-repository correctness and paired accepted-task cost evaluation before private operational features or public savings claims.

No private repositories may be indexed persistently by these plaintext prototypes. Encryption/key custody, access control, service cursor authentication, crash recovery and schema lifecycle remain open gates. If cloud returns 402, stop that lane and leave a handoff; do not reroute its coding into Codex.
