# Reducing cost per accepted task

Working plan, 21 September 2026. This extends D4/D5 in
[the dogfood goals](FORGESWORN-DOGFOOD-GOALS.md); it does not replace or amend
any locked experiment. Heartwood's active session remains independent.

Scope clarified 22 September: follow the [general product direction](../PRODUCT_DIRECTION.md).
Prioritise accepted daily work and a portable developer workflow before the
optional three-way competitive study below. Oathrun integration and cheaper-model
routing are separate from qualifying Context retrieval on a fixed frontier model.

The [Heartwood ecosystem pilot](HEARTWOOD-ECOSYSTEM-PILOT.md) now provides an
original offline catalogue and focused protocol map. Operator direction is to
build our own approach, without integrating or copying Graphify code. Its
version-resolution gaps define the next ecosystem implementation slice; this
prototype does not close the accepted-task savings gate or change locked trials.

## What the latest trace tells us

The [v3 qualification](D5-RESULTS.md) compared ordinary
tools with Context, not Graphify. Baseline was accepted; assisted was rejected.
Re-reading its retained events gives the following diagnostic, without running
another model:

| Measure | Baseline | Context-assisted |
| --- | ---: | ---: |
| Executor navigation searches | 0 | 22 |
| Executor MCP text bytes, including status/refresh | 0 | 87,717 |
| Navigation locations returned / distinct locations | 0 / 0 | 330 / 256 |
| Executor command-output bytes | 155,402 | 63,917 |
| Reviewer command calls | 4 | 12 |
| Reviewer command-output bytes | 89,926 | 137,083 |
| Executor + reviewer input tokens | 664,134 | 705,141 |
| Cached input subset | 570,240 | 590,848 |
| Input less reported cached subset | 93,894 | 114,293 |
| Output tokens | 7,538 | 8,438 |

Bytes count captured UTF-8 text, not wire framing or tokens. Command output
includes checks and diagnostics as well as source. Distinct navigation locations
use `(path, line, source hash)`; 74 returned hits repeated a previous location.
The cached subset is already included in input. Provider billing, host usage
and account-wide cache state remain unknown.

The assisted answer saw relevant source but still conflated source freshness
with policy freshness and overgeneralised failed refresh behaviour. More source
alone is not a demonstrated cure. The first improvement should reduce repeated
discovery while keeping complete selected branches and their tests together.
Acceptance must still reject incorrect synthesis.

## Ordered work and model assignments

| Goal | Work | Execution | Review / acceptance |
| --- | --- | --- | --- |
| S1: Assemble useful evidence once | Resolve explicitly selected source anchors to complete code blocks; merge duplicate ranges; preserve exact source and freshness verification | Deterministic TypeScript parser; Flash, thinking off, for implementation | Sol/high for selection boundaries; fixtures for branches, tests, exclusions, limits and stale packets |
| S2: Qualify the handoff | Give a worker the packet and require each behavioural claim to cite implementation and a relevant test, including exceptions; flag missing evidence | Deterministic extraction where possible; Flash/thinking off for synthesis and routine work | Independent review; include all host selection, repairs and review costs; do not restrict reviewer evidence access |
| S3: Reuse only current evidence | Reuse a verified packet within its existing root/source/policy/HEAD contract; measure repeat-use benefit before adding persistent or incremental caches | Deterministic verification first; Flash/thinking off if additional tooling is justified | Sol/high for invalidation and isolation changes |
| S4: Compare three retrieval workflows | Efficient ordinary tools, pinned Graphify and Context on identical tasks, revisions, models and acceptance criteria | Deterministic receipts; Flash/thinking off for adapters | Sol/high prospectively reviews and locks the new protocol |
| S5: Measure cheaper-model routing separately | After retrieval qualification, change worker models while retaining task quality requirements | Flash/thinking off versus GLM/low on qualified task types; eligible Pro for harder work | Qualified independent review; failures and escalations included |

Luna/medium is the fallback for small Codex packets; Terra/medium for contained
implementation when the eligible cheaper route is unavailable or inadequate.
These assignments do not change the active host model. No max effort is required
by this plan. Unknown or refused provider calls are reconciled under the existing
worker policy, never silently retried or routed around.

