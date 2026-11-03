# Local task console

The optional task console lets the owner save a task, choose a checkout, start an
installed coding host, answer its supported questions/approvals, inspect changes
and tests, and continue its saved conversation. Local result acceptance is
separate from committing, merging, deployment and Girnel acceptance.

Adapters are **Codex app-server** (qualified on CLI 0.166.0), **Claude Code**
(stream-json/control protocol, qualified on CLI 2.1.316) and **Kimi Code**
(ACP1 stdio; qualification below). An optional **bounded Ollama worker** lane
uses an installed worker helper and explicit operator profile; it has no native
coding-agent session or autonomous tools. See its separate contract below.
Existing independent terminal/app sessions are not attached or
imported. Oathrun/KithMoot execution routes and their grants remain separate.

## Start an explicit control session

```sh
z1p workspace dashboard /absolute/workspace --cache-dir /absolute/private/cache \
  --control-dir /absolute/private/task-console --codex /absolute/path/to/codex \
  --max-run-seconds 600
```

Use `command -v codex`, `command -v claude` and `command -v kimi` to find installed executables.
Supply any combination of `--codex`, `--claude` and `--kimi`; only configured hosts are selectable:

```sh
z1p workspace dashboard /absolute/workspace --cache-dir /absolute/private/cache \
  --control-dir /absolute/private/task-console --codex /absolute/path/to/codex \
  --claude /absolute/path/to/claude --kimi /absolute/path/to/kimi
```

Add `--repo` to restrict the console's selection to one canonical saved-catalogue checkout. Existing
`--handover-base` and `--girnel-links` options still apply to the observation view.

`--control-dir` explicitly creates/opens a private encrypted journal using the
same local SQLite/crypto store as workspace tools, in the specified directory.
Keep it outside source control. Its key is local to the OS owner. The normal
dashboard, without this option, remains read-only and has no task-control API.
Starting control mode does not launch a host or begin model inference. Save task
creates a local record; **Run task** starts execution.

The URL is a local execution capability. Keep it private. The server binds only
to loopback, checks Host/Origin, and requires same-origin JSON plus a custom
header for mutations. Browser input cannot select an executable, supply shell
arguments, change provider/policy, resume arbitrary thread IDs or signal arbitrary
PIDs. The operator selects the executable at launch. No remote listener, hosted
service, telemetry or new account is introduced.

## Task journey

1. Select a checkout from the launch-time saved catalogue. Enter the title,
   objective and optional relative intended paths. Save the task.
2. Select **Run task**. The console publishes advisory activity and starts a new
   child host in that checkout. Codex uses `app-server --listen stdio://`; Claude
   uses `--print --verbose --input-format stream-json --output-format stream-json
   --include-partial-messages --permission-prompt-tool stdio` plus its owned session
   UUID (`--session-id=...` or `--resume=...`). It inherits the installed account,
   model/provider, reasoning, sandbox and approval configuration. Kimi uses only
   `acp`, without client filesystem/terminal capabilities or execution overrides.
   The adapter sends no model, provider or permission overrides. Effective host
   settings are shown once its thread is created.
3. Follow streamed response text, completed command/test output and file-change
   records. Native auto-approved tools continue under the installed permission
   mode/rules; only requests the host sends to this client wait for the owner. Approvals
   offer one-request accept, decline or cancel, without policy amendments or
   accept-for-session. Ordinary non-secret user questions can be answered here.
4. **Stop run** requests interruption. An acknowledgement alone is not a terminal
   receipt. The UI shows interrupted only after the host reports it; uncertain
   outcomes remain labelled Needs reconciliation. Claude interruption acknowledgements
   and results after Stop are not qualified interruption receipts and require native
   reconciliation in this release.
5. A completed turn becomes **Ready for your review**. Inspect the current whole
   working-tree status/diff, previews of bounded new UTF-8 files, result and run
   log. This can include changes that predated the task; it is not task ownership
   attribution. Command exit status is reported host evidence, not independent
   reviewer acceptance.
6. Accept the reviewed result locally, or request changes and enter a follow-up.
   Continuing starts a fresh owned process and resumes only this task's recorded
   thread. A saved model/provider mismatch is refused before another turn.

