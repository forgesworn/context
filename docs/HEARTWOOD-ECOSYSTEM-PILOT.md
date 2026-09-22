# Heartwood ecosystem pilot

Local prototype, 21 September 2026. The operator wants an original Context
approach. Do not integrate or copy Graphify implementation code. Graphify can
remain an external comparison, independently evaluated under a future protocol.

## First usable result

An offline interactive catalogue now covers 139 visible ForgeSworn GitHub
repositories and one additional local origin. Metadata was read from 132 local
repositories across 157 top-level checkouts. Eight catalogue repositories had no
matching checkout in that scope; they remain visible as unscanned entries.

The broad inventory reads npm and Cargo manifests at captured local commits.
It recorded 227 manifests, 430 unambiguous cross-repository dependency
declarations and 279 npm lock observations. Package-name matches are candidate
producer relationships, never proof that the consumer uses the producer's
current checkout. Ambiguous producers are retained explicitly in the viewer.
Gradle, Python and Dart dependency resolution remain outside this inventory.

The focused evidence selection contains 59 files from 11 committed repositories:
Heartwood ESP32, Heartwood bridge, Heartwood Ledger, Sapwood, Bark, Cambium,
Signet Login, Signet App, Signet, Signet Protocol and Signet Protocol Rust.
The overview also includes nsec-tree as a related declared dependency.
Source blobs are copied by recorded commit and hash into private snapshots;
uncommitted source is excluded. No application checkout, hook, client binding,
hardware connection or other session was modified.

The unsigned visual catalogue contains 148 repository/contract nodes and 238
grouped relationships. It offers a Heartwood view, full catalogue, search,
repository neighbourhoods and an inspector for commits, checkouts, package
versions, lock observations and relationship evidence. It runs offline without
external scripts, fonts or network requests.

This is a local report, not a new public API, deployed service, automatic team
graph or signed collection. The generated private graph and its source snapshots
are outside Git:

```text
~/.cache/z1p-delivery/20260921-heartwood-graph-cwjuby1u/
  heartwood-ecosystem.html
  ecosystem-graph.json
  inventory.json
  snapshot-receipt.json
  source-scan-summary.json
  source-graphs/
  query.py
  viewer-checks.json
  evidence-checks.json
  serial-constant-check.json
```

Original inventory, selection, assembly, rendering and validation scripts are
retained beside the artifacts. A new capture should use a fresh evidence
directory and new receipts; this report must not silently become a current-state
view. Full local paths and private repository metadata are intentionally absent
from committed generated data.

## Findings worth using

1. Device app policy, browser-site policy and Android app approval are separate
   boundaries. The map relates their implementation/documentation to explicit
   contract nodes instead of treating every approval as the same grant.
2. Both `signet` and `signet-protocol` declare the npm package name
   `signet-protocol`. Some consumers resolve `1.10.1`; name matching cannot select
   a producer checkout or establish release provenance. Installed state was not
   inspected.
3. All 58 shared named serial-frame constants match between the captured
   Heartwood Rust and Sapwood TypeScript files. Three Rust constants have no
   same-named TypeScript entry. This is a literal comparison, not proof of
   complete wire compatibility, a defect finding or physical-device acceptance.
4. Heartwood Ledger declares relative dependencies on Heartwood's common crate.
   The declared source path matters; a registry-version-only model would miss it.
5. Our existing bounded source scans produced 515 records from 34 selected code
   files across separate JS/TS and Rust/Kotlin scans. The Heartwood Rust scan hit
   its 128-record cap and omitted `ConnectSlot`. The pilot query helper now uses
   a labelled, bounded exact-identifier fallback against verified selected
   source when no retained record matches. No collection limit was raised.

Example offline queries, from the private evidence directory:

```sh
python3 query.py --repo sapwood --term buildFrame --max-results 3 --max-bytes 4096
python3 query.py --repo heartwood-esp32 --term ConnectSlot --max-results 3 --max-bytes 4096
```

These query captured evidence, not a live worktree. JS/TS records use Context's
compiler-based extractor. Rust/Kotlin records use its conservative lexical
extractor. Relationships and source text remain data, not instructions,
authorisation or semantic proof. Absence is not evidence that a symbol is absent
from the repository. A syntax packet or source excerpt still needs sufficiency
review before a coding handoff.

## Validation and routing

The Context checkout build passed with Node 24.21.0. Evidence checks verified all
59 snapshot hashes, unique graph identities, no dangling edges, commit/hash
provenance, exact focused citation lines, AST and fallback queries, output byte
bounds, invalid repository rejection and changed-snapshot rejection. Browser
checks passed for the default view, complete catalogue access, search, node and
edge selection, reset, a 390-pixel layout, empty data, inert hostile labels and
zero external HTTP requests. The rendered overview was visually inspected.
These are local prototype checks, not CI, registry, consumer-release or hardware
acceptance. No application tests or protocol conformance suites ran.

Deterministic tools performed inventory and extraction. DeepSeek Flash
`deepseek-v4.1-flash:cloud`, thinking off, drafted the original viewer through
the M4 endpoint. Its first draft hit the 6,000-token output ceiling and was
rejected. One repair completed; host integration fixed neighbourhood selection,
catalogue truncation, metadata wording, contract classification and keyboard
access. The second draft is recorded as partially retained, not accepted as-is.
Both calls reported 1,405 prompt and 14,329 completion tokens combined. Host
preparation/review usage and monetary billing remain unknown. This is useful
dogfooding, not a savings result or a Graphify comparison.

An isolated Graphify comparison installation was started, then removed when the
operator clarified the original-implementation requirement. No Graphify graph
extraction ran and no Graphify source was copied into Context. Its installation
receipt remains private setup history.

## Maintained dependency slice

The original [dependency snapshot helper](DEPENDENCY-SNAPSHOTS.md) now captures,
queries and verifies explicit committed npm/Cargo selections. Its first local
Heartwood capture covered eight repositories and 147 dependency declarations.
Signet Login locks `signet-protocol` 1.10.1 while both same-named source producers
remain unverified candidates. Heartwood Ledger's `../heartwood-esp32/common` path
resolves to the selected common crate snapshot without claiming an installed
commit. The capture did not modify the active Heartwood checkout.

This is checkout tooling, not a published package, MCP command or replacement
for the prototype viewer. The viewer still uses its earlier captured data.

## Remaining implementation slices

Continue building on that evidence:

- Keep declared, locked and inspected-installed dependencies distinct.
- Resolve aliases, local path/workspace dependencies and duplicate package
  producers explicitly. Do not infer registry origin from a same-named fork.
- Identify package artifacts by source and integrity; map them to source commits
  only when supported by release provenance. Otherwise retain an unknown link.
- Separate repository identity, immutable commit evidence and a worktree's
  changing local overlay. Include relevant dependency and extraction settings
  when deciding whether cached evidence is reusable.
- Validate one published package, one relative source dependency and the
  Heartwood/Sapwood protocol boundary before expanding deep extraction.

Use deterministic extraction and tests, Flash/thinking off for bounded
implementation, and qualified frontier review for identity and isolation rules.
Qualify GLM separately on useful work. Do not build every language parser or team
synchronisation before these relationships are correct. Continue recording whole
task cost under the [savings plan](SAVINGS-PLAN.md).
