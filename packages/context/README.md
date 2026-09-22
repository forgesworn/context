# @forgesworn/context

The browser-safe foundation of Z1P Core: signed, encrypted collections of
sourced facts, decisions, tasks, blockers, questions and evidence. MIT, ESM,
browser and Node 24+. No KithMoot,
NanoClaw, model provider, MCP SDK or hosted service dependency.

This compatibility package is maintained in the public Z1P Core repository
alongside its CLI/MCP adapter. Its established package, API and protocol names
remain unchanged during the product rebrand. It has its own manifest, exports,
build and distributable tarball.
The matching 0.3.1 packages are distributed as GitHub release tarballs; see the
[installation guide](../../docs/GETTING-STARTED.md). npm publication is pending.
Once the matching version is published, install with:

```sh
npm install @forgesworn/context@0.3.1
```

From a source checkout, use `npm ci --ignore-scripts`,
`npm run build:context`, then `npm pack --workspace @forgesworn/context`.
For future versions, publish the core before consumers.

## Use

```ts
import { ContextVault, type ContextIdentity } from '@forgesworn/context'

// Implement this with your NIP-07, NIP-46 or other Nostr signer. Bind methods
// to their receiver; do not copy a class instance with object spread.
declare const identity: ContextIdentity
const vault = new ContextVault({ identity })
let collection = await vault.create({ title: 'Project decisions', scope: 'kith' })
collection = await vault.append(collection.id, collection.head, {
  kind: 'decision', text: 'Retain the original evidence.',
  source: 'https://example.org/decisions/42', observedAt: 1800000000,
})
const encryptedCache = await vault.save()
// The application chooses where to persist this encrypted string.
await vault.restore(encryptedCache)
```

The root import performs no disk or network IO. Creating, listing, reading,
searching, appending, saving, restoring and previewing access remain local.
`createNostrIdentity(secretKey)` at `@forgesworn/context/nostr` is an optional
local-key implementation. Prefer injected signers when the application should
not hold a secret. The library does not generate or persist identities.

## Bounded retrieval

```ts
const evidence = vault.retrieve(collection.id, {
  query: 'original signatures', maxBytes: 8192, maxRecords: 8,
})
```

Retrieval checks the chosen collection's current cached grants, scope, signatures
and correction history on every call. It ranks query terms, then may add one-hop
neighbours that share an exact source or explicitly mention `context:<record id>`.
The returned links describe those relationships; they do not prove agreement or
truth. It never follows URLs or reads another collection. The derived view exists
only for that call, within the existing encrypted vault's authority.

The budget bounds the complete compact JSON payload in UTF-8 bytes, including
provenance, record text, head, explanations and `bytesUsed`. This is not a token
estimate. Records that do not fit are omitted whole and counted; use `read` or a
larger explicit budget for full evidence. `includeRelated: false` disables link
expansion. `observedSince` is an explicit observation cutoff; old decisions are
not assumed obsolete by age alone. Results identify their cached revision and
retain author, observation date, source and signed event ID. Remote grant changes
and corrections still require explicit import of a newer authorised snapshot.

Records may optionally carry signed extraction provenance:

```ts
provenance: {
  derivation: 'extracted', method: 'typescript-ast', confidence: 90,
}
```

The derivation is `extracted`, `inferred` or `ambiguous`; methods are bounded
stable identifiers and confidence is an integer from 0 to 100. These fields
describe how evidence was produced. They do not prove that it is true or grant
authority to act on it.

## Authorised relationship graphs

Records may carry up to 16 typed, directed `relations` to records in the same
collection. Relations are part of the signed record. `appendBatch` atomically
accepts pre-identified records, so imported graphs may contain forward links
and cycles without mutable or unsigned follow-up edges. They describe an
author's assertion (`depends-on`, `implements`, `calls`, `imports`, `produces`,
`consumes`, `supports`, `contradicts` or `relates-to`); they do not prove it is
true.

