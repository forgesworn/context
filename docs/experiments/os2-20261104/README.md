# OS2 protocol draft: Codex Sol/high, Context 0.26.0

Status: **draft for owner review, not locked, nothing run.** The draft protocol
is in [`protocol.draft.json`](protocol.draft.json). It has no `lockedAt` and no
hashes. It is locked only after the owner approves it and an independent
reviewer accepts it, and before any arm runs. Each paid step below needs its
own approval; approving this draft approves none of them.

## What this decides

OS2 asks whether Context gives better developer results at lower complete
model cost than a competent ordinary workflow, with the same frontier model on
both sides ([OS2 row](../../OPEN-SOURCE-EXECUTION.md),
[acceptance contract](../../DETERMINISTIC-CODE-INTELLIGENCE.md#acceptance-better-outcomes-and-lower-complete-cost)).
It passes only if Context:

1. has every outcome accepted,
2. improves one prospectively named quality measure, and
3. uses at least 20% fewer total model tokens, with no more total review time.

Lower tokens alone cannot pass.

## What earlier runs showed, and what this plan does about it

No comparison has run since the 0.4.0 screen on 23 September, which already
included explore and coverage. The 29 release tags since then added, among
other things:

- the encrypted shared workspace cache (from 0.7.0);
- the repository graph (from 0.11.0);
- the policy scope notice (0.24.0);
- web, Svelte and shell sources (0.25.0 and 0.26.0).

None of these has been measured against a baseline. The earlier record names
four causes that this plan addresses before anything is paid for.

| Observed | Source | Response here |
| --- | --- | --- |
| The assisted answer was rejected for synthesis errors (freshness branches), not missing evidence | [v3 result](../d5-20260921-v3/RESULTS.md) | The quality gate is measured by checker and scope, not prose rubric fit (see Quality gate) |
| Every arm usually retrieved all required evidence; three quarters of full-recall answers were still rejected, so retrieval could only show up as cost | [recall analysis](../retrieval-recall-20260923/RESULTS.md) | Task classes are weighted to impact and code changes, where missed or incorrect dependencies are checkable |
| The tools added turns instead of replacing reads: diagnosis-context reached 4.4M input with 10 to 14 packets plus up to 24 direct reads | [0.4.0 screen](../screen-pro-040-20260923/RESULTS.md) | Phase 0 defines a reads-after-packet metric with a threshold; qualification fails if the threshold is exceeded |
| A single run per task cannot separate a tool change from run-to-run variance | [repeated-run design](../REPEATED-RUNS.md) | Three repetitions per task and arm, with rotating order |

The executor-only saving disappeared once reviewer usage was counted in both
v1 and v3. The cost measure here therefore counts executor, reviewer, setup,
repairs and failed attempts.

## Build under test

Context 0.26.0, commit `8cbb6163f3903c248899442278a673e8aacf20de`, installed
from the public release assets:

- `forgesworn-context-0.26.0.tgz`
  sha256 `b03731611e5e07155efa4f176207e8737452cb3c841a5d86d95d54112181acbd`
- `forgesworn-context-tools-0.26.0.tgz`
  sha256 `234e5470950755bc11550ed789dde3eb4b6b4eb68d3629ad109b188592b6197e`

If phase 0 exposes a tool defect, the fix ships as its own release and PR. The
draft is then repinned before lock. Fixes are never made inside the experiment.

## Task pack: same shape, new tasks

The acceptance contract says to "retain OS2's proposed eight tasks across two
repositories, one external". The shape is retained but not the files. The
eight locked tasks in [`d5-20260921/tasks`](../d5-20260921/tasks) cannot be
used, for two reasons:

- They are all on context and kithmoot, both ForgeSworn repositories.
- The 0.4.0 fixes were found on that set.

The new pack:

- Eight tasks: four on one ForgeSworn repository and four on one repository
  outside ForgeSworn, each pinned at a commit and frozen as an archive.
- Per repository: one orientation, one impact, one diagnosis and one code
  change. Impact and code-change tasks carry the quality measure.
- Each task has a public statement and a private acceptance file. The private
  file holds required evidence, the dependency set a correct answer or diff
  must touch, and the checker and scope rules.
- The rubrics and dependency sets are written and hashed by a session that has
  not designed Context tools, instructions or these prompts. That excludes the
  session that wrote this draft. Nobody on the tool side reads them before
  results are recorded.

Criteria for the external repository (the owner chooses it):

- public, with a permissive licence;
- TypeScript or JavaScript in most of the code, so syntax-aware `plan`
  packets are exercised; mixed-language coverage is a separate question;
- tests run offline with a pinned toolchain, so code changes can be checked
  deterministically;
- large enough that grep and read is not trivially sufficient, and small
  enough to freeze and prepare per arm.

## Executor, reviewer and harness

- Executor: Codex CLI, `gpt-5.6-sol`, reasoning effort `high`. Both arms run in
  separate fresh, ephemeral sessions. This is the Codex cohort; a Claude cohort
  is separate work with its own fixed model and effort.
- Reviewer: a fresh `gpt-5.6-sol`/high session with a read-only sandbox. It is
  blind to the arm and sees only the answer or diff, the checker result, the
  private rubric and the cited frozen source.
- Harness: [`d5-20260921-v3/run-pair.py`](../d5-20260921-v3/run-pair.py) is the
  base. It already uses `codex exec --json`, per-arm `CODEX_HOME`,
  `--sandbox workspace-write` for executors and `read-only` for reviewers. It
  needs repetitions, arm rotation and a third arm added, with tests, before
  lock.
- No recorded cell can be reused as a comparator. Every earlier cell used
  Luna/medium or DeepSeek V4 Pro, so all arms run fresh.
- The harness calls the Codex binary by absolute path with explicit flags. It
  never goes through a shell or inherits aliases, because this machine's shell
  aliases `codex` to `--dangerously-bypass-approvals-and-sandbox`.
- Codex is now 0.166.0, against 0.155.1 in September. Its version is pinned at
  lock, and the v2 read-only sandbox defect is rechecked with a
  write-capability probe before any arm.

## Arms

| Arm | Tools | Notes |
| --- | --- | --- |
| plain | Codex built-in shell, read and edit; no MCP | Retrieval instruction of similar length and force to the other arms |
| context | Same, plus the pinned 0.26.0 repository MCP server bound to the arm's prepared root | Fresh server per arm; refresh before the first packet |
| graphify (optional) | Same as plain, plus a graph prebuilt with `graphify update` (no model) from `graphifyy` 0.9.65 | Version from the September protocols; repin at lock if changed |

The OS2 row needs only the pair (plain against Context). The acceptance
contract also wants a Graphify comparison. With Graphify the run is
8 × 3 × 3 = 72 executor cells; without it, 8 × 2 × 3 = 48. Either way every
cell gets a reviewer session. Repetition r of task i uses arm order
(i + r - 1) mod n, as in the September repeated design. Results are never
pooled with v1, v2, S5, v3, the repeated Pro run or the 0.4.0 screen.

## Phases

### Phase 0: zero model (free)

1. **Packet sufficiency.** For each new task, a deterministic script checks
   whether a bounded Context packet built from the task's required evidence
   contains it all, and records the bytes. A task that Context cannot cover
   within budget is recorded as a known gap. It is not removed from the pack.
2. **Transcript metrics.** Built in [`metrics.mjs`](metrics.mjs), with
   fixture tests in [`metrics.test.mjs`](metrics.test.mjs) (run with
   `node --test`; the repository's CI does not run experiment tests). It reads
   one `codex exec --json` stream as the v3 runner records it:
   - *reads after packet*: distinct packet-covered files later read directly
     (`cat`, `nl`, `head`, `tail`, `sed -n` ranges, `awk` NR ranges) with a
     line range that overlaps one a packet already returned, divided by
     distinct packet-covered files. A command with no range counts as the
     whole file. Reads before the covering packet do not count;
   - *searches after packet* (`rg`, `grep`, `git grep`, `find`): reported
     separately and outside the threshold, because bounded search is what
     the plain arm is told to do;
   - *unclassified segments*: commands the classifier does not recognise,
     reported so its coverage is visible;
   - *tool error rate*: failed or declined tool calls and MCP `isError`
     results, divided by all tool results. A command that ran and exited
     non-zero (for example `rg` with no match) is counted as a non-zero
     exit, not a tool error.

   The field names were confirmed from the Codex 0.166.0 binary and the v3
   runner. They are checked against a real 0.166.0 stream from the write
   probe; nothing earlier is paid.

   The September executor streams are not at the recorded private path
   (`.cache/z1p-delivery` under the home directory). A search of the home
   directory and the M4 found only MCP log files. So the measure has not been
   shown to flag the known bad case: diagnosis-context, with 10 to 14 packets
   followed by up to 24 direct reads. Those streams were also Claude Code
   stream-json, not Codex. If the owner can locate them, a stream-json reader
   can be added to test against them. Otherwise the phase 1 pair is the first
   real measurement, and the 0.25 threshold stays proposed until then.
3. **Harness tests.** Cover rotation, the third arm, incomplete-usage
   handling and the no-alias rule, all with fixtures and no model.

### Phase 1: one-pair qualification (paid, needs approval)

One new impact or code-change task: plain against Context, one repetition,
plus a reviewer for each. It passes if:

- the Context outcome is accepted;
- reads after packet are at most 0.25 (proposed); and
- the Context tool error rate is at most 5% (proposed).

A failed qualification is recorded. Its observed cause is fixed and released
as its own change, and phase 1 runs again under a new draft revision.
Phase 2 is not run after a failure.

### Independent protocol review (paid, needs approval)

A fresh Sol/high session reviews the frozen protocol, harness diff and phase 1
receipts before phase 2 is locked. That review is itself a model session and
is counted as setup.

### Phase 2: full comparison (paid, needs separate approval)

Eight tasks, three repetitions, two or three arms, run as locked.

## Quality gate (choose one before lock)

The proposed primary measure is **missed or incorrect dependencies** on impact
and code-change tasks. These are counted against the hidden dependency set by
the checker and the scope check, not by a reviewer reading prose.

The alternative is **first-pass accepted changes**: the code-change checker
passes on the executor's first self-check.

The dependency count is independent of acceptance. An outcome can pass its
checker and review and still miss a dependency in the hidden set, for example
a caller left unchanged that no test exercises. The count is taken after
acceptance, from the hidden set, which is never shown to the executor or the
reviewer.

Context passes on quality if:

- its per-task median count of missed or incorrect dependencies is lower than
  the comparator's on at least two tasks and higher on none; and
- no Context outcome is rejected.

If the baseline makes no misses on the pack, the claim is not made. A harder
task class, chosen and written before rerunning, replaces that class.

Structured answers still need blind reviewer acceptance to count as accepted.

## Cost gate

The proposal uses one statistic: the **sum over tasks of per-task median total
tokens**. Total means executor plus reviewer input and output, including:

- cached input;
- host setup;
- repairs;
- failed attempts.

Context must be at least 20% below each comparator, with no higher sum of
per-task median reviewer seconds. The geometric-mean ratio with a 90%
bootstrap interval, as used in the 0.4.0 screen, is reported but does not
decide.

Cached input, uncached input, output and the reasoning subset are reported
separately and never added twice. Usage comes from the Codex `--json` event
stream, as in v3. A cell with missing usage is marked incomplete, never zero,
and an incomplete cell fails the cost gate for that task. The billing route
for Sol is not known, so cash savings stay unproven whatever the token result.

## Scale (not a price)

These volumes come from the record and give scale only; Sol/high will differ:

- The v3 single pair used about 1.37M input across executor and reviewer, at
  Luna/medium.
- The September repeated design estimated about 50M executor input on Sonnet
  5 for three arms, twelve tasks and three repetitions, before reviewers.

Phase 2 is of that order. Phase 1 is one pair. No prices were looked up.

## Decisions for the owner

1. Which repository outside ForgeSworn, and at which commit.
2. Two arms (plain and Context) or three (adding Graphify).
3. Who writes and hashes the hidden rubrics and dependency sets.
4. How Sol usage is billed (subscription allowance or metered), which decides
   whether any cash figure can be reported.
5. Approval, separately, for: the write-capability probe, phase 1, the
   protocol review and phase 2.

## Not claimed

This draft delivers no measurement, savings or quality result. It changes no
package code and does not reopen or alter any earlier protocol or result.
