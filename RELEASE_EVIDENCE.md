# Z1P Core release candidate evidence ledger

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