## Current routing decision

Operator decision, 21 September 2026: Qwen is outside the default workflow.
The objective is frontier-quality development at lower total cost per accepted
result. DeepSeek Flash is the default worker; GLM/low is a candidate alternative
to qualify on useful bounded work. Eligible DeepSeek Pro can handle harder
implementation. Frontier models retain difficult design, consequential review
and work where they achieve the quality bar more economically overall.
Use deterministic tools for extraction when they suffice. Count host preparation,
failed drafts, repairs and review; free tokens are not an acceptance criterion.

The next S2 handoff uses Flash with thinking off. Qualifying a GLM task does not
establish a cost advantage. Keep retrieval comparisons on fixed model settings,
then measure routing separately. These are project instructions, not automatic
model switching or a change to the active Codex session.

## First three-way run, 22 September 2026

S4 has now run once under a locked protocol with headless Claude Code and
Sonnet 5: [results](experiments/graphify-20260922/RESULTS.md). Context matched
plain tools on acceptance (four of eight) but used 13.9 percent more executor
input; Graphify used 19.4 percent less input than plain tools with two accepted.
The rule below was not met. The measured cause was search page volume.

The same day, after adding `repository_explore` (one call for a symbol's
declaration, references, importers and tests), compact text search and packet
rendering and `pathPrefix`, the protocol was rerun as
[v2](experiments/graphify-20260922-v2/RESULTS.md) with only the Context arm
changed. Context accepted five of eight (plain three, Graphify four) with the
lowest executor input: 3.62M against 3.88M and 4.55M, or 44.1 and 36.3 percent
less per accepted task. The rule is still not met: three Context rejections,
all rubric omissions, and reviewer time 9.8 percent above plain. The margin
over Graphify rests on one task where Graphify spent 2.0M. Next: raise
acceptance on the orientation and impact tasks, which need complete synthesis
from evidence the tool already returns, and reduce per-session uncached input
(tool schemas and instruction appendix) before a third run.

The S5 routing measurement ran the same evening:
[the v2 protocol with every executor on DeepSeek V4 Pro](experiments/graphify-20260922-s5-deepseek/RESULTS.md)
through the local Ollama daemon, reviewers unchanged on Sonnet 5. Each arm
accepted three of eight. Context used 52.3 percent less executor input than
plain tools and 1.3 percent more than Graphify, per accepted task and in
total, with reviewer time 29.8 percent above plain; the rule is not met on
the cheaper executor either. The margin over plain tools widened from v2 and
the margin over Graphify disappeared; one task dominated every arm. The
cheaper executor accepted nine of twenty-four against Sonnet's twelve with
the same reviewer, used 2.5 times the output tokens in extended thinking and
took 116 minutes against 66. Credit consumption was not read; no saving is
claimed. Routing decisions stay on the accepted-result basis above.

A single-arm screen followed:
[v2 with `repository_coverage` added to the Context arm](experiments/graphify-20260922-v3-coverage/RESULTS.md),
a deterministic pre-submit check listing explored files a draft leaves
uncited. Context accepted three of eight against five in v2 and used 2.9
times the executor input, so the screen failed and no three-way run follows.
None of the rejections traces to the tool, and input rose as much on a task
with no coverage call, so run-to-run variance exceeded the effect being
screened. Further comparisons need repeated runs per task. The same work
replaced presence-only retrieval ranking in `@forgesworn/context` with BM25
plus a source-label bonus, after the token gate proved sensitive to unrelated
files; the gate now passes at 36.5x with full evidence recall.

## Proposed competitive decision rule

Before any three-way trial, pin Graphify's revision/configuration, define tasks
and acceptance checks, and qualify all three installations. Use the same source
scope and fair retrieval budgets; Graphify gets its documented normal workflow.
Same scope means the same root, revision and exclusions. Fair budgets mean the
same overall model, context and time ceiling, not identical retrieved-byte or
tool-call quotas. Prospectively lock the Context anchor-selection procedure,
selection model/tools and budget. Count all selection work and keep it isolated
from other arms' queries, packets, answers and acceptance ground truth. Give
every arm the same public task and acceptance instructions; keep private grading
evidence out of executor selection. Counterbalance arm order and prohibit
cross-arm reuse of packets or queries.
Do not use whole-repository prompt stuffing as the baseline. Keep cold setup and
repeat-use measurements separate, with a predeclared amortisation horizon.

