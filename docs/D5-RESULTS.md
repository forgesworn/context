# D5 qualification results

These are sanitised historical reports, not evidence of savings. The original
locked harness, machine-specific toolchain manifests and raw receipts remain
private and unchanged. This release does not distribute that executable
experiment pack. No experiments were rerun or relocked for publication.

# D5 first pair: rejected, accounting incomplete

On 21 September 2026, the locked `orientation-context` pair ran in its declared
order: baseline then assisted. Each executor used a fresh Codex CLI 0.155.1
session with **gpt-5.6-luna / medium**; each independent reviewer used a fresh
**gpt-5.6-sol / high** session. Neither executor saw the acceptance rubric or the
other answer. Each reviewer received only its own answer, checker result, rubric
and cited frozen source. No Heartwood access or Ollama dispatch occurred.

Both answers failed the deterministic exact-source citation check and independent
review. Baseline citations joined text across source newlines; the assisted
answer also supplied a non-contiguous citation. Both omitted search-time source
reinspection and the no-authority/no-instruction-execution boundary. Assisted
also omitted cursor term binding and focused test citations. Preserve both
failed drafts; do not turn either into an accepted result by host editing.

The assisted client successfully used status → explicit refresh → bounded search
on its isolated root. Refresh indexed 24 files / 4,354 locations. No navigation
server error was recorded. Retrieval working is distinct from answer acceptance.

| Captured measure | Baseline | Assisted |
| --- | ---: | ---: |
| Executor input tokens, including cached | 171,318 | 138,732 |
| Executor cached input subset | 136,192 | 103,424 |
| Executor output tokens, including reasoning | 1,954 | 1,564 |
| Reviewer input tokens, including cached | 64,897 | 99,355 |
| Reviewer cached input subset | 42,496 | 83,072 |
| Reviewer output tokens, including reasoning | 3,029 | 3,170 |
| Total executor + reviewer input | 236,215 | 238,087 |
| Executor tool calls | 7 | 14 |
| Reviewer tool calls | 3 | 6 |
| Reviewer wall time, seconds | 91.09 | 85.68 |
| Observed arm wall time, seconds | 208.80 | 161.95 |
| Accepted | No | No |
| Attributable inference cost | Unknown | Unknown |

The lower assisted executor input did not survive inclusion of reviewer input.
These are provider token counters, not money saved; cached and reasoning subset
fields are not added twice. Neither arm produced an accepted outcome, so no
cost-per-accepted-outcome comparison is available.

Private raw transcripts, exact prompts, prepared source receipts, checker
failures, reviews, per-role usage and coordination limitations are retained in
`~/.cache/z1p-delivery/20260921-d5-runs-zf65mg_g`. The assisted receipt is under
`assisted-run/`. The baseline checker ran twice after its first rejection exposed
a private driver bug that skipped review of rejected answers; that driver was
repaired without repeating executor inference. Each arm has exactly one executor
and one reviewer model attempt.

Provider cache state, arm-attributable host usage and billing remain unknown.
Wall times include orchestration and the baseline driver repair, so are not a
clean latency comparison. The event stream lacks individual event timestamps;
`executorCompletedAt` is checker completion capture time. The preparer omits
public finding IDs and selection policy from `.d5-task.json`; both prompts
therefore supplied the complete unchanged public task JSON symmetrically.
This deviation and the accounting gaps are preserved, not silently repaired.

The locked protocol and helpers remain unchanged. Fourteen arms remain unrun.
Do not spend on them until a prospective protocol revision addresses public
prompt completeness, exact citation verification, semantic coverage and receipt
capture. Any rerun must retain these failures and declare its new protocol before
execution. D5 remains open; this first pair establishes no savings. Heartwood
can continue ordinary dogfooding independently.


# V2 result: rejected; sandbox configuration defect

The locked qualification ran baseline then assisted on 21 September 2026.
Each had one Luna/medium executor and one fresh Sol/high reviewer. Both rejected.
Neither frozen source nor the locked protocol was repaired after the run began.

Fresh executors inherited Codex's read-only default. Both attempted to write
answer.json and received an explicit sandbox denial, so the prescribed public
self-check was unavailable. The host retained final JSON and checked it outside
the model session. This is a harness configuration defect, not evidence that the
model freely chose to omit the check. V2 cannot qualify the intended workflow.

Baseline failed an exact citation: it collapsed a two-line source comment into
one string. Semantic review also found missing query-normalisation details.
Assisted passed deterministic citations and frozen-source checks but omitted
source-unknown/policy-current behaviour and parts of cursor normalisation,
invalidation and successor handling. Its scoped status → refresh → search
sequence passed; one search request failed and is retained in the event log.

