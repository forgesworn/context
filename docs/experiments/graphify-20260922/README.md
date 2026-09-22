# Three-way retrieval comparison: plain tools, Graphify, Context

Prospective protocol, 22 September 2026. Experiment
`three-way-plain-graphify-context-20260922-v1`. This is the first comparison
that includes Graphify; the earlier D5 pairs compared Context with ordinary
tools only. Results, when present, are in `RESULTS.md`. Nothing here is a
savings claim until that file records accepted outcomes and the aggregate.

## What is compared

Three arms run the same frozen task in the same headless coding client with
the same model and effort. Only source-discovery support differs:

| Arm | Tools available | Instruction text |
| --- | --- | --- |
| plain | Built-in Bash, Read, Edit, Write | One sentence naming those tools |
| graphify | The same, plus a Graphify graph prebuilt in `graphify-out/` without a model and the `graphify` CLI on PATH | Graphify's own always-on text (`always_on/claude-md.md`, hash in `protocol.json`) |
| context | The same, plus the z1p-repository stdio MCP server bound to the workspace with the task selection policy | The project instruction from the setup guide (`context-instructions.txt`) |

The eight tasks, seeded regressions, frozen archives, preparer and
deterministic checker are the locked v1 pack in `../d5-20260921`, reused
unchanged. Two repositories, four categories: orientation, diagnosis, impact and
an accepted code change.

## How an arm runs

1. `prepare-arm.mjs` extracts the frozen archive, applies the task's seeded
   patch, writes the selection policy and task marker, and commits the tree.
2. `npm ci --ignore-scripts` installs dependencies. This is shared setup and is
   not timed.
3. Arm setup: the graphify arm runs `graphify update <workspace>` and excludes
   `graphify-out/` from Git; the context arm gets an MCP config pointing the
   current Context build at the workspace. Both are recorded.
4. One fresh headless session receives the identical task prompt on stdin.
   The arm's instruction text is passed as a system prompt appendix so the
   frozen tree stays identical. Skills, other MCP servers, network tools,
   subagents and orchestration tools are disabled. The built-in agents-md
   plugin is disabled because a probe showed it injects the frozen tree's own
   AGENTS.md, which for the Context revision instructs use of Context tools.
5. `accept.mjs` runs the deterministic checker: schema, exact citation tokens
   against frozen hashes and a read-only tree for structured tasks; build,
   focused tests and behaviour probes for code tasks.
6. A fresh reviewer session with no tools receives the answer or diff, the
   private rubric, the checker result and bounded excerpts of the cited frozen
   source, and returns a structured verdict. It does not see the arm name.

Arms of one task run sequentially in a rotated order (`armOrders` in
`protocol.json`). Nothing is reused between arms.

## What is measured

From the client's stream: tool calls by name, bytes returned per tool, per
request usage, total input (fresh plus cache write plus cache read), uncached
input, output, the client's list-price cost estimate, turns and wall time.
Reviewer usage and time are recorded separately. Whole-arm time adds the
graphify build, executor, checker and reviewer.

The prospective decision rule follows the savings plan: all context-arm tasks
accepted; aggregate executor input tokens per accepted task at least 20 percent
lower than each comparator; no higher aggregate reviewer time. Token counts are
usage counters. The account is a subscription with no overage, so cash savings
are not established by any result here; a rate-limit or provider failure stops
the run without retry and is recorded.

## Run it

Private machine paths live in a `local.json` outside the repository:

```sh
node docs/experiments/graphify-20260922/run.mjs --local /private/local.json --task orientation-context
node docs/experiments/graphify-20260922/run.mjs --local /private/local.json --all
node docs/experiments/graphify-20260922/summarise.mjs --evidence /private/evidence --out docs/experiments/graphify-20260922/RESULTS.md
```

`--protocol DIR` runs the same harness under another locked protocol directory
(for example `../graphify-20260922-v2`). `replay-payloads.mjs --evidence DIR`
re-issues the Context arm's recorded MCP calls against the frozen workspaces
with the current build and reports o200k token counts for the JSON and compact
text forms plus one `repository_explore` per searched identifier; it calls no
model. `tool-use.mjs --evidence DIR` tabulates each arm's actual tool use from
the transcripts (Context calls by tool and bytes, Graphify CLI calls, reads).

Receipts, transcripts, prompts, answers, diffs and reviews stay in the private
evidence directory. Only the sanitised summary is committed.

## Known limits

- Graphify indexes the whole workspace; Context is confined to the selection
  policy. Graphify is not disadvantaged.
- The plain arm searches through Bash because this client build hides Grep and
  Glob when permissions are bypassed. All arms share that condition.
- Graphify's arm-specific build (about five seconds on these trees) is counted
  in whole-arm time; Context's refresh is a tool call inside the session.
- One model, one client version, eight tasks on two ForgeSworn repositories:
  an operational pilot, not a general performance claim.
- Graphify is an evaluation dependency installed in an isolated virtual
  environment. No Graphify code is copied into Context.