Checkout selection sets the conversation context; the installed host's sandbox
controls actual filesystem/network access. The console does not claim filesystem
isolation merely from `cwd`. Task text, agent output and peer observations cannot
grant execution authority. Existing native execution/approval controls still apply.

The controller does not automatically execute shell commands from task fields,
apply a diff, commit, merge, publish or mutate a Girnel card when a result is
accepted. A user's objective may separately authorise the coding host to perform
actions under its own controls. No automatic background retries or next turns
are scheduled. Closing the browser leaves the explicit foreground console alive;
stopping the console closes its owned hosts.

## Recovery and bounds

One host run is active per console. A host process, including startup and approval
wait, has a 10–900 second wall bound (600 by default). A separate POSIX watchdog
enforces the wall bound and reacts to parent loss, checking process start identity
before signalling its owned process group. Host processes close after turns to
release memory. macOS/Linux are the process-control platform scope of these adapters.
Time limits are not financial caps; usage/billing follow the configured host and
account. No whole-task savings claim is made.

The encrypted journal keeps at most 64 tasks, bounded output and the last 64
accepted action request IDs per task. A duplicate retained request with identical
payload does not launch work again; changed payload is refused. Control revisions
reject stale decisions. An uncertain transport result requires inspection before
another explicit action, rather than automatic request replay. An incomplete run
after shutdown/restart remains Needs reconciliation and never starts itself.

A private `console.lock` prevents two controllers using the same journal. Clean
shutdown removes its own lock. After a crash, verify the recorded owner/host has
stopped and reconcile its saved threads before removing that specific stale lock.
There is deliberately no automatic takeover or killing from stored PIDs. An
operator can run independent consoles with separate journals; this is not a
distributed scheduler or a global checkout lock.

Result acceptance binds the exact stored thread/turn/result and a current working
tree fingerprint. Changed tracked or untracked contents refuse old acceptance.
The snapshot is checked for changes while it is read; this is a point-in-time
check, not an atomic lock against later external filesystem writers.
Git status/diff are bounded to 256 KiB each, with hooks, fsmonitor, executable
clean/process/smudge filters and external diff/textconv disabled for review reads.
New-file previews permit at most 64 regular UTF-8 files, 64 KiB each/256 KiB total;
symlinks, binary/oversized/changing files or an unavailable audit disable acceptance
here. Use the native host/editor for a larger review. Task detail responses are
bounded to 1 MiB. Earlier log output can be omitted with an explicit marker.

Unsupported host interactions (including extended permission grants and secret
questions) are refused without granting permission and leave the run requiring
reconciliation in the native host. The console does not implement authentication
flows, arbitrary MCP form tools or every app-server feature. Existing Codex thread
history also remains in the host's own storage; the console journal is not its
only copy.

## Claude native controls

The adapter uses the installed CLI without adding an SDK dependency. Before
sending user input it performs `initialize` and read-only `get_settings`, requiring
an idle session and reported `applied.model`, `account.apiProvider` and permission
mode. Only those selected fields and a small sandbox summary enter the encrypted
journal; account email, environment and full native settings are discarded. Older
CLIs that cannot report this contract fail before a prompt. Hooks, skills and
settings remain enabled. Claude's print mode skips its workspace trust dialog: the
operator must select trusted saved checkouts. The console does not add a sandbox.

Ordinary native `can_use_tool` requests show the exact tool name and bounded input
in the approval panel. Allow echoes that input for this one operation; the adapter
never echoes permission suggestions or supplies `updatedPermissions`. Decline
denies the operation; Cancel denies it with Claude's interrupt flag. `Write` shows
the requested content, and `Edit` the old/new strings; these are native requests,
not a reconstructed guarantee about the eventual whole-file diff. Review the
current working tree separately after execution.

`AskUserQuestion` supports up to three non-secret questions, displays choices and
accepts free-text answers (including multi-select answers expressed as text).
Native cancellation invalidates a pending request. Mode-changing interactions,
unsupported control requests and oversized requests are refused and require
reconciliation. Explicit secret flags are rejected; text inputs are not a secret
vault. Completed tool results are labelled host-reported, without inventing command
exit codes that Claude did not supply.

