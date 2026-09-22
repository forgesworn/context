# ForgeSworn dogfooding and inference-cost goals

Updated: 22 September 2026. Accountable owner: the product owner. Execution owner: Context development lead.

Scope clarified 22 September: this is the internal adoption plan, not the
general product roadmap. [Product direction](../PRODUCT_DIRECTION.md) and
[release goals](../GOALS.md) govern the MIT developer tool for other projects.
D6's Oathrun/KithMoot application integration is optional for that product;
the worker model assignments here are our development workflow, not required
Context infrastructure or an automatic routing feature.

The active product queue is [OS0–OS6](OPEN-SOURCE-EXECUTION.md), with owners,
locations and model/effort assignments. These internal D goals remain adoption
evidence; enterprise work is parked until open-source value is demonstrated.

Execution has started. See [the execution ledger](DOGFOOD-EXECUTION.md) for
current results; the initial inventory below is the planning snapshot.

## Outcome and immediate decision

Our first outcome is lower monthly Claude/Codex spending, or more accepted
frontier development within the same subscription, for ForgeSworn developers.
Use Context during real ecosystem work and measure from the first task. Build
the general MIT tool through this use; do not wait for enterprise services,
public publication, a complete ecosystem graph or the full benchmark campaign.

Start with the product owner and the existing Heartwood session, then explicitly selected
Heartwood-related repositories such as Sapwood and Heartwood Ledger. Add another
developer when available; no staffing dependency blocks the first pilot. Qualify
Claude Code alongside Codex. Using Oathrun as a source repository is separate
from integrating its runtime, which remains optional.

## Immediate savings goals: FS0–FS5

These goals take scheduling priority for the next delivery slice. They apply
OS0–OS2 and the smallest useful OS4 language changes to our own development;
they do not replace public G gates or alter locked D5 experiments. Existing D0–D7
sections below remain the historical adoption sequence. Model names/effort are
the assignments in [the execution plan](OPEN-SOURCE-EXECUTION.md), not product
dependencies or automatic session switches.

| Goal / priority | Work and responsible owner | Where | Implementation / execution | Review and done condition |
| --- | --- | --- | --- | --- |
| **FS0 — Establish the baseline. Start now** | the product owner supplies available usage/billing exports; Context lead records coverage, plan period, seats and current unknowns | Private local evidence; publish only sanitised aggregates | Deterministic import/normalisation; Flash/off for a bounded adapter if needed | Terra/medium checks accounting. Record the last complete billing period where available and current period-to-date for Claude and Codex-associated accounts separately. Missing baseline does not block adoption |
| **FS1 — Put Context in the daily path. Start now** | Context integration owner qualifies MCP and repeatable setup; each application session owns its code and acceptance | `packages/context-tools`, client docs, explicitly selected project bindings; Heartwood task stays with its existing owner | Flash/off scoped setup/fixtures, Terra/medium integration; existing frontier model for daily work. Claude qualification: Sonnet/medium, then Opus/high; Codex keeps the selected developer model | Real source-backed task use in both clients, refresh/restart/disable verified, no provider credentials in Context. Expand toward three explicitly selected ecosystem repositories; unsupported evidence has a bounded fallback |
| **FS2 — Capture real task usage. First implementation priority alongside FS1** | Context tooling owner produces provider-neutral receipts and an offline daily/weekly summary | Developer scripts/tests and `docs/TASK-COST-REPORT.md`; private client event/usage exports outside Git | Deterministic event parsing/counting; Flash/off bounded adapters/fixtures; Terra/medium integration | Terra/medium accounting review; Sol/high only for a new disclosure boundary. Both client sources covered or explicitly incomplete; deduplicate cumulative usage and shared subscriptions; all attempts/review included. Begin manually with the linked receipt now |
| **FS3 — Review benefit every week. After receipts start** | Context lead produces a summary; the product owner checks whether the workflow helps; independent reviewer checks comparison claims | Private receipt aggregate; sanitised weekly section in `docs/DOGFOOD-EXECUTION.md` | Deterministic totals; Terra/medium interprets results. New paired checks keep the same frontier model/effort within each pair: Sol/high for Codex or Opus/high for Claude | First checkpoint after five working days or ten completed pilot tasks, whichever arrives first. Show coverage, acceptance, usage/task, repeated reads, review time and cost. Qualify one prospective pair per client before extending controlled trials; do not relabel daily work as a control arm |
| **FS4 — Fix the largest measured waste. Repeat after FS3** | Context lead chooses one concrete cause; Context implementer fixes it | Packet/MCP adapters, Rust/TS/Kotlin extractors or freshness code in Context; application changes remain in their own repos | Flash/off small mechanical changes; Terra/medium integration; Sol/high resolver/provenance contracts | Same task acceptance, focused regressions and new usage evidence. Target repeated source discovery, insufficient packets or language gaps; deeper graph/index work only when it fixes observed waste |
| **FS5 — Reconcile each billing period. After a complete period** | the product owner owns invoice/account reconciliation and any plan decision; Context lead prepares the report | Private account ledger and [monthly template](examples/monthly-savings-review.md) | Deterministic account totals; Terra/medium summary; Sol/high if causal interpretation is disputed | Report actual bills, overages/credits/API charges, output quality and usage separately for each provider/account. Identify measured savings, estimated avoided spend and unknown attribution. Never change a plan automatically |

