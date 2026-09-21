# Enterprise scale: architecture review

Date: 21 September 2026.  Status: proposed direction; implementation gates remain open.

## Decision

Separate the repository index, bounded evidence retrieval and signed portable storage.  Prove repository scale with a local indexed engine before designing a new encrypted database format.  Preserve the browser-safe protocol and verification core; provide persistent indexing through the Node tools adapter.

ADR-001 contains useful paging and compare-and-swap ideas, but it is not yet a sufficient design for enterprise queries.  Its cryptographic format must remain provisional.  Ten thousand records is an initial fixture, not an enterprise capacity claim.

## What the current design misses

1. **Search before lookup.**  A record-ID tree answers where a known record lives.  It does not find records relevant to an agent's question.  Current retrieval scores every visible record.  Paging those records alone would still require a full scan.
2. **Work budgets.**  A 32 KiB answer can require millions of candidate reads.  Candidate evaluation, posting-list reads, edge expansion, decrypted bytes and elapsed work need limits independent of output size.
3. **Publication and rollback.**  A root signature authenticates a root, not that it is current.  A parent pointer alone does not replace v1's ancestry checks when a reader skips several revisions.  CAS in memory supplies neither disk durability nor rollback protection.
4. **Author and index trust.**  A signed root commits to its contents but does not establish that its index is complete or correctly derived.  Record author signatures, grant validity at creation and query authorisation need explicit rules.  Merkle membership proves inclusion, not search relevance or completeness.
5. **Refresh.**  Repository updates must invalidate derived symbols, outgoing edges, reverse references and search entries together.  Appending another scan eventually fills any finite store and leaves stale results.
6. **Operational boundaries.**  Access domains, concurrent readers, crash recovery, deletion, quotas and retained snapshots determine enterprise behaviour as much as graph size does.

## Three layers

| Layer | Responsibility | First implementation |
| --- | --- | --- |
| Repository index | Files, symbols, relations, inverted search index, source revisions and active generation | Local Node adapter using a mature transactional embedded database; evaluate SQLite as the initial candidate |
| Evidence retrieval | Authorised scope, ranking, bounded expansion, source excerpts and explicit incompleteness | Storage-independent asynchronous query API with a budget shared across all work |
| Signed portable storage | Authenticity, encrypted export/import, provenance and snapshot commitments | Keep v1 compatibility; specify v2 only after the query workload and update patterns are measured |

SQLite is a candidate implementation choice, not a dependency selected by this document.  Qualify the maintained driver against the pinned Node runtime, packaging, concurrent access and encryption requirements before adopting it.  The adapter must not enter the browser-safe package import graph.

The repository index is disposable derived state.  A local source revision or verified imported record is its input.  Its rows must distinguish local extraction from cryptographically verified imported evidence.  Unsigned index rows must never be returned as signed records merely because they came from a trusted process.

An index containing source names, tokens or edges is sensitive even without full source text.  V1 currently promises no persistent plaintext index.  A persistent index therefore requires an explicit new storage mode with a specified encryption/key-custody implementation.  Prototype with public fixtures until that decision passes review; never silently create a plaintext private-code index.

## Query contract

Every query specifies authorised collection/project scope, source generation and resource budgets.  The engine resolves the active generation once and pins it for the operation.  An explicit bounded set of repositories may form an ecosystem; repository membership alone does not widen query access.

1. Check authorisation before reading project metadata or searching.
2. Select candidates through an inverted lexical index.  Use bounded posting-list work and deterministic ranking/tie-breaking.  Existing lexical relevance is an adequate first baseline; semantic models are optional later experiments.
3. Expand outgoing and incoming adjacency indexes within a shared edge/node/page budget.  High-degree nodes cannot consume unlimited work.
4. Fetch source spans or verified records only for selected evidence.  Count those bytes and any verification work against the same query budget.
5. Return the pinned generation, source revision, provenance, consumed budget and explicit truncation reason.  Use an opaque generation-bound cursor where continuation is supported.

Proposed API shape, not an existing export:

```ts
queryEvidence({ scope, generation, query, budget, signal }): Promise<EvidenceResult>
```

The budget covers candidate count, postings visited, edges visited, page reads, decoded bytes, output bytes and deadline.  Cancellation must propagate to the storage adapter.  Budgets are enforced during work, not checked only after a complete scan.

Do not promise exact global top-k under arbitrary strict work limits.  Report whether the search exhausted its candidate domain or stopped early.  Pagination must not silently switch generations.  A bounded path search can report `budget-exhausted`; it must not mislabel that result as proof that no path exists.

## Refresh and storage

Use one active generation per repository snapshot.  A manifest records repository identity, source revision, extractor version, configuration and per-file hashes.  Parse changed files into staging; replace their derived rows and outgoing edges, then reconcile affected incoming references using reverse indexes.  Configuration or extractor changes can trigger a documented full rebuild.

