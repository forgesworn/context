# Offline daily usage imports

The checkout now provides `scripts/daily-usage.mjs` for FS2. It imports explicitly
selected Claude Code or Codex usage exports and summarises task receipts offline.
It needs Node from `.nvmrc`; it does not need a model, provider SDK, login or
network connection. This is developer tooling, not a new MCP operation or a
published package command. It does not alter client configuration or collect
transcripts automatically.

## Capture a task window as you work

Use [the task profile](examples/daily-usage-profile.json) to supply task,
developer, repository, account and exact client session IDs once per task/phase.
Use nonsecret labels; the profile and boundary retain the session ID locally.
`client` is `codex` or `claude`. Start before preparation, between requests:

```sh
node scripts/daily-usage.mjs start \
  --spec /absolute/private/task-profile.json \
  --out /absolute/private/task-start.json
```

After the last request has finished and its usage event has been recorded, close
the window. For a complete task this includes repairs and review; a separate
review session needs its own profile/window with the same task ID and phase
`review`. Do not finish a window while a request is still running.

```sh
node scripts/daily-usage.mjs finish \
  --input /absolute/private/task-start.json \
  --out /absolute/private/task-import.json

node scripts/daily-usage.mjs import \
  --input /absolute/private/session-export.jsonl \
  --spec /absolute/private/task-import.json \
  --out /absolute/private/task-usage.json
```

`start` records the local UTC clock; `finish` produces the existing import spec.
It does not read a transcript, identify a session or contact a provider. Both
commands require an existing private directory and write new mode-0600 files.
They reject symlinks, oversized inputs, extra fields and overwrites. The original
boundary stays unchanged. Its checksum detects accidental edits, not dishonest
attribution. A reversed/equal clock is rejected; other clock drift is not detected.

The generated spec leaves acceptance, review duration and every coverage field
`null`. Review and set those assertions explicitly before import when established;
keep shared task assertions consistent across host/worker/reviewer specs. Elapsed
window time is not review time. `contextUsed` comes from your profile and may stay
`null`. A captured window proves neither complete usage nor savings.

Start a new window when switching task, phase, session or checkout. The repository
label is operator supplied: these commands do not watch Git, retarget MCP or verify
worktree identity. Summary rejects overlapping windows for different tasks/phases
in the same client session; independent sessions may run concurrently.
Keep the request-boundary and stable-export requirements below. For a task already
underway, label the captured portion incomplete; use the manual import spec for
older boundaries supported by evidence. Do not pretend a new start covers earlier
preparation. Ollama attempts continue to use `import-worker` and explicit attempt
IDs; task capture does not replace their receipt evidence.

## Import a selected task window

Keep the input export, specification and output in private local storage. Use
absolute paths without symlink ancestors. If a live session file is still growing,
first obtain a stable export; the importer rejects detected changes while reading.

Copy [the import specification](examples/daily-usage-import.json), replacing its
sample IDs and timestamps. `sessionId` must be the exact session in the export.
`from` is inclusive and `to` exclusive, both UTC. Attribution follows the usage
event's timestamp, not the request start: prefer task boundaries between requests.
A request crossing a boundary cannot be split accurately by this tool.

```sh
node scripts/daily-usage.mjs import \
  --input /absolute/private/session-export.jsonl \
  --spec /absolute/private/task-import.json \
  --out /absolute/private/task-usage.json

node scripts/daily-usage.mjs summary \
  --input /absolute/private/task-usage.json \
  --input /absolute/private/another-task-usage.json \
  --out /absolute/private/weekly-usage.json
```

Outputs are new files only, mode `0600`; existing files are never overwritten.
Success prints a schema and checksum, not transcript content. Errors are generic
and exit 2. A successful import may still have incomplete usage or task coverage;
read its warnings and totals. Source/output hashes detect accidental changes,
not authenticity or faithful selection by an operator.