FS0, FS1 and FS2 can proceed together. Do not rerun completed application work
solely to fill a report. Capture current sessions from a stated boundary if
earlier usage is missing, and label those tasks partial. Keep daily-use recording
short: attach source receipts rather than asking a frontier model to narrate
every tool call. A report generator must run offline without a model.

## What we mean by savings

| Measure | How to establish it | What we may claim |
| --- | --- | --- |
| Less context/model usage | Whole-task input/output, cache fields and all attempts; controlled same-task/model comparison | Measured token reduction for that cohort; not automatically cheaper bills |
| More subscription headroom | Provider-reported allowance/limit observations where exposed, plus accepted work and review time | Observed headroom or fewer limit interruptions; never derive proprietary allowance units from raw tokens |
| Lower variable spending | Attributable API/extra-usage charges for comparable accepted work, including external workers | Measured variable-cost reduction; do not price included subscription tokens as API charges |
| Lower monthly bill | Reconciled same-currency invoices/account charges for comparable periods, with seats/plan/workload changes reported | Actual bill change. Attribute a portion to Context only where supporting evidence exists |
| Avoided upgrade or estimated savings | Explicit counterfactual, applicable terms/rates, dated evidence and uncertainty | An estimate shown separately from cash already saved |

Keep Claude and Codex/client usage cohorts separate. A ChatGPT account may fund
Codex and other use; Claude accounts may include work outside the pilot. Count
each subscription once at account level and retain an unallocated-use bucket.
Do not divide a subscription fee into fictitious per-token savings or count a
single account charge once per repository/developer. Record developer/repo/task
identifiers for coverage, not intrusive staff productivity ranking.

Record input, output, cached input, cache-write input and reasoning fields with
the source's exact semantics. Cached/reasoning values may be subsets; normalise
per provider and preserve raw fields. Deduplicate request IDs and distinguish
per-request usage from cumulative session counters. Unknowns remain `null`.
Track record coverage explicitly: accepted and failed tasks, missing receipts,
unallocated account use and excluded intervals. Incomplete coverage cannot
establish a total saving.

Monthly account spend includes subscription charges plus extra usage/API charges
not already included on the same invoice, minus credits/refunds counted once.
Report currencies separately unless using a documented dated FX basis; keep tax
basis consistent. Account bill reduction is prior comparable-period spend minus
current spend, not by itself a causal Context estimate. Note seats, plan changes,
working days, task mix and acceptance/review differences before interpreting it.

Any work moved to DeepSeek/GLM or another provider adds its own charges and review
overhead to the overall result. Keep Context implementation/evaluation investment
visible separately from recurring task cost; do not hide it or assume payback.
For a complete positive baseline, token/cost reduction is
`(baseline - assisted) / baseline`; zero or unknown baselines produce no percentage.
Compare task classes within fixed provider/model settings before aggregating.

Our target for a new controlled cohort is at least **20% lower total model tokens
per accepted result**, all assisted tasks meeting the same acceptance checks and
no increased aggregate review time. This is a target, not an observed saving;
lock the protocol before runs. Monetary goals remain conditional on attributable
cost. Subscription-only use may show capacity benefits while cash savings stay
zero. The failed historical comparison remains in the ledger.

## Start with the next ecosystem task

1. The application owner records task, repo/worktree/revision, chosen client,
   actual model/effort and acceptance checks. Copy the
   [daily receipt](examples/daily-use-receipt.json) into private evidence storage;
   record the source and coverage of any available usage export.