Deletion removes a file's active derived records.  Rename is initially a delete plus add, with optional explicit lineage.  Preserve stable IDs for unchanged source locations; do not promise that every refactor preserves symbol identity.  Historical signed assertions remain separate from the active source view.

Publish the new generation atomically after validation.  Readers already pinned to the old generation finish against it.  Failed builds leave the last committed generation available with visible freshness metadata.  Start with one writer per repository and concurrent snapshot readers; independent repositories can build concurrently within quotas.

Durability requires writing and syncing referenced data before publishing the head, and persisting the head through a transaction or correctly synced rename protocol.  Test process termination around each publication boundary.  MemoryRootStore is only a fixture and proves none of these disk properties.

Garbage collection requires both a reachability check and protection for active readers/builds.  Elapsed grace time alone is insufficient.  Pin retained roots explicitly and document backup retention separately from active-data deletion.

## Signed storage and access

Keep v1 readable and its existing signed domains unchanged.  Do not enlarge v1 constants or reuse v1 signatures with new meanings.  A later v2 can use bounded encrypted index/record pages and a signed commitment root, with individually attributable evidence retained where required.

Before implementing v2 crypto, resolve:

- the exact canonical encoding, signature domain and audited encryption construction;
- how authorship and historical grant validation survive paging;
- how clients establish descent from their last trusted head without an unbounded inline ancestor array;
- bounded epoch-key history and whether newcomers receive historical access;
- fresh nonce/key derivation for every immutable page version;
- metadata leakage from clear page headers and size/access patterns; and
- what a reader can verify about index derivation versus merely trusting the authorised index builder.

An opaque page ID must be fresh for every sealed version or accompanied by a proven nonce strategy.  Reusing a logical page ID on updates must not accidentally reuse an AEAD key/nonce pair.  Ciphertext hashes can authenticate stored bytes but do not resolve this issue.

Offline readers can verify their cached policy and expiry; they cannot discover a newer revocation without synchronisation.  Results must expose that freshness boundary.  Hosted queries must check current service authorisation and bind cursors/caches to it.  Previously disclosed keys and plaintext remain outside retrospective revocation.

For shared deployments, partition storage, indexes and caches by access domain.  Authorise before candidate selection, including counts and snippets.  Cross-domain querying requires explicit grants for every participant and a global budget.  Do not add one organisation-wide index and rely solely on filtering final results.

## Ordered implementation packets

1. **Scale contract and harness.**  Add deterministic public corpora and query expectations at 10k/50k, 100k/500k and 1m/5m records/edges.  Include skewed hubs, duplicate identifiers and source edits/deletes.  These are proposed tiers, not capacities already achieved.
2. **Local index proof.**  Qualify an embedded database adapter against those workloads.  Implement generation transactions, lexical candidate lookup, adjacency lookup and measured query budgets.  Use public fixtures while encryption is unresolved.
3. **Refresh and agent workflow.**  Implement staged source refresh, invalidation and cancellation, then exercise a real MCP client.  Keep the existing benchmark unchanged and repair its current recall regression as a separate bounded scanner task.
4. **Private-data storage gate.**  Select and test encryption, key handling, recovery and explicit opt-in before indexing private repositories persistently.
5. **Portable signed v2.**  Complete a reviewed format specification and compatibility fixtures, then implement only the pieces justified by the measured index workload.
6. **Shared operation.**  Add managed repository connections, scoped service access, scheduling, audit and service quotas after the local engine proves useful on the pilot team's tasks.

The scalable local engine, local refresh and portable verification should remain open source.  Managed operation, team administration and support provide the private commercial layer.

## Acceptance evidence

For each scale tier, record hardware, corpus/revision, engine version, cold and warm query latency, p50/p95, peak memory, disk footprint, initial-build time, refresh work and query resource counters.  Set numerical latency/memory targets before comparing implementations.  Do not invent them from an unmeasured design.

Require declared-source recall and accepted-task quality alongside cost.  Prove that single-file refresh avoids a whole-repository rebuild where dependency semantics permit it.  Include cancellation, a high-degree hub, concurrent query/build, crash recovery, denied access and stale snapshots.  Query work should follow its enforced budgets as the corpus grows.

At the initial review, the memory stores were foundations only and the expanded source-navigation corpus failed recall. Subsequent worker changes restored both benchmark gates. The synthetic SQLite baseline and a separate bounded posting-page experiment now exist; see [scale evidence](../benchmarks/scale/README.md) and the [bounded search design](BOUNDED-SEARCH-DESIGN.md). These do not close the enterprise acceptance gate or select a production adapter. The next useful work remains query qualification and refresh, not another cryptographic page codec.