Target at least 20% lower aggregate attributable variable inference cost per
accepted outcome than **each** comparator, all scheduled Context tasks accepted,
no material quality regression and no increased aggregate review time. Include
failed attempts in costs. Report per-task results, elapsed time and human review
time separately. This is an operational pilot, not a universal performance claim.

Count packet selection and assembly, scans, refreshes, host inference, workers,
repairs, review and escalation. Separate observed billing, rate-based estimates,
fixed subscription headroom and local compute. Missing billing leaves the monetary
gate open. A zero-cost comparator needs an absolute-cost/quality comparison; it
cannot support a percentage saving.

Keep cumulative development and evaluation spend visible separately. Once there
is an observed per-task saving, report the number of accepted tasks needed to
recover that investment; do not assume ongoing savings repay development costs.

Use new prospective protocol files; v1/v2/v3 stay immutable. The existing D5
reporter supports paired baseline/assisted arms and must not be presented as a
three-way reporter without an explicitly validated extension or separate
comparison procedure. Lock model settings and order before execution; change
routing only in a later experiment so retrieval and model-choice effects remain
separable.

Graphify's published results are context for evaluation, not our baseline
measurement: [official repository](https://github.com/Graphify-Labs/graphify),
[published benchmarks](https://github.com/Graphify-Labs/graphify/blob/v8/BENCHMARKS.md).
Matching its older navigation-compression headline is not the acceptance gate.

## What to defer

Add batch search, broader parsing, persistent caches or graph visualisation only
when task receipts show they improve accepted work. Start with the existing
packet helper. A complete syntax block is not a dependency closure: callers,
imports, fixtures and external contracts still need explicit selection. Never
claim that deterministic assembly proves semantic sufficiency or saves money.

## First local implementation

`worker-packet.mjs plan` resolves explicit TS/JS line anchors into complete
syntax blocks and emits a standard v1 packet plus unsigned coverage metadata.
It preserves existing `build`/`verify` behaviour and their 64 KiB packet bound.
See [the packet workflow](WORKER-PACKETS.md) for use and limitations.

A retrospective freshness fixture selected three implementation methods and
six focused tests, including stale/unknown source, stale/unknown policy and
failed/cancelled refresh. Eleven anchors resolved to nine ranges and 471 unique
lines. The entire packet is 33,879 bytes and 8,565 offline `o200k_base` tokens.
Its exact source ranges, excerpts and hashes match a manually checked reference;
the existing verifier accepts it and its coverage digest matches the file.

This fixture was selected after seeing v3's failure. It is a local assembly check,
not an unbiased comparison, a complete dependency closure, an accepted model
answer, or a monetary saving. No new experimental model arm has run. The reference
needed a host correction to include one closing test line; comparing whole
packets also required normalising the reference's original-spec range order.
Both corrections remain recorded in private evidence.

Evidence: `~/.cache/z1p-delivery/20260921-packet-savings-sd3d6paw`, containing the
trace aggregate, worker dispatch receipt, source packets, coverage, reference
and assembly result. Flash/thinking-off dispatch on the M4 was rejected as busy
before inference; Terra/medium implemented the fallback packet and Sol/high
reviewed the design and boundaries. Host preparation, draft corrections and
review are development overhead, with unknown attributable usage and billing.

The [maintained dependency snapshot slice](DEPENDENCY-SNAPSHOTS.md) now provides
explicit selected-worktree capture, bounded dependency queries and verification
of source/tooling identity. Its first Heartwood capture exercises a published npm
lock and a cross-repository Cargo path. Both Flash resolver drafts needed host
replacement, so this acceptance is useful correctness evidence, not proof of
cost savings. See the [execution ledger](DOGFOOD-EXECUTION.md) for failed drafts,
review and usage. Next use the result in a complete accepted Heartwood task.
