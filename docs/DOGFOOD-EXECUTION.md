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

The six recorded Codex task sessions in this pass reported 804,914 cumulative
input tokens, including 711,936 cached input tokens, and 9,575 output tokens.
Those totals include the incomplete lifecycle attempt; cached input is a subset
and reasoning output is already included. Collaboration-worker and host usage
remain unavailable. These are acceptance and development receipts without a
paired baseline, not an inference-cost comparison.

## Gate status

| Goal | Status | Remaining acceptance |
| --- | --- | --- |
| D0 reproducible pilot | Local lifecycle and build passed | Actual Codex edit/stale/refresh/old-cursor exercise now passed; candidate CI and installed-build receipts are recorded with each release |
| D1 daily Context use | Passed | Orientation, source-backed boundary diagnosis and accepted packet coding tasks span fresh clients; continue recording normal use |
| D2 source selection | Passed locally with qualified review | Sol/high review defects repaired; root, policy, cancellation and cursor regressions pass |
| D3 two additional repositories | Scoped clients passed; gate partial | Negative cross-root checks passed both ways; raw disabled-session tool absence remains unproven by the available CLI output |
| D4 reusable worker packets | Passed locally | Build and read-only verification implemented; two coding tasks accepted with source packets, repairs and host review recorded |
| D5 whole-task savings | Open | Predeclared eight-pair trial with complete host/worker accounting |
| D6 consumer/room integration | Open | Coordinate with Oathrun's own authority and execution gates |
| D7 dependable distribution | Internal install passed; public open | Public publication and consumer upgrades still require G0–G4 |

The immediate command-line workflow is in [daily use](DAILY-USE.md).
Run [the navigation smoke](NAVIGATION-SMOKE.md) when validating a build and
consult [policy semantics](NAVIGATION-POLICY.md) before expanding source scope.