2. Use existing Context status/refresh/search and a sufficient verified packet.
   Read direct source for a tiny known-file edit; avoid ceremonial graph queries.
   The existing Heartwood owner continues its task without a second investigation.
3. Attach the resulting checks and all usage/review/repair evidence. Missing
   accounting stays explicit; an accepted code change can still have incomplete
   measurement. Record Context overhead and fallback reasons.
4. The Context lead reviews the first cohort, fixes one measured bottleneck and
   maintains the weekly scorecard. Do not wait for eight pairs to start adoption.

The daily receipt and monthly review are manual templates, not inputs accepted
by the existing strict paired-task reporter. The separate
[FS2 daily importer](DAILY-USAGE.md) now reads explicit Codex request exports and
fixture-qualified Claude transcripts and creates offline task summaries. Explicit
Ollama helper receipts are now supported, with operator-supplied attempt IDs and
timestamps. Explicit `start`/`finish` commands now capture task windows and produce
import specs with unknown acceptance/coverage. Real Claude exports and complete
everyday captures remain open; automatic session discovery is excluded. Read-only local
exports are the source, not new provider authentication inside Context.
Private prompts, source and billing remain local; no telemetry upload is added.

As of this update: local Codex use is evidenced; actual Claude task acceptance,
routine whole-task accounting and monthly cash savings remain open. The previous
controlled assisted answer failed and increased combined executor/reviewer input.
No new paid model trial, account inspection or billing reconciliation ran for
this planning change. Public external-project acceptance follows this initial
ForgeSworn pilot; enterprise stays deferred.

**The current checkout can be dogfooded now.** D0, D1, D2, D3 and D4 have passed:
the pilot is reproducible, routine tasks have accepted outcomes, selection has
qualified review, and source packets support two accepted coding tasks. Next,
address the [corrected qualification's assisted-answer failure](D5-RESULTS.md)
and retrieval/review overhead before expanding the whole-task comparison. The
harness now works; baseline passed, assisted failed semantic review, and no
monetary savings are established. Heartwood is also dogfooding in a separate
session; keep its active task independent of the controlled comparison. Public
package release, hosted services and enterprise indexing are not prerequisites
for this local pilot. See the execution ledger for the exact scope and evidence.

The [savings improvement plan](SAVINGS-PLAN.md) records the v3 retrieval overhead,
the next packet-assembly change, model assignments and the proposed separate
ordinary-tools / Context / Graphify comparison. It leaves locked D5 protocols
and the active Heartwood session unchanged.

The original [dependency snapshot helper](DEPENDENCY-SNAPSHOTS.md) is now
available for explicitly selected Heartwood ecosystem manifests. Its local
capture distinguishes locked package artifacts from source paths and checks
worktree/tooling freshness. Use it on the next real task; monetary savings and
release provenance remain open.

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
| Flash | `deepseek-v4.1-flash:cloud` | `think=false` | Default worker for useful extraction, summaries, coding, debugging and tests |
| GLM | `glm-5.3-flash:cloud` | `low`, subject to runtime verification | Candidate alternative for bounded coding/tests and visual work; qualify on a useful task before wider use |
| Pro | `deepseek-v4-pro:cloud` | `think=false` initially; validate supported thinking before increasing | Difficult implementation after a bounded Flash failure; only on a reconciled, eligible endpoint |
| Luna | `gpt-5.6-luna` | `medium` | Small Codex maintenance/check packets if the local route is unavailable or unsuitable |
| Terra | `gpt-5.6-terra` | `medium` | Contained integration review or implementation fallback where cheaper workers fail |
| Sol | `gpt-5.6-sol` | `high` | Trust boundaries, consequential design, difficult lifecycle review and measurement decisions |

Operator decision, 21 September 2026: remove Qwen from the default workflow.
Use DeepSeek Flash first, evaluate GLM on useful bounded work, and retain
qualified frontier models for difficult design, consequential review and tasks
where they reduce total completion cost. This project policy supersedes the
worker skill's older Qwen assignments. The objective is frontier-quality
development at lower total cost per accepted result, including host preparation,
repairs, review and escalation. Deterministic extraction needs no model. Cloud
and subscription usage must be recorded on their actual charging basis.

Allow one focused repair after a terminal inadequate draft, then resize the
packet or escalate with the compiler/test evidence. A timeout or unknown outcome
requires reconciliation before replay. Do not silently switch providers after
a refusal or spending hold. Use Pro only after checking current endpoint state;
the original planning review did not qualify provider availability. A later
[recovery check](DOGFOOD-EXECUTION.md#worker-availability-recovery) accepted live
Qwen and Flash tasks through the M4 tunnel with thinking off. Use that explicitly
verified endpoint for daily work; Pro's separate unresolved jobs are unaffected.

Codex effort names and Ollama thinking flags are separate controls. Official
model references confirm the proposed Codex effort levels for
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) and
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol).
The previously qualified Flash route is recorded in the recovery evidence above.
GLM is a candidate assignment, not a newly accepted lane or a demonstrated saving.
The assignments are our task-fit choices, not vendor guarantees or price quotes.
Reserve Astra/high for a specific unresolved decision after Sol review; no goal
needs max/ultra by default. Selecting a model in this document does not change
the model powering an already-running session.