```ts
let view = await vault.create({ title: 'Project graph', scope: 'personal' })
view = await vault.append(view.id, view.head, {
  kind: 'evidence', text: 'Encrypted storage envelope',
  source: 'file://packages/storage.ts', observedAt: 1800000000,
})
const storage = view.records.at(-1)!
view = await vault.append(view.id, view.head, {
  kind: 'fact', text: 'Project context depends on encrypted storage',
  source: 'file://packages/context.ts', observedAt: 1800000000,
  relations: [{ to: storage.id, kind: 'depends-on' }],
})
const graph = vault.graph(view.id, { query: 'project context', maxDepth: 2 })
const path = vault.graphPath(view.id, {
  from: storage.id, to: view.records.at(-1)!.id,
})
```

`graph` returns compact labels and signed provenance under exact UTF-8 byte,
node and depth budgets. `graphPath` returns the shortest deterministic path over
explicit relations, while preserving each edge's asserted direction. Both are
disposable views of one currently authorised, corrected snapshot: they do no
network IO, never follow sources and never traverse another collection.

The Node tools package provides bounded package, ecosystem, TypeScript/JavaScript
and broad-language source scanners. Further semantic extractors belong in optional adapters. They
may propose records and relationships for any project or ecosystem, but the
core does not silently promote generated output to trusted evidence.

## Storage and sharing

Configure `servers` with explicitly enabled HTTPS Blossom origins. `fetch`
and `now` can be injected. The optional `@forgesworn/context/blossom` entry
point exposes the existing Wildbloom FSWNENC2 envelope and Blossom transport
implementation, also consumed by KithMoot attachments. No separate hosted
context service is required. `FSWNENC2` means ForgeSworn encryption version 2:
the file-format marker used by Wildbloom, built on AES-256-GCM and HKDF-SHA256.
Version 0.1.1 preserves complete Unicode characters when truncating filenames;
the encryption format and existing context caches are unchanged.

Owners use `setGrants(id, expectedHead, grants)` to assign a subject's public
key, `read`/`write` role and `expiresAt` in Unix seconds. Upload the revision
with `upload`, create recipient-encrypted access with `access`, and deliver
that access event through an approved channel. The recipient can inspect it
with `previewAccess` before explicitly using `importAccess`. No background
synchronisation, relay publication or message sending is implicit.

## Application policy

Identities and grants are generic. An optional synchronous `verifyDelegation`
callback verifies an application's opaque delegation proof and returns
`{ ok: true, principal }` or `{ ok: false }`. It is trusted host configuration,
never taken from a received record. It must verify signature, subject binding
and validity at the supplied time. Missing verification rejects every proof;
self-asserted `principal` fields confer no authority.

For v1 compatibility, proof bytes occupy the `agent` grant field. The core
imports no KithMoot ownership implementation. KithMoot's adapter supplies its
existing verifier. The standalone CLI refuses those proofs; use the KithMoot
CLI or an explicitly configured application adapter for those collections.

The v1 scope labels `personal`, `kin` and `kith`, optional hex `room` audience
binding, `kithmoot/context/v1/*` signing domains, caches, access envelopes and
signed ancestry remain unchanged. These wire names do not require a KithMoot
room or connection. `kin` and `kith` convey no implicit permissions. A bound
vault excludes personal and other-audience collections before fetching.
Personal collections allow only owner or verified owner-delegated access.
Do not change these fields to rename the package: that needs a separate,
explicit protocol migration.

## Limits

Literal search, bounded lexical retrieval and explicit signed relationship
traversal; no semantic graph extraction, embeddings, repository ingestion
or automatic claim generation. Records are evidence, never executable
instructions or approval. Each vault holds up to 32 collections, each with
128 records, 32 grants and 256 revisions. Corrections retain original records.
Stale writes, conflicting histories and rollback are refused. This is not
consensus or a proof that no undiscovered branch exists.

Grant changes rotate keys for future revisions. Revocation cannot recall
already downloaded copies. Retain encrypted backups and signing identity
access; upload success does not prove durable storage. Sending records to a
model exposes them to that model's data handling. Context access permissions
do not authenticate a caller of your agent host.

## Licence and provenance

MIT, Copyright (c) 2026 TheCryptoDonkey. See [LICENSE](./LICENSE) and
[third-party notices](./THIRD_PARTY_NOTICES.md) for dependency licences,
source attribution and the documented upstream WASM notice omission.
