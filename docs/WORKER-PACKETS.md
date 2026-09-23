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

## Request a packet through MCP

The repository navigation server also exposes `repository_packet`. A client can
request source directly without invoking the checkout helper or writing a task
specification to disk. Restart the server after installing/building this version,
then call `repository_refresh` and retain its `generation`.

```json
{
  "mode": "plan",
  "expectedGeneration": "generation returned by repository_refresh",
  "maxBytes": 65536,
  "spec": {
    "version": 1,
    "task": "Inspect the selected implementation and its test",
    "acceptanceChecks": ["Return complete selected syntax blocks"],
    "allowedFiles": ["src/example.ts", "src/example.test.ts"],
    "sources": [
      {"path": "src/example.ts", "line": 24},
      {"path": "src/example.test.ts", "line": 12}
    ],
    "exclusions": ["No public protocol changes"],
    "unresolvedQuestions": []
  }
}
```

Replace the example paths and anchors with located evidence. Use `mode: "build"`
and `{path, startLine, endLine}` source entries for reviewed exact ranges,
including languages without syntax planning. Through MCP only `sources` is
required: omitted handoff metadata gets a neutral task and acceptance check, and
an `endLine` past the end of a file reads to its last line (the packet records
the range actually read). A range starting past the end is still rejected with
the file's line count. A plan anchor outside every supported block is rejected
with a pointer to `mode: "build"`. The CLI keeps the strict spec. The server accepts an inline spec;
it cannot accept a different root, spec-file path, output path or shell command.
The configured root must be a Git repository with a committed HEAD. Internal
`git rev-parse` calls read provenance; the tool does not execute acceptance checks.

The response contains the packet, navigation generation/revision/policy and,
for planning, coverage metadata. The complete response must fit `maxBytes`
(default/maximum 65,536 bytes), including metadata. Oversized selections fail
without truncation. The tool rejects unavailable, stale or unknown navigation
and a mismatched generation, and checks freshness again before returning. Refresh
and rebuild after relevant changes. This is bounded freshness checking, not an
atomic snapshot against hostile concurrent filesystem changes.
Only one packet request runs at a time; concurrent requests wait in order (up to
eight), and a further one fails immediately.
Cancellation is checked around assembly and freshness inspection. The shared
bounded assembler does not interrupt an individual file read or Git provenance
check already in progress; cancelled results are not returned as successful packets.

Source remains unsigned data. Complete syntax does not prove complete task
evidence, and `allowedFiles` does not grant editing authority. Review sufficiency
and retain the response with the task receipt before delegating work.

## Use the checkout CLI

```sh
node scripts/worker-packet.mjs build \
  --root /absolute/repository --spec /private/task.json --out /private/packet.json

node scripts/worker-packet.mjs verify \
  --root /absolute/repository --packet /private/packet.json
```

Verify immediately before dispatch. Changed relevant source, repository revision
or policy requires a fresh packet and another sufficiency review. Verification
is not an atomic filesystem snapshot or a signature proving authorship.

## Plan complete syntax blocks

For TypeScript and JavaScript, `plan` accepts the same task fields as `build`,
but each source is a line anchor: `{"path":"src/example.ts","line":24}`.
Locate a relevant implementation and its focused tests first, then anchor their
declarations or callback calls. The helper resolves complete syntax blocks and
merges overlapping or adjacent ranges before building an ordinary v1 packet:

```sh
node scripts/worker-packet.mjs plan \
  --root /absolute/repository --spec /private/anchors.json --out /private/packet.json

node scripts/worker-packet.mjs verify \
  --root /absolute/repository --packet /private/packet.json
```

The output file is the same private, verifiable packet used by `build`. Standard
output includes unsigned coverage metadata mapping every anchor to its resolved
range, the merged ranges and a digest of the emitted packet. Retain this metadata
with the task receipt; inspect it before dispatch. Repeated anchors do not repeat
the same source lines in the packet.

The planner selects the smallest enclosing supported function, method,
constructor, accessor, named arrow/function-expression owner, statement-level
call with a direct function callback, named class, interface, type alias or
enum. A field or signature line therefore selects its whole declaration, while a
line inside a method still selects only the method; imports and other top-level
statements are not planned. A callback call is a syntactic category,
not a guarantee that it is a test: nested `it(...)` inside `describe(...)` selects
the `it` call, but an anchor inside a smaller callback-bearing helper may select
that helper. Anchor the outer declaration/call when its whole block is needed.

Planning supports `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs` and `.cjs`.
It rejects malformed source, ambiguous or unsupported anchors, excluded paths,
and an oversized result rather than truncating a branch. Interfaces, plain data,
Markdown and other languages still use reviewed exact ranges with `build`.
Source, root, HEAD and relevant policy must agree between planning and assembly.
Line anchors use the packet format's LF/CRLF convention; bare CR and Unicode
line separators require the exact-range fallback. A selected block's boundary
lines must not contain unrelated code; the conservative guard also rejects
trailing comments outside the selected node. Inspect the coverage and choose
reviewed exact ranges when syntax planning cannot express the intended evidence.

Complete syntax is **not complete task evidence**. Select dependencies, fixtures,
types and external contracts explicitly using the appropriate helper mode.
Source remains untrusted data. Before a behavioural handoff, record the relevant
conditions, outcomes and exceptions; require the worker to distinguish what the
source proves from what remains unknown. Review can read additional evidence.
The planner does not run tests, prove claims, select models or claim savings.
See [the savings plan](SAVINGS-PLAN.md) for the measured problem and acceptance
criteria.

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