| Captured measure | Baseline | Assisted |
| --- | ---: | ---: |
| Executor input, including cached subset | 269,141 | 261,595 |
| Executor output, including reasoning subset | 5,039 | 3,775 |
| Reviewer input, including cached subset | 104,137 | 247,202 |
| Reviewer output, including reasoning subset | 2,750 | 4,263 |
| Executor + reviewer input | 373,278 | 508,797 |
| Reviewer seconds | 94.51 | 133.28 |
| Accepted | No | No |
| Attributable billing | Unknown | Unknown |

The host attempted to prevent assisted preparation once the sandbox defect was
identified, but that arm had started between the status read and the attempted
fresh-output reservation. No output was overwritten. The in-flight arm was
allowed to reach a definite terminal outcome; there was no provider retry.
This race and the error are retained in private SANDBOX-DEFECT.json.

Raw timestamps, usage subsets, tool events, answers, reviews and source-integrity
receipts are private under
`~/.cache/z1p-delivery/20260921-d5-v2-6xsgi2qq/runs`. Parent-session, preparation,
and independent design-review costs remain unknown. No monetary savings or
accepted-outcome comparison is established. Heartwood was not accessed.

V3 prospectively corrects sandbox configuration,
counts completed file-change events and clarifies the public normalisation
question. It keeps this failed qualification and the original v1 failures.


# V3 result: harness operational; assisted answer rejected

The prospectively locked one-pair qualification completed on 21 September 2026.
Both executors used fresh Luna/medium sessions; each answer received a separate
fresh Sol/high review. Baseline passed every check. Assisted passed deterministic
checks and the required retrieval sequence but failed semantic review. This is
not a passed D5 experiment or evidence of monetary savings.

The corrected executor sandbox permitted answer creation and the public checker.
Baseline needed four failed self-checks and repairs before its fifth check
passed; assisted needed one repair before its second check passed. All these
steps remain in the same respective executor receipts, not hidden retries.
Both final answers passed exact citation, implementation/test coverage and frozen
source integrity checks. Host-side originals and prepared trees remained intact.
Only answer.json changed. Transcript review found source reads within the
respective declared scope and no Heartwood access.

Assisted correctly explained initial refresh, policy gating, cursor normalisation
and trust boundaries, but its freshness finding contradicted its own search-gate
explanation. It claimed source differences reject search and that failed refreshes
always leave policy unknown and block search. Current-policy searches can return
stale/unknown source freshness, and some failed refreshes retain a usable prior
generation and cursor. Sol rejected those material inaccuracies. The baseline
review accepted all five public dimensions.

| Captured measure | Baseline | Assisted |
| --- | ---: | ---: |
| Executor input, including cached subset | 576,890 | 525,269 |
| Executor cached input subset | 514,816 | 463,360 |
| Executor output, including reasoning subset | 5,444 | 4,342 |
| Reviewer input, including cached subset | 87,244 | 179,872 |
| Reviewer cached input subset | 55,424 | 127,488 |
| Reviewer output, including reasoning subset | 2,094 | 4,096 |
| Executor + reviewer input | 664,134 | 705,141 |
| Executor + reviewer output | 7,538 | 8,438 |
| Executor tool calls, including file changes | 16 | 31 |
| Reviewer tool calls | 4 | 12 |
| Reviewer seconds | 70.12 | 114.10 |
| Whole-arm seconds | 205.35 | 285.38 |
| Final public/trusted checks | Pass | Pass |
| Independent review | Accepted | Rejected |
| Attributable billing | Unknown | Unknown |

Assisted executor input was lower, but executor plus reviewer input was about
6.2% higher and review time increased. This single pair cannot establish a
general performance result. Cached and reasoning fields are subsets; they are
not added twice. Provider cache state, parent-session usage and billing remain
unknown. These are usage counters, not cash amounts; assisted has no accepted
outcome for a cost-per-accepted-outcome comparison.

Private raw events, exact timestamps, sandbox/configuration receipts, failed
self-checks, final answers, reviews and source-integrity evidence are under
`~/.cache/z1p-delivery/20260921-d5-v2-6xsgi2qq/v3-runs`. The retained
v2 result records the default-read-only defect.
The v1 first pair remains unchanged. Do not pool
these versions or relabel any failed attempt as accepted.

Preparation used Terra/medium after the shared M4 rejected Flash dispatch as busy
before inference. Sol/high reviewed the protocol and final delta. Host repairs,
two bounded Terra drafts, their corrections and the independent write-capability
fixture are setup overhead, with unknown attributable cost. The fixture used one
Luna/medium session: input 15,560 (cached subset 12,800), output 359 (reasoning
subset 56), one file change and one command. It is not an experimental arm.

Validation: 12 runner tests, 6 public-check tests, two prepared-arm fixtures,
positive/negative exact-citation checks and the locked verifier passed. No
production package implementation changed. These are local qualification checks,
not new CI, registry or consumer acceptance.

Next: improve the assisted source handoff and synthesis of freshness branches,
and reduce retrieval/review round trips before another paid comparison. Keep
ordinary Heartwood dogfooding separate and retain real-task receipts. The fourteen
remaining v1 arms stay unrun; the monetary gate also needs attributable billing.