Follow-ups start a fresh process using only the stored UUID and refuse changed
reported model/provider before a new prompt. A native init reporting another
session, checkout or model aborts the run. Session history remains in Claude's own
storage as well as the console's bounded journal. The one-active-host limit spans
all three adapters. No unrelated terminal/app session is attached.

This follows the [official approval and question contract](https://code.claude.com/docs/en/agent-sdk/user-input)
and the [official SDK control transport](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py),
checked against the installed CLI. The adapter remains responsible for its own
bounded native-protocol qualification; SDK documentation alone is not acceptance.

## Kimi native controls

Kimi uses the installed `kimi acp` process and ACP version1 JSON-RPC. Before any
prompt, `initialize` must advertise history-free `session/resume`; `session/new`
or `session/resume` must report a scoped provider/model and native permission mode.
The console makes no mode/model/thinking/authentication calls and sends no CLI
overrides. Native hooks, skills, permissions and configured servers remain the
harness's responsibility. `mcpServers: []` adds no ephemeral client servers.
Only this task's stored `session_<uuid>` can be resumed. A changed model/provider
or a mismatched returned session refuses a new prompt. No history import/replay
or unrelated session attachment is implemented.

Only form elicitation is advertised. Up to3required ordinary fields can be text,
single choices or multiple choices. The form shows the native question and choices;
answers remain editable until Send answers. Decline and Cancel return the matching
native form outcome. Choice/length/required-field validation happens before the
pending request is consumed, so an invalid answer leaves it open. URL, secret,
optional/nested/unsupported forms require reconciliation in Kimi's native client.
Text inputs are not a secret vault.

An approval merges the native tool-call update with its preceding operation record
and displays the full bounded raw input, locations and supplied content/diff. When
Kimi requests approval before rawInput metadata arrives, only complete JSON object
arguments from that same call's preceding cumulative stream can supply the input;
partial JSON and display summaries alone cannot be approved. Only
a unique `allow_once` or `reject_once` option can be selected; session-wide options
are never offered or chosen. Cancellation returns ACP's cancelled outcome. Missing
operation input, mode-changing requests, changed pending operation details, unknown
reverse RPCs and oversized requests are refused. Client filesystem, terminal,
authentication and generic RPC execution are not advertised or provided. Native
auto-approved tools still follow the installed policy.

Response text and completed tool results stream into the existing task view.
`session/cancel` is only a stop request: the matching prompt's `stopReason: cancelled`
receipt is required before showing Interrupted. A success racing with Stop, missing
terminal receipt, disconnect or error remains Needs reconciliation; no automatic
retry starts. The independent watchdog, one-active-host rule and exact working-tree
review apply to all three adapters. No financial cap or whole-task savings is claimed.

The adapter follows the [official Kimi ACP contract](https://moonshotai.github.io/kimi-code/en/reference/kimi-acp)
and [ACP1 tool approvals](https://agentclientprotocol.com/protocol/v1/tool-calls),
[forms](https://agentclientprotocol.com/protocol/v1/elicitation) and
[sessions](https://agentclientprotocol.com/protocol/v1/session-setup). Installed-host
qualification is separate from protocol documentation and deterministic doubles.

## Girnel and other hosts

Girnel still owns its board/card status. Existing explicit card metadata links
remain an observation adapter. Console tasks are local durable work records;
creating/accepting them does not create/complete Girnel cards or KithMoot
assignments. Remaining integrations include an explicitly authorised selected-card browser
adapter, live Ollama model qualification and concurrent task isolation. Direct
Ollama must reuse its existing worker controls rather than introducing a raw-API
executor beside them.

## Protocol and validation

The host adapter follows the [official Codex app-server protocol](https://learn.chatgpt.com/docs/app-server),
checked against generated bindings from the installed CLI. The native harness
owns model execution; Z1P's optional local host controller owns this UI/journal.
The browser-safe core and repository MCP discovery surface are unchanged.

Focused tests exercise persistence, duplicate requests, stale/wrong approvals,
question routing, unsupported permission refusal, cancellation receipts,
disconnect/restart, changed configuration, checkout/path rejection, review-content
binding and expired activity rows. Independent process tests check timeout and
parent-death cleanup. Packed consumers and browser tests drive real stdio/HTTP
with a deterministic host double; those tests do not establish real model use.
Actual installed-host trials and their limits are recorded separately.

On 2 November 2026 the native Codex adapter completed a disposable-fixture
two-turn journey: request approval for the exact proposed patch, edit two files,
run a generated regression, review/request changes, resume the same stored thread,
verify again and accept through the fixture driver. An independent baseline
mutation made that regression fail. The installed model/provider and read-only,
on-request policy were retained. A preceding attempt stopped before write approval
and exposed the missing patch-preview path; that failure was retained and repaired.
This is one Codex fixture qualification, not all-host, billing or human acceptance.

On 2 November 2026 Claude Code 2.1.316 completed one disposable-fixture, two-turn
journey using its configured `claude-opus-5-5` / `firstParty` profile and `auto`
permission mode. Native fixture-local ask rules for Write/Edit/Bash were committed
before the trial; global settings were unchanged. The console displayed and
returned an AskUserQuestion answer and individually reviewed Bash requests,
including the exact two-file edit/test command. An independent baseline mutation
made the generated regression fail. A fresh owned process resumed the same UUID,
reran verification and reached fixture-driver acceptance after review. This is
not owner acceptance or a whole-task cost/savings measurement. A fixture setup
failure (ignored local settings file, before inference) was retained and repaired
with an explicit add of that fixture file; no additional model trial was needed.

Deterministic Claude wire tests also cover changed model/provider before a second
prompt, missing settings, one-operation decline/cancel, cancelled stale approvals,
unsupported/secret/oversized requests, wrong-session messages, interrupt-only
acknowledgements and successful results racing with Stop. Packaged HTTP/stdio
consumers cover all three adapters; browser fixtures cover task selection, approvals,
review, desktop/mobile layout and accessibility without model inference.


On 3 November 2026 Kimi Code 2.4.1 completed a disposable-fixture two-turn
journey with its configured `kimi-code/k3.1-pro` profile and `default` native
mode, without model/provider/thinking/permission overrides. The console returned
its native verification choice, displayed individually reviewed Bash requests,
streamed an actual edit and passing regression, and resumed the same stored
session in a fresh owned process. An independent baseline mutation made the
regression fail; the fixture driver accepted the second result. Fixture-scoped
context metadata and the requested question were handled by a deterministic test
driver; native auto-approved tools retained their installed policy. This is
fixture qualification, not owner acceptance or a whole-task billing measurement.

Two preceding one-turn attempts were reconciled before proceeding: the first
exposed approval before rawInput metadata, repaired by accepting only complete
same-call streamed JSON; the second exhausted its 240-second wall allowance
while waiting for operator decisions, with source unchanged. The final fixture
used the two remaining turns of the original four-turn allocation and the native
600-second default wall bound per process. It completed in approximately430seconds,
including review waits. Failed evidence and cleanup receipts were retained; no
provider refusal or uncertain result was automatically retried. Native context
calls also exposed unsupported `.txt` packet sources and an invalid checkpoint
state; Kimi recovered through supported source evidence and a valid saved checkpoint.


## Bounded Ollama worker

Add `--ollama-profile /absolute/private/ollama-console.json` in control mode.
The JSON file must be canonical, regular and private (0600). No helper is
installed, downloaded, pulled, restarted or exposed by this option. Supply the
existing Python executable, `ollama-workers` helper and engineering adapter:

```json
{
  "version": 1,
  "python": "/absolute/path/to/python3",
  "helper": "/absolute/path/to/ollama-workers/scripts/ollama_task.py",
  "engineeringAdapter": "/absolute/path/to/forgesworn-engineering/scripts/ollama_worker.py",
  "endpoint": "http://127.0.0.1:11435",
  "model": "deepseek-v4.1-flash:cloud",
  "think": "false",
  "maxOutput": 4096,
  "timeoutSeconds": 300,
  "routeReason": "Bounded coding draft from the selected checkout",
  "verification": null
}
```

Use an explicit eligible full model name. `localhost` can forward cloud
inference: the configured account/provider controls billing and disclosure.
The helper retains endpoint locking, pending markers, preflight, refusal and
receipt behaviour. No raw provider API executor or automatic fallback is added.
Startup reads helper status/inventory without inference. A pending marker or
missing model disables this host with a reason, leaving other hosts usable;
restart the dashboard after native reconciliation/eligibility changes. Native
inference is checked again immediately before dispatch. Profile contents are
bound to this worker task; changed model, endpoint, thinking, output/time limits,
helper paths or verification configuration refuse continuation.

Ollama requires 1–8 explicit supported non-hidden source file paths, with an
existing parent directory and at least one existing source. Directories, source
symlinks/hardlinks and excluded files are refused. Each existing file is at most
16,000 bytes; the source packet is at most 24 KiB. Missing selected output files
are recorded as absent. The controller uses the existing source-packet builder
and checks hashes, checkout identity, HEAD and navigation policy before disclosure
and before applying a replacement. It does not scan other projects or give the
model filesystem, MCP or shell tools.

Each turn asks separately to send the bounded packet to the configured worker,
apply exact whole-file UTF-8 replacements and run the operator-configured check.
The engineering adapter preflights its composed guidance plus packet before
inference. A returned JSON draft can replace only selected files; it cannot
select commands, permissions, endpoints, file modes or deletions. Unknown fields,
malformed JSON and oversized/out-of-scope drafts are refused. No response claims
establish that tests or tools ran. An approval is one operation, without a
remembered grant. Declined replacements remain drafts and are recorded as rejected
worker output if that no-change result is accepted locally.

For verification, replace `null` with an operator-owned object such as
`{"executable":"/absolute/path/to/node","args":["--test","regression.test.mjs"],"timeoutSeconds":60}`.
The exact executable, argv and checkout are shown for approval; no shell or
model-generated command is executed. Configure an appropriate profile/check for
the selected project. With `null`, or if the check is declined, the result says
that no verification ran. A numeric nonzero check exit is failure; timeout or
uncertain process effects require reconciliation. Configured project code runs
as the OS owner without a sandbox. Source guards are bounded point-in-time
checks, not hostile-process isolation or an atomic multi-file transaction. A
partial write or uncertain check never silently rolls back or replays.

Continuation uses a fresh owned controller and verified source packet, plus the
last bounded worker summary. This is not model-side KV/session resume, automatic
history import or a tool-using agent loop. At most16turns are retained per worker
task. The shared one-active-run and watchdog bounds remain. Stop before dispatch
or during an idle approval has a qualified local cancellation receipt; stopping
in-flight inference/checks remains Needs reconciliation because killing a local
client does not prove remote inference stopped. The original helper pending
marker is preserved and must be reconciled there; no automatic clearing/retry,
provider refusal replay or account-hold bypass occurs.

Worker task summaries are encrypted in the console journal. Packet/prompt files,
answers and original helper receipts remain in private 0700/0600 directories under
`CONTROL_DIR/workers/<task>/<turn>/`; they are **not encrypted at rest** by the
console. The engineering adapter's temporary composed prompt is managed by that
adapter. Keep receipts for accounting/reconciliation, then archive/remove completed
worker evidence explicitly; do not remove pending markers to make a retry work.
Local result review records the owner's disposition through the existing helper,
without another inference request. Provider-reported token counts are labelled;
missing usage, account totals and whole-task billing/savings remain unknown.

On 3 November 2026 the intended M4 endpoint responded to helper status and
inventory, with no pending request and **no listed models**. No inference trial,
model installation or fallback was attempted. A later fresh readiness check listed the intended Flash model, with no pending
request. The actual installed helper and engineering adapter then completed one
two-turn `deepseek-v4.1-flash:cloud` / thinking-off disposable fixture in 49.361 seconds:
reviewed replacements, configured verification, independent baseline rejection,
fresh-source-packet continuation and fixture-driver result acceptance. Exactly two
native calls were made, without fallback or automatic retry. Original receipts,
reported usage, partial/accepted helper reviews and cleanup evidence were retained.
This qualifies one bounded worker journey, not model-side session/KV reuse,
owner acceptance, every provider, account totals or whole-task billing/savings.
Deterministic controlled-endpoint/helper/browser evidence remains separate.