The specification assigns stable nonsecret task/developer/repository labels, an
optional account label, phase and outcome assertions. Use `category: development`
for work building Context, `evaluation` for trials and `ecosystem-task` for normal
application development. This keeps tool-building investment separate from the
workflow it is meant to improve. `accepted`, `contextUsed`, review time and all
coverage fields remain `null` until explicitly established; import never derives
them from tool success. Do not put credentials, private paths or prose in labels.

The original [daily receipt draft](examples/daily-use-receipt.json) remains a
manual task worksheet. It is not this import specification or an accepted input
to the paired D5 reporter. The new command has its own versioned receipt format.

## Import an Ollama worker attempt

The same offline tool accepts one raw `ollama_task.py` `receipt.json` per
`import-worker` call. Use the [worker specification](examples/worker-usage-import.json)
with the same task/developer/repository labels, outcome assertions and review time
as the host receipt. Set `client: "ollama"`, `phase: "worker"` and the fixed
`sessionId: "ollama-workers"`. Assign the actual worker account separately from
the host account; a localhost endpoint does not establish free inference.

```sh
node scripts/daily-usage.mjs import-worker \
  --input /absolute/private/worker-attempt/receipt.json \
  --spec /absolute/private/worker-import.json \
  --out /absolute/private/worker-usage.json

node scripts/daily-usage.mjs summary \
  --input /absolute/private/host-usage.json \
  --input /absolute/private/worker-usage.json \
  --out /absolute/private/task-summary.json
```

The helper currently records neither a stable request ID nor a wall-clock time.
Supply `attemptId` and `at` explicitly from your task evidence. Reuse one unique
attempt ID across copies/imports; give every actual retry or repair a new ID,
even if its prompt and counters match. Do not derive IDs from a prompt hash,
receipt bytes or filenames. `at` is the operator-recorded accounting timestamp,
within the selected half-open window; it is not a provider-certified request time.
If original timing is unavailable, disclose a capture-time attribution in your
private task ledger rather than inventing a request time. Identity and timing
assertions cannot be authenticated by this importer. Renaming a duplicate with a
new ID can overcount; reusing an ID for separate identical attempts can undercount.

Imports retain known prompt/completion counters, including truncated or unusable
drafts. Refused, unknown, busy and refused-pending receipts retain unknown usage;
busy and refused-pending are coordination outcomes, not proof of inference calls.
The summary's `workerAttempts` counts each distinct recorded attempt by status.
Different tasks may overlap in time; the same attempt cannot be reassigned to a
different task/account or combined with conflicting metrics or statuses.
After reconciling an unknown attempt, retain its history privately and select the
reconciled receipt for aggregation; do not import both versions or assign a new
attempt ID merely to avoid the conflict check.

Cache and reasoning counters remain unknown. The helper's model and thinking
fields describe the requested configuration, not independently confirmed returned
model metadata. Warnings preserve these limitations. Successful generation is
not accepted implementation: `accepted` and coverage remain explicit task-level
assertions. Keep the helper's separate review receipt and actual test evidence
privately; this adapter does not import review prose or measure host review time.

The adapter reads only the selected receipt (maximum 4 MiB) and spec. It never
opens adjacent prompts, answers, HTTP diagnostics or review files, and strips
task prose, endpoint and provider error bodies from its output. No worker replay,
provider calls or directory discovery occur. The existing private-path, stable
read, no-overwrite and generic-error rules apply. Preserve original 402 receipts
privately for diagnosis; they are not exposed in the aggregate.

## Supported exports and accounting

| Source | Imported usage | Limitations |
| --- | --- | --- |
| Codex rollout JSONL | `token_usage_record.payload.usage`, keyed by session and response IDs | Ignores cumulative `event_msg/token_count`, `thread_token_usage` and `turn_token_usage`. Older cumulative-only logs are reported incomplete, not converted to a zero or guessed task delta. Model/effort come from a matching prior `turn_context` when available |
| Claude Code transcript JSONL | `assistant.message.usage`, keyed by `sessionId` and message ID | Model comes from the message; effort is unknown in this supported shape. Partial streamed copies with conflicting usage become an unknown record. Claude CLI result JSON or arbitrary provider/API exports are not supported by this adapter |
| Ollama helper receipt JSON (`import-worker`) | `reportedTokens.prompt` and `completion`, keyed by the explicit attempt ID | Operator-supplied timestamp/identity; requested model/effort; unknown cache, reasoning and billing; no automatic helper review import |

