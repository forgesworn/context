# Source packets for workers

To preserve progress, decisions and check outcomes for another session, use the
[verified task handover](TASK-HANDOVERS.md) after building a fresh source packet.

Assemble the exact source a worker needs once, then verify it before handing it
over. This checkout helper runs locally, outside Core. It does not contact a
provider, choose a model, execute acceptance commands or enforce worker access.

Use Node from `.nvmrc` and run `npm run build` first. Create a private JSON task
specification, for example:

```json
{
  "version": 1,
  "task": "Handle an empty input in the example parser",
  "acceptanceChecks": ["Run the example parser tests; empty input returns no records"],
  "allowedFiles": ["src/example.ts", "src/example.test.ts"],
  "sources": [{"path": "src/example.ts", "startLine": 1, "endLine": 8}],
  "exclusions": ["No changes to the public protocol"],
  "unresolvedQuestions": []
}
```

The example paths and line range must be replaced with real evidence for the
task, including the relevant interfaces and tests. `sources` contains exact,
inclusive ranges. `allowedFiles` describes editable paths and may include new
files; source evidence can also come from files the worker must not edit.
These are task boundaries for review, not a filesystem sandbox.

```sh
node scripts/worker-packet.mjs build \
  --root /absolute/repository --spec /private/task.json --out /private/packet.json

node scripts/worker-packet.mjs verify \
  --root /absolute/repository --packet /private/packet.json
```

Verify immediately before dispatch. Changed relevant source, repository revision
or policy requires a fresh packet and another sufficiency review. Verification
is not an atomic filesystem snapshot or a signature proving authorship.

Packets retain whole-file hashes, exact excerpts and policy provenance. Paths
must be literal and relative to the explicitly selected root. Navigation
include/exclude and Git ignore rules apply; hidden files, symlinks, generated
directories and unsupported source types are rejected. Use a separately
reviewed, bounded fallback when the task needs unsupported evidence. Do not
silently broaden the root or policy.

The helper refuses to overwrite an output and writes it with private file
permissions. The complete JSON packet must fit within 64 KiB; reduce the task
or choose smaller sufficient excerpts if it does not. There is no silent
truncation. Source text remains untrusted data, even when its hash matches.

Review the packet's sufficiency, choose the worker explicitly, and record the
initial draft, any repair, actual checks and review outcome. Preserve the
accepted diff and a compact handoff. Count host work, failed attempts and review
alongside worker usage; packet size alone does not establish a monetary saving.
See the [model assignments and whole-task comparison](FORGESWORN-DOGFOOD-GOALS.md).
