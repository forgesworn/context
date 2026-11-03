# Console collaboration acceptance

## Live pilot, 3 November 2026

The installed 0.19.0 GitHub release (`ef201a1310f6ac034f7f3bd78b7a6eebd7f66cf7`)
was exercised against disposable Git fixtures. Actual installed hosts ran their
existing profiles; the controller supplied no model, provider or native permission
overrides. Private transcripts, task snapshots, reviewed approvals, fixture files
and helper receipts were retained outside the repository. No owner project task,
external ticket or production service was changed.

| Journey | Observed result |
| --- | --- |
| Codex to Claude | Passed: concurrent isolated worktrees; native worker registrations; handover delivery; receiver ACK and exact received token; separate tested changes |
| Codex to Kimi | Passed after a corrective inbox note: handover delivery, valid ACK, exact received token and independent regression |
| Ollama queued continuation | Passed: note queued during the first turn, absent from that turn's packet, then included in a fresh packet on explicit continuation; exact token replacement and configured verification |
| Fresh Kimi with explicit sender guidance | Passed: first ACK attempt used the registered worker sender; recorded ACK, exact token and test verified |
| Completed native state after controller restart | Passed: saved thread IDs, working copies, inboxes and reviews retained; no automatic turn during a 12-second observation |

The observed models were `gpt-6.1-sol` through OpenAI,
`claude-opus-5-5` through Claude's first-party host, `k3.1-pro` through Kimi Code and
`deepseek-v4.1-flash:cloud` with thinking off through the existing M4 helper.
These are dated receipts, not model-selection requirements or recommendations.
Codex retained its read-only sandbox and on-request approvals. Its one-file
fixture edit required a reviewed, one-operation native approval. Claude reported
its existing `auto` approval mode and did not report sandbox details. Kimi retained
its default approval mode; fixture-scoped metadata and test requests were reviewed
by the driver, and sandbox details were not reported.

The host independently ran each regression against the changed source, restored
the original bug and observed failure, then restored the reviewed source.
The selected original checkout remained unchanged. Each native receiver was
asked to wait for an incoming token it had not been given in its task objective;
the test compared its resulting receipt file with the sender's exact token.
A console delivery timestamp alone was insufficient: the receiver's explicit
ACK had to be retained too. Result acceptance was by the fixture driver, not the
project owner.

Ollama made exactly two successful helper requests with no fallback or automatic
retry. The original receipts reported 15,298 prompt tokens and 304 completion
tokens (15,602 total); both reviewed drafts and configured checks passed.
The first result was marked partial when requesting the explicit continuation,
and the final result accepted. The note remained queued throughout the first
turn and was marked submitted, with ACK unconfirmed, on the second. This does not
give a bounded text worker a live MCP inbox or model-side session/KV reuse.
Host preparation, review and other native usage were not fully accounted; whole
task tokens, account billing and savings remain unknown.

## Sender-slot correction

The initial Kimi receiver used the console slot as `repository_message.slot`
twice. The server rejected both requests because that connection had not
registered that sender. A corrective addressed note explained the sender slot;
Kimi then ACKed from its actual worker identity and completed the fixture.
The controller did not count either rejected request as acknowledgement.

The 0.19.1 generated instructions now name the registered worker sender slot,
`expectedRoot` and ACK `recipientAgentId` explicitly, and retain that sender slot
for progress and handover notes. Native permissions and transport validation are
unchanged. One fresh actual Kimi task against this wording used the correct
sender on its first ACK attempt, received the recorded acknowledgement, wrote the
exact token and passed the existing regression. No corrective note was needed.
It also recovered from two unsupported `.txt` packet selections and a checkpoint
state validation error; those errors remain in the retained transcript.

The pilot used four native turns before the wording change and one fresh Kimi
turn afterwards, plus the two bounded Ollama requests. A completed-state restart
retained the three original native task records without starting a new turn.

## Repeating the acceptance

Use a disposable committed repository with independent source and test files for
each host. Configure the console and native MCP clients to share the same private
workspace cache. Save the fixture workspace in that cache before creating tasks;
an `allowedRoots` argument alone does not create a catalogue entry. Leave the
owner's running console and projects untouched.

1. Create receiver and sender tasks with separate managed worktrees and explicit
   intended files. Start both through the console using existing native profiles.
2. Give only the sender a fresh random token and the receiver's console address.
   Ask the receiver to register its supplied worker slot, poll addressed notes
   within a bounded interval, ACK the note and record the received token.
3. Review native approvals against the exact fixture checkout and operation.
   Require real worker registrations, recorded delivery, an ACK from the recorded
   recipient and an independently matched receipt file.
4. Verify each scoped change with its test. Restore the original source and
   require that same test to fail; restore the reviewed bytes afterwards. Check
   that the source checkout and other task's worktree are unchanged.
5. Explicitly continue the sender's saved thread for another receiver. For a
   bounded Ollama worker, queue a note after the first packet is prepared, prove
   it stays queued through that turn, then explicitly continue with a fresh packet.
6. Restart the controller after terminal results and compare saved thread IDs,
   working copies, inboxes and reviews. Observe zero active runs and no new turn.
   Keep this separate from the controlled active-interruption test.
7. Retain evidence and original helper receipts; reconcile any unknown remote
   outcome before retrying. Preserve reviewed fixture files before clearing only
   task-created changes. Verify the resulting worktrees are clean and their
   branches are merged before `git worktree remove` and `git worktree prune`.
   Stop all pilot-owned processes and remove their disposable cache entries.

## Scope and remaining gates

This is a bounded fixture qualification on one Mac with these configured profiles.
It does not establish universal adoption, independent developer acceptance,
all-host simultaneous production work or an unattended approval policy.
The pilot used explicit collaboration tasks and a fixture driver that reviewed
scoped approvals; it is not evidence that every ordinary task polls at the right
time without prompting. Notes did not grant permission or launch turns.

[Automated package acceptance](../test/concurrent-console-package-probe.mjs)
separately covers two native-protocol doubles, actual MCP clients, interruption
while waiting for approvals, no automatic replay, explicit thread continuation
and independent review. Browser acceptance covers inbox/review filters and mobile
layout. Those tests remain distinct from actual model adoption. The live pilot
did not kill an in-flight model request or establish seamless live crash recovery.
Attaching existing external sessions, live Girnel mutations and account-wide cost
measurement remain separate work.
