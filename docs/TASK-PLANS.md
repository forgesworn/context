# Task plans in the local dashboard

In a control-enabled dashboard, open **New task plan**. Choose one saved checkout,
give the plan a title, and add up to eight steps. Each step names its host,
instructions, source files, required checks and prerequisite steps. Save creates
the plan and all draft tasks in one encrypted local transaction. It starts no
host, inference, worktree, command or background scheduler.

The **Task plans** section displays dependency arrows, assignments, reported host
status, planner state, blockers, required checks, working copies and review gates.
Open a step to use the existing managed-task controls. The section refreshes
every three seconds while visible. Existing registered-agent links remain a
separate observation/inbox surface; linking an external actor does not assign it
execution of a plan step.

## Run and review

1. Open a ready step and select **Run task**. Each step uses its own managed branch
   and worktree from committed HEAD. Select one to eight explicit supported source
   files, with at least one existing file. Each existing file must be a regular,
   non-symlink file of at most 16,000 bytes; the bounded packet is at most 48,000
   bytes. Source-policy exclusions still apply. New allowed files may be named.
2. The console builds an actual source packet in that worktree, records its hash
   in the existing host-workflow contract and rechecks it before sending a turn.
   Native hosts receive the packet and required checks. Ollama retains its own
   verified worker-packet and explicit dispatch/replacement/check approvals too.
3. The installed host retains its account, provider, model, approvals and tools.
   Intended paths are advisory, not a sandbox. No routing or spending settings are
   changed. The console does not execute check strings as shell commands.
4. A completed turn enters review. Record each named check's actual outcome and
   evidence, plus owner review evidence. **Accept reviewed result** requires every
   required check to be recorded as passed and the exact result/working-tree
   fingerprint to remain current. These are owner-recorded assertions, not tests
   executed or independently authenticated by the form. **Request changes** may
   record failed or unknown checks and allows an explicit follow-up attempt.
5. Dependent steps become ready only after their prerequisites have accepted
   results. No next step starts automatically. Before dispatch, each prerequisite's
   reviewed working tree is checked again; a changed prerequisite refuses the run.

Isolated branches are **not automatically merged**. The next host receives bounded
predecessor result text, working-copy/branch references and the reviewed hash as
untrusted observations. It must inspect and deliberately integrate required changes
under its existing controls. Local acceptance does not establish integration,
commit, merge, release, maintainer acceptance or Girnel card acceptance.

## Failure and limits

The existing `host-workflow` planner enforces dependencies, overlapping intended
paths, three attempts per step, the configured plan width and a total attempt
bound. Width cannot exceed console capacity. New starts stop 24 hours after plan
creation; the selected host's existing per-process deadline still applies. This
is not an aggregate wall-clock cancellation service or financial cap.

Failed, interrupted or disconnected turns retain an unknown workflow outcome.
After inspecting the native host, branch and external effects, record explicit
**Reconciliation evidence for a safe retry** before another run. A restart never
replays a run. A source-preparation failure also requires explicit reconciliation;
it does not fabricate a model attempt when none was recorded. Reconciliation is
an owner assertion, not proof of remote cancellation or permission to bypass a
provider refusal/spending hold.

Each revision is an immutable task contract. Use **Revise requirements** to change
instructions, hosts, files, checks, dependencies, title or concurrency. See the
revision workflow below. Arbitrary terminal-session attachment, CLI workflow
snapshot import, scheduled triggers and automatic commit/merge remain outside
this console. The existing workflow CLI/API remains available separately.

Up to 16 plans share the existing 64-task journal. One save is limited to the
existing 16 KiB same-origin JSON mutation bound. Saves retain their original UUID
and exact payload across an unknown browser response; explicit retry reconciles
that same request and cannot create a second plan or launch a host. The journal's
existing retention bounds apply to task output and action receipts.

Existing version-1 console journals continue to open. Saving the first plan
atomically promotes that control journal to version 2. Consoles before 0.22 refuse it
rather than running plan steps without the new gates. Keep the current console
for that journal; rollback requires a coherent earlier private backup, not removal
of plan metadata. The workspace cache and external inbox formats are unchanged.

## Change requirements and notify workers

