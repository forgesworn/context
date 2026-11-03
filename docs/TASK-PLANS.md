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

Plans are immutable task contracts. To change requirements, hosts, files, checks
or dependencies, save a new plan. This first integration does not propagate a
revised contract into existing agents, attach arbitrary terminal sessions to plan
execution, import CLI workflow snapshots, schedule triggers or automatically
commit/merge branches. The existing workflow CLI/API remains available separately.

Up to 16 plans share the existing 64-task journal. One save is limited to the
existing 16 KiB same-origin JSON mutation bound. Saves retain their original UUID
and exact payload across an unknown browser response; explicit retry reconciles
that same request and cannot create a second plan or launch a host. The journal's
existing retention bounds apply to task output and action receipts.

Existing version-1 console journals continue to open. Saving the first plan
atomically promotes that control journal to version 2. Older consoles refuse it
rather than running plan steps without the new gates. Keep the current console
for that journal; rollback requires a coherent earlier private backup, not removal
of plan metadata. The workspace cache and external inbox formats are unchanged.

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

Verification: `console-workflow.test.ts` covers atomic/private saves, invalid
graphs, dependencies, check identity/acceptance, parallel worktrees, restart,
reconciliation and source changes before dispatch. The mandatory independent
package probe runs an actual HTTP server and stdio protocol-double processes,
executes fixture regressions and checks exact review, replay, restart and privacy.
The browser probe additionally exercises plan creation, a lost committed save
response, blocked buttons, named-check review, inert labels, desktop/mobile and
accessibility. These fixtures do not establish ordinary-session adoption or a
new four-model qualification.
