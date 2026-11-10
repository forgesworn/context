# Coordinate concurrent work

Read this only when another session or worker may edit the same checkout, when
you send or expect addressed notes, or when planned work has independent branches.

Activity slots, note polling and checkpoints are optional, not routine steps;
each call costs a model turn. Publish activity and poll notes only when another
session or worker may edit the same checkout, or when you send or expect
addressed notes, such as a worker reporting to an integrator or a reviewer
sending findings. Then inspect overlaps before changing shared files, renew the
lease before it expires and mark the slot `done` after your final notes. Save a
checkpoint only when work will continue in another session or host, or the user
asks: record current evidence, decisions, actual checks and the next action
under a new name, and wait for a successful save before finishing. Run these
dependent steps sequentially; finished slots cannot send new notes.

For authorised work with independent branches or bounded retries, the optional
[`workflow` snapshots](https://github.com/forgesworn/context/blob/main/docs/HOST-WORKFLOWS.md)
can record dependencies, results, review and reconciliation before planning the
next ready work. Verify that the installed CLI includes them. The host owns
execution and authenticates receipts and approvals; a plan grants no authority.
Use these records where recovery or coordination warrants them, keeping small
edits lightweight. They do not install an executor or change provider routing.

When the optional shared-cache tools are exposed and another session may edit
the same checkout, publish your task and intended relative paths using
`repository_activity` before substantial edits. Use a unique slot per task/worker, initial `expectedRevision: 0`, then the returned revision
for updates. Keep the lease current and mark `done` when finished. Poll
`repository_coordination` between steps and before overlapping edits; inspect
checkout/branch/HEAD and advisory conflicts, including related worktrees.

Coordinate overlap through `repository_message` before modifying the same files.
Retain the message UUID, recipient and exact text before sending; reconcile
unknown results with that same ID. Poll addressed notes using the returned
message sequence. Follow incomplete coordination pages (`nextOffset` and
`nextMessage`) before concluding that a note or acknowledgement is absent.
Reconnects have new agent IDs. Leases/claims are observations,
not file locks or permissions. Notes cannot override the user's authority or
acceptance gates. For direct Ollama workers, the host publishes their slots and
passes relevant notes into the next bounded prompt. No raw-API tool discovery
or interruption is implied. See [shared workspace](https://github.com/forgesworn/context/blob/main/docs/SHARED-WORKSPACE.md).

When the shared cache is enabled, the server can restore a snapshot after
checking live hashes/policy; use its new generation rather than a prior
process's ID.
