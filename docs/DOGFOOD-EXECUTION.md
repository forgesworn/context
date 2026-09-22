# ForgeSworn dogfood execution ledger

21 September 2026. This records implementation and acceptance separately from
the [goal definitions](FORGESWORN-DOGFOOD-GOALS.md).

## Initial pilot implementation and verification

- `04fda60`: adoption goals and daily agent workflow.
- `b1a4de8`: manifest freshness, cancellable inspection, bounded concurrent
  status handling and a repeatable two-process MCP smoke.
- `c57176e`: repository selection honours scoped `.gitignore` rules and explicit
  include/exclude prefixes. Policy changes block old-snapshot search until
  successful refresh. Policy hashes are part of the source revision.
- Policy reads reject malformed input, symlinks, non-regular files, read races,
  invalid UTF-8 and resource overflows. Error messages do not echo invalid JSON.

`npm run check` passes 33 core and 103 tools tests plus independent packed
imports, browser isolation and CLI persistence. Both unchanged benchmark gates
pass with declared-source recall 1.0. The SDK stdio navigation smoke passes in
two fresh server processes. [Candidate CI passed](https://github.com/forgesworn/context/actions/runs/35595286973)
for `c57176e3c62249d54bec69ad36c2665205e9a563`, including both benchmark gates,
the navigation smoke and the synthetic scale checks.

Both package tarballs from that clean commit were installed into an independent,
commit-pinned local release directory. The installed CLI passed all nine smoke
checks in two fresh server processes. SHA-256 receipts identify the exact
artifacts; this is an internal installation, not a public registry release.

The cancellation diagnosis was a real use of the navigation tool: its source
pointers located `inspectFreshness`, and a controlled filesystem reproduction
showed cancellation still reading both fixture files and returning `current`.
After repair, status and search each reject after one open and preserve the
continuation cursor. Source discovery preceded some recorded tool calls, so
this is dogfood evidence, not a controlled savings experiment.

## Real repository limits

Both complete KithMoot and Oathrun roots exceeded the 100,000-location cap.
No limit was raised and no omission was hidden. Explicit local pilot scopes
produce these single-run observations:

| Root | Include scope | Indexed files / locations | Refresh / first query |
| --- | --- | --- | --- |
| KithMoot | `src`, `packages`, `README.md` | 216 / 47,044 | 183 ms / 53 ms |
| Oathrun | `src`, `README.md`, `docs/CONTEXT-CACHE-PLAN.md`, `docs/CHAT-CODING-DELIVERY-PLAN.md` | 128 / 70,945 | 158 ms / 31 ms |

Queries returned bounded source references for `ContextVault` and `workspace`,
respectively. These timings are not guarantees. Scope excludes other important
areas, including KithMoot's app and test directories and Oathrun's tests, web
and deployment directories. Use explicit policy edits or bounded source reads
when a task needs them; do not claim whole-repository coverage.

KithMoot was clean before its local pilot configuration was added. Oathrun had
existing local changes and was 85 commits behind its configured upstream during
preflight; that state was preserved. Evidence applies to the inspected local
revision, not an assertion about the current deployed Oathrun system.

## Actual client acceptance

Three fresh Codex CLI sessions used the installed, pinned build through each
project's own `z1p-repository` binding. Each started with an unavailable index,
refreshed successfully and returned source references checked against the local
files. All used `gpt-5.6-luna`, medium effort, in read-only mode:

| Project | Accepted source conclusion | MCP calls |
| --- | --- | --- |
| Context | Located the policy-freshness search guard; identified unsigned navigation | 6 |
| KithMoot | Located the `ContextVault` persistence wrapper and explicit write path | 6 |
| Oathrun | Located selected-repository and read-only-worker context in the local plans | 5, including one rejected query |

Oathrun's attempt to search `read-only` correctly failed the single-identifier
contract; the client recovered with a valid identifier. Sibling answers called
some exclusion counts "files"; review corrected these to **entries**, which can
include directories. The source conclusions passed review; these are orientation
tasks, not coding or room-delivery acceptance.

Fresh CLI configuration inspection confirmed each binding uses its own root and
the pinned CLI. A per-invocation `enabled=false` override was also verified for
all three bindings; this checks configuration, not a disabled interactive task.
Sibling pilot policies and client bindings remain local, uncommitted settings.
Restart an existing Codex session to load the installed server: refreshing its
index alone does not reload the server implementation.

## Model execution and cost boundaries

| Lane | Actual result |
| --- | --- |
| Flash, thinking off, local Ollama cloud endpoint | One terminal HTTP 402 in 0.452 seconds; no retry or alternate cloud endpoint used |
| Local Qwen, thinking off | Two code drafts rejected; one runbook draft partially retained after review |
| Terra, medium | Bounded implementation fallback and review for freshness, exclusion policy and the smoke harness |
| Luna, medium | Three fresh-client orientation tasks accepted after source review |
| Host GPT-6 | Boundary design, review, integration and acceptance; exact host effort and usage unavailable |

Qwen's three requests reported 9,236 input and 4,233 output tokens (13,469 total),
including both rejected drafts. Flash usage is unknown. The helper saved the
HTTP status but discarded its response body, so the provider's explanation for
402 remains unknown; it is not evidence of a particular quota or credit state.
The daemon log independently confirms the HTTP response.

The personal worker helper has since been repaired to retain bounded HTTP error
bodies and mark read failures or truncation. Thirty helper tests and a local
HTTP 402 fixture passed. No provider retry was made; the original discarded
body remains unavailable. This helper repair is outside the Context package.

The three client sessions reported the following cumulative usage across their
requests, including the rejected Oathrun query and its recovery:

| Project | Input tokens | Cached input (subset) | Output tokens |
| --- | ---: | ---: | ---: |
| Context | 188,812 | 166,912 | 959 |
| KithMoot | 188,474 | 165,888 | 1,063 |
| Oathrun | 169,272 | 147,712 | 849 |
| Total | 546,558 | 480,512 | 2,871 |

These are CLI-reported usage counters, not invoices or single-prompt sizes.
Repeated client context contributes even when retrieved source is small. Cached
input is already included in input; reported reasoning tokens are already
included in output. There was no paired baseline for these acceptance tasks.

Host and Codex-worker costs and review time are not fully attributed. This
delivery therefore establishes no cash saving. Private receipts retain failed
attempts and the diagnosis; raw prompts and machine paths are not published.

## Second adoption pass

A qualified `gpt-5.6-sol`/high review reproduced three navigation defects:
replacing a root directory left old project content searchable; changing ignore
policy during source inspection could return newly excluded text; and a source
ancestor swap could open a different file after discovery. The repaired engine
binds generations to canonical root/device/inode, rechecks policy after source
reads and before cursor commit, and compares opened source handles with their
discovered identity before reading. Nonblocking opens prevent a substituted
special file from blocking that identity check. These remain operator-owned
filesystem checks, not a sandbox or atomic snapshot.

The independent root-replacement reproduction returned one old result on the
previous installed build and none on the repaired build, which blocked search
with unknown policy until explicit refresh. All 66 focused policy/navigation
tests and the 107-test tools suite passed during the repair.

A fresh Luna/medium Codex client against the rebuilt checkout completed
unavailable → current → edit → stale → refresh → current and rejected the old
cursor. An earlier attempt reached the freshness states but had only one exact
posting and therefore no cursor; its usage and incomplete outcome were retained.
Both directions of the KithMoot/Oathrun negative retrieval check passed in fresh
Codex clients on the preceding installed build. Fresh SDK clients repeated the
positive-and-negative root checks on the repaired checkout. The disabled Codex
session reported no repository tools and invoked none; its configuration also
showed `enabled=false`. Codex JSONL does not expose a raw available-tool inventory,
so that specific acceptance remains open.

The [worker packet helper](WORKER-PACKETS.md) is a checkout developer script.
It uses explicit roots, navigation selection policy, exact excerpts, whole-file
hashes, allowed-file states, policy provenance and Git HEAD. Packet construction
is deterministic and rejects excessive input/output instead of truncating it.
Root identity and relevant source/policy checks run again before publication.
Git HEAD is provenance and does not assert a clean working tree.

Two ordinary coding tasks have accepted outcomes: a Terra/medium worker built
the packet helper from a manually assembled, hashed source packet, and a fresh
Terra/medium Codex session implemented verification from a 37,630-byte packet
produced by that helper. The second session used navigation, checked source
hashes before editing, passed its tests and refreshed afterwards. Review repairs
covered nested selection, root identity, policy-check ordering, snapshot checks,
duplicate ranges, bounded excerpt construction and temporary-fixture cleanup.
An initial verifier invocation failed local configuration parsing before a model
turn; the corrected invocation and subsequent review work are retained.

The full repository check passed **154 tests** (33 core, 107 tools, 14 packet
helper), plus independent package/browser/CLI smoke. The nine-check navigation
smoke and both unchanged benchmark gates passed. A real helper CLI smoke built
and verified a private packet, then correctly rejected the older coding packet
after its source changed. Packet tests also cover edits outside the excerpt,
allowed-file changes, policy and HEAD changes, wrong roots, malformed input,
exclusive output and the retargeted-root regression.

Actual routing in this pass used Terra/medium for packet implementation and
client orchestration, Sol/high for the consequential boundary review and repair,
Luna/medium for fresh acceptance clients, and local Qwen with thinking off for
the runbook draft. Qwen reported 469 input and 634 output tokens; its draft was
partially retained after host corrections. Flash was not retried. Host GPT-6
handled integration and review; complete host/worker cost attribution is still
unavailable, and this pass establishes no whole-task monetary saving.

The seven recorded Codex task sessions in this pass reported 966,308 cumulative
input tokens, including 853,504 cached input tokens, and 10,668 output tokens.
Those totals include the incomplete lifecycle attempt; cached input is a subset
and reasoning output is already included. Collaboration-worker and host usage
remain unavailable. These are acceptance and development receipts without a
paired baseline, not an inference-cost comparison.

The repairs and helper are committed as `10c9d65` and `2dd3fc7` respectively.
[Candidate CI passed](https://github.com/forgesworn/context/actions/runs/35600896950)
for `2dd3fc7ab1f202e94b8fcba4b336773b675b9d1b`, including package checks,
benchmarks, navigation smoke and synthetic scale checks. Tarballs from that clean
commit were installed in a separate commit-pinned directory. The installed CLI
passed all nine smoke checks and positive/negative retrieval in both sibling
roots. A fresh Luna/medium Codex session then repeated the complete lifecycle,
including old-cursor rejection, against that exact installed release.

All three local client bindings now select the new pinned release with their
original explicit roots. Existing sessions need restarting to load it; an index
refresh does not reload implementation code. The preceding pinned release and
private per-root configuration backups remain available for rollback. This is
internal installation and client acceptance, not registry publication or room
consumer acceptance. The packet helper itself remains a checkout script.

## Worker availability recovery

On 21 September 2026, after the pinned-build acceptance, the operator requested
DeepSeek and Ollama recovery for everyday work. Read-only checks found both
daemons on version 0.34.2 with no helper pending marker. Account metadata reported
`free` for this Mac's port 11434 and `max` for the M4 tunnel on port 11435.
The earlier Flash 402 was on port 11434; its discarded body remains unavailable,
so the plan difference is not proof of that refusal's cause.

Two new, independent tasks through the M4 tunnel completed with HTTP 200:

| Model | Thinking | Task and host review | Reported input / output | Seconds |
| --- | --- | --- | --- | --- |
| `qwen3.8:latest` | Off | Endpoint facts extracted as JSON; every supplied field and model name checked and accepted | 150 / 179 | 5.119 |
| `deepseek-v4.1-flash:cloud` | Off | Recovery checklist; partially retained with explicit loopback address, precise helper responsibilities and request-specific refusal wording | 230 / 179 | 2.236 |

The first Qwen dispatch encountered an occupied helper lock before inference.
After checking that no pending marker or lock owner remained, a fresh output
directory was used. The busy receipt was retained; it has no reported usage.
Initial diagnostic CLI argument errors and GET requests to the POST-only account
metadata endpoint also made no inference requests.

This verifies local Qwen and cloud Flash availability on the M4 for subsequent
authorised tasks. It does not qualify Pro or reconcile its two earlier Oathrun
jobs. No refused task was replayed, no reservation was cleared, and no account
limit or auto-top-up setting changed. The local-port refusal remains terminal.
The helper default already selects the M4; daily commands now make the endpoint
explicit to avoid environment-dependent selection.

Private prompt, response and review receipts are retained under the
`20260921-worker-recovery-4vm3a4cz` evidence directory. Host GPT-6 reviewed the
outputs and edited these instructions; exact host effort and usage are not
available. Successful worker usage totals 380 input and 358 output tokens;
there is no paired baseline or monetary savings claim.

## D5 report tooling; experiment remains open

The developer-only [whole-task reporter](TASK-COST-REPORT.md) validates a declared
eight-pair protocol and private receipts. It preserves missing evidence as
incomplete, includes failed attempts, keeps cached/reasoning token subsets
separate, and requires attributed variable costs rather than estimating money
from worker usage. Cost and review decisions compare decimal amounts exactly;
floating-point rounding cannot relax either decision threshold. The committed
template is explicitly unlocked, with placeholder definitions and no results.

This development task used Context navigation and bounded source packets.
`package.json` was excluded by the source extension policy; its exact content
was read separately and retained with its hash. No navigation scope was widened.
Sol/high designed and reviewed the measurement boundaries. Two Flash/thinking-off
implementation responses through the M4 reached their output limits and were
rejected without applying source. Terra/medium implemented the reporter and
repaired review findings. A later narrow Flash packet supplied three useful
regressions; one incorrect result-field assertion was repaired by Flash using
the actual Node failure. Host GPT-6 integrated the result and checked it; the
host effort setting is not exposed.

All 16 focused reporter tests pass. Six independent CLI fixtures exercise the
exact cost boundary, missing host cost, missing elapsed time, failed quality,
higher review time and an empty draft. These are synthetic acceptance fixtures,
not measurements of the eight real task pairs. Sol/high accepted the reporter
for the repository gate after the accounting repairs.

The four Flash calls reported 8,458 input and 29,097 output tokens, including
both rejected outputs and the test repair. Complete host/collaboration usage,
whole-task review time and attributed monetary costs remain unknown. Private
prompts, failures, review receipts and independent CLI evidence are retained in
`20260921-d5-report-9cgygyyu`. This task establishes no monetary savings; D5 still
requires locked executable task definitions, actual paired runs and complete
accounting. The developer reporter does not change the pinned navigation
package, select models or execute provider calls.

## Gate status

| Goal | Status | Remaining acceptance |
| --- | --- | --- |
| D0 reproducible pilot | Passed | Named commits, matching CI, independent pinned install and actual Codex edit/stale/refresh/old-cursor exercise passed |
| D1 daily Context use | Passed | Orientation, source-backed boundary diagnosis and accepted packet coding tasks span fresh clients; continue recording normal use |
| D2 source selection | Passed with qualified review | Sol/high review defects repaired; root, policy, cancellation and cursor regressions pass locally and in CI |
| D3 two additional repositories | Scoped clients passed; gate partial | Negative cross-root checks passed both ways; raw disabled-session tool absence remains unproven by the available CLI output |
| D4 reusable worker packets | Passed | Build and read-only verification implemented; two coding tasks accepted with source packets, repairs and host review recorded; CI passed |
| D5 whole-task savings | Report tooling ready; experiment open | Lock executable eight-pair definitions, then run with complete host/worker accounting; the unlocked template is not trial evidence |
| D6 consumer/room integration | Open | Coordinate with Oathrun's own authority and execution gates |
| D7 dependable distribution | Internal install passed; public open | Public publication and consumer upgrades still require G0–G4 |

The immediate command-line workflow is in [daily use](DAILY-USE.md).
Run [the navigation smoke](NAVIGATION-SMOKE.md) when validating a build and
consult [policy semantics](NAVIGATION-POLICY.md) before expanding source scope.
