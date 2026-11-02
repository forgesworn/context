# Local task console

The optional task console lets the owner save a task, choose a checkout, start an
installed coding host, answer its supported questions/approvals, inspect changes
and tests, and continue its saved conversation. Local result acceptance is
separate from committing, merging, deployment and Girnel acceptance.

The first adapter is **Codex app-server**, tested against installed Codex CLI
0.166.0. Claude, Kimi and Ollama appear as pending adapters and cannot be launched
by this version. Existing independent terminal/app sessions are not attached or
imported. Oathrun/KithMoot execution routes and their grants remain separate.

## Start an explicit control session

```sh
z1p workspace dashboard /absolute/workspace --cache-dir /absolute/private/cache \
  --control-dir /absolute/private/task-console --codex /absolute/path/to/codex \
  --max-run-seconds 600
```

Find the installed executable with `command -v codex`. Add `--repo` to restrict
the console's selection to one canonical saved-catalogue checkout. Existing
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
   child `codex app-server --listen stdio://` in that checkout. It inherits the
   installed account, model/provider, reasoning, sandbox and approval configuration.
   The adapter sends no model, provider or permission overrides. Effective host
   settings are shown once its thread is created.
3. Follow streamed response text, completed command/test output and file-change
   records. A host requesting supported approval waits for the owner. Approvals
   offer one-request accept, decline or cancel, without policy amendments or
   accept-for-session. Ordinary non-secret user questions can be answered here.
4. **Stop run** requests interruption. An acknowledgement alone is not a terminal
   receipt. The UI shows interrupted only after the host reports it; uncertain
   outcomes remain labelled Needs reconciliation.
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
release memory. macOS/Linux are the qualified platform scope of this adapter.
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

## Girnel and other hosts

Girnel still owns its board/card status. Existing explicit card metadata links
remain an observation adapter. Console tasks are local durable work records;
creating/accepting them does not create/complete Girnel cards or KithMoot
assignments. The next integration is an explicitly authorised selected-card
browser adapter, followed by qualified Claude/Kimi/Ollama host adapters. Direct
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
