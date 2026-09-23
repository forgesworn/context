# Z1P Core release candidate evidence ledger

Latest implementation and adoption results are in the
[dogfood execution ledger](docs/DOGFOOD-EXECUTION.md). The dated snapshots below
remain historical evidence; internal pilot acceptance is separate from G0–G4.

## 0.4.0 shipment checks, 23 September 2026

Local navigation gains two tools and loses most of the friction recorded in
the retrieval experiments:

- `repository_explore` answers one symbol per call: declaration source, scoped
  references with their enclosing declarations, importers and tests.
- `repository_coverage` is a deterministic pre-submit check. It lists explored
  files a draft leaves uncited and quotes that are not verbatim; it checks the
  first eight symbols and names the rest as not checked.
- Search takes `pathPrefix` and printable literals whose ends fall on whole
  tokens, not only identifiers. Search and packet responses render as compact
  text by default; pass `format: "json"` for the previous structure.
- Search, explore and coverage build the index on first use; an explicit
  `repository_refresh` is needed only after edits or branch changes.
- `repository_packet` queues concurrent calls (up to eight waiting), requires
  only `sources` through MCP, reads a whole file from a path alone or to the
  end when `endLine` runs past it, merges overlapping ranges and states file
  lengths in range errors.
- Plan mode also selects named classes, interfaces, type aliases and enums, so
  an anchor on a field or signature line returns its whole declaration.
- Served tool instructions and schemas are smaller (5,586 bytes for the tool
  listing).
- `@forgesworn/context` retrieval ranks by BM25 with a source-label bonus.

Local Node 24.21.0 checks from `npm ci --ignore-scripts` passed 451 tests,
independent packed-package smoke, navigation stdio smoke, 22 scale tests and
the 10k postings probe. Both unchanged benchmark gates passed with
required-source recall 1.0: raw evidence 37.93x, navigation 356.2x.
Commit-specific CI, archive checksums and registry checks accompany the
release; this entry does not pre-claim them.

External repository walkthrough (tool level, no model): the packed 0.4.0
tarballs installed outside the workspace, then `doctor` and a stdio MCP client
on `sindresorhus/ky` at `0d59458` (89 files, 18,463 locations). Explore built
the index on first use; a packet given only a path returned the whole file;
explore resolved `HTTPError` with references and tests; a literal search, a plan anchor on a
class field (whole class returned) and a read past the end of a file succeeded;
an edit made navigation stale and packets were refused until refresh, after
which the new line was found; paths outside the root and under `node_modules`
were refused; an unknown symbol returned an explicit empty result. This is not
client, developer or task acceptance on that repository.

Measured benefit: none shown. A locked repeated run on a DeepSeek V4 Pro
executor (72 cells, eight tasks, three repetitions;
[results](docs/experiments/repeated-pro-20260923/RESULTS.md)) found the
pre-release Context arm used more executor input than plain tools (geometric
mean ratio 1.17, 90% interval 0.79 to 1.36) and Graphify (1.31, 0.94 to 1.64),
and was accepted on 3 of 8 tasks against 5 for each. Its input followed extra
turns rather than larger tool results; the first-use build, whole-file packets
and range merging above remove the deterministic part of that overhead but are
not yet measured on an executor. No token, subscription or cash saving is
claimed for this release.

Reconnect existing MCP servers after upgrading. Clients that parsed the JSON
search or packet output must now request `format: "json"`.

## 0.3.3 shipment checks, 22 September 2026

The TS/JS scanner now binds calls to scoped compiler symbols over selected source
files. It avoids false shadowed targets and nested-callback attribution, follows
supported local aliases, rejects type-only/ambiguous exports and separates
same-named static/instance methods. Analysis uses no LLM and the compiler host has
no filesystem, configuration, default-library or network fallback. Full project
resolution and default-export expression assignments remain unsupported.

