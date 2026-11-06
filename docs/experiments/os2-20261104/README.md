# OS2 protocol draft v2: Codex Sol/high, Context 0.30.0

Status: **draft v2 for owner review, not locked.** Version 1 qualified in phase
1 and was then reviewed; the review said revise before phase 2. Version 2
(2026-11-05) applies the review's free changes. The protocol is in
[`protocol.draft.json`](protocol.draft.json). It has no `lockedAt`. It is
locked only after the owner approves it, the paid items under
[Still needs separate approval](#still-needs-separate-approval-in-this-order)
are done, and before any phase 2 cell. Each paid step needs its own approval;
approving this draft approves none of them. Sections below that record runs
(phase 0, phase 1, the review and the diagnostic pairs) describe version 1 as
it was run and are kept unchanged.

## Version 2 changes (2026-11-05)

What the [protocol review](protocol-review.md) asked for, and what changed:

| Review item | Version 2 |
| --- | --- |
| Executors and reviewers can read sibling cells, plans, hidden files and shared temp | Codex 0.166 permission profiles deny reads of the home directory, `/private/tmp` and per-user temp. Each session runs in a fresh root under `/Users/Shared` with its own temp and `HOME`, and a copied toolchain. Before any model starts, a probe under the same profile must fail to read a canary in the cell directory. The legacy `--sandbox` flag is never passed, because it overrides the profile. |
| Reviewer blinding defeated by its parent directory | The reviewer runs in its own staged root holding only its bundle, under a read-only profile with the same denies. |
| Usage assumptions A1-A4 unvalidated | Checked on every stream: cached within input, reasoning within output, one usage event per exec whose totals equal the per-call session log, zero cache writes, exit 0. Any failure makes the cell incomplete. |
| Harness gaps: manifest, setup, locked inputs, repetition counts, scope, frozen evidence, assess order | `plan` skips the manifest and records hashes of Codex, Node, the Context CLI, the toolchain, every task file, the harness and the metrics script; `execute` refuses on any change. Failed setup removes the template. Templates are rechecked against their record. The cost statistic requires exactly the planned repetitions. Scope is enforced from the acceptance file. The reviewer sees bounded excerpts of cited lines, resolved inside the workspace. `assess` waits for every executor. |
| Declared analysis not implemented | `analyse` computes the cost gate, a task-level bootstrap interval, the geometric mean and the quality guard into `analysis.json`. |
| Point estimate at 0.80 is not inferential | The cost gate needs the point ratio at most 0.80 **and** the upper end of its 90% task-bootstrap interval below 1.0. |
| Reviewer seconds too noisy to gate | Reported, not gated. |
| "Plan headroom" not measured | The primary outcome is renamed **reported processed tokens** (input plus output, cached input included). Uncached input, cached input and output are reported, with a frozen sensitivity set: uncached + output + w x cached for w = 0, 0.1 and 1. No plan-headroom claim. |
| Quality rule has a floor effect; "no Context rejection" is brittle | Quality guard: Context has no fewer accepted outcomes than the comparator, and on no impact or code-change task a higher median dependency count. "Better" (lower on two or more tasks) is reported. All-zero counts are inconclusive. Code changes are scored on files actually changed, not claimed; impact answers also report precision. |
| Arm order confounded with time | Blocks of (task, repetition) run in a seeded random order (seed 20261105). |
| Metrics fail open | `metrics.mjs` reports malformed lines, separates MCP and shell error rates, parses pipelines, `tail` and interpreter one-liners more strictly, and makes reads-after-packet invalid on malformed lines, packets without ranges, or an unclassified command that names a packet-covered file or could reach one indirectly (globs, variables, substitutions, loops, `xargs`). On the eight recorded cells the measure is valid in all eight. |
| Forced status and refresh calls | The Context instruction no longer asks for `repository_status` or a refresh. From 0.28.0, packet, explore, coverage and graph calls without a generation refresh a stale index themselves. |

### Live isolation probe (2026-11-05): passed

One `codex exec` session (Codex 0.166.0, `gpt-5.6-sol`, effort low) under the
version 2 executor profile, run by [`isolation-probe.py`](isolation-probe.py)
with the owner's approval. It was told to `cat` a canary file in a directory
inside the home, `cat` a file in its staged workspace and write one there.

- The canary read returned `Operation not permitted` (exit 1); the canary text
  never reached the model.
- The workspace read and the write both succeeded; nothing was written outside
  the staged root.
- Usage: 43,886 tokens (43,579 input, of which 32,000 cached; 307 output),
  complete under the A1-A4 checks; 20.8 seconds.

The first verdict was a fail, wrongly: the probe judged from the `--json`
event stream, and Codex 0.166 left the denied command out of that stream
entirely (the two commands that succeeded were there). The session log, which
records what the model was shown, has all three. The probe and the harness's
`deniedAccesses` count now read the session log, and the verdict was
recomputed from the recorded log with `--rejudge` (no second session). In the
recorded plain cells the stream and the session log list the same commands
(28 of 28 and 23 of 23), so ordinary commands are not lost; the gap applies to
commands the sandbox denies, which read metrics do not count as reads.

Still open, and not decided by this version:

- ~~Task replacement~~ (custodian run 2026-11-06; see Replacement tasks).
- **Quality measure (paid pilot).** Symbol and call-site recall and precision,
  and rules for alternative valid implementations, need a pilot on tasks
  outside phase 2.
- **Reviewer independence (paid).** Owner decision 2026-11-05: one reviewer
  from a different model family from the executor, plus a second blinded
  review on a sample of outcomes to measure agreement. The model, sample size
  and agreement threshold are set in the paid design step.
- ~~Live isolation check~~ (run 2026-11-05, passed; see below).
- **Loopback.** Owner decision 2026-11-05: allow loopback only. Executor
  profiles set `[permissions.os2.network] enabled = true, allow_local_binding =
  true` with no domain list, and `features.network_proxy = true`, so Codex's
  network proxy refuses every outside host. Checked with `codex sandbox` (no
  model): a localhost socket round trip worked; `curl https://example.com` got
  403 from the proxy; direct TCP to 1.1.1.1, the LAN gateway and the M4 failed;
  the home directory stayed unreadable. Without `network_proxy`, the same
  network section opened the internet, so the probe now checks both: before
  any model starts it exits 99 if an outside host is reachable and, for
  executors, 98 if loopback fails. Reviewers keep no network. Not yet checked:
  h3's own socket tests under this profile, and a `codex exec` session using it
  (requalification covers both).
- **Power.** Eight tasks give roughly 25% power for a true 0.80 ratio. Owner
  decision 2026-11-05: keep eight tasks and limit any result to this task pack.
  A failed gate is not evidence that Context gives no saving, and a pass is
  not a general claim.
- **Excluded costs.** Indexing, CPU, storage and tool development are outside
  the measured model cost; executor wall time and local preparation are
  reported separately.

## What this decides

OS2 asks whether Context gives better developer results at lower complete
model cost than a competent ordinary workflow, with the same frontier model on
both sides ([OS2 row](../../OPEN-SOURCE-EXECUTION.md),
[acceptance contract](../../DETERMINISTIC-CODE-INTELLIGENCE.md#acceptance-better-outcomes-and-lower-complete-cost)).
In version 2 it passes only if Context:

1. passes the quality guard against each comparator (no fewer accepted
   outcomes, and no impact or code-change task with more missed or incorrect
   dependencies), and
2. uses at least 20% fewer reported processed tokens, with the upper end of
   the 90% task-bootstrap interval below parity.

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

Context 0.30.0, commit `697f8d7c6d585bb76b5774d56cbd40a8ce13594b`, installed
from the public release assets:

- `forgesworn-context-0.30.0.tgz`
  sha256 `7f3de3539aab25fa08a8d97983174d1e2cd763d0111f5bde9ad0377b3072832c`
- `forgesworn-context-tools-0.30.0.tgz`
  sha256 `2e356cae75ecf1777abe2f81c9363ef7ad133b59e851b000f76fd337cfad30f6`

Version 1 ran 0.26.0 (`8cbb616`); the diagnostic pairs ran 0.27.0 and 0.28.0;
the first version 2 requalification ran 0.29.0 (`6cd0ce2`) and failed on the
MCP error gate. 0.30.0 is the fix for that failure: an oversized
`repository_packet` build serves every requested source that fits whole and
outlines the rest, as a successful result, instead of fetching nothing
(PR #74). It changes nothing else.

If a later phase exposes a tool defect, the fix ships as its own release and
PR, and the draft is repinned and requalified before lock. Fixes are never
made inside the experiment.

## Replacement tasks (2026-11-06)

bray-impact, bray-diagnosis, h3-diagnosis and h3-code-change were replaced,
keeping their ids and classes, and `h3-qualification` (code-change) was added
for requalification only, in [`tasks-qualification/`](tasks-qualification)
so that `plan` never schedules it. The retired entries stay in
`tasks/manifest.json` and the protocol as history.

| Task | Class | Base commit | Base date |
| --- | --- | --- | --- |
| bray-impact | impact | `754f1b75` | 2026-07-27 |
| bray-diagnosis | diagnosis | `4136501b` | 2026-09-24 |
| h3-diagnosis | diagnosis | `8f21c717` | 2026-10-03 |
| h3-code-change | code-change | `1ff4999e` | 2026-07-05 |
| h3-qualification | code-change | `07273db6` | 2026-09-02 |

How it ran:

- One custodian session, Claude Code headless, Opus 5.5, on the owner's
  plan: 54 turns, 628 seconds, about 3.7M cached input read, 0.13M cache
  writes and 41,000 output tokens (about $2.64 at API rates; not billed as
  cash). It examined and rejected 173 candidates.
- Isolation as the 4 Nov author. Step 0 confirmed outbound HTTPS refused
  (403) and a write outside its folder refused. It had the eight existing
  acceptance files so it could apply the overlap rules.
- Its reply had to be one fixed JSON shape (ids, classes, commits, hashes, an
  exclusions flag and a rejected count). A guard script checked the shape and
  printed nothing else; the reply was valid and every hash matched its file.
  Problems and reasons went only to its private manifest, which the tool side
  has not read.

Blind checks (counts only, in
[`phase0-blind-checks.json`](phase0-blind-checks.json)):

- [`exclusion-check.py`](exclusion-check.py): no reused merged change or
  base commit, no new path in any existing dependency set or kept task's
  required evidence, no dependency path shared between new tasks, and every
  scope in the v2 shape. Its first run flagged one overlap that was the same
  relative path in the other repository; the check now compares repository
  and path, with a test.
- Freeze on the M4 from clean installs, outbound network denied: all four
  checker tasks fail at base and pass with the change, with no reinstall.
- Packets with Context 0.29.0: every task's required evidence fits one
  packet (5 to 37 KB).

### Follow-up custodian (2026-11-06)

A second isolated session (same setup and reply guard; 35 turns, 293
seconds, about 2.3M cached input read and 24,000 output tokens, about $1.83
at API rates, plan-billed) did two hidden-side jobs:

- Converted the kept four acceptance files (bray-orientation,
  bray-code-change, h3-orientation, h3-impact) to
  `{"allowedPaths": [...]}`, keeping the old text in `scopeText`. A blind
  check confirmed the new scope is valid, `scopeText` equals the old scope,
  and no other field changed. Their new hashes are in the manifest and
  protocol.
- Reviewed the first custodian's ten listed problems. It edited no file. It
  recommends replacing bray-impact and bray-diagnosis again and judged their
  April 2026 base commits not acceptable. Its reasons are private and unread.

### Bray rewrite (2026-11-06)

The two bray tasks were written twice more, each time by an isolated session
with the same setup and reply guard, given every existing acceptance file and
the follow-up's reasons:

- Session 3 (47 turns, 485 seconds, about $2.39 at API rates, plan-billed)
  wrote both. bray-diagnosis met every exclusion and is kept. bray-impact was
  rejected: 2 of its 5 dependency files were in the retired bray-impact, whose
  answer had been partly hinted to the tool side, and 1 in the kept
  bray-code-change. The custodian disclosed the overlap.
- Session 4 (49 turns, 467 seconds, about $2.41) wrote bray-impact alone,
  with no overlap with the retired bray-impact as a rule it could not relax.
  It shares no path with the retired bray-impact or any current, retired or
  rejected bray-impact. It shares two with the first rejected bray-diagnosis,
  which never entered the pack.

Both have base commits after 1 July 2026. Checks: the freeze on the M4 (the
bray-diagnosis checker fails at base and passes with the change; bray-impact
evidence and dependency paths are valid at base), one 0.29.0 packet each, and
a final exclusion check of the five new tasks against the kept four and the
retired four, all clean. The table above shows the final base commits; the
rejected versions' hashes stay in `tasks/manifest.json`.

## Reviewer design, pilot and readiness (2026-11-06)

Owner decision 2026-11-05: one reviewer from a different model family, and a
second blinded review on a sample. Fixed before any requalification cell:

- **Primary reviewer:** Claude Code (`claude -p`), `claude-opus-5-5`, effort
  `high`, `--tools ""` (no tools; checked with one Haiku call that only the
  structured-output tool remains), `--json-schema` for the verdict, project
  settings only, CLAUDE.md and auto-memory off, an empty strict MCP config and
  `--no-session-persistence`. Its verdict decides `accepted`, with the checker
  and scope. Its usage is complete only for a successful result with integer
  usage fields; anything else is incomplete, never zero. The Claude binary and
  reviewer settings are in the plan's lock, and `assess` refuses a different
  binary.
- **Second reviewer:** the existing Codex reviewer path, unchanged, on every
  cell of a plan of 12 cells or fewer (so both requalification cells), and in
  phase 2 on 12 of 48 cells, 6 per arm, drawn with seed 20261105. Reported:
  raw agreement on `accepted` and on each rubric item. With fewer than 80%
  agreement on `accepted`, or any missing second review, the quality guard is
  reported as unreliable and the run does not pass. Kappa on 12 cells is noise,
  so only counts are reported.
- **Cost gate change:** gated tokens are executor tokens only. Reviewers are
  identical across arms and come from two tokenisers, so their sum would mean
  nothing; reviewer tokens are reported per family.
- **Provider failures:** a cell whose executor exited non-zero with no model
  output at all (no `turn.completed` and no completed item) may be rerun once
  with `execute --rerun-provider-failures`; the failed attempt is kept in
  `repair-1/`. A cell with any model output is never rerun.
- **Build outputs:** `site/tools-manifest.json`, which bray's own build
  rewrites, is left out of the recorded change like `answer.json`, so running
  the build is never a scope violation.
- **Toolchain:** the h3 tasks pin three pnpm versions (11.9.0 for h3-impact
  and h3-code-change, 11.22.0 for h3-qualification, 12.3.4 through
  `devEngines` for h3-orientation and h3-diagnosis). The copied toolchain
  carried only 11.9.0, so three of the five h3 tasks would have failed their
  offline relink; only h3-code-change had ever run. A new toolchain,
  `/Users/Shared/os2-toolchain-20261106`, carries all three, and the relink,
  checker and template install now use it too, rather than the host's pnpm.
- **Leak closed:** headless Claude sessions save transcripts under
  `~/.claude/projects` unless told not to. The 4 Nov author's and the four
  custodians' transcripts, which held hidden answers, were moved to the M4
  holding (hash checked) and deleted here. Every hidden-side launch now passes
  `--no-session-persistence`.

**Pilot** ([`pilot.py`](pilot.py), on the eight recorded cells of the retired
h3-code-change from attempt 2 and the three diagnostic pairs; 16 reviews):
both reviewers accepted all eight and agreed on all 40 rubric items. The
checker passed on all eight. Dependency recall was 1.0 on every cell with no
misses; precision was 0.6 to 0.75 (one or two extra changed files). Claude
reviews used 14,000 to 18,000 tokens and 15 to 34 seconds; Codex reviews
25,000 to 48,000 tokens. Limits: one task, every outcome accepted, so
agreement has only been seen on easy cases and the miss count was zero
everywhere.

**Readiness** ([`readiness.py`](readiness.py), model-free): all nine new
templates (prepared on this Mac with the new toolchain) staged as `execute`
would: the five h3 copies relink offline, all nine pass the isolation probe
with loopback, and all pass the readiness probe (bray's probe is new).
**Checker smoke** ([`checker-smoke.py`](checker-smoke.py), blind, booleans
only): on this Mac with the toolchain, all five checker tasks fail on the base
copy and pass with the merged change applied.

## Executor, reviewer and harness

- Executor: Codex CLI, `gpt-5.6-sol`, reasoning effort `high`. Both arms run in
  separate fresh sessions, each with its own `CODEX_HOME` (session logs kept for per-call accounting). This is the Codex cohort; a Claude cohort
  is separate work with its own fixed model and effort.
- Reviewer (from 2026-11-06, see Reviewer design): Claude Code headless,
  `claude-opus-5-5` at effort `high`, with no tools at all. The answer, diff
  (capped at 256 KiB, truncation recorded), checker result, private rubric and
  bounded excerpts of the cited lines are inlined in its prompt, so it can read
  nothing else. A second, blinded `gpt-5.6-sol`/high review under the
  read-only permission profile runs on a seeded sample, to measure agreement.
- Harness: [`harness.py`](harness.py), derived from
  [`d5-20260921-v3/run-pair.py`](../d5-20260921-v3/run-pair.py), which stays
  locked and unchanged. It keeps `codex exec --json` and per-arm `CODEX_HOME`.
  From version 2 it isolates every session with a permission profile instead
  of `--sandbox` (`:workspace` for executors, `:read-only` for reviewers, both
  denying the home directory and shared temp), and adds rotation, arms as data,
  one source for model and effort, and the seven retrieval tools for the
  Context arm. (v3 enabled only status, refresh and search, which would leave
  `repository_packet` unavailable and the reads-after-packet measure
  undefined.) Stages: `toolchain`, `plan`, `prepare`, `execute`, `assess`,
  `analyse`.
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
| context | Same, plus the pinned 0.30.0 repository MCP server bound to the arm's staged root | Fresh server per arm; the first call builds the index, and later calls without a generation refresh it when stale |
| graphify (later round) | Same as plain, plus a graph prebuilt with `graphify update` (no model) from `graphifyy` 0.9.65 | Not in this run; see below |

This run uses two arms: 8 × 2 × 3 = 48 executor cells, each with a reviewer
session. The OS2 row needs only the pair. The acceptance contract also wants a
Graphify comparison, and in the September repeated run Context used 1.31 times
Graphify's input tokens, so it is a serious comparator. It runs as a separate
later round, with its own approval, only if the pair passes. The harness
already supports a third arm. Repetition r of task i uses the arm list
rotated left by (i + r - 1) mod n, as in the September repeated design; from
version 2 the (task, repetition) blocks then run in a seeded random order.
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

Version 2 requalification uses a separate qualification task that phase 2
never uses, and also needs: reads after packet valid (no malformed lines and
no unclassified command that could reach a packet-covered file), the Context
MCP error rate (`mcpErrorRate`, MCP calls only) at most 5%, every isolation
probe passed and complete usage in both cells. For scale, the Context MCP
error rate was 4.3% in the 0.27.0 diagnostic pair and 15.4% in the 0.28.0
pair (4 of 26 calls: two searches rejected for passing `expectedGeneration`,
which search does not accept; one packet over 64 KiB; one packet naming a
missing file).

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
environment, pointed the same way (2.3 times). Of the 284,034-token executor
gap, 271,232 (95%) is cached input; uncached input differs by 11,780 and output
by 1,022. Both reviewers received near-identical material (5 cited files,
about 39 KB each), so that does not explain their time difference.

#### Requalification on version 2 (2026-11-06): failed on the MCP error gate

h3-qualification, plain against Context 0.29.0, one repetition, new toolchain,
Claude primary reviewer and Codex second reviewer on both cells.

| Gate | Result |
| --- | --- |
| Context accepted | yes (checker passed, scope passed, both reviewers accepted) |
| Reads after packet valid | yes (no malformed lines) |
| Reads after packet at most 0.25 | yes (0) |
| Context MCP error rate at most 5% | **no: 1 of 13 calls (7.7%)** |
| Every isolation probe passed | yes (relink, isolation with loopback, readiness, intact after run; Codex reviewer probes) |
| Usage complete in both cells | yes (executors and Claude reviews) |

The one MCP error: the agent's second call asked `repository_packet` for two
whole files (AGENTS.md, 254 lines, and a 437-line source file) with a 65,000
byte budget. The tool refused because the excerpts exceeded 64 KiB, fetched
nothing, and returned outlines with advice to request smaller ranges; the
agent did so and finished. This is the same class as one of the four errors
in the 0.28.0 pair.

Also recorded: plain was accepted too; both reviewers agreed on both cells;
executor tokens were 756,790 (Context) and 601,004 (plain), a single pair and
not a gate. Dependency recall was 1.0 in both cells (precision 0.33 and 0.5).
Claude reviews used 18,371 and 17,420 tokens; Codex reviews 53,180 and 37,682.
No outside references and no denied reads in either executor.

Under the protocol, phase 2 does not run after a failed requalification. The
observed cause is fixed in Context as its own release, then requalification
runs again under a new draft revision.

#### Requalification on version 2, revision r2 (2026-11-06): passed

Same task, settings, seed and order, on Context 0.30.0.

| Gate | Result |
| --- | --- |
| Context accepted | yes (checker, scope and both reviewers) |
| Reads after packet valid | yes |
| Reads after packet at most 0.25 | yes (0) |
| Context MCP error rate at most 5% | yes (0 of 18) |
| Every isolation probe passed | yes |
| Usage complete in both cells | yes |

Also recorded: plain was accepted; both reviewers agreed on both cells.
Executor tokens were 1,600,113 (Context, 326.9 s) and
1,070,517 (plain, 265.7 s), a ratio of
1.49. With the 0.29.0 pair (1.26) that is two
single pairs on one task, not a gate result, but both point the same way.
Dependency recall was 1.0 in both cells (precision 0.33 each). Claude reviews
used 19,721 and 16,493 tokens; Codex reviews 38,017 and
37,559.

### Where the Context arm's tokens go (2026-11-06, no model)

Phase 2 was paused on the owner's decision after both requalification pairs
had Context above plain (1.26 and 1.49). [`cost-attribution.py`](cost-attribution.py)
splits each recorded session's input into the fixed per-call part (the first
call's input, paid again on every call) and what each step added, charged once
per later call that carries it. Five pairs (three diagnostic pairs on the
retired h3-code-change, both requalification runs):

| Pair | Calls (Context / plain) | Input tokens (Context / plain) | Carried tool results, k tokens (Context MCP + shell / plain shell) |
| --- | --- | --- | --- |
| diag (0.26.0) | 35 / 26 | 2,029k / 1,162k | 987 + 90 / 656 |
| diag027 | 27 / 29 | 1,097k / 1,418k | 517 + 17 / 827 |
| diag028 | 36 / 26 | 1,777k / 1,200k | 846 + 74 / 684 |
| requal (0.29.0) | 21 / 15 | 745k / 590k | 309 + 5 / 257 |
| requal r2 (0.30.0) | 28 / 23 | 1,586k / 1,059k | 780 + 129 / 615 |

Findings:

- The fixed part is the same in both arms (first-call input about 10.8k
  tokens), so the Context tool definitions are not the cost.
- Context retrieves about as much text as plain (raw tool output roughly 100
  to 190 KB per session in both arms); it does not read less. It makes more
  model calls (in four of five pairs) because it uses both Context tools and
  shell commands, and every call re-reads everything before it.
- Large results arrive early and are carried longest: a broad
  `repository_explore` (for example the symbol `H3`, 19 to 24 KB) in the first
  six calls; JSON-format packets, whose per-line objects are much larger than
  the text form; and, in the 0.30.0 run, a three-whole-file JSON packet of
  47 KB at call 4 that the 0.29.0 behaviour would have refused with an outline.
  So the 0.30.0 change fixed the MCP error gate but can raise cost when the
  agent asks for whole files.
- Plain also varies widely between runs (590k to 1,418k), so single pairs
  cannot show a release effect.

### Independent protocol review (paid, needs approval)

A fresh Sol/high session reviews the frozen protocol, harness diff and phase 1
receipts before phase 2 is locked. That review is itself a model session and
is counted as setup.

#### Review run (2026-11-05): revise then run

One Sol/high session in a read-only sandbox (602 s, 1,543,816 tokens, of which
1,400,576 cached) reviewed the protocol folder, both phase 1 attempts' executor
receipts, the earlier results and the Context source. Hidden material, the
author transcript and the attempt folders were on the M4 throughout. The full
report is [protocol-review.md](protocol-review.md); `protocol-review.py`
builds its bundle from an allowlist and refuses to run while hidden material
is present.

Verdict: not ready to lock; revise, then run only as a falsification attempt.
Main points:

- **Token gap.** Both arms made 23 observable model calls, and Context
  returned fewer raw tool bytes than plain, yet carried about 12,300 more input
  tokens per call. The cost is context carried on every call (the seven-tool
  surface and early navigation results), not payload size. No cached-token
  weight from 0 to 1 turns phase 1 into a saving (ratios 1.03 to 1.31).
- **Power.** With eight tasks, the reviewer puts power to detect a true 20%
  saving at about 25%, the plausible phase 2 ratio at 0.8 to 1.8 (most likely
  1.1 to 1.4) and the chance of passing the token gate as written in single
  digits to low teens.
- **Blocking defects.** Executors and reviewers can read sibling cells,
  `/tmp` and, during assessment, hidden material; the reviewer's parent folder
  names the arm; the quality and scope gates, bootstrap and complete-cost
  analysis are not implemented as declared; A1 to A4 do not fail closed; the
  primary metric does not measure plan headroom; four tasks (bray-impact,
  bray-diagnosis, h3-diagnosis and the twice-used h3-code-change) should be
  replaced through an isolated custodian.

One finding is mistaken: pnpm 12.3.4 is the pin at h3 `f0e17808` (offline
check) and 11.9.0 the pin at h3-code-change's base `3eb3a57`, so they do not
conflict.

#### Correction and overhead probe (2026-11-05)

The token-gap explanation above, and the review's section 1, assumed Codex
carries the Context tool descriptions on every call. Measurement says it does
not. Seven small Sol/high sessions on a copy of the h3-code-change template
(about 143,000 tokens in all, mostly cached) found:

- **No tool descriptions in the prompt.** A one-call "reply OK" session used
  10,565 input tokens in all three set-ups: plain, Context with seven tools,
  Context with three. The full tool list is only 5,777 bytes anyway.
- **Code mode.** Codex 0.166 runs every tool call, shell or MCP, inside a
  JavaScript `exec` sandbox. The model finds Context tools at run time through
  `ALL_TOOLS` and sees only what its script prints, not the raw tool result.
  The `--json` stream still shows nested calls as `mcp_tool_call` and
  `command_execution` items, so phase 1's raw result sizes say nothing about
  what the model read.
- **Unrecorded.** Phase 1 ran with `--ephemeral`, which discarded the session
  log, the only record of per-call usage and of what each script printed. The
  per-call gap of about 12,300 tokens is therefore unmeasured, not explained.
- **Friction seen.** In one probe the model's first script failed because
  status and refresh return text-only JSON (no `structuredContent`), so it had
  to guess how to read `generation`; packets also need a generation first, which
  costs a round. These are hypotheses until measured.

The runner no longer passes `--ephemeral`. Each cell's session log stays in its
own `CODEX_HOME`, and `executor.json` and the reviewer record now carry
per-call usage, script count, script bytes and bytes shown to the model.

#### Diagnostic pair (2026-11-05)

h3-code-change again, Context then plain, executors only, session logs kept
(two Sol/high sessions; diagnostic, not a comparison: the task is used).
`session-breakdown.py CODEX_HOME` lists every call.

| | Context | Plain |
|---|---|---|
| Model calls | 35 | 26 |
| Executor tokens | 2,043,898 | 1,172,732 |
| Opening prompt, every call | 10,768 | 10,765 |
| Carried content (added once, re-read by every later call) | 1,652,406 | 882,450 |
| of which retrieval output | 1,416,007 | 676,059 |
| of which edits, tests and checks | 235,455 | 206,391 |

Total input is exactly the opening prompt on every call plus everything earlier
calls added. The gap is retrieval: Context's retrieval scripts added about
53,500 tokens, against about 36,700 for plain's `rg` and `sed`, and added them
earlier, so more later calls carried them. By category, Context's:

- **search and explore** (4 calls) added 23,939 tokens, carried 722,515. The
  model asked for `format: "json"`, which wraps every line in an object and
  repeats hashes and policy digests; one script of three searches and an
  explore hit Codex's 10,000-token output cap. Explore also inlines whole
  definition bodies (the 136-line `H3` class), which a packet then fetched
  again;
- **packets** (5) added 24,119, carried 567,863, about what plain's file reads
  cost;
- **status and refresh** (5, including three refreshes after edits) added
  little but each re-read the whole conversation: 243,996 input tokens;
- **tool discovery** (one `ALL_TOOLS` script) and **coverage** (one call at the
  end) cost a further 156,129 between them.

#### Diagnostic pair on 0.27.0 (2026-11-05)

Same task and order after Context 0.27.0 (search digests once per file, a
"text is compact" hint on the search format, explore defaulting to 12 KiB with
40-line declaration previews). Two Sol/high sessions, executors only, session
logs kept; the hidden checker was run alone afterwards (no reviewer).

| | Context 0.26.0 | Context 0.27.0 | Plain (with 0.26.0 run) | Plain (with 0.27.0 run) |
|---|---|---|---|---|
| Model calls | 35 | 27 | 26 | 29 |
| Executor tokens | 2,043,898 | 1,106,828 | 1,172,732 | 1,432,286 |
| Carried content | 1,652,406 | 805,606 | 882,450 | 1,105,533 |
| Search and explore added / carried | 23,939 / 722,515 | 13,852 / 305,834 | | |
| Packets added / carried | 24,119 / 567,863 | 19,085 / 331,168 | | |
| Hidden checker | | passed | | passed |

Every Context search, explore and packet call in the 0.27.0 run asked for
text. The Context arm's tokens fell by 46% and its calls by eight. Plain's
tokens differed by 22% between two runs of the same unchanged arm, so one pair
per version cannot separate the release's effect from run-to-run variation, and
the 0.77 ratio in this pair is not a gate result. Both arms passed the hidden
checker with no missed or incorrect dependencies.

#### Diagnostic pair on 0.28.0 (2026-11-05)

Same task, order and prompts after Context 0.28.0: packet, explore, coverage
and graph calls without `expectedGeneration` refresh a stale index themselves.
Two Sol/high sessions, executors only, session logs kept; the hidden checker
was run alone afterwards (no reviewer).

| | Context 0.27.0 | Context 0.28.0 | Plain (with 0.27.0 run) | Plain (with 0.28.0 run) |
|---|---|---|---|---|
| Model calls | 27 | 36 | 29 | 26 |
| Executor tokens | 1,106,828 | 1,788,775 | 1,432,286 | 1,211,387 |
| Carried content | 805,606 | 1,388,732 | 1,105,533 | 919,605 |
| Packet calls, added / carried | 5, 19,085 / 331,168 | 7, 26,823 / 719,405 | | |
| Search and explore calls, added / carried | 3, 13,852 / 305,834 | 2, 9,803 / 309,566 | | |
| Status and refresh calls, carried | 4, 23,542 | 5, 48,470 | | |
| Test and check calls | 8 | 13 | 12 | 9 |
| Hidden checker | passed | passed | passed | passed |

The executor used the new behaviour once. After its first two edits it sent a
packet without a generation; the server refreshed the index (a new generation,
no refresh call) and the packet then failed on a wrong file path; a search and
a packet on that generation followed. After a later edit it went back to
`repository_status` and `repository_refresh` before a pinned packet. In all it
made five status or refresh calls, as the context-arm prompt asks it to check
status and refresh when not current; they cost 48,470 carried tokens, about 3%
of the session. The larger difference from the 0.27.0 run is the path the agent
took: two more packets, one of 11,833 tokens early in the session that 30 later
calls re-read, and five more test runs.

Across three runs (0.26.0, 0.27.0, 0.28.0) the Context arm used 2.04M, 1.11M
and 1.79M tokens, and plain 1.17M, 1.43M and 1.21M. Context's 0.27.0 and 0.28.0
runs differ by 62% with a small server change between them, more than any
effect a release has shown, so these pairs cannot attribute a saving or a
loss to a release. The plain cell's two outside-reference flags are false
positives: route strings `"/s"` and `"/o"` in an inline test script.

### Phase 2: full comparison (paid, needs separate approval)

Eight tasks, three repetitions, two arms (48 executor and 48 reviewer sessions), run as locked.

## Quality gate

The measure is **missed or incorrect dependencies** on impact and code-change
tasks (owner decision, 2026-11-04), counted against the hidden dependency set
without a reviewer. For code changes, covered paths are the files actually
changed; claims in `answer.json` do not count. For impact answers, named paths
that do not exist at base are incorrect, and paths outside the set are
reported as precision. Diagnosis and orientation tasks are not counted. The
count is taken for every outcome, accepted or not, and is never shown to the
executor or the reviewer.

An outcome is accepted only if its checker passes (code-change and diagnosis),
every changed file is inside the task's scope, and the blind reviewer accepts.

Version 2 quality guard, per comparator:

- Context has no fewer accepted outcomes in total; and
- on no impact or code-change task is Context's median dependency count higher.

Lower on at least two such tasks is reported as "better" but not required.
If both arms score zero on every counted task, the quality comparison is
inconclusive; replacing a task class after seeing the baseline would be a new
protocol. First-pass acceptance is not measured in version 2.

Version 1 required "lower on at least two tasks and higher on none, with no
Context outcome rejected"; the review found that rule had a floor effect and
failed on one stochastic rejection.

## Cost gate

The primary outcome is **reported processed tokens**: executor input and
output from the Codex `--json` stream, cached input included (reviewer tokens
are reported per family, not gated; see Reviewer design). The
statistic is the **sum over tasks of per-task median** processed tokens. Every
task needs exactly the planned repetitions per arm, all complete.

Context passes against a comparator only if:

- its sum is at most 0.80 of the comparator's; and
- the upper end of the 90% bootstrap interval of that ratio (tasks resampled
  with replacement, 10,000 draws, seed 20261105) is below 1.0.

Reported, not gated:

- the geometric mean of per-task ratios with its interval;
- uncached input, cached input, output and the reasoning subset, never added
  twice;
- uncached + output + w x cached for w = 0, 0.1 and 1, fixed before any new
  cell;
- reviewer seconds;
- executor wall time and local preparation.

Usage must pass the A1-A4 checks (see Version 2 changes) or the cell is
incomplete, never zero, and an incomplete cell in a compared arm fails the
gate. Setup, repairs, invalid attempts and reruns are listed per run in this
README; `analyse` totals the recorded executor and reviewer sessions only.

Codex on this machine reports "Logged in using ChatGPT", so Sol usage comes
from the plan allowance, not metered API billing. Nothing here measures plan
headroom or cash; the result is reported as processed tokens. A full Sol/high
run may meet the plan's rate limits.

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
4. ~~The protocol review~~ (run 2026-11-05: revise then run).
5. Owner review of version 2. The three open decisions were taken
   2026-11-05: loopback only, eight tasks with a pack-limited claim, and a
   different-family reviewer with an agreement sample.
6. ~~One short live isolation session~~ (`isolation-probe.py`, run and
   passed 2026-11-05).
7. ~~Replacement tasks from an isolated custodian, plus a separate
   qualification task~~ (run 2026-11-06; follow-up converted the kept
   scopes and reviewed the problem list; the bray pair was rewritten).
8. ~~The quality-measure pilot and the reviewer-independence design~~
   (2026-11-06; see Reviewer design, pilot and readiness).
9. Requalification (phase 1) on version 2 with the qualification task:
   run 2026-11-06, **failed** on the MCP error gate (1 of 13, 7.7%); fixed
   in 0.30.0 (PR #74) and rerun the same day under revision r2: **passed**.
10. Phase 2.

## Not claimed

This draft delivers no measurement, savings or quality result. It changes no
package code and does not reopen or alter any earlier protocol or result. Any
phase 2 result applies to this eight-task pack only.
