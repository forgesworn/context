# Bounded workflows for coding hosts

The optional control-enabled dashboard now connects this planner to
[managed task plans](TASK-PLANS.md): atomic draft creation, explicit per-step
dispatch, fresh source-packet receipts, prerequisite checks and exact owner review.
The offline CLI/API below remains independent. Neither surface schedules work or
grants native execution authority by itself.

The optional `@forgesworn/context-tools/host-workflow` API and `workflow` CLI
provide structured task records, dependency checks, deterministic result
reduction and resumable planning. They run locally with no account, model,
network request, command execution or additional dependency. The browser-safe
signed core and existing MCP tool inventory are unchanged.

This is the data and planning boundary for a coding host. The host still owns
execution, model choice, permissions, source verification, review and live
resource limits. A workflow record cannot grant authority. Availability in an
installed package does not mean a coding host automatically consumes this API.

## Tasks and dependencies

A workflow is an immutable contract plus an ordered event history. Its `root`
is one explicitly selected canonical checkout. `revision` is the SHA-256 identity
of the **task contract**, supplied and checked by the host. Change it when scope,
required checks or approval requirements change. It is not a live source hash:
ordinary authorised edits do not require starting the whole workflow again.
Each attempt records its own `packetSha256`; the host must verify the current
source packet before dispatch and again when freshness matters during review.

For example, save this JSON outside the checkout, replacing the root, task
revision and creation time with actual values:

```json
{
  "version": 1,
  "id": "api-change",
  "root": "/absolute/selected/checkout",
  "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "createdAt": 1793615400000,
  "nodes": [
    {
      "id": "implementation",
      "task": "Update the selected API and its focused regression",
      "dependsOn": [],
      "paths": ["src/api.ts", "test/api.test.ts"],
      "checks": ["Focused regression passes"],
      "maxAttempts": 2,
      "gate": null,
      "effect": "none",
      "costLimitMicros": null
    }
  ],
  "budget": {
    "maxConcurrent": 1,
    "maxAttempts": 2,
    "maxDurationMs": 1800000,
    "maxCostMicros": null
  }
}
```

`dependsOn` contains node IDs whose results must have passed independent review.
It describes a data dependency, rather than an arbitrary checklist order.
Cycles, missing dependencies, duplicate IDs, traversal paths and unknown schema
fields are refused. Up to 64 nodes, 16 concurrent attempts, 16 attempts per node,
1,024 total attempts, 4,096 events and 2 MiB per record are supported.
The duration limit is at most 24 hours.

Planning returns ready node IDs in contract order. It respects available
concurrency, remaining attempts, current approval assertions and overlapping
normalised relative paths. Directory paths overlap their descendants. The
path claims remain through review and uncertain-outcome reconciliation.
Unrelated work can still use free execution slots. These checks only govern a
host that follows the plan; they are not filesystem locks
and do not discover case aliases, symlinks or another independent planner.

## Events, review and recovery

Use `appendWorkflowEvent(record, event, expectedSequence, observation)`:

| Event | Required information and effect |
| --- | --- |
| `start` | Unique event ID, node, globally unique attempt ID, actor, timestamp, current verified packet SHA-256 and nullable approval evidence. Reserves a slot. |
| `result` | Matching node/attempt/actor, outcome, failure classification, checks with evidence, source-backed findings and usage. Releases the running slot. |
| `review` | Matching successful result, reviewer, acceptance decision and evidence. Acceptance requires every declared check to pass and a reviewer ID different from the worker. |
| `reconcile` | Readback evidence and `retry_safe` or `stop` for an uncertain outcome or an unaccepted external effect. |
| `cancel` | Actor, timestamp and reason. Prevents new starts; late results can still be recorded. |

Every event has `id`, `type`, `at` and `actor`. Attempt events also have `node`
and `attempt`. A result includes `outcome` (`succeeded`, `failed`, `unknown`),
`failure` (`transient`, `invalid_output`, `refused`, `spend_hold`, or null),
`checks`, `findings` and `usage`. Each check has `check`, `outcome` and `evidence`.
Each finding has `id`, `claim` and source ranges with `path`, `startLine`,
`endLine` and `sha256`. Usage has nullable `inputTokens`, `outputTokens` and
`costMicros`. A review includes `accepted` and `evidence`; reconciliation includes
`resolution` and `evidence`; cancellation includes `evidence`.

The trusted host separately supplies `{root, revision, now, approvals}`.
An approval assertion is `{gate, revision, evidence}`. It must match the current
task revision and the start event's `approvalEvidence`. The host authenticates
the actual approval and checks that its scope covers the proposed action.
External-effect nodes require a named gate. Worker text cannot create a grant.
Existing authorisation can satisfy the host's gate; this does not require asking
the owner again for an already authorised action.

Different actor IDs are a consistency check, not authentication or proof of
independent judgement. The host must obtain and inspect real test/review
receipts. `reportedComplete` means every node has a recorded accepted result;
it is not maintainer acceptance, release proof or permission to publish.

An in-flight attempt remains in flight after serialisation and restart. A host
must inspect it and record an outcome; restart never implicitly retries it.
Unknown outcomes require reconciliation. Failed or review-rejected external
effects also require reconciliation before another attempt. Refusals cannot be
retried through this workflow; a spending hold stops all new work. Exhausted
nodes remain visible, and completed unrelated nodes are retained.