Codex input already includes its reported cache fields. Claude's input total
adds fresh input, cache reads and cache creation once. Cache creation's nested
breakdown is not added again. Reasoning output is a subset when reported;
Claude reasoning is not separately inferred. Missing metrics remain `null`,
including omitted cache fields; independently known metrics are retained.

Identical request copies are deduplicated, retaining the earliest event time.
Conflicting copies within one import remain one unknown record. Summary removes
identical receipt repeats and identical request repeats with the same task,
account, repository and phase. It rejects differing request data or conflicting
attribution, including overlapping windows assigned to different tasks/phases.
Do not merge a partial and a later repaired receipt; choose the intended capture.
Timestamp differences alone do not create a second request: same-task copies
keep the earliest observed time. A repeated request assigned to a different task
still requires explicit reconciliation rather than guessing task ownership.

A task may include a Codex host and Claude review. Task outcome, developer,
repository, category and review time must agree; usage remains in separate
client/account/model/effort/Context-use cohorts. Cohort task counts must not be
summed as a count of distinct tasks. The top-level task list deduplicates them.
Summary retains rejected and unknown tasks and the asserted coverage of every
receipt. It does not authenticate assertions or infer whole-task completeness.

Each metric reports a known subtotal, unknown record count and complete total
for the **selected observed records**. Empty selections have a null complete
total. This does not establish that all host, worker or reviewer activity was
captured. Unrecognised events are counted, missing request/session identity is
flagged, and malformed selected usage fails the import. Source content, raw
session/response IDs and input paths are omitted from output; their hashes and
selected metadata remain. Keep even these reduced receipts private by default.

Limits: 64 MiB per log, 4 MiB per line, 100,000 lines; 64 KiB specification;
16 MiB output/individual summary input; 32 receipt inputs with 32 MiB combined
input and 100,000 records across unique receipts. Regular-file/ancestor checks
reject symlinks and detected file replacement. They are not a filesystem sandbox
against a hostile process racing parent directories. No source files, paths or
URLs stored inside the exported transcript are followed.

## What the summary cannot tell you yet

Cash savings, monthly spend and token savings stay `null`: this is observed-use
accounting, not a baseline comparison or billing importer. It never estimates a
subscription allowance from tokens. Reconcile account bills using the
[monthly review](examples/monthly-savings-review.md), separately from measured
same-model task comparisons. Pricing estimates and invoice attribution are
different evidence. Account identifiers group usage; no subscription charge is
invented or multiplied by the number of tasks.

Remaining FS2 work: real Claude export acceptance, client-version coverage,
complete everyday host/worker/review captures and convenient weekly report
rendering. Explicit task boundaries and worker-helper receipt imports are available. The current tool handles explicit exports immediately;
automatic session discovery, provider authentication and telemetry are excluded.

## First local acceptance

On 22 September 2026 a frozen, usage-only projection of the explicitly selected
Context session was imported for 07:00–07:50 UTC. It produced 49 request records,
6,014,669 input tokens (5,693,056 reported cached) and 41,646 output tokens.
Reported reasoning, 4,327 tokens, is already included in output. There were no
duplicate/conflicting request records in that selection. Some model/effort
metadata was unavailable and all whole-task coverage assertions were false.

This is a partial Context **development** window, not an accepted Heartwood task,
a baseline, a complete cost of this implementation or evidence of savings. No
real Claude export was present in the selected Context export directory; the
Claude adapter has synthetic fixture acceptance only. The active Heartwood
session was not inspected or modified. Private evidence is recorded in the
[execution ledger](DOGFOOD-EXECUTION.md).
