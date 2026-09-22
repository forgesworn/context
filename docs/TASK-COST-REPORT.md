# Whole-task cost evidence

Use `scripts/task-cost-report.mjs` to check and summarise private paired-task
receipts. It is a local developer tool, outside Core. It reads one JSON file,
prints JSON, and makes no provider requests. It does not collect usage, look up
prices, run the tasks or authenticate the supplied evidence.

For ongoing ecosystem work, follow the
[FS0–FS5 savings goals](FORGESWORN-DOGFOOD-GOALS.md#immediate-savings-goals-fs0fs5).
The [daily receipt](examples/daily-use-receipt.json) and
[monthly review](examples/monthly-savings-review.md) are separate manual drafts;
this strict paired-task reporter does **not** accept them or collect client
usage. The separate [daily usage importer](DAILY-USAGE.md) now handles explicit
Codex request exports and fixture-qualified Claude transcripts, with offline
summaries. It has its own specification/schema; billing remains separate. Routine adoption
can record useful partial evidence before a controlled experiment is complete.

Use Node from `.nvmrc`:

```sh
node scripts/task-cost-report.mjs --input /absolute/private/trial.json
```

The input contains `protocol` and `receipts`. Start from the deliberately
unlocked [draft template](examples/task-cost-draft.json). Its hashes, revisions
and qualification references are placeholders, not evidence. Copy it to private
storage and replace them before locking a real experiment. Keep prompts, source,
provider receipts and billing evidence private; publish a reviewed aggregate.

The concrete Context/KithMoot comparison is in
[the D5 experiment pack](D5-RESULTS.md). Its protocol,
frozen task definitions, preparation helper and acceptance checks remain private
and separate from the generic draft template. Heartwood's concurrent daily-use session is
outside this comparison; do not turn its ongoing task into a retrospective pair.

## Lock the comparison before running it

The eight pairs contain two tasks in each category: orientation, diagnosis,
change impact and accepted code changes. Use one task per category in each of
two explicitly qualified repositories. Alternate baseline-first and
assisted-first order. Baseline retrieval is efficient `rg` and exact file reads;
assisted retrieval uses Context. The historical full-file diagnostic in
[the first trial](PAIRED-TRIAL.md) is a different experiment.

For each pair, retain the exact task and executable acceptance definitions and
their SHA-256 hashes. Lock repository revision and qualification reference,
role/provider/model/effort/settings, acceptance IDs and arm order. The protocol's
`measurementDefinitionSha256` identifies a shared procedure defining whole-arm
wall time and review time, including preparation, failed drafts and repairs.
Give each arm a separate session and record its cache and contamination state.

`lockedAt: null` keeps the protocol in draft. Set it only after replacing every
placeholder and retaining the real definitions; it must precede every arm's
`startedAt`. Changing task definitions or measurement rules requires a new
experiment. The tool checks declared consistency, not whether an operator
actually followed the procedure or whether a referenced receipt is authentic.

## Record all work

Each arm receipt contains the locked controls plus:

- Explicit coverage attestations for all attempts, host work, workers and review.
  `true` means complete; `false` or `null` leaves qualification incomplete.
  `workers: true` with no worker rows attests that no workers were used.
- Every host and worker attempt, including repairs, failures, refusals and
  cancellations. Record a blocked dispatch as `dispatched: false`; preserve its
  receipt and evidence that no inference occurred.
- Input/output tokens and cached-input/reasoning-output subsets. Missing fields
  are explicitly `null`. Subsets are reported separately and never added again
  to the corresponding totals.
- Explicit variable inference cost in GBP, its attribution source and date.
  If the original amount is in another currency, include the dated conversion
  basis in the source. Tokens and plan names never imply a monetary amount.
- Tool calls, source reads, scan/refresh time, whole-arm elapsed time, review
  time, acceptance results and evidence references. Attempt durations are
  diagnostics, not the whole-arm wall time.

The input and its strings/arrays are bounded. Unknown fields, duplicate arms or
sessions, mismatched controls and invalid counts are errors. Evidence references
are strings only; the script never opens those paths or URLs.

## Interpret the result

The report exposes known subtotals and incomplete totals separately. It includes
unsuccessful attempts rather than discarding them in favour of accepted results.
Fixed-subscription amounts and dated rate estimates do not qualify as attributed
variable cost. A local inference zero requires an explicit no-provider-charge
basis. Unknown cost remains `null` even when usage is known.

- `incomplete`: draft protocol, missing arms, missing attribution or measurement,
  uncertain coverage/acceptance, contamination, or a zero-cost baseline that
  cannot support a percentage-reduction decision.
- `failed`: complete evidence misses quality, cost or review-time requirements.
- `passed`: all eight pairs meet identical acceptance checks without material
  regression; assisted aggregate variable cost is at least 20% lower; assisted
  aggregate review time does not increase.

A valid report exits zero even when incomplete or failed. Malformed input exits
nonzero with a JSON error. Consumers must inspect `status`, not equate a
successful CLI exit with a successful trial.

The cost decision compares the supplied decimal amounts without relaxing the
20% threshold. Displayed totals and percentages are JavaScript numbers and may
show ordinary floating-point rounding at the boundary.

The report is preparation for D5, not evidence that D5 has passed. Ordinary daily
work can start accumulating receipts while the protocol and attribution remain
incomplete. Complete host usage and attributable billing are still required to
claim whole-task monetary savings.

The separate [v3 harness qualification](D5-RESULTS.md)
now has one accepted baseline and one rejected assisted answer. Including review,
assisted input and review time increased. Those raw qualification receipts have
not been relabelled as completed arms in the eight-pair reporter; billing and
setup/host attribution remain unknown.