Events have stable identities. Retrying the same event ID with identical content
returns the same record; changing its content is refused. An ordinary append
requires the current event count. This comparison is against the supplied
snapshot: it does not provide cross-process consensus. Use one coordinating
writer, or a host-owned transactional store, to avoid divergent histories.

## Local CLI snapshots

Build the checkout first, or use an installation containing these commands.
The output directory must already exist, be canonical and private (0700 on
POSIX). New files are 0600, written and synced before exclusive publication.
Existing outputs and symlink inputs/outputs are refused. Use a new filename for
each snapshot. Keep records outside version control; their findings and evidence
are plaintext, not encrypted collections. `plan` and `qualify` print JSON to
stdout, so direct captures to appropriate private storage.

```sh
z1p workflow init --root /absolute/checkout \
  --spec /private/task/spec.json --out /private/task/workflow-001.json

z1p workflow plan --root /absolute/checkout \
  --record /private/task/workflow-001.json --observation /private/task/observation.json

z1p workflow append --root /absolute/checkout \
  --record /private/task/workflow-001.json --event /private/task/event.json \
  --observation /private/task/observation.json --sequence 0 \
  --out /private/task/workflow-002.json
```

Snapshot storage requires same-directory hard links. Power loss can leave a
private `.workflow-*.tmp`; remove only a confirmed orphan. Filesystem crash
durability, hostile concurrent filesystem writers and automatic discovery of
the newest snapshot are outside this contract. Reconcile an uncertain write by
reading its destination before retrying. The CLI reads only explicitly named
inputs and Git root metadata; it does not index siblings or select a provider.

## Reduction and accounting

`reduceWorkflowFindings` merges exact claims with the same source evidence,
normalises source order and retains contributing node/attempt identities.
Conflicting claims using one finding ID remain separate and are reported.
Multiple workers repeating a finding are not independent corroboration.
`planWorkflow` reduces findings from accepted attempts only. It reports retries,
failed attempts, rejected reviews, unresolved outcomes and elapsed time.

The usage totals cover attempt results only. Unknown counters remain null;
observed subtotals are labelled. Whole-task cost is always unknown here because
coordinator, preparation, review and repair phases need the existing
[complete-task accounting](DAILY-USAGE.md). A configured money cap requires a
per-attempt cost limit, reserves running/proposed limits and pauses new work when
observed spend is unknown or excessive. The executor must enforce the actual
per-call cap, cancellation and deadlines; planning cannot stop a running model.

## Host qualification

`assessHostLifecycle` and `workflow qualify --root ABS --trace ABS` check a
version-1 record with `host`, `hostVersion`, `transport`, `root`,
`automaticGuidance` and `observations`. Each observation contains `step`, `at`,
`passed`, `evidence`, `session` and nullable `generation`.

The required ordered steps are startup, status, coordination, activity,
message_sent, message_received, packet, edit, stale_rejected, refresh,
fresh_packet, checks, checkpoint, restart, resume and done. These are a controlled
qualification scenario, not a requirement to edit files or send messages during
every ordinary task. Evidence should point to retained actual host/tool traces.
The report checks omissions, failures, ordering, packet generations and a new
session after restart. It never authenticates supplied observations:
`reported_complete` must not be promoted to host acceptance without inspection.

Native, shell and direct-Ollama host-packet transports are separate observations.
Direct Ollama uses `host_packet`; its coding host supplies current evidence and
represents activity/messages. No raw inference MCP discovery is implied.

Current qualification: the actual Codex startup hook and native Context tools
work. Full clean-session edit/restart/coordination acceptance remains separate
for each host. Claude's prior trial followed Bash rather than the complete
workflow; Kimi's native retrieval did not establish the full lifecycle. Ollama's
bounded helper trial established host mediation, not an independent lifecycle.
No new model call, paid trial or provider configuration is introduced here.

## Jev and execution runtimes

The next optional integration belongs in the coding host. Keep deterministic
rules first; use a decision model only for a bounded semantic choice. Jev could
classify task suitability or escalation, while an existing local model provides
a comparison arm. Lock labels and an abstain/escalate path before evaluation;
measure routing errors and total accepted-result cost, including failed cheap
attempts. Verify confidence on our labelled tasks rather than importing a
vendor's threshold or treating a score as authority.

No Jev, LangGraph, alternate Ollama runner, API credential or hosted source upload
is added. A runtime can consume these contracts after its permissions, uncertain
effects, deadlines and cancellation behaviour are qualified. The code graph
continues to supply evidence; the host's execution graph determines the work.

Design inputs: Lunar Researcher's [graph guide](https://lunarresearcher.substack.com/p/graph-engineering-the-complete-guide)
and public [loop preview](https://lunarresearcher.substack.com/p/the-kimi-k3-loop-stack-from-300-agents),
the [Jev/LangGraph article](https://www.langchain.com/blog/building-prod-with-jev-and-langgraph),
and TypeSafe's [coding-agent boundary](https://docs.typesafe.ai/introduction/coding-agents).
These sources inform the design, not evidence of our host acceptance or savings.
