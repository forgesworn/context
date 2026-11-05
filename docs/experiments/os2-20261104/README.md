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

- Eight tasks: four on [forgesworn/bray](https://github.com/forgesworn/bray)
  and four on [h3js/h3](https://github.com/h3js/h3), outside ForgeSworn. Each
  task is pinned at its own commit and frozen as an archive.
- Per repository: one orientation, one impact, one diagnosis and one code
  change. Impact and code-change tasks carry the quality measure.
- Each task has a public statement and a private acceptance file. The private
  file holds required evidence, the dependency set a correct answer or diff
  must touch, and the checker and scope rules.
- Nobody on the tool side reads the private files before results are
  recorded. The owner designed Context, so the owner does not write them
  either.

Where the tasks come from:

- **Impact and code-change tasks are taken from merged history.** Each one
  redoes a real merged change from its parent commit. That change's diff gives
  the dependency set, and the tests it added give the checker. This keeps the
  hidden sets objective. [`history-candidates.mjs`](history-candidates.mjs)
  lists eligible changes into a private file and prints counts only. The pool
  itself is not secret: the script and history are public, so anyone can
  rebuild it. What stays hidden from the tool side is which candidates the
  blind author picks, and their private acceptance files. Since 2025-01-01:

  | Repository | Head checked | First-parent changes | Eligible | Since 2026-07-01 |
  | --- | --- | --- | --- | --- |
  | bray | `8d6713d8` (2026-11-02) | 512 | 79 | 14 |
  | h3 | `f0e17808` (2026-10-22) | 732 | 99 | 43 |

  The most recent eligible changes are preferred, because the model is less
  likely to have seen them.
- **Orientation and diagnosis tasks, and the vetting of mined tasks,** are
  done by a fresh Claude session that has not seen the Context docs, tools or
  these prompts. Using a different model family from the Sol executor avoids
  shared blind spots. On this machine every Claude session loads the Context
  skill from the global instructions at startup, so that session must be
  started where those instructions are not loaded. It uses model tokens and
  needs its own approval.

Why these repositories:

- bray: about 70,000 lines of TypeScript and 119 test files, the largest
  ForgeSworn TypeScript repository checked. context (the tool's own
  repository) and kithmoot (where the 0.4.0 fixes were found) are excluded.
- h3: MIT, almost entirely TypeScript, vitest, about 5,500 stars. Version 2
  is a recent rewrite, so the model is less likely to answer from memory than
  with a more famous repository.
- Both are MIT and use vitest. Their tests pass with outbound network denied
  on the M4 (macOS `sandbox-exec`; the profile was first checked to block an
  outbound HTTPS request and allow loopback):

  | Repository | Install | Test command | Result |
  | --- | --- | --- | --- |
  | bray `8d6713d8` | `npm ci && npm run build` | `vitest run` | 119 files, 1,852 tests passed |
  | h3 `f0e17808` | `pnpm install --frozen-lockfile` (pnpm 12.3.4, pinned by `packageManager`) | `vitest --run` | 72 files passed, 1 skipped; 3,112 tests passed, 69 skipped |

  bray's test files mention relay URLs and WebSocket (63 and 8 files), so the
  passing run, not the absence of references, is the evidence. h3's own
  `test` script also runs lint and a typecheck; the checker runs vitest only.
  This shows no network references are needed at those commits. Each task's
  own commit is checked again when it is frozen.

## Task pack as authored (2026-11-04)

The public statements are in [`tasks/`](tasks), with hashes in
[`tasks/manifest.json`](tasks/manifest.json). The acceptance files are kept
private and are unread by the tool side; their hashes are in the protocol.

| Task | Class | Base commit | Base date |
| --- | --- | --- | --- |
| bray-orientation | orientation | `8d6713d8` | 2026-11-02 |
| bray-impact | impact | `f49cada6` | 2026-09-03 |
| bray-diagnosis | diagnosis | `264acc6f` | 2026-10-29 |
| bray-code-change | code-change | `0cac309e` | 2026-07-28 |
| h3-orientation | orientation | `f0e17808` | 2026-10-22 |
| h3-impact | impact | `2a164f36` | 2026-07-02 |
| h3-diagnosis | diagnosis | `ae4d6ee0` | 2026-07-22 |
| h3-code-change | code-change | `3eb3a57f` | 2026-07-09 |

The author examined and rejected eight other candidates.

How the author session ran:

- Claude Code headless, Opus 5.5, on the owner's plan. 70 turns, 626 seconds;
  about 8.1M cached input read, 0.2M cache writes and 50,000 output tokens
  (about $4.26 at API rates; not billed as cash).
- Isolation:
  - `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`, auto-memory off, project settings
    only, skills off, no MCP servers, and web and agent tools disallowed;
  - the shell sandboxed through `--settings` to deny every outbound domain
    and any write outside its folder;
  - git remotes removed from its repository copies.
- Checks:
  - a test session reported no user or project instructions;
  - the brief's first step confirmed that outbound HTTPS was refused and a
    write outside the folder was refused.
- Before that:
  - two Opus attempts stopped at that first step because the network was
    still open: Claude Code ignores a project settings file in an untrusted
    folder;
  - three one-turn Haiku probes found the network setting that works.

Known issues, for the protocol review:

- **Partial leak.** Despite the brief, the author's final reply gave partial
  hints about the hidden answers for bray-impact and bray-diagnosis, and said
  the two h3 code tasks touch one shared source file. The tool side has seen
  those hints. The protocol review decides whether to replace those tasks.
- **Checkers not yet verified on clean installs.** The checkers were verified
  against each repository's current `node_modules`, not a clean install at
  each base commit. Freezing each task repeats the check from a clean
  install, run by a script that reports only pass or fail.
- **Orientation line ranges** were read by hand, so reviewers allow small
  offsets.

## Executor, reviewer and harness

- Executor: Codex CLI, `gpt-5.6-sol`, reasoning effort `high`. Both arms run in
  separate fresh, ephemeral sessions. This is the Codex cohort; a Claude cohort
  is separate work with its own fixed model and effort.
- Reviewer: a fresh `gpt-5.6-sol`/high session with a read-only sandbox. It is
  blind to the arm and sees only the answer or diff, the checker result, the
  private rubric and the cited frozen source.
- Harness: [`harness.py`](harness.py), derived from
  [`d5-20260921-v3/run-pair.py`](../d5-20260921-v3/run-pair.py), which stays
  locked and unchanged. It keeps `codex exec --json`, per-arm `CODEX_HOME`,
  `--sandbox workspace-write` for executors and `read-only` for reviewers, and
  adds rotation, arms as data, one source for model and effort, and the seven
  0.26.0 retrieval tools for the Context arm. (v3 enabled only status, refresh
  and search, which would leave `repository_packet` unavailable and the
  reads-after-packet measure undefined.) It currently only plans cells; running
  them waits for the task pack.
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
| graphify (later round) | Same as plain, plus a graph prebuilt with `graphify update` (no model) from `graphifyy` 0.9.65 | Not in this run; see below |

This run uses two arms: 8 × 2 × 3 = 48 executor cells, each with a reviewer
session. The OS2 row needs only the pair. The acceptance contract also wants a
Graphify comparison, and in the September repeated run Context used 1.31 times
Graphify's input tokens, so it is a serious comparator. It runs as a separate
later round, with its own approval, only if the pair passes. The harness
already supports a third arm. Repetition r of task i uses the arm list
rotated left by (i + r - 1) mod n, as in the September repeated design.
Results are never pooled with v1, v2, S5, v3, the repeated Pro run or the
0.4.0 screen.

## Phases

### Phase 0: zero model (free)

1. **Packet sufficiency and freeze (done, blind).**
   [`blind-check.mjs`](blind-check.mjs) reads the private acceptance files
   and prints only counts and pass/fail. It has 4 tests, including that its
   output never contains paths, symbols or commands. Results are in
   [`phase0-blind-checks.json`](phase0-blind-checks.json):
   - *Packets* (Context 0.26.0 `connect`, one build packet per task,
     64 KiB budget): all 8 tasks' required evidence fits in one packet:
     1 to 13 ranges, 4,211 to 36,131 bytes in JSON form. No task is a
     known gap.
   - *Freeze* (M4, clean install at each base commit, tests with outbound
     network denied):
     - all 8 base archives are hashed into the protocol;
     - for all 4 code-change and diagnosis tasks, the checker fails at base
       with the change's tests applied and passes with the change, and no
       reinstall was needed;
     - every required evidence range is valid at its base commit.
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
   runner, then on the real write-probe stream (see Write probe below).

   The September executor streams are not at the recorded private path
   (`.cache/z1p-delivery` under the home directory). A search of the home
   directory and the M4 found only MCP log files. So the measure has not been
   shown to flag the known bad case: diagnosis-context, with 10 to 14 packets
   followed by up to 24 direct reads. Those streams were also Claude Code
   stream-json, not Codex. If the owner can locate them, a stream-json reader
   can be added to test against them. Otherwise the phase 1 pair is the first
   real measurement, and the 0.25 threshold stays proposed until then.
3. **Harness tests.** Built in [`harness.test.py`](harness.test.py) (run
   with `python3 harness.test.py`), 25 tests. The execution path has four
   stages:
   - `prepare`: templates from the hashed archives;
   - `plan`: opaque `cell-NNN` names, so the reviewer cannot read the arm
     from its path;
   - `execute`: every executor cell. It refuses to start while any
     `--forbid` path exists, because Codex's sandbox limits writes, not
     reads. So the acceptance files, the author's transcript and the blind
     workspace must be off the executing machine. Commands that reference
     paths outside the workspace are recorded for review.
   - `assess`, after all executors: the checker with the change's tests
     applied, the path-level dependency count, and the blind reviewer.

   The fake-Codex end-to-end tests cover the hidden-file refusal, the answer
   kept out of the recorded change, reviewer sources that escape the
   workspace, and a failed checker never being accepted. Six deliberate
   bugs in these safeguards were each caught. The earlier tests:
   - rotation for 48 and 72 cells, checked against the formula;
   - arm setup, including that only the Context arm gets the server, bound to
     its own workspace;
   - model and effort agreeing between config and command, and instructions
     of similar length;
   - the no-alias rule: commands are argument lists, start with the resolved
     absolute Codex binary, carry exactly one allowed sandbox, and reject
     bypass flags, `-s`, `-c` sandbox overrides, shells and strings;
   - usage that is incomplete, never zero, when missing or failed;
   - the cost gate, with medians, the 20% threshold, reviewer time,
     incomplete cells and each comparator;
   - a dry-run plan of 48 cells that never starts a fake Codex.

   Five deliberate bugs were each caught: the rotation formula, the
   threshold, incomplete-as-zero, a dropped bypass flag and a dropped
   `repository_packet`.

   Usage assumptions: cached input is within input, reasoning is within
   output, and cache writes are within input. Raw usage events are kept.

### Write probe (paid; run 2026-11-04, passed)

[`write-probe.py`](write-probe.py) ran two Sol/high sessions on a throwaway
40-line repository, with Codex 0.166.0 (binary sha256 `39acf979…a7db7c1`)
and the harness's own config and commands. Streams and the receipt are kept
privately under `.cache/z1p-delivery/os2-write-probe-20261104`.

| Session | Sandbox | Asked to | Result | Seconds | Input (cached) | Output (reasoning) |
| --- | --- | --- | --- | --- | --- | --- |
| Executor, Context arm config | `workspace-write` | status, refresh, packet `src/a.ts:1-20`, `cat src/a.ts`, write a file | File written; all three MCP calls completed | 32.0 | 86,960 (81,152) | 578 (200) |
| Reviewer config, no MCP | `read-only` | write a file with the shell | Refused: "operation not permitted"; no file | 38.6 | 41,856 (39,424) | 279 (67) |

What it confirmed:

- The v2 defect is absent: the executor can write, and the reviewer cannot.
- `metrics.mjs` reads the real stream: 1 packet, 1 covered file, the
  prescribed `cat` counted as a re-read (reads after packet 1.0, as
  instructed), 5 tool results, 0 tool errors, 0 unclassified segments.
  Commands arrive as `/bin/zsh -lc '<script>'`, which `innerScript` unwraps.
- Usage: one `turn.completed` per exec, aggregating every model call in the
  turn. Fields present: `input_tokens`, `cached_input_tokens`,
  `output_tokens`, `reasoning_output_tokens`, and an unexpected
  `cache_write_input_tokens` (0 in both). The harness reports it separately
  and flags any cell where it is non-zero; whether it is within
  `input_tokens` is settled before lock if it appears.
- Even a trivial session costs about 42,000 (reviewer) to 87,000 (Context
  executor) input tokens, mostly cached. This fixed overhead per session is
  part of every cell's total.
- Codex runs agent commands through the owner's login shell (`zsh -l`), the
  same in every arm.

### Phase 1: one-pair qualification (paid, needs approval)

One new impact or code-change task: plain against Context, one repetition,
plus a reviewer for each. It passes if:

- the Context outcome is accepted;
- reads after packet are at most 0.25 (proposed); and
- the Context tool error rate is at most 5% (proposed).

A failed qualification is recorded. Its observed cause is fixed and released
as its own change, and phase 1 runs again under a new draft revision.
Phase 2 is not run after a failure.

#### Attempt 1 (2026-11-04): invalid, runner defect

h3-code-change on this Mac, Codex 0.166.0, Context 0.26.0, Sol/high; Context
ran first (cell-001), then plain (cell-002). The blind workspace and the
author transcript were moved to the M4 while executors ran (tar hash matched
on both machines) and restored for assessment. Four sessions were spent.

**Defect.** Each cell is a copy of the template at a new path. pnpm 11 treats
the copy as stale and reinstalls before every `pnpm <bin>`. Inside Codex's
workspace-write sandbox that reinstall cannot write the global store, fails
offline and purges `node_modules`. Neither executor could run tests (each
tried twice), the hidden checker exited 127 in both cells, and both reviewers
saw a failed checker and rejected. This is not a phase 1 result in either
direction.

Observations under the broken environment, not a comparison:

| | Context | Plain |
|---|---|---|
| Seconds | 398.5 | 288.7 |
| Total tokens | 2,125,752 | 924,423 |
| Uncached input | 70,596 | 43,789 |
| Output | 15,220 | 11,386 |
| Files changed | 5 | 4 |
| Hidden checker after relink (no reviewer) | passed | passed |
| Missed or incorrect dependencies | 0 | 0 |

The Context arm used 12 packets, with no reads after a packet and a tool error
rate of 2.3%.

**Fix.** The runner relinks every copy offline before any model starts, then
runs `pnpm vitest --version` under Codex's own sandbox (`codex sandbox`) and
refuses to start the executor if either fails. It records whether the tool
chain still works after the run, relinks the checker's copy, and can run the
checker alone (`assess --checker-only`, no reviewer). Without the relink the
probe fails under Codex's sandbox; with it, it passes. 28 harness tests.

**For the protocol review:**

- the outside-reference audit flagged glob patterns such as `*/vitest.mjs`
  (fixed);
- `/tmp` is exempt from that audit: cell-001 moved a stray `.pnpm-store` to
  `/private/tmp` unflagged (removed afterwards), and `/tmp` is shared by cells;
- the reviewer runs inside the cell directory, whose parent holds the
  executor's config and prompt, which name the arm. Both reviewers' audits
  showed no outside reads.

#### Attempt 2 (2026-11-05): passed

Same task, host and order. The blind workspace, the author transcript and
attempt 1's outputs were on the M4 while executors ran (hashes matched) and
were restored for assessment. Every copy was relinked (1.9 s) and probed under
Codex's sandbox (2.1 s) before the model started; both arms ran their tests,
and the tool chain still worked after each run. Four sessions were spent.

| | Context | Plain |
|---|---|---|
| Accepted (checker and reviewer) | yes | yes |
| Missed or incorrect dependencies | 0 | 0 |
| Executor seconds | 249.4 | 234.7 |
| Executor tokens | 1,211,829 | 927,795 |
| Uncached input | 54,059 | 42,279 |
| Output | 10,762 | 9,740 |
| Reviewer tokens | 96,619 | 67,611 |
| Reviewer seconds | 55.4 | 31.4 |
| Cell total tokens | 1,308,448 | 995,406 |

The Context arm used 3 packets, with no reads after a packet and no tool
errors, so the phase 1 pass conditions are met. No outside reads were flagged
in any of the four sessions.

One pair is not a gate test, but on this pair the Context cell used 1.31 times
the plain cell's tokens and its reviewer took longer. The cost gate needs at
most 0.80 times and no higher reviewer seconds. Attempt 1, in a broken
environment, pointed the same way (2.3 times).

### Independent protocol review (paid, needs approval)

A fresh Sol/high session reviews the frozen protocol, harness diff and phase 1
receipts before phase 2 is locked. That review is itself a model session and
is counted as setup.

### Phase 2: full comparison (paid, needs separate approval)

Eight tasks, three repetitions, two arms (48 executor and 48 reviewer sessions), run as locked.

## Quality gate

The primary measure is **missed or incorrect dependencies** on impact and
code-change tasks (owner decision, 2026-11-04). These are counted against the
hidden dependency set by the checker and the scope check, not by a reviewer
reading prose. Tasks taken from merged history give that set directly. First-pass
accepted changes is reported, but does not decide, because Context has no
clear reason to improve it.

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
stream, as in v3. A cell with missing usage is marked incomplete, never zero.
An incomplete cell in either compared arm fails the cost gate, since the
statistic cannot then be computed.

Codex on this machine reports "Logged in using ChatGPT", so Sol usage comes
from the plan allowance, not metered API billing. The result is reported as
token reduction and plan headroom, never as cash saved. A full Sol/high run
may meet the plan's rate limits.

## Scale (not a price)

These volumes come from the record and give scale only; Sol/high will differ:

- The v3 single pair used about 1.37M input across executor and reviewer, at
  Luna/medium.
- The September repeated design estimated about 50M executor input on Sonnet
  5 for three arms, twelve tasks and three repetitions, before reviewers.

Phase 2 is of that order. Phase 1 is one pair. No prices were looked up.

## Owner decisions (2026-11-04)

1. Repositories: bray (ForgeSworn) and h3 (outside), each task pinned at its
   own commit.
2. Two arms, plain and Context. Graphify is a later round, run only if the
   pair passes.
3. Hidden sets: impact and code-change tasks taken from merged history;
   orientation, diagnosis and vetting by a fresh Claude session without the
   Context docs or skill.
4. Billing: ChatGPT plan allowance; tokens and headroom, no cash claim.
5. Quality measure: missed or incorrect dependencies.

## Still needs separate approval, in this order

1. ~~The write-capability probe~~ (run and passed 2026-11-04).
2. ~~The blind task-author session~~ (run 2026-11-04; see Task pack as
   authored).
3. ~~Phase 1~~ (attempt 1 invalid on a runner defect; attempt 2 passed
   2026-11-05).
4. The protocol review and phase 2, only if phase 1 passes.

## Not claimed

This draft delivers no measurement, savings or quality result. It changes no
package code and does not reopen or alter any earlier protocol or result.
