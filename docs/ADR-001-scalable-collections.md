# ADR-001: Scalable signed collections

Status: provisional; implementation sequence superseded by the [enterprise scale review](ENTERPRISE-SCALE-REVIEW.md).

The review identifies missing query indexes, work budgets, durable publication and rollback semantics.  Do not implement the cryptographic format below until those decisions are resolved.  The existing memory stores remain experimental internal foundations.

Updated: 21 September 2026.

## Context

The v1 collection snapshot contains every signed record event.  Appending copies and re-signs the complete snapshot, validation materialises it, and a collection is capped at 128 records.  The current repository benchmark retained 128 records and dropped 111.  Raising the constant would preserve the full-read and full-rewrite behaviour and would not provide credible whole-codebase support.

The target is at least 10,000 records and 50,000 edges without requiring a query to decrypt, validate or materialise the complete graph.  Retrieval remains capped at 20 records and 32 KiB, and graph views at 40 nodes and 32 KiB.

## Invariants

- Existing v1 policies, snapshots, records, access events and signed domains remain valid and unambiguous.
- A collection remains one authorisation domain.  A relation cannot silently cross a collection or project boundary.
- Record contents and relationships remain tamper-evident and encrypted at rest.
- Exact lookup and bounded traversal load only the pages required by the bounded result.
- Appends retain expected-head concurrency.  A losing writer cannot become authoritative by sequence or timing.
- Core remains local-first and browser-safe.  Normal reads use an explicitly supplied local blob store and never follow a URL found in graph content.
- Revocation prevents future authorised access.  It cannot retract keys or plaintext already obtained by a recipient.

## Options

| Option | Result |
| --- | --- |
| Increase v1 limits | Rejected. Snapshots, validation, key rotation and appends still scale with the whole collection. Event and envelope limits become the next ceiling. |
| Split one project across ordinary v1 collections | Rejected as the target design. It weakens atomic relationships, complicates grants and key rotation, and would require implicit cross-collection traversal. |
| One v2 root containing every record/page and edge entry | Rejected. The index and key schedule become another unbounded snapshot. |
| Append-only event log with sparse indexes | Deferred. It is useful for multi-writer history but adds log compaction and synchronisation complexity not required by the first target. |
| Bounded v2 Merkle/B-tree indexes and immutable pages | Selected. The root and every page remain bounded while lookup grows logarithmically. |

## Decision

Add an explicit v2 collection format.  A small signed root commits to bounded immutable encrypted pages through ciphertext SHA-256 digests.  Separate paged trees locate records, outgoing edges and any historical epoch-key material.  No root, key schedule, index node, edge bucket or record page grows with the total graph.

The signed root contains only bounded metadata: the collection and policy epoch identifiers, revision, previous committed root digest, record-index root digest, edge-index root digest, key-schedule root digest and authenticated counts.  Its canonical encoded content must not exceed 8 KiB before the outer signature.

Each logical page has an opaque random page ID and a fixed page class.  A minimal clear header carries the format version, collection ID, epoch, page class and page ID.  The page key is derived from the epoch key, page class and page ID.  AEAD encryption authenticates the complete header as associated data.

The stored address is SHA-256 over the complete sealed bytes, including the authenticated header and ciphertext.  A reader verifies that digest before decryption, then verifies the authenticated page identity, type, range and internal references.  Plaintext hashes are not storage addresses and equal plaintext under different opaque page IDs must not expose an equality address.

Index nodes contain bounded key ranges and child ciphertext digests.  An exact lookup decrypts one node per tree level followed by the selected record page.  One-hop traversal uses an edge tree keyed by source, relation kind and target, and stops at the existing record, node and byte budgets.  Page-read limits are derived and asserted from the actual built tree height rather than assumed constants.

Core receives pages through a narrow content-addressed `BlobStore`; graph content cannot choose an arbitrary URL.  Persistent filesystem, IndexedDB and remote synchronisation adapters are later concerns with their own authority boundaries.

## Writes, rotation and recovery

Writers first store immutable sealed pages.  They then create and sign a root whose previous digest is the currently authorised head.  Publication uses a narrow `RootStore.compareAndSwap(expectedHeadDigest, newRootDigest)` operation.  A losing writer receives a conflict, reads the committed head, revalidates and deliberately retries.  Sequence numbers do not resolve siblings.

A crash before root publication leaves the previous root authoritative and may leave orphan pages.  A crash after successful compare-and-swap leaves the new committed root authoritative.  Recovery starts from the last committed valid root supplied by `RootStore`, never the highest uncommitted candidate.  Garbage collection removes unreferenced pages only after an explicit grace period or complete reference scan from every retained committed root.

Policy rotation creates a new epoch key for future pages.  Old pages require retained old epoch keys unless a deliberate full rewrite and re-encryption occurs.  Historical key material is itself stored in bounded encrypted pages committed by the root, not an ever-growing inline list.  A recipient holding an old key may retain old ciphertext or plaintext but cannot derive a new epoch key.

Deletion and rename will be represented by a new committed root with deterministic tombstones and replacement index entries.  Their repository-refresh semantics are not part of the first implementation slice.

## Compatibility

V1 objects keep their existing parsers, validation and limits.  V2 uses distinct versioned root and page objects and does not reinterpret a v1 signature.  The first implementation slice adds no automatic migration and does not change `ContextVault`, persistence or public v1 behaviour.

A later migration must read and fully validate a v1 snapshot, emit v2 pages and publish a separate v2 root without modifying the original.  Existing compatibility fixtures remain regression gates.

## First implementation slice

Build and test the storage/index primitives before connecting them to `ContextVault`:

- bounded canonical codecs for a root, page header, index node, record page and edge bucket;
- seal/open helpers using the existing qualified cryptographic primitives where they fit;
- bounded B-tree construction, exact record lookup and one-hop neighbour lookup;
- a `BlobStore` interface and in-memory content-addressed implementation;
- a `RootStore` interface and test-only in-memory compare-and-swap implementation; and
- a deterministic 10,000-record, 50,000-edge fixture with page-read instrumentation.

Tentative interfaces, subject to implementation review:

```ts
interface BlobStore {
  put(bytes: Uint8Array): Promise<string>
  get(digest: string): Promise<Uint8Array | undefined>
}

interface RootStore {
  readHead(): Promise<string | null>
  compareAndSwap(expectedHead: string | null, nextHead: string): Promise<boolean>
}
```

The slice should live under `packages/context/src/paging/` with focused codec, crypto, index and store tests.  No dependency is added merely for convenience.

## Acceptance

- The encoded root is no more than 8 KiB; all page types and fan-out have enforced bounds.
- The 10,000-record and 50,000-edge fixture builds deterministically.
- Exact lookup and bounded neighbour traversal remain within page-read ceilings calculated from the built tree height and requested result bound.
- Neither lookup nor traversal decrypts or validates the complete collection.
- Ciphertext tampering, wrong associated data, wrong page identity and digest mismatch are rejected.
- Equal plaintext placed under distinct page IDs does not produce a plaintext equality address.
- Concurrent writers prove expected-head conflict behaviour; crash-before and crash-after-CAS fixtures preserve the last committed root.
- Existing v1 build, unit, package-smoke and benchmark gates remain green.

Stop if a root or individual page grows with total graph size, a lookup follows content-provided URLs, an automatic sibling winner replaces compare-and-swap, or scale is achieved by weakening isolation or response bounds.

## Non-goals for the first slice

- v1 migration;
- `ContextVault` or file-store integration;
- hosted storage or synchronisation;
- repository watch or incremental refresh;
- garbage-collection implementation; and
- lifting any public whole-codebase scale claim.