## Ordered goals

| Goal | Priority / dependency | Implementation model and effort | Review model and effort | Done when |
| --- | --- | --- | --- | --- |
| **D0 — Make the existing pilot reproducible** | Now | Deterministic evidence collection; Flash / thinking off for synthesis or repair | Terra / medium; Sol / high for a discovered boundary defect | Freshness work has a named reviewed commit, matching CI and a repeatable local launch |
| **D1 — Use it on everyday Context tasks** | Start now; close after D0 | Flash / thinking off for the short runbook; deterministic MCP setup | Terra / medium | Three normal tasks across two fresh client sessions finish with source-backed accepted outcomes and receipts |
| **D2 — Control what each repository exposes** | Before expanding roots; depends on D0 | Flash / thinking off | Sol / high for exclusion and root-boundary contract | Configured exclusions and Git ignore behaviour are tested, visible and shared by refresh/freshness inspection |
| **D3 — Extend the pilot to KithMoot and Oathrun** | After D1–D2 | Deterministic inventory; Flash / thinking off for reusable setup | Terra / medium; Sol / high for cross-project authority | Two additional explicit roots work in isolated sessions, each with one accepted real task and a tested disable path |
| **D4 — Feed small, sufficient packets to cheaper workers** | After D1; use only qualified roots | Flash / thinking off for coding and useful packet summaries | Terra / medium | Two ordinary coding tasks complete using retrieved source packets, with all repairs and host work recorded |
| **D5 — Prove useful whole-task savings** | Instrument from D1; compare after D4 | Flash / thinking off for receipt/report tooling; deterministic extraction | Sol / high for experiment design and acceptance | Eight paired tasks meet the predeclared quality and cost decision rule below |
| **D6 — Connect the normal ForgeSworn consumer workflow** | After D3–D4 and relevant consumer gates | Flash / thinking off; Pro / thinking off only for a bounded harder packet | Sol / high | An authorised Oathrun/KithMoot task retrieves scoped Context evidence, returns a cited result, and survives the required lifecycle checks |
| **D7 — Make installation and release dependable** | After D0–D2; public release also needs G0–G4 | Flash / thinking off for packaging and docs | Terra / medium for packaging; Sol / high for unresolved release boundaries | Another isolated environment runs the pinned pilot; later, published exact versions pass registry smoke and consumer compatibility |

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

At planning time the bridge used fixed directory and extension exclusions and
did not honour `.gitignore`. Define project-local include/exclude
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
Do not mistake a navigation pointer or model summary for sufficient source.

Scanning and excerpt assembly stay deterministic where possible. The host
reviews the packet's sufficiency once, sends ordinary implementation to Flash,
then returns precise test failures for at most one focused repair. Store the
accepted diff, checks and compact handoff rather than repeatedly sending the
whole conversation. Keep routing, execution and disclosure policy in the
consumer/worker layer; do not introduce a provider dependency into Core.

### D5: Measure cost per accepted outcome

Use the developer-only [whole-task cost report](TASK-COST-REPORT.md) to validate
declared controls and retain incomplete accounting explicitly. Its unlocked
template is preparation, not an executed or accepted eight-pair trial.
The concrete [Context/KithMoot experiment pack](D5-RESULTS.md)
is summarised publicly; the machine-specific definitions and checks remain private. Its protocol lock and
actual trial results remain separate evidence; Heartwood's ongoing session is
ordinary dogfooding outside that comparison.

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
location and remaining limits. Current statuses are in the
[execution ledger](DOGFOOD-EXECUTION.md); working components alone do not imply
that their full adoption gates are complete.