Open a current plan and choose **Revise requirements**. The form copies its steps;
edit the required fields and explain the change. The checkout is fixed. Saving
creates a new immutable contract with fresh draft tasks and links both revisions
in one encrypted transaction. A no-op, changed root, stale base or second successor
is refused. A lost save response retains the exact UUID/payload for explicit retry;
retry returns the recorded revision rather than creating another one.

The view names directly changed steps and their downstream dependants, considering
the old and new dependency graphs. Changing the title or width affects the whole
plan. **All** older-revision results become historical, including unchanged steps:
acceptance is not silently carried across a contract change. The new host receives
bounded prior result and branch references so it can inspect and reuse applicable
work, then produce fresh evidence against the new requirements. Source branches,
files, receipts and earlier workflow events are preserved.

Previous revisions refuse new turns, owner acceptance and console approval grants.
Decline, cancel, stop, inbox reading and outcome reconciliation remain available.
A revision racing native startup is checked again immediately before turn dispatch.
Delayed older browser responses cannot restore superseded approval controls. The
new revision never starts a host or replays a turn automatically.

Each prior started, non-accepted task gets a private change note when its inbox has
capacity. It includes the new contract identity, impact, reason and instructions to
preserve work and report status. The note grants no new authority and does not
retarget a running turn. Existing registered workers receive it through their exact
worktree's addressed coordination inbox; only that delivered peer's `ACK <UUID>`
counts as acknowledgement. The same stored UUID reconciles delivery retries.

**Queued**, **Stored in shared inbox** and **Acknowledged** remain distinct. No prior
run and full inbox are explicit outcomes; retained notes are never overwritten to
make room. Unregistered workers, including raw Ollama text inference, cannot receive
asynchronous notes. A new explicit Ollama task receives the revised prompt through
its host and retains that helper's smaller combined packet/prompt bounds.

Running native work is not automatically cancelled. Review its status and use
**Stop run** or the original host where appropriate. An acknowledgement does not
prove the worker stopped, adopted the requirements or obtained new permission.
Started older tasks retain their worktrees and consume normal console capacity
until their actual host ends. Their earlier acceptance cannot satisfy new steps.

The revision view shows previous/newer links and defaults to current revisions;
**Show plan revisions → All revisions** includes history. Each saved revision
counts against the existing 16-plan/64-task bounds. Its new immutable contract has
its own explicit attempt/start window; an unchanged contract cannot be resaved
merely to reset the budget. Revision metrics describe their own events, not a
whole-task savings claim.

The first revision atomically promotes the control journal to version 3. Consoles
before 0.23 refuse that journal instead of ignoring the supersession guards. New
ordinary plans retain version 3 thereafter; version-1 and version-2 journals still
open in the new console. Workspace cache, external-inbox and MCP formats are
unchanged. No signing keys, raw host history or arbitrary process control is read.

## Data and evidence

Plan contracts, packets, check receipts and review evidence are stored in the
private encrypted control journal. They are served only through the existing
private loopback console capability and are excluded from workspace/Girnel
observation feeds. Normal published task titles, host labels, branches and intended
paths remain observations under the existing sharing rules. Running a step submits
its bounded packet and predecessor observations to the selected host, which owns
any provider disclosure. There is no new account, hosted store, telemetry,
listener, model provider or raw session-history import.

Attempt, retry and unresolved-outcome counts come from actual workflow events.
Usage and whole-task cost remain unknown here; owner check evidence and a local
acceptance label do not establish monetary savings. Use the existing
[usage receipts](DAILY-USAGE.md) for complete-task accounting.

Verification: `plan-revisions.test.ts` covers change impact, stale contracts,
startup races, old acceptance/approvals, historical receipts, exact peer ACKs,
full inboxes and retained journal version. The independent package/browser
revision probes add real stdio hosts, an MCP peer, executed fixture regressions,
lost saves, delayed UI responses and restart/history. These are deterministic
fixtures, not new four-model adoption qualification.

`console-workflow.test.ts` covers atomic/private saves, invalid
graphs, dependencies, check identity/acceptance, parallel worktrees, restart,
reconciliation and source changes before dispatch. The mandatory independent
package probe runs an actual HTTP server and stdio protocol-double processes,
executes fixture regressions and checks exact review, replay, restart and privacy.
The browser probe additionally exercises plan creation, a lost committed save
response, blocked buttons, named-check review, inert labels, desktop/mobile and
accessibility. These fixtures do not establish ordinary-session adoption or a
new four-model qualification.
