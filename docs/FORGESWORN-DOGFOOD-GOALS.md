# ForgeSworn dogfooding and inference-cost goals

Reviewed: 21 September 2026. Owner: ForgeSworn engineering.

## Outcome and immediate decision

Use Z1P Core during ordinary ForgeSworn development to reduce repeated source
discovery and cost per accepted task. Start with the existing local Codex MCP
bridge, then expand to KithMoot and Oathrun through explicit repository bindings.
Measure the complete workflow before claiming savings.

**The current checkout can be dogfooded now.** Complete D0 and D1 to make that
pilot reproducible and routine. Complete D2 before expanding to other repository
roots. Public package release, hosted services and enterprise indexing are not
prerequisites for this local pilot.

These D goals are the internal adoption sequence. [G0–G4](../GOALS.md) remain the
public release gates. A passed D goal does not automatically close a G gate.
The model assignments below are proposed execution settings, not scheduled jobs
or automatic routing already implemented by this library.

## What we have, and what remains

| Area | Evidence on this review | Remaining gap |
| --- | --- | --- |
| Core and tools | Both packages build; `npm run check` passes 33 core and 77 tools tests plus independent tarball smoke on Node 24.21.0/macOS | Checks include six pre-existing modified files; this is not a clean release candidate |
| Main CI | [Run 35588618564](https://github.com/forgesworn/context/actions/runs/35588618564) passed for `dda22841b9cc38735b67f84e04dc5e07e2d048c2` | That run does not cover the local freshness changes |
| Local navigation | Actual Codex MCP refresh indexed 60 files / 8,033 locations; search returned 12 source locations in 2,844 bytes, `freshness: current`, with continuation | Freshness code/tests/docs remain uncommitted; normal multi-task use and other roots are unqualified |
| Signed evidence | Encrypted persistence, bounded retrieval and restart workflow exist; [dogfood evidence](DOGFOOD.md) records acceptance | Signed v1 still holds 128 records; configured snapshots need explicit replacement/rebinding |
| Discovery | Both benchmark gates pass with required-source recall 1.0 on their declared queries | The signed navigation corpus retains 128 records and drops 180; pointer compression is not complete answer evidence |
| Client support | Codex tool calls work in this session; Claude connection and an earlier 429 are documented in [DOGFOOD.md](DOGFOOD.md) | Actual Claude tool-use acceptance remains unverified; do not make it a dependency of Codex dogfooding |
| Cost evidence | [One diagnostic pair](PAIRED-TRIAL.md) used 56.7% fewer worker tokens including repairs | Host selection/review and billing were unknown; baseline was full files, not an optimised `rg` workflow |
| Distribution | Both manifests say `0.3.0`; independent packed installs pass | Registry lookups for both exact versions returned E404 during this review |
| Consumers | KithMoot's local manifest still uses `0.2.0` workspace packages; Oathrun's delivery plan separates read workers, coding and context integration | No current end-to-end Context → Oathrun task acceptance established by this review; consumer upgrades need their own evidence |

The live navigation bridge is unsigned, local and ephemeral. Signed collections
provide a different trust and persistence contract. Neither route performs
inference or executes workers; the consuming client controls model disclosure
and execution. See [LOCAL-NAVIGATION.md](LOCAL-NAVIGATION.md) for actual limits.

## Model and effort policy

Use deterministic commands for scanning, indexing, filtering and tests. They
need no model. Use a model only for the judgement or implementation it adds.

| Short name | Exact model | Initial effort / thinking | Use |
| --- | --- | --- | --- |
| Qwen | `qwen3.8:latest`, local M4 | `think=false` | Bounded extraction, evidence tables, summaries and small mechanical edits |
| Flash | `deepseek-v4.1-flash:cloud` | `think=false` | Ordinary coding, debugging and tests against a supplied contract |
| Pro | `deepseek-v4-pro:cloud` | `think=false` initially; validate supported thinking before increasing | Difficult implementation after a bounded Flash failure; only on a reconciled, eligible endpoint |
| Luna | `gpt-5.6-luna` | `medium` | Small Codex maintenance/check packets if the local route is unavailable or unsuitable |
| Terra | `gpt-5.6-terra` | `medium` | Contained integration review or implementation fallback where cheaper workers fail |
| Sol | `gpt-5.6-sol` | `high` | Trust boundaries, consequential design, difficult lifecycle review and measurement decisions |

These assignments apply the current local Ollama-workers routing guidance:
Qwen for narrow extraction, Flash first for ordinary code. A failed Qwen coding
attempt is not a prerequisite. Local Qwen has no provider token charge, but its
latency, machine use and review overhead still count. Cloud and subscription
usage must be recorded on their actual charging basis.

Allow one focused repair after a terminal inadequate draft, then resize the
packet or escalate with the compiler/test evidence. A timeout or unknown outcome
requires reconciliation before replay. Do not silently switch providers after
a refusal or spending hold. Use Pro only after checking current endpoint state;
this review did not run model inference or qualify provider availability.

Codex effort names and Ollama thinking flags are separate controls. Official
model references confirm the proposed Codex effort levels for
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) and
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol).
Provider references: [Qwen](https://ollama.com/library/qwen3.8) and
[Flash](https://ollama.com/library/deepseek-v4.1-flash).
The assignments are our task-fit choices, not vendor guarantees or price quotes.
Reserve Astra/high for a specific unresolved decision after Sol review; no goal
needs max/ultra by default. Selecting a model in this document does not change
the model powering an already-running session.

## Ordered goals

| Goal | Priority / dependency | Implementation model and effort | Review model and effort | Done when |
| --- | --- | --- | --- | --- |
| **D0 — Make the existing pilot reproducible** | Now | Qwen / thinking off for evidence; Flash / thinking off for any required repair | Terra / medium; Sol / high for a discovered boundary defect | Freshness work has a named reviewed commit, matching CI and a repeatable local launch |
| **D1 — Use it on everyday Context tasks** | Start now; close after D0 | Qwen / thinking off for the short runbook; deterministic MCP setup | Terra / medium | Three normal tasks across two fresh client sessions finish with source-backed accepted outcomes and receipts |
| **D2 — Control what each repository exposes** | Before expanding roots; depends on D0 | Flash / thinking off | Sol / high for exclusion and root-boundary contract | Configured exclusions and Git ignore behaviour are tested, visible and shared by refresh/freshness inspection |
| **D3 — Extend the pilot to KithMoot and Oathrun** | After D1–D2 | Qwen / thinking off for inventory; Flash / thinking off for reusable setup | Terra / medium; Sol / high for cross-project authority | Two additional explicit roots work in isolated sessions, each with one accepted real task and a tested disable path |
| **D4 — Feed small, sufficient packets to cheaper workers** | After D1; use only qualified roots | Flash / thinking off; Qwen / thinking off for packet summaries | Terra / medium | Two ordinary coding tasks complete using retrieved source packets, with all repairs and host work recorded |
| **D5 — Prove useful whole-task savings** | Instrument from D1; compare after D4 | Flash / thinking off for receipt/report tooling; Qwen / thinking off for extraction | Sol / high for experiment design and acceptance | Eight paired tasks meet the predeclared quality and cost decision rule below |
| **D6 — Connect the normal ForgeSworn consumer workflow** | After D3–D4 and relevant consumer gates | Flash / thinking off; Pro / thinking off only for a bounded harder packet | Sol / high | An authorised Oathrun/KithMoot task retrieves scoped Context evidence, returns a cited result, and survives the required lifecycle checks |
| **D7 — Make installation and release dependable** | After D0–D2; public release also needs G0–G4 | Flash / thinking off for packaging; Qwen / thinking off for docs | Terra / medium for packaging; Sol / high for unresolved release boundaries | Another isolated environment runs the pinned pilot; later, published exact versions pass registry smoke and consumer compatibility |

### D0: Finish the work already present

- Preserve the existing six-file freshness diff and review it as its own change.
  Record the final commit, runtime, checks and CI; do not attribute local results
  to `dda2284` alone.
- Rebuild and restart the pilot process when its implementation changes. In an
  actual Codex session, check unavailable → refresh → current, edit → stale,
  explicit refresh → current, and old-cursor invalidation on successful refresh.
  Use a disposable fixture for deliberate edits and cancellation tests.
- Capture a pinned checkout or paired tarball launch and rollback command.
  Keep keys and receipts outside the repository. Update the evidence ledger so
  historical missing features are not mistaken for today's blockers.

### D1: Establish a small daily habit

Use the current Context checkout first. At task start, call
`repository_status`; refresh if unavailable, stale or unknown. Search for a
specific identifier with a small result budget, then read the necessary source
and tests. Page only when the task requires more evidence. Read current source
before changing it, and refresh after edits. On exclusion, no match or quota
failure, fall back to bounded `rg`/file reads and record why.

The three tasks should cover orientation, a diagnosis and an accepted code
change. Record revision, working-tree changes, client version, model/effort,
retrievals, fallback, checks and review result. This is usability acceptance;
the paired savings experiment is D5. Start its usage record here to avoid losing
the baseline. Claude qualification can follow when its lane is available.

### D2: Make wider repository use deliberate

The current bridge uses fixed directory and extension exclusions. It does not
honour `.gitignore` or detect secrets. Define project-local include/exclude
configuration, Git ignore semantics and how explicitly included files behave.
Test an ignored source fixture, generated directories (including Rust `target`),
hidden files, symlinks, excluded Markdown, deletion, rename and policy changes.
Never imply that honouring Git ignores constitutes secret detection.

Use exactly the same selection policy for refresh and freshness checks. Show
exclusions and quota failures; never broaden the root automatically. Measure
refresh and per-query freshness cost on real roots: the current freshness check
reads a bounded manifest and hashes source bytes, so small output does not imply
cheap disk work. Optimise only against measured latency without losing stale
source detection. Keep the pilot confined to its reviewed root until this passes.

### D3: Add two consumers as development repositories

Configure separate explicit roots for KithMoot and Oathrun, each with its own
ephemeral index and client binding. Start with per-repository navigation; use
the ecosystem manifest only for a task that explicitly needs joined evidence.
Record limits, exclusions, revision and source hashes for each root. Verify a
query bound to one root cannot retrieve the other, and that disabling a binding
removes its tools on a fresh session.

Do not use the parent workspace directory as an ambient shared root. Related
repositories do not imply permission to share private records or conversations.
This goal uses Context to work on those repositories; application/room
integration is the separate D6 goal. Keep the existing KithMoot `0.2.0`
dependency unchanged until compatibility is tested in an isolated branch.

### D4: Remove repeated manual context assembly

Provide a reusable packet format or small helper around the existing worker
workflow. Include task, acceptance checks, allowed files, repository/revision,
source hashes, exact relevant interfaces/fixtures, bounded excerpts, exclusions
and unresolved questions. Reject or rebuild a packet if relevant source changes.
Do not mistake a navigation pointer or Qwen summary for sufficient source.

Scanning and excerpt assembly stay deterministic where possible. The host
reviews the packet's sufficiency once, sends ordinary implementation to Flash,
then returns precise test failures for at most one focused repair. Store the
accepted diff, checks and compact handoff rather than repeatedly sending the
whole conversation. Keep routing, execution and disclosure policy in the
consumer/worker layer; do not introduce a provider dependency into Core.

### D5: Measure cost per accepted outcome

Predeclare eight paired tasks: two each for orientation, bug diagnosis, change
impact and accepted code changes, distributed across at least two qualified
repositories. Compare the normal efficient `rg`/file-read workflow with Context
assistance. Hold revision, task, model, thinking/effort, tools available beyond
retrieval and acceptance checks constant within each pair. Alternate order and
use separate sessions; document cache state and possible contamination.

Count all host and worker input/output, reported cached/reasoning usage, retries,
failed runs, tool calls, source reads, scan/refresh latency, review time and
accepted outcomes. Avoid double-counting provider reasoning fields already
included in output totals. Missing usage remains `null`; record which phase
cannot be measured. Store sensitive receipts privately and commit a sanitised
aggregate with reproducible task/acceptance definitions.

**Proposed decision rule, to lock before running the experiment:** all eight
assisted tasks meet the same acceptance checks, with no material correctness
regression, and at least 20% lower aggregate variable inference cost per accepted
task without higher aggregate review time. Include unsuccessful-attempt costs
in each arm's numerator. Report individual pairs and total elapsed time as well
as the aggregate. Eight pairs are an operational pilot, not a universal claim.

If billing cannot be attributed, report token/allowance changes separately and
leave the monetary gate open. Subscription headroom does not lower a fixed bill
unless it prevents overage or permits a plan change. Report cash figures in GBP
with the dated conversion basis. Only after the retrieval comparison, run a
separate experiment changing models; otherwise routing gains and retrieval gains
cannot be distinguished. If Context loses to `rg` on a task class, keep `rg` as
the default there and fix the measured cause.

### D6: Join the ecosystem at the consumer boundary

Coordinate with Oathrun's `docs/CHAT-CODING-DELIVERY-PLAN.md` and
`docs/CONTEXT-CACHE-PLAN.md`. Its read worker, coding executor and signed context
integration have separate gates. Begin with one scoped read task; do not build
a second worker supervisor in this repository or make full chat coding a
dependency of the local pilot.

The consumer must select an explicit project, check authority before retrieval
and disclosure, preserve source provenance and label unsigned navigation.
Test denied cross-project reads, deliberate bounded joins, revocation on the
next read, restart and cancellation. Membership alone grants no ambient context.
Signed records and grants, rather than the local OS-only navigation process,
must carry the shared-room trust contract. Existing signed collections remain
bounded; do not persist private source in the plaintext scale prototypes.

Close this goal with a real task in the intended Oathrun/KithMoot workflow,
including result delivery and usage evidence. A unit test, direct model call or
MCP connection check alone is insufficient. Coding can follow once Oathrun's
own execution and recovery gates pass.

### D7: Separate reproducible adoption from public publication

For the internal pilot, install both packages from a named commit's tarballs
outside the workspace, launch navigation against an explicit root, exercise
restart/refresh/search and document removal. No registry release is required.

For public release, complete G0–G4, the threat model and negative-boundary
matrix, package compatibility and release documentation. Publish both matching
versions through the release process, install those exact versions from the
registry and repeat the workflow. Test the KithMoot upgrade independently before
changing its normal installation. Record prepared, published and consumer-adopted
as separate states.

## Work to defer

Keep encrypted persistent indexing beyond 128 signed records, ranked multi-term
retrieval, incremental large-graph refresh, hosted operation, graph editing,
automatic model routing and wider language semantics behind measured pilot
needs. The scale prototypes remain experiments. A real quota or latency failure
can promote the relevant work; synthetic corpus size alone should not delay D1.

## Execution order and evidence

Start D0/D1 immediately. Add minimal D5 receipts from the first normal task.
Then D2 → D3, with D4 on already-qualified roots. Run D5 comparisons before
declaring that the workflow saves money. Coordinate D6 with the consumer owner;
finish D7's public half when the release gates pass.

For each goal record status, owner, exact model/effort, starting revision,
changed files, accepted outcome, checks, usage including failures, evidence
location and remaining limits. All D goals are **open** at this review; working
components above do not imply that their full adoption gates are complete.
