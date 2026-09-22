# ForgeSworn dogfood execution ledger

21 September 2026. This records implementation and acceptance separately from
the [goal definitions](FORGESWORN-DOGFOOD-GOALS.md).

## Routing update: DeepSeek and GLM focus

Operator decision, 21 September 2026: remove Qwen from the default Context
workflow. DeepSeek Flash/thinking off now owns routine worker tasks, including
useful extraction and synthesis; use deterministic tools where sufficient.
GLM/low is a candidate for bounded implementation/tests and visual work, pending
useful task acceptance. Eligible Pro is an option for harder implementation;
qualified frontier models retain difficult design and consequential review.

The next packet handoff is assigned to Flash/thinking off. Measure total cost
per accepted result at the required development quality, including failed
attempts and host review. This updates project instructions and plans only:
no inference, endpoint change or automatic model routing occurred. Historical
worker receipts and locked comparisons remain evidence of their original runs.

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

## Disabled-client inventory acceptance

Six fresh Codex CLI 0.155.1 app-server processes exercised the existing pinned
bindings in Context, KithMoot and Oathrun. For each explicit project directory,
the enabled process returned exactly `repository_status`, `repository_refresh`
and `repository_search`; the disabled process returned an empty tool catalogue
for `z1p-repository`, without a tool-discovery error. All inventory pages were
consumed. The disabled server remains a configuration entry; its tools are absent.

The check used a per-process `mcp_servers.z1p-repository.enabled=false` override,
without editing any project configuration. Unrelated configured MCP servers were
disabled in that process; the client-managed app catalogue was not used. The
check sent `initialize`, `initialized` and `mcpServerStatus/list` with `detail:
"full"`. No model turn or inference request was started. This is the actual raw
client catalogue missing from the earlier CLI transcript, not a model's account
of its available tools. It closes D3 together with the earlier real tasks and
positive/negative root-isolation checks; it is not room-consumer acceptance.