Implementation validation passed 420 tests, independent packed-package smoke and
both unchanged benchmark gates with required-source recall 1.0. Independent
review findings were repaired and rechecked. See the
[execution ledger](docs/DOGFOOD-EXECUTION.md#22-september-2026--scope-aware-tsjs-call-evidence-local-unreleased)
for attempts, repairs and the distinction between worker tokens and total cost.
Versioned shipment CI, archive checksums and public-download checks accompany the
GitHub release; this source entry does not pre-claim their outcome.

Install both matching 0.3.3 tarballs with Node 24. Existing MCP servers require a
reconnect after upgrading. npm authentication again returned HTTP 401 on
22 September; registry publication remains blocked. Actual client acceptance,
consumer upgrades and measured developer/subscription/cash benefits are separate
checks; this scanner correction does not close those gates.

## 0.3.2 shipment checks, 22 September 2026

Navigation and exact source packets now accept `.kts`, `.cc`, `.cxx`, `.hh`,
`.hpp` and `.hxx`, matching the broad scanner's existing lexical coverage.
Syntax-aware planning remains TS/JS-only and Dart remains unsupported.
See the [language support matrix](docs/LANGUAGE-SUPPORT.md).

Local Node 24.21.0 checks passed 402 tests, independent package installation,
both unchanged benchmark gates, navigation stdio smoke, 22 scale tests and the
10k postings probe. Added coverage checks each suffix's search, exact source
lines/hashes, stale rejection and refresh, policy exclusion, unsupported planning
and retrieval through installed stdio MCP. Commit-specific CI, public artifact
checksums and download verification accompany the GitHub release.

npm authentication still returns HTTP 401; registry publication is outstanding.
Upgrade using matching GitHub tarballs or the source build, then reconnect the
MCP server: refreshing its source index does not reload its implementation.
These checks do not establish new Claude lifecycle acceptance or measured
whole-task/subscription/cash savings. The first actual Claude audit and its
incomplete host-cost coverage are recorded in the execution ledger.

## 0.3.1 shipment, 22 September 2026

This patch adds an installed, read-only `doctor` command that verifies the exact
Git checkout, all four repository tools and one source line's generation/hash
through a fresh stdio connection. It reports client acceptance as `not-tested`;
an SDK probe does not establish Claude/Codex task acceptance.

The raw-evidence benchmark now uses versioned v2 synthetic collections, retaining
every corpus chunk within the existing 128-record and 32-collection bounds.
Each question queries every collection and counts every response. Per-call
budgets and gate thresholds are unchanged; the total per-question budget scales
with the collection count. See [the methodology](benchmarks/README.md).

The version-bumped 0.3.1 local checks passed 386 tests, independent installed-package smoke,
both benchmark gates, navigation stdio smoke, 22 scale tests and the 10k postings
probe. Raw v2 measured 32.53x and navigation 270.71x, both with required-source
recall 1.0. Commit-specific CI and artifact checksums accompany the GitHub release. No new client,
consumer or whole-task savings acceptance follows from these checks.

npm authentication returned HTTP 401 on 22 September. Registry publication
remains blocked; matching release tarballs provide the independent installation
route. The next adoption gate is an accepted Claude task with complete usage,
repair and review accounting, alongside continuing Codex use.

## Current internal adoption review, 21 September 2026

The [ForgeSworn dogfooding plan](docs/FORGESWORN-DOGFOOD-GOALS.md) now tracks
remaining internal adoption work separately from public release gates.
On `dda2284` plus the six existing freshness code/test/doc modifications,
`npm run check` passed 33 core tests, 77 tools tests and independent tarball
smoke under Node 24.21.0 on macOS. Both built benchmark runners passed with
`--check` and declared-source recall 1.0. No benchmark threshold was changed.

Actual Codex MCP refresh/search returned `freshness: current`: 60 files,
8,033 indexed locations, and a 12-result / 2,844-byte first search page with a
continuation. This snapshot preceded the new planning documentation. Freshness
work remains uncommitted, so these are working-tree results.
[Main CI](https://github.com/forgesworn/context/actions/runs/35588618564) passed
for `dda22841b9cc38735b67f84e04dc5e07e2d048c2`, independently of those local changes.
Exact `0.3.0` registry lookups for both packages returned E404.

The dated baseline and blocker lists below are historical. Local navigation now
provides a separate route beyond 128 locations, refresh and Codex tool use are
implemented, and a [paired diagnostic trial](docs/PAIRED-TRIAL.md) has run.
Signed v1 still has a 128-record ceiling; complete-task monetary savings,
Claude tool-use acceptance, public release qualification and broader ecosystem
adoption remain open. No G0–G4 gate is closed by this review.

## Source shipment verification, 21 September 2026

The scale-foundations shipment passes 33 core tests, 28 tools tests, independent packed-package smoke, both token benchmark gates, 22 synthetic scale tests and the 10k posting-index runner. The memory blob fixture now copies Node Buffer inputs independently and rejects non-string digests before coercion. CI includes navigation recall, both scale suites and the 10k probe. These are source-shipment checks, not closure of G0-G4 or an npm publication. PR and main CI provide commit-specific remote evidence; earlier entries below remain historical snapshots.

Updated: 21 September 2026.

## Candidate metadata

| Field | Value |
| --- | --- |
| Evidence date | 21 September 2026 |
| Tested commit | `5540c4d` |
| Working tree | Uncommitted `README.md`, `GOALS.md` and this ledger are documentation changes only |
| Runtime | Node v24.21.0 |
| Platform | macOS arm64 |
| Registry | `@forgesworn/context-tools@0.3.0` is not published |

Overall status: **G0 in progress, not passed.**

The tested commit builds and its current automated tests pass.  CI has not been rerun for the eventual release commit, known release gaps remain, and no readiness or security conclusion follows from this evidence.

## Commands and observed outcomes

```sh
npm run check && npm run benchmark:tokens:check && npm run benchmark:tokens:parity
```

| Check | Outcome | Evidence |
| --- | --- | --- |
| TypeScript builds | Passed | Both workspace packages compiled |
| `@forgesworn/context` tests | Passed | 4 files, 25 tests |
| `@forgesworn/context-tools` tests | Passed | 4 files, 24 tests |
| Packed-package smoke | Passed | Independent Node import, declarations and browser bundle; independent CLI create, append and restart recovery |
| Raw evidence benchmark | Passed | 26 files, 67,087 baseline tokens, 6 queries, aggregate 28.30x reduction multiplier, 96.47% reduction, minimum declared-source recall 1.0; 10x regression floor passed |
| Navigation benchmark | Passed with material limitation | 25 files, 60,541 baseline tokens, 8 queries, average 140.71x, minimum 138.54x and median 140.47x, minimum declared-source recall 1.0; 71.5x reference target passed |

The navigation scan retained 128 graph records and dropped 111.  This makes the present collection ceiling a release and product blocker for whole-codebase claims.  The navigation result measures compact pointers to required sources.  It is not sufficient answer evidence and is not a measured inference-bill saving.

## Gate status

| Gate | Status | Evidence and remaining gaps |
| --- | --- | --- |
| G0 reproducible baseline | In progress | Local build, 49 tests, packed smoke and both benchmarks passed. The release commit and a current CI run remain outstanding. Test-to-gate coverage is recorded below. |
| G1 trust boundaries | Partially evidenced | Tests cover grant and scope rechecks, proof refusal, uploader signing boundaries, bounded traversal and scanner path/symlink handling. The full negative boundary matrix and published threat model remain outstanding. |
| G2 usable evidence | Partially evidenced | Tests cover deterministic scans, corrections, provenance, ambiguity and response bounds. Repository refresh across deletion and rename is not implemented or proven. The 128-record collection ceiling prevents whole-codebase claims. |
| G3 independent use | Partially evidenced | Real tarballs work outside the workspace. A published-registry install, documented end-to-end walkthrough and named real MCP client robustness check remain outstanding. |
| G4 cost per accepted task | Not started | No paired pilot trial has run. Current token benchmarks do not measure accepted task quality, retries, review time or billed cost. |

## Existing test evidence

- `retrieval.test.ts`: bounded query hits and one-hop links without external reads; current-head corrections; exact UTF-8 caps and oversized omission; source revisions are not conflated.
- `graph.test.ts`: atomic links and cycles; bounded query and path operations without crossing collections; provenance; invalid, absent and corrected endpoints; byte, depth and node caps; corrected stale topology; deterministic shortest paths.
- `index.test.ts`: grant and scope rechecks; identity sharing and restore; malformed provenance; unknown proof and personal-sharing refusal; host proof adapter; uploader signing boundaries.
- Scanner tests: deterministic JS/TS and conservative broad-language output; hidden, generated and symlinked trees ignored or rejected; UTF-8 and resource bounds; append-safe relations; ambiguous packages and links handled.
- `blossom.test.ts`: published envelope fixture compatibility.
- The package smoke builds real tarballs and checks the independent consumers described above.

These statements describe the named tests.  They do not extend to untested environments, attacks or integrations.

## Known blockers

1. Design and prove a route beyond 128 records while keeping each read bounded.
2. Define and test repository refresh for changed, deleted and renamed files, including explicit stale-snapshot behaviour.
3. Exercise initialisation, errors, cancellation and bounded results through a named real MCP client.
4. Publish the matching packages through the authorised process, then repeat the independent smoke against the registry versions.
5. Run CI on the eventual release commit and record its result separately from this local pass.
6. Publish the threat model and complete the negative trust-boundary test matrix.
7. Run the paired cost-per-accepted-task trial.  Include retries, failures, review effort, scan/refresh cost and the actual charging basis.

## Claim boundaries

- Passing these checks does not establish that Z1P Core is secure, release-ready or production-ready.
- The broad-language scanner is conservative lexical navigation, not compiler-level semantic analysis.
- The benchmark corpora and declared-source checks do not prove task answer quality.
- No cost saving is claimed until the paired trial measures complete accepted tasks.
- Registry availability, current CI, a real client workflow and normal-work use remain separate gates.

## Next action

Follow the [enterprise scale review](docs/ENTERPRISE-SCALE-REVIEW.md): prove indexed queries and resource budgets before implementing a new cryptographic paging format.

## Subsequent working-tree checks

Adding the experimental paging memory stores increased the test count to 55; both builds, all tests and independent package smoke passed.  Raw-evidence reduction was 28.90x with minimum declared-source recall 1.0.

The expanded navigation corpus failed: 27 files, 128 retained records, 122 dropped records, and `retrieveView` source recall 0.  The earlier passing baseline above remains historical evidence only.  The current working tree does not pass the full gate.  No scanner repair has been applied, and no benchmark threshold has been relaxed.

### Worker implementation follow-up

The scanner regression above has now been repaired by adding bounded exported-name anchors to file records and allocating symbol detail round-robin across files.  Existing IDs, source fields and the 128-record limit are preserved.  Full workspace verification passed: 31 core tests, 28 tools tests, independent package smoke and both unchanged token benchmark gates.  Navigation minimum declared-source recall is again 1.0, with aggregate reduction 144.73x on this working tree.

The separate [synthetic scale probe](benchmarks/scale/README.md) adds eight passing tests and successful 10k/50k and 100k/500k record/edge runs.  This prototype is not integrated into Core and does not lift the current collection limit or qualify private-data storage.
