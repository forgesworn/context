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
