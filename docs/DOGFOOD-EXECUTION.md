# ForgeSworn dogfood execution ledger

21 September 2026. This records implementation and acceptance separately from
the [goal definitions](FORGESWORN-DOGFOOD-GOALS.md).

## Implemented and locally verified

- `04fda60`: adoption goals and daily agent workflow.
- `b1a4de8`: manifest freshness, cancellable inspection, bounded concurrent
  status handling and a repeatable two-process MCP smoke.
- Repository selection now honours scoped `.gitignore` rules and explicit
  include/exclude prefixes. Policy changes block old-snapshot search until
  successful refresh. Policy hashes are part of the source revision.
- Policy reads reject malformed input, symlinks, non-regular files, read races,
  invalid UTF-8 and resource overflows. Error messages do not echo invalid JSON.

`npm run check` passes 33 core and 103 tools tests plus independent packed
imports, browser isolation and CLI persistence. Both unchanged benchmark gates
pass with declared-source recall 1.0. The SDK stdio navigation smoke passes in
two fresh server processes. These checks are not a public registry release.

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

## Model execution and cost boundaries

| Lane | Actual result |
| --- | --- |
| Flash, thinking off, local Ollama cloud endpoint | One terminal HTTP 402 in 0.452 seconds; no retry or alternate cloud endpoint used |
| Local Qwen, thinking off | Two code drafts rejected; one runbook draft partially retained after review |
| Terra, medium | Bounded implementation fallback and review for freshness, exclusion policy and the smoke harness |
| Host GPT-6 | Boundary design, review, integration and acceptance; exact host effort and usage unavailable |

Qwen's three requests reported 9,236 input and 4,233 output tokens (13,469 total),
including both rejected drafts. Flash usage is unknown. The helper saved the
HTTP status but discarded its response body, so the provider's explanation for
402 remains unknown; it is not evidence of a particular quota or credit state.
The daemon log independently confirms the HTTP response.

Host and Codex-worker costs and review time are not fully attributed. This
delivery therefore establishes no cash saving. Private receipts retain failed
attempts and the diagnosis; raw prompts and machine paths are not published.

## Gate status

| Goal | Status | Remaining acceptance |
| --- | --- | --- |
| D0 reproducible pilot | In progress | Final candidate CI, pinned installation and new-client acceptance |
| D1 daily Context use | In progress | Complete three accepted tasks across two fresh client sessions |
| D2 source selection | Locally passed | Candidate CI and installed-package confirmation |
| D3 two additional repositories | In progress | Qualified client bindings, normal task acceptance and disable-path verification |
| D4 reusable worker packets | Open | Packet builder/format and two accepted worker coding tasks |
| D5 whole-task savings | Open | Predeclared eight-pair trial with complete host/worker accounting |
| D6 consumer/room integration | Open | Coordinate with Oathrun's own authority and execution gates |
| D7 dependable distribution | In progress | Pinned internal install; public publication still requires G0–G4 |

The immediate command-line workflow is in [daily use](DAILY-USE.md).
Run [the navigation smoke](NAVIGATION-SMOKE.md) when validating a build and
consult [policy semantics](NAVIGATION-POLICY.md) before expanding source scope.