Reproduce with `codex app-server --stdio` from the bound project directory,
once enabled and once with `-c mcp_servers.z1p-repository.enabled=false`, using
the [documented app-server protocol](https://learn.chatgpt.com/docs/app-server).
The exact collector, generated protocol types, six raw transcripts and summary
are retained privately in `20260921-d3-client-w6qs0oay`. The host performed these
deterministic checks; complete host usage remains unavailable.

## Heartwood daily-use handoff

Heartwood has a separate local Codex binding to the same pinned navigation
release. A fresh SDK client indexed 150 files / 56,817 locations, verified source
hashes for four approval-policy identifier searches and returned no match for
the Context-only negative query. Codex configuration inspection confirmed its
explicit Heartwood root. Private setup evidence is retained in
`20260921-heartwood-dogfood-rgc8nnk1`.

The operator reports that the persistent-app-approvals task is now dogfooding in
another Codex session. That session owns implementation, model routing, usage
and task acceptance. A read-only M4 helper status check found a live-owner
DeepSeek Pro request for that task; no competing worker was dispatched and its
pending marker was preserved. This is activity evidence, not an accepted result.
This Context session has not verified its completed task
or changed its checkout, client configuration or worker jobs during the D3/D5
follow-up. The ignored plan stays outside the navigation index. Ordinary-use
receipts can inform usability, but cannot be retroactively called a controlled
baseline or a locked D5 pair. The planned comparison uses isolated Context and
KithMoot revisions instead.

## D5 qualification: harness repaired; assisted answer rejected

The [comparison protocol](D5-RESULTS.md) was locked at
`2026-09-21T14:44:42.000Z` on immutable Context and KithMoot revisions,
with one orientation, diagnosis, impact and coding task per repository. Eight
private task snapshots, including three seeded regressions, passed fresh pinned
navigation checks: unavailable → refresh → current, positive source hashes and
negative cross-root retrieval. The largest scope has 216 files / 47,044
locations; no limit or exclusion was relaxed. Receipts and task/setup hashes
are retained with `20260921-d3-client-w6qs0oay`.

Sol/high designed the protocol. Review caught non-applying seed patches,
unusable hidden exact-answer requirements, a path-containment check that
rejected valid answers, a trailing-newline identifier edge case and missing
executable-helper hash bindings. These were repaired and verified before locking.
Terra/medium implemented the bounded helper and verifier repairs
because the shared M4 is occupied by Heartwood; no competing Ollama request was
made. The host independently qualified the scopes and reviewed the design.
Complete host/collaboration usage remains unknown. Both code checkers reject the
seeded or unimplemented behaviour and pass the reference repair; six structured
checkers accept valid source-backed fixtures and reject altered citations.
Structured checking validates schema and frozen-source provenance; a separate
blind Sol/high review must accept the conclusions. Hashes bind tasks, seeded
patches, measurement rules, model settings and executable helpers.

Independent verification passed all eight definitions. The whole-task reporter
accepts the locked input and reports `incomplete` solely for sixteen missing
arms, with no reduction percentage. The fixed executor is Luna/medium and the
blind reviewer is Sol/high in both arms; this isolates retrieval from model
routing. Preparation and reference checks are not trial arms and establish no
inference saving. The initial pre-run report is retained. The [first pair](D5-RESULTS.md)
has since run: both answers failed citations and semantic review, and accounting
is incomplete. Fourteen arms remain unrun. Resolve the recorded prompt and
receipt gaps prospectively before expanding; unknown billing or host usage must
remain unknown.

The existing repository check passed 170 tests and independent packed-package
smoke on Node 24.21.0. Both unchanged benchmark gates passed with declared-source
recall 1.0. These local results do not constitute new CI or registry acceptance.

## D5 prospective harness repairs and corrected qualification

The [v2 qualification](D5-RESULTS.md) exposed a default
read-only Codex sandbox that blocked answer creation and self-checking. Its two
rejections are retained. A minimal independent write-capability fixture then
proved the explicit workspace-write executor setting and successful self-check;
reviewers remain read-only. Sol/high approved the prospective v3 delta.

The [v3 qualification](D5-RESULTS.md) completed with
Luna/medium executors and separate Sol/high reviewers. Both answers passed exact
citations and frozen-source checks after recorded in-session repairs. Baseline
passed semantic review; assisted incorrectly described source freshness and
failed-refresh behaviour, so it was rejected. Assisted whole-arm input increased
from 664,134 to 705,141 tokens when review was included, and review time rose
from 70.12 to 114.10 seconds. Billing and host/setup usage remain unknown.

The harness now preserves full public tasks, scoped citation self-checks, original
source hashes, explicit sandbox/toolchain settings, observed event timestamps,
ordered retrieval evidence and failure receipts. Twelve runner tests, six public
checker tests, prepared-arm fixtures and locked verification pass locally. Flash
was blocked by an active shared M4 request before inference; Terra/medium drafted
the bounded helpers, with recorded host repairs and Sol/high review. No Heartwood
checkout, job or configuration changed. No production package code changed.

D5 stays open. Improve assisted synthesis and reduce retrieval/review round trips
before spending on more comparisons; preserve every failed version and setup
cost. Fourteen v1 arms remain unrun. These qualification results are separate from
the eight-pair reporter and do not close CI, registry, consumer or monetary gates.

## Savings follow-up: complete syntax packets

The [savings plan](SAVINGS-PLAN.md) diagnoses v3's 22 navigation searches,
74 repeated locations and increased review work. It defines model assignments
and a prospective three-way comparison with Graphify, including isolated anchor
selection and whole-task cost accounting. No new comparison arm has run.

The checkout packet helper now has a `plan` mode: explicit TS/JS line anchors
resolve to complete supported syntax blocks, overlaps merge, and the result is
an unchanged v1 packet accepted by `verify`. Unsigned coverage maps every anchor
and hashes the emitted packet. Unsupported syntax and oversized results fail
rather than silently truncating a branch. Source, policy, HEAD and root checks
bind selection to assembly; deterministic source/policy race tests prove failure
before output. This is a checkout helper, not a new MCP server capability.

A retrospective fixture assembled 11 anchors into nine ranges / 471 unique
lines in a 33,879-byte packet (8,565 offline o200k tokens). Exact source matches
a manually checked reference. It demonstrates assembly and verification only;
the task was chosen after v3's failure and has no new model answer or savings
claim. The corrected manual-reference endpoint and range-order comparison are
retained with the private evidence.

Flash/thinking-off dispatch was rejected as busy on the M4 before inference.
Terra/medium implemented the fallback draft and a focused completion pass.
Host review caught missing edge coverage; repairs addressed source line-separator
semantics, property commas, class-field functions and object methods/accessors.
Host integration added deterministic selection/assembly race tests. Sol/high
reviewed the design and final boundaries and found no remaining blocker within
the documented contract. Development usage and billing remain unknown.

Local validation on Node 24.21.0: `npm run check` passed 33 core, 107 tools,
28 packet and 16 cost-report tests (184 total), plus independent package smoke.
Both unchanged benchmark scripts passed `--check` against the freshly built
packages with minimum required-source recall 1.0. These retain their existing
compression-only meaning. Fresh CLI processes exercised the helper; the MCP
server implementation is unchanged. No new CI, registry or consumer acceptance
is claimed. Heartwood and the locked v1/v2/v3 experiment files are unchanged.

Private evidence: `~/.cache/z1p-delivery/20260921-packet-savings-sd3d6paw`.
Next: qualify an isolated worker handoff and then lock the three-way comparison,
including billing attribution. D5 remains open.

## Gate status

| Goal | Status | Remaining acceptance |
| --- | --- | --- |
| D0 reproducible pilot | Passed | Named commits, matching CI, independent pinned install and actual Codex edit/stale/refresh/old-cursor exercise passed |
| D1 daily Context use | Passed | Orientation, source-backed boundary diagnosis and accepted packet coding tasks span fresh clients; continue recording normal use |
| D2 source selection | Passed with qualified review | Sol/high review defects repaired; root, policy, cancellation and cursor regressions pass locally and in CI |
| D3 two additional repositories | Passed | Real scoped client tasks and negative cross-root checks passed; fresh enabled/disabled Codex client catalogues now prove tool absence |
| D4 reusable worker packets | Passed | Build and read-only verification implemented; two coding tasks accepted with source packets, repairs and host review recorded; CI passed |
| D5 whole-task savings | Harness repaired; assisted qualification rejected | Improve assisted correctness and retrieval/review overhead; attributable billing unknown; fourteen original arms remain unrun |
| D6 consumer/room integration | Open | Coordinate with Oathrun's own authority and execution gates |
| D7 dependable distribution | Internal install passed; public open | Public publication and consumer upgrades still require G0–G4 |

The immediate command-line workflow is in [daily use](DAILY-USE.md).
Run [the navigation smoke](NAVIGATION-SMOKE.md) when validating a build and
consult [policy semantics](NAVIGATION-POLICY.md) before expanding source scope.

## Original dependency snapshots (22 September 2026)

The checkout now has [maintained dependency capture, verification and bounded
queries](DEPENDENCY-SNAPSHOTS.md), implemented independently of Graphify. It
reads selected committed npm/Cargo manifests, recognises npm lock v2/v3 artifacts
and explicitly selected local path/workspace references, and emits an unsigned
dependency graph. Registry artifacts remain separate from same-named source
repositories. Cargo lock resolution, installed-artifact checks, release
attestations and shared team synchronisation remain open.

The local Heartwood capture selected eight repositories and fourteen manifest/
lock documents, yielding 147 declarations: 119 locked artifacts, two local source
references and 26 unresolved declarations. Twenty-five unresolved rows are
unsupported Cargo lock resolution; one references an unselected local target.
Signet Login's `signet-protocol` lock is 1.10.1, with both selected producers left
as candidates. Heartwood Ledger's relative common-crate path resolves to the
selected ESP32 snapshot. These are declaration/lock observations, not installed
or physical-device acceptance. The active Heartwood checkout was read only.

Snapshots bind HEAD, selected file/lock hashes including negative observations,
worktree/Git-administration identities and helper/resolver hashes. Verification
regenerates derived rows/graph as well. Branch and general dirty flags remain
labelled capture-time observations. Symlink/root races, partial-clone lazy fetch,
URL credentials, output expansion and malformed reports have focused rejection
checks. Queries are bounded and never read paths from a report as authority.

Routing: deterministic capture and tests; `deepseek-v4.1-flash:cloud` with thinking
off through the M4 for a pure resolver draft and one focused repair; qualified
`gpt-5.6-sol`/high independent boundary review. The active host model/effort was
not switched by worker dispatch; its exact effort is not exposed. The first
worker draft failed two of 35 generated tests and had substantive contract gaps.
The repair failed 24 of 45 tests and still mishandled path/lock identity. Both
resolver drafts were rejected. Host boundary implementation replaced them;
corrected test scaffolding from the repair was retained alongside independent
regressions. Review findings produced further focused fixes. No further routine
worker packet remained during final boundary review and acceptance.

The two calls reported 18,668 prompt and 30,663 completion tokens (49,331 total).
Dispositions are one rejected and one partially retained. Host preparation,
replacement implementation and review usage/billing remain unknown; these costs
must be counted before assessing savings. This is not a new D5 comparison arm,
a monetary saving or a Graphify parity claim. Existing locked experiments were
not changed.

Private receipts, prompts, rejected drafts, captures and check logs:
`~/.cache/z1p-delivery/20260921-dependency-snapshots-p6mr2mgs`.
The folder was created on 21 September UTC; local completion is 22 September.

Next: use one verified dependency query to select source for a real Heartwood
investigation and record the complete accepted task. Loading these relationships
into the prototype viewer and establishing release-to-source attestations are
separate follow-ups. No npm publication, client rebinding or shared MCP server
implementation change was made by this slice.

Local validation for this slice passed on Node 24.21.0: `npm run check`
(33 core + 107 tools + 28 packet + 16 cost-report + 79 dependency/snapshot tests,
263 total) and independent package smoke. Both unchanged benchmark gates passed
with minimum required-source recall 1.0. A fresh CLI process captured the eight
selected repositories, bounded queries returned the expected lock/path evidence,
and explicit verification returned `current`. An earlier full-check invocation
overlapped a helper edit and correctly rejected the changed graph; the final
settled-code rerun passed. No new CI, registry or hardware acceptance is claimed.

## FS2: offline daily usage accounting (22 September 2026)

Implemented [explicit client-export imports and task summaries](DAILY-USAGE.md)
in `scripts/daily-usage.mjs`, with a pure request normaliser. The CLI runs offline
without provider authentication, model calls, recursive session discovery or
automatic client changes. It is a checkout development helper, not a new MCP
operation or published command. The existing paired D5 reporter and locked
experiments are unchanged.

Codex per-request records are counted once; cumulative counters are ignored.
Claude assistant usage accounts for cache reads/creation separately from fresh
input. Missing values remain unknown, conflicting copies do not become guessed
totals, and summary rejects conflicting task attribution. Matching repeated
requests across exports are counted once. Usage remains in separate
client/account/model/effort/category cohorts, including rejected and unknown
tasks. Same-task host/review records may come from different clients. Cash,
monthly spend and causal token savings remain null.

Inputs/specs/outputs are bounded and explicit, output files are exclusive mode
0600, and detectable symlink/replacement cases reject. Exported content and raw
session/request IDs are omitted. Checksums provide unsigned integrity, not
authenticity; source event time does not precisely split a request across task
boundaries. See the guide for supported shapes, actual limits and hostile
filesystem-race limitations.

A frozen usage-only projection of this Context session, explicitly selected for
07:00–07:50 UTC, imported 49 requests: 6,014,669 input tokens including 5,693,056
reported cached, and 41,646 output including 4,327 reported reasoning. No
duplicate/conflicting requests occurred in that selection. It is a partial
development window, not the complete implementation bill or a controlled savings
comparison. Missing model/effort and false whole-task coverage assertions remain
visible. No real Claude transcript export was present in the selected Context
export directory, so Claude has synthetic fixture acceptance only. Heartwood's
active session, checkout and configuration were not read or changed.

Routing followed the Ollama-workers skill and project policy: Flash/thinking off
on the explicit M4 wrote the normaliser and tests from a verified source packet.
The first draft had an incorrect Claude total assertion plus four host regression
failures (independent missing counters, earliest conflict time, fractional-time
ordering and malformed totals). One focused repair passed; both attempts remain
recorded. Total worker usage was 15,217 prompt + 11,676 completion = 26,893 tokens.
Host integration and independent Sol/high boundary review found and repaired
source-metadata validation, summary resource bounds, model-context isolation,
warning consistency and cross-export deduplication. No further ordinary worker
packet remained during host integration/review. Complete host/review accounting
and billing are unknown, so this work establishes no savings.

Local validation: 58 focused usage tests; final `npm run check` passed 321 total
tests and both independent package smoke workflows. Both unchanged benchmark
gates passed against the built packages. Sol/high's final scoped boundary review
was accepted with no remaining blocker. Fresh CLI processes exercised the helper;
shared MCP implementation did not change and requires no runtime restart. No new
CI, registry, Claude live-client or monthly billing acceptance is claimed.

Private evidence: `~/.cache/z1p-delivery/20260922-daily-usage-t3u8a6w3`, including
worker prompts/receipts, failed and passing checks, source capture hash, selected
export, import specification, request receipt and summary. The worker packet
builder rejected a JSON example as unsupported before dispatch; the accepted
packet used exact existing JavaScript evidence instead.

FS2 is **partially delivered and usable now**. Next: use the importer on the next
accepted ecosystem task, qualify a real Claude export and add worker-receipt/task
capture convenience where needed. Invoice reconciliation stays with the account
holder; client/provider authentication remains outside Context.

## 22 September 2026 — delegated source packets through MCP

Delivered the local OS1b implementation: `repository_packet` accepts an inline
strict task spec, exact ranges (`build`) or complete TS/JS syntax anchors (`plan`).
It uses the configured repository root and requires the current navigation
generation. The packaged shared assembler preserves the existing CLI packet
format and policy, path, source-hash and Git provenance checks. The complete JSON
response, including coverage/provenance, must fit the requested cap (maximum
65,536 bytes); it fails rather than truncating code. No provider SDK, credentials,
arbitrary command, spec-file path, output path or new dependency was introduced.

Delegation was explicitly authorised. One Terra/medium implementation worker
received a verified 58,417-byte packet without the conversation history. One
Sol/high reviewer found a blocking unbounded request queue and concurrent
freshness scans. One focused Terra repair replaced the queue with a synchronous
busy guard before any freshness scan; the reviewer accepted the repair. No
subdelegation or further feature work occurred. Deterministic packet preparation
first rejected an unsupported JSON allowed-file entry and then an oversized
selection; a separately reviewed JSON read and smaller source excerpts resolved
these before dispatch. These failures incurred host work, not inference retries.

Final local verification: `npm run check` passed **325 tests** and package smoke
checks; both unchanged benchmark gates passed. The installed tarball's stdio
server returned a complete function, rejected stale evidence, recovered after
refresh and worked after restart. A separate fresh stdio process bound to this
Context checkout returned the selected real `buildPacketInline` function in a
3,313-byte response. This is Node MCP SDK acceptance, not a new live Claude or
Codex model-driven task. The existing in-session MCP connection still exposes its
old tool list and needs reconnecting; source refresh does not reload code. No
Heartwood checkout, session or configuration was touched. No CI, publication,
registry release or consumer application acceptance is claimed; work is uncommitted.

Usage was normalised from request records in the two explicitly selected worker
threads and this host turn, with no transcript text copied. Snapshot at
08:29:04 UTC (host still running; final tail excluded):

| Role | Recorded model / effort | Requests | Uncached input | Cached input subset | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| Implementation plus repair | `gpt-5.6-terra` / medium | 32 | 108,989 | 1,938,432 | 17,220 |
| Review plus repair check | `gpt-5.6-sol` / high | 17 | 71,611 | 1,092,864 | 7,959 |
| Host preparation, integration and checks | `gpt-6-astra` / medium | 42 | 109,781 | 3,219,840 | 15,117 |

The snapshot contains 6,581,813 total request tokens, including 6,251,136 cached
input tokens, with no duplicate/conflicting requests in the selected records.
This is development investment, not evidence of recurring savings. Host coverage
is incomplete, billing/allowance conversion is unknown, and no controlled baseline
exists. Delegation is not a hard spend cap: each agent made multiple requests.
The host overhead is material; keep future handoffs and coordinator traffic
smaller, use fixed-output Flash packets for suitably bounded routine work, and
reserve this agent/reviewer arrangement for integration and consequential boundaries.

Remaining limits: the assembler checks cancellation at phase boundaries rather
than interrupting each active file/Git operation; MCP input is parsed before the
inline-spec cap applies. The documented 64 KiB limit covers the JSON tool payload,
not transport framing. Complete syntax still does not prove complete task evidence.

Private evidence: `~/.cache/z1p-delivery/20260922-packet-mcp-51qzq61g/`, including
source packet, baseline hashes, final checks, real-source response and per-role
usage snapshots. Next: reconnect Context's MCP client and use the tool on an
accepted task; qualify actual Claude use separately. Do not restart the active
Heartwood session from this session.

## 22 September 2026 — packet discovery repair, dogfooded through MCP

A fresh local MCP discovery check found that `repository_packet` advertised
`{"type":"object","properties":{}}`. The previous tests checked the tool name
and invoked it with already-known arguments; they missed this client-discovery
failure. The pinned MCP SDK falls back to an empty schema for a top-level Zod
union. This invalidates the earlier assumption that successful SDK calls alone
established usable argument discovery.

Used a fresh stdio connection bound only to Context to obtain an 11,886-byte
source packet for the actual repair. Verified it with the existing CLI before
dispatch, rendered only the selected excerpts into a 7,402-byte prompt, and sent
one `deepseek-v4.1-flash:cloud` request through explicit M4 port 11435 with thinking
off and a 2,500-token output cap. The first draft passed: 1,893 reported prompt
and 1,137 completion tokens (3,030 total), HTTP 200, terminal stop, no repair or
unknown outcome. The helper was clear before and after the request.

The MCP schema now has a strict top-level object with visible `mode`, `spec`,
`expectedGeneration` and `maxBytes` properties. Mode-specific source validation
runs before navigation inside the existing busy-slot try/finally. Mismatched
build/plan specs are rejected. Host review retained the single-flight guard,
root binding, freshness checks, strict unknown-field rejection and output cap.
No additional model reviewer or autonomous implementation agent was started.

Regression assertions now inspect the actual advertised schema and mismatched
mode/spec calls. The installed-tarball stdio check also asserts property names,
required fields and rejection of extra fields in the advertised schema. Focused
build and 11 MCP tests passed; final `npm run check` passed all 325 tests and
package checks; both unchanged benchmark gates passed. A fresh rebuilt stdio
server advertised all four arguments and returned current repaired source in
2,950 bytes. The configured in-session tool list still contains only the old
three operations: a client reconnect remains necessary for direct model tool
use. Actual Claude qualification is still open. No Heartwood state was touched.

Host usage snapshot at 08:44:47 UTC: 13 requests, 23,508 uncached input,
1,451,520 cached input and 6,327 output tokens, recorded as GPT-6 Astra/medium.
This excludes the final host tail. The 3,030 worker tokens are not a whole-task
cost or savings claim; account charges and allowance conversion remain unknown.
This is a real accepted Context development repair using MCP-selected evidence,
not a controlled comparison or an accepted Heartwood task.

Private evidence: `~/.cache/z1p-delivery/20260922-packet-schema-pmswzs0h/` contains
the MCP source packet, freshness verification inputs, bounded worker prompt and
receipt, accepted draft, checks, fresh-server acceptance and host usage snapshot.
Work remains uncommitted; no CI, release or registry acceptance was performed.

## 22 September 2026 — correct the restarted Context client binding

The user restarted successfully (navigation generation was unavailable), but
this project still launched the older pinned release and its `enabled_tools`
list excluded `repository_packet`. The prior restart advice missed those two
configuration requirements. Updated only Context's ignored `.codex/config.toml`
repository-server block to launch this checkout's tested build and allow all
four repository tools. The signed-context block and Heartwood binding were not
changed. This is a development-checkout binding, not a new immutable release.

A fresh stdio client launched the exact new configured command and arguments,
verified all four tools and the advertised packet arguments, refreshed the
correct Context root, and successfully retrieved current source. The existing
Codex connection still requires another reconnect to load this configuration;
no claim of direct model-driven packet use is made yet. No inference workers,
source changes, publication or repeated repository test run were needed for
this configuration fix. Private old/new navigation settings and acceptance:
`~/.cache/z1p-delivery/20260922-context-binding-ggcw5a7n/`.

## 22 September 2026 — direct Codex packet tool acceptance after reconnect

The corrected in-session binding now exposes `repository_packet` with its input
schema. Direct model-issued status, refresh, bounded identifier search and a
plan request succeeded against the explicit Context root. The packet returned
`buildPacketInline` in full (source-packet.mjs lines 263–267), with source hash,
coverage and matching generation `f9214e35-d12c-465d-aff4-9e6fce8ddb03`.
This closes the direct Codex packet-discovery/retrieval check, beyond earlier
standalone SDK tests. No worker inference or Heartwood access was needed.
Actual Claude use, accepted application tasks and measured savings remain open.

## 22 September 2026 — FS2 Ollama worker receipts, dogfooded locally

Added `daily-usage.mjs import-worker` for explicitly selected raw helper receipts.
The offline adapter preserves prompt/completion counts for successful, truncated
and unusable drafts, leaves refusal/unknown counters unknown, and strips private
task prose, endpoints and provider diagnostics. Existing file bounds, stable
reads, private output permissions and no-overwrite checks apply. No provider
authentication, network calls or automatic transcript discovery were added.

The helper has no stable request ID or timestamp. The import spec therefore
requires an operator-supplied attempt ID and accounting timestamp, with warnings
that these cannot be independently authenticated. A fixed worker identity
namespace makes re-imports deduplicate across captures; distinct repairs need
distinct IDs. Summaries reject conflicting attribution, counters or statuses,
retain separate provider/account cohorts and count worker statuses once per
attempt. Generation success never implies accepted implementation. Cache,
reasoning and returned-model confirmation remain unknown; model/effort are the
helper's requested settings. Review evidence and task completeness remain
operator assertions, not automatically established by receipt import.

Used a current root-verified MCP packet and CLI verification before one bounded
M4 Flash/off request for normalisation and regression tests. Its reviewed draft
was accepted without repair: 2,075 reported input and 5,176 output tokens (7,251
total), terminal stop. Host integration and review ran in the existing Codex
session. Imported this actual helper receipt through the new CLI and generated
a private summary; its timestamp explicitly uses capture-time attribution.
Host preparation/integration/review usage remains uncollected and billing is
unknown. This is development evidence, not whole-task savings or a controlled
comparison. Claude qualification awaits an eligible account; no Claude inference
or Heartwood application changes were made.

Validation: 81 focused accounting tests; `npm run check` passed 362 tests across
the repository plus installed-package smoke checks; both unchanged token and
navigation benchmark gates passed. Refreshed Context and retrieved the changed
normaliser and importer as complete syntax blocks. One post-edit packet request
used a comment-line anchor and was rejected; the corrected function-line request
succeeded. No additional inference or worker repair was needed.

Private evidence: `~/.cache/z1p-delivery/20260922-worker-accounting/` contains the
source packet, prompt, worker draft/receipt/review, accounting import and summary,
capture-time note and check logs. Changes remain local and uncommitted; no CI,
registry or release acceptance is claimed. Next: convenient task-boundary capture,
real Claude export qualification and routine complete host/worker/review receipts.


## 22 September 2026 — FS2 explicit task-window capture

Added offline `daily-usage.mjs start` / `finish` commands and a portable task
profile example. Start records local UTC against explicit client/session/task
labels; finish writes the existing import specification. Outcomes, review time
and coverage start unknown. No session discovery, Git watching, provider calls,
configuration changes or automatic acceptance were added. The boundary retains
its raw session ID privately; checksums are integrity checks, not authentication.
Existing private-file, bounded-read and no-overwrite rules apply. Usage remains
attributed by event timestamp; finish only after final request usage is recorded.

Implemented and reviewed in the existing Codex host session, without extra
workers or model switching. Effective host model/effort and whole-task usage were
not independently captured for this change; no cost or savings claim follows.
Used root-verified MCP source packets before editing, refreshed and retrieved the
complete new functions afterwards. Heartwood and Claude sessions were untouched.

Validation: five new capture tests, 86 accounting tests total; full `npm run check`
passed 367 tests plus installed-package smoke checks. Both unchanged benchmark
gates passed. Documentation links, shell blocks, example JSON and whitespace
checks passed. The CLI start → finish → import workflow used synthetic usage
fixtures, not a real newly completed client task. Evidence logs are private at
`~/.cache/z1p-delivery/20260922-task-boundaries/`.

Local and uncommitted; no CI, registry or new Claude acceptance. Next: use the
capture workflow for complete host/worker/reviewer evidence on an ordinary task,
qualify an explicitly selected real Claude export, then render a useful weekly
scorecard. Actual savings still require comparable accepted tasks and billing
reconciliation; capture alone does not establish them.


## 22 September 2026 — First complete bounded Codex implementation receipt

Imported the completed FS2 task-window implementation turn, 09:55:43.010 to
10:00:31.784 UTC, from this Context session's explicitly selected request log.
Verified session metadata against the Context checkout before selecting usage.
A frozen private projection retains only session identity, turn model/effort and
request usage; conversation content is excluded. The existing importer and
summary commands ran unchanged under Node 24.21.0.

The 17 unique requests report **883,063 input tokens**, including **830,336
cached input**, and **6,190 output**, including **662 reasoning output**.
The recorded model/effort is `gpt-6-astra` / `medium`; no model switch or worker
call occurred in that task. Imported totals match an independent sum of the
selected raw request records, with no duplicate, conflicting or unknown metrics.

Coverage is operator asserted for that bounded implementation turn: preparation,
edits, checks and host self-review, with no worker or separate reviewer attempts.
Earlier feature design and later accounting/reporting are excluded; this is not
lifetime feature cost. Acceptance means the recorded local 367-test and
package/benchmark gates, not independent user, CI or registry acceptance.
Review duration, account billing and savings remain unknown. Cached input is
part of input, not additional usage and not evidence of Context-caused savings.

Private evidence: `~/.cache/z1p-delivery/20260922-complete-task-receipt/`, containing
`usage-export.jsonl`, `import-spec.json`, `capture-evidence.json`, `receipt.json`
and `summary.json`, all mode 0600. This is a development cohort, not an ordinary
application-task or control cohort. Heartwood was not inspected or modified.

Next: capture an accepted application task in its owning session; qualify actual
Claude source retrieval and a real transcript import once its allowance is
eligible. No new Claude request was made for this accounting task.


## 22 September 2026 — Shipment validation

The shipment sweep passed `npm run check` (367 tests and isolated package
consumers), both unchanged token/navigation benchmark gates, navigation stdio
smoke, SQLite/postings tests and the 10,000-record postings run. The locked v2
and v3 experiment verifiers also passed; no inference experiments were rerun.
The navigation smoke's obsolete three-tool assertion was updated to require
all four tools, including `repository_packet`.

The public npm registry still reports 0.1.1 for both packages, and the local npm
identity check returned HTTP 401. Registry publication is therefore unavailable
in this environment. Shipment uses reviewed Git source and GitHub package
assets at version 0.3.0; the setup guide explains installing both tarballs.
CI, merge and release results are recorded by the corresponding GitHub PR/run
and release rather than inferred from these local checks. No active Heartwood
client binding or personal client configuration was changed.

## 22 September 2026 — Read-only installation doctor (local, unreleased)

Added `encrypted-context doctor <repository-root> --term <known-identifier>`
to OS1's installation workflow. It launches the installed CLI with the current
Node executable and verifies all four repository tools over stdio. It checks
canonical root/HEAD, generation, search and exact source-packet agreement;
reports binding details, exclusions and evidence hashes without source text;
and closes its owned process on success or failure. It changes neither client
configuration nor repository files. Actual Claude/Codex acceptance remains
separate and is explicitly `not-tested` in the report.

One DeepSeek Flash draft (`deepseek-v4.1-flash:cloud`, thinking off) reported
1,082 prompt and 5,209 completion tokens. The draft compiled, but a focused test
caught lost exclusion metadata and host review found executable/environment
and validation defects. A repair dispatch was blocked by the shared endpoint's
busy guard before inference. The host retained and corrected the draft without
interrupting the other request. Private prompt, answer, attempt receipts and
live doctor output remain outside Git. This is partial worker acceptance with
host repairs, not evidence of savings; complete host cost and billing are unknown.

Validation: build and all 378 tests passed, including 11 new doctor checks.
The independent installed-tarball smoke passed after correcting its macOS
canonical-path assertion. A live doctor probe passed on the Context checkout.
The unchanged navigation benchmark passed with declared-source recall 1.0.

**Release blocker:** the unchanged raw-evidence benchmark failed because the
expanded source/test corpus has 136 chunks, above signed v1's 128-record limit.
No threshold, corpus selection or collection limit was changed. This needs a
separately reviewed scale/benchmark solution before shipping these changes;
navigation passing does not replace that gate. These local changes are not in
the previously published v0.3.0 assets or npm. Heartwood was not modified, and
no new Claude qualification or application-level consumer acceptance occurred.

## 22 September 2026 — Doctor benchmark blocker resolved locally

The preceding raw-evidence benchmark failure is retained as historical evidence.
The v2 runner now partitions the complete deterministic corpus into valid
synthetic collection views instead of requiring the entire repository to fit in
one collection. All 136 chunks from 38 selected files are retained, in collections
of 128 and 8 records. Signed v1's 128-record and 32-collection limits are unchanged.

Every question queries both collections. All response payloads, including empty
ones, contribute to the token and byte totals. The original questions, required
sources, 8,192-byte/four-record per-call budgets, 10x raw regression floor and
71.5x navigation threshold are unchanged. Aggregate per-question budgets grow
with collection count, so this is explicitly versioned and documented as a new
measurement method, not a reproduction of v1 on the same budget. There is no new
production aggregate retrieval API. Locked D5 experiments remain untouched.

On this working tree, `npm run check` passed 386 tests and independent packed
package consumers. The raw v2 gate passed at 32.50x against its naive full-corpus
baseline with required-source recall 1.0; the unchanged navigation gate passed
at 270.71x with recall 1.0. Stdio smoke, 22 scale tests and the 10,000-record
posting-index check passed. These synthetic payload comparisons do not establish
whole-task, subscription or monetary savings. Eight new tests cover partition
boundaries through 4,096 records, explicit over-capacity rejection, evidence
beyond record 128, empty-response costs and single-collection v1 payload parity.

Implementation used one DeepSeek Flash/off draft (551 reported prompt tokens,
1,207 completion tokens). Host review corrected its timestamp type and unintended
async interface and strengthened response-accounting checks before acceptance.
The worker draft is recorded as partial with host integration; no retry or paid
comparison arm ran. Private evidence is outside Git; complete host usage and
billing remain unknown.

The local release-check blocker is resolved. Doctor and benchmark changes remain
uncommitted and unpublished; this is not new CI, registry or client acceptance.
Next adoption gate: a real Claude source-packet task and usage import. The existing
Heartwood owner retains its application task; no consumer checkout was changed.

## 22 September 2026 — First Claude task and real export import

After the 0.3.1 shipment, an independent installation of its downloaded GitHub
tarballs passed `doctor` against the Context checkout at `bb83fa3`. Claude Code
2.1.278 then ran a useful read-only language coverage audit using that installed
MCP server. The actual model was `claude-sonnet-5`, with medium effort requested.
The existing Max subscription login was used; no new API credential was supplied.
One client invocation completed successfully, with no reported provider refusal,
tool error or permission denial and no host replay. Heartwood was not inspected or modified.

The invocation supplied an explicit MCP binding, `--strict-mcp-config`, the four
allowed repository tools, no built-in tools, and disabled skills for this bounded
audit. It preserved saved client settings. This establishes real Claude Code
print-mode use with an explicit binding, not acceptance of every interactive
configuration. [CLI flag reference](https://code.claude.com/docs/en/cli-reference).

The model called status once, refresh once, search eight times and packet once.
The source-backed result needed host corrections: it falsely called `.kts`
absent from broad scanning, misstated the number of packet suffixes, described
the planner rejection incorrectly and omitted `.hh` from its proposed alignment.
The reviewed [support matrix](LANGUAGE-SUPPORT.md) is accepted after those
corrections; the original draft remains partial, retained privately. No second
model pass was needed. The audit identifies a concrete next task: align Kotlin
script and C++ suffix eligibility across navigation and exact source packets,
with per-suffix tests and no broader parsing claim.

The completed transcript was copied from this explicitly created session only.
The existing daily importer accepted its real shape without code changes: 19
assistant entries became seven unique request records, with 12 identical copies
removed and no conflicts. Imported totals exactly match the CLI result:
166,442 input tokens (130,617 cache reads, 35,811 cache creation, 14 fresh input),
5,322 output tokens, 171,764 combined. The separate CLI thinking count is included
in output; imported reasoning and effective effort remain unknown. Reported
list-price cost is not subscription billing and is not treated as cash spend.

Private launch, transcript, original answer, review, reconciled receipt and task
summary are retained outside Git. Only the observed Claude execution is fully
accounted here. Codex preparation, repair/integration and review usage are not
fully captured; review duration and whole-task cost remain unknown. Coverage
assertions explicitly retain those gaps. This is Context development, not an
accepted Heartwood application task, a controlled comparison or evidence of
token/subscription/cash savings.

OS1a and FS2 now have first real Claude read-only tool-use and export evidence.
Actual-client edit → stale → refresh, restart/disable, a consequential task and
complete everyday host/worker/review receipts remain open. Eight searches before
one packet are an observation to review on further tasks, not a demonstrated
regression or causal savings claim. Documentation links and source assertions
were checked; no production code or language eligibility changed in this slice.

## 22 September 2026 — Kotlin script and C++ retrieval alignment (0.3.2)

The language audit's six concrete gaps are fixed: `.kts`, `.cc`, `.cxx`, `.hh`,
`.hpp` and `.hxx` are eligible for navigation and exact packets. Broad scanning
already recognised them; syntax planning remains TS/JS-only. No new parser or
semantic-resolution claim is made. The support matrix now documents this state.

The M4 worker endpoint was occupied by another live session, so no inference was
dispatched or interrupted. The host implemented and reviewed the small allowlist
change and regression tests. The first focused run failed seven assertions on
test error wording; the repair checks actual stale status and the existing
refresh-required error. All 26 focused tests then passed. Whole host usage and
review cost remain incomplete; no worker-token or monetary saving is claimed.

Local shipment checks passed 402 tests, independent installed-package smoke,
both unchanged benchmark gates, navigation stdio smoke, 22 scale tests and the
10k postings probe. Per-suffix MCP tests cover search, source hashes/lines,
checkout/commit provenance, stale rejection and refresh, Git-ignore exclusions
and unsupported plan requests; the installed smoke retrieves all six suffixes.
Dart remains explicitly unsupported. Publication/CI evidence belongs to the
0.3.2 release, separately from these local checks; npm auth returned HTTP 401.

Existing servers need a reconnect after the upgrade. No Heartwood checkout,
configuration or live job was changed. Real Claude lifecycle qualification,
routine whole-task receipts and measured benefit remain the next adoption gates.
