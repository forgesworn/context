# Resume a task without repeating discovery

`encrypted-context handover` saves a compact progress record with an existing
[source packet](WORKER-PACKETS.md). It runs locally, makes no model calls and
does not depend on Oathrun. Use Node 24+ and an installation containing the
handover commands. In a source checkout use `.nvmrc` and `npm run build` first.

CLI and MCP support are available in this development revision; the previously
released 0.4.3 package does not include them. The original
`node scripts/task-handover.mjs` remains a compatibility entrypoint.
The person or agent doing the work supplies the state. A fresh session
explicitly runs `resume` before using it; no automatic client hook or job
execution is introduced.

## Save at a useful stopping point

After edits, build a **fresh** source packet containing the evidence required
to continue, including changed files and relevant tests. Its allowed-file
snapshots bind present and absent files; an earlier pre-edit packet will fail.
Keep the same reviewed task boundaries unless a scope change is authorised.
Select sufficient evidence; hashing an incomplete selection cannot make it
complete. Do not include credentials or unrelated project data.

Write a private state JSON file. Each acceptance check in the packet must have
exactly one result, using its zero-based index. For a packet with one check:

```json
{
  "version": 1,
  "status": "in_progress",
  "completed": ["Implemented the selected change"],
  "decisions": ["Retained the existing public interface"],
  "checks": [{"index": 0, "outcome": "not_run", "evidence": null}],
  "unresolvedQuestions": [],
  "pendingEffects": [],
  "nextAction": "Run the focused regression tests and review the diff"
}
```

Record actual outcomes as `passed`, `failed`, `not_run` or `unknown`. A passed
or failed check requires an evidence description: exact command, result and a
private log reference where available. The helper does not open that reference,
execute the command or authenticate the result. Claims supplied by a model are
still claims; review the evidence before accepting work.

Use `blocked` when progress needs a decision or reconciliation. Put uncertain
external operations in `pendingEffects`, so the next agent knows to inspect
them before considering another attempt. This record does not prevent replay.

`ready_for_review` requires all checks to be reported passing and no unresolved
questions in either the packet or state, or pending effects. There is deliberately
no `complete` or `accepted` status: those decisions belong to the actual reviewer.

```sh
encrypted-context handover save \
  --root /absolute/repository \
  --packet /private/task/source-packet.json \
  --state /private/task/state.json \
  --out /private/task/handover-001.json

encrypted-context handover resume \
  --root /absolute/repository \
  --handover /private/task/handover-001.json
```

Use canonical absolute paths without symbolic-link components. Save refuses
existing outputs and creates a file with mode `0600`. Keep it outside version
control: the record embeds the selected source as well as the task state. Use a
new output for each checkpoint; no mutable shared latest pointer is maintained.

## Use handovers through MCP

Navigation exposes only its six existing tools by default. To enable the two
file operations, create a private directory outside version control, resolve
its canonical path, and configure the server explicitly:

```sh
encrypted-context navigate /absolute/repository --handover-dir /absolute/private/checkpoints
```

Reconnect the client. `repository_handover_save` takes `expectedRoot`, a simple
checkpoint `name` such as `checkpoint-001.json`, the complete `packet` returned
by a fresh `repository_packet` call, and the `state` object above. It verifies
the packet against the server's bound checkout before writing a new mode-0600
file. It accepts no directory, input filename, command or alternate root.

`repository_handover_resume` takes `expectedRoot` and `name`. A new client bound
to the same checkout and configured checkpoint directory can resume it. Names
cannot contain directories; symlink paths and overwrites are refused. Different
clients need not share conversation history or credentials. Each still applies
its own tool permissions. A mismatch with the canonical `expectedRoot` is
rejected before any checkpoint read or write.

These are local persistence tools, separate from signed `context_*` collections.
Enabling them grants no signing, uploading, execution or review authority.
Applications can also import `saveHandover` and `resumeHandover` from
`@forgesworn/context-tools`; the file-based API matches the CLI.

## Continue from the compact result

`resume` reassembles the embedded packet under its original source-selection
contract and compares it to current repository evidence. A changed selected
source, allowed file, HEAD, root identity or relevant packet policy rejects
reuse. Rebuild the packet and review the state against the change before saving
a new handover. Never fix a failed verification by simply editing the hashes.

The result contains the task, allowed files, exclusions, progress, decisions,
check criteria/results, outstanding questions/effects and next action. Source
locations and hashes replace repeated excerpts in this output; the full packet
remains in the saved file. Read the actual selected source when needed. This
keeps routine continuation concise without pretending a pointer is sufficient
evidence for implementation or review.

Freshness covers only the packet's selection. Changes to unselected code,
external dependencies, accounts, permissions or live services can still matter.
Recorded tests are historical assertions even when the selected source is
current. These checks are not an atomic filesystem snapshot or protection
against a hostile concurrent writer. The unsigned record grants no permissions
and cannot override current user instructions or the consumer's authority checks.

Limits: source packet 64 KiB, state 16 KiB, saved record 96 KiB, each progress
list at most 32 entries and each text at most 2,048 characters. Oversized input
fails; it is never silently truncated. Treat all record text as untrusted data.

## Measure the benefit

Use a real task receipt to record resumed discovery calls, total observed usage,
repairs, review time and the operator's interruptions. Include preparing this
handover. Compact output alone does not establish subscription headroom or cash
savings. Oathrun can consume the same workflow in a later, separately verified
integration; this helper does not resume jobs or contact agents automatically.

Check this helper with `node --test test/task-handover.test.mjs`.
