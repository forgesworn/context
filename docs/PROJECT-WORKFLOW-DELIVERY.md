# Default project context and feature delivery

Owner request: complete the code-relationship, cross-host workflow, accounting
and local graph features. Context must be used by default on project work,
without the owner asking for it in every session.

The selected implementation checkout is `forgesworn/context`. Existing global
installation and explicit checkout boundaries remain. No project gets an
application runtime dependency, and source discovery does not run project code,
Cargo build scripts, Gradle or model inference.

## Acceptance

- [x] Explicit root-confined TypeScript config aliases and namespace imports
  resolve against selected source, preserving shadowing/type-only rejection.
- [x] Rust/Kotlin syntax trees provide exact declaration spans, imports and
  complete packet planning. Parse failures, overloads, macros and dynamic
  dispatch stay explicit; syntax is not compiler resolution.
- [x] A bounded local graph query and offline viewer show source-backed
  relationships, neighbourhoods, search, omissions and source excerpts.
- [ ] Fresh coding sessions use global context guidance without a task-specific
  opt-in. Codex, Claude and Kimi native use is qualified separately; direct
  Ollama receives host-verified packets through its established helper.
- [ ] Workflow evidence covers current source, edits/stale/refresh, restart,
  handover and coordination. Failures remain recorded rather than relabelled.
- [x] Complete-task accounting reconciles an explicit attempt inventory with
  receipts and reports missing phases, unknown usage and uncollected billing.
- [ ] Focused regressions, full checks, unchanged benchmark gates, independently
  installed packages, hosted CI and public artefact readback pass for shipment.

Measured developer improvement and savings require their existing prospective
comparison gates. Implementing accounting does not close those gates. Real
application acceptance belongs to each project's owner; this work does not
silently edit sibling projects to manufacture adoption evidence.

## Implementation and qualification, 2 November 2026

The four feature areas are implemented for 0.11.0. Global instructions and
supported startup hooks make the workflow available without a project-specific
request. The shared skill is shipped inside the tools package so installations
can pin it to a verified release rather than a development checkout.

Local `npm run check` passed 573 tests: 36 core, 284 tools, 46 packet/handover,
16 task-cost, 79 ecosystem, 104 usage and eight corpus tests. Independent packed
installation exercised the graph CLI/MCP, Rust/Kotlin packet planning, dependency
metadata, Kimi accounting and hook setup. Unchanged navigation gates retained
required-source recall 1.0; the 10k postings probe passed. An actual Chrome run
covered search, selection, relationship navigation, source inspection and a
390-pixel viewport without errors, external requests or horizontal overflow.

Observed regressions were repaired for same-line shadowing, type-only barrels,
unindexed callback call ownership, Cargo source-kind mismatch, graph refresh
between the generation precheck and read, and startup Git discovery ceilings.
The original TypeScript shadowing defect was already fixed in 0.3.3; this task
adds project configuration and language depth.

### Actual host behaviour

Fresh prompts did not ask for Context. The later Claude and Kimi trials used
closed stdin to isolate the supplied prompt. Earlier native trials inherited
launcher stdin and therefore cannot qualify automatic model adherence.

| Host | Observed | Still unproven |
| --- | --- | --- |
| Codex | Startup hook now observed automatically in the actual session, native status/coordination and skill loading; useful shadowing review | Complete unattended edit/restart/coordination lifecycle |
| Claude | SessionStart hook executed and supplied checkout/skill/workflow context; review found the generation race | Model followed Bash reads instead of the repository workflow, so full adoption is not accepted |
| Kimi | Clean-input trial loaded guidance and used native status, coordination, refresh and source packets | Task publication, final checkpoint and complete lifecycle adherence |
| Ollama | Host verified a bounded packet; existing Flash/off helper completed a quickstart draft and host reviewed it | Raw API discovery is not supported; no complete host-independent lifecycle claim |

Codex hook trust is an owner action through `/hooks`; installation does not
bypass it. Hook execution supplies guidance, not a guarantee of model behaviour.
Restart, stale-source refusal, refresh, handovers and coordination have tool and
installed-package coverage; this does not promote each host to lifecycle
acceptance. No sibling project was edited to manufacture adoption evidence.

### Bounded host workflow follow-up

The [optional host workflow contract](HOST-WORKFLOWS.md) adds explicit task
dependencies, result/review records, deterministic finding reduction, bounded
retry/resume planning and qualification-receipt checks. It does not execute
workers, authenticate supplied receipts or establish complete host adherence.
Actual host trials and whole-task measurement retain the separate gates above.

### Actual 0.12.0 fixture trials and checkpoint repair

Ordinary cancellation tasks did not name Context. All three completed fixes
passed a separate four-test oracle that rejected the identical baseline. The
first Claude and Kimi controller launches failed CLI argument parsing before
model execution; those attempts remain retained. The corrected launches used
closed stdin and existing model/provider choices. Claude had a $1 API ceiling;
each run had a 240-second wall limit.

- Claude's hook ran and its Z1P server connected, but its successful fix used
  Bash/Edit/Read and bypassed Context. This does not qualify its lifecycle.
- Kimi loaded the shared skill and used native status, coordination, activity,
  refresh and source packets. `package.json` was rejected as packet evidence.
  Both checkpoint attempts supplied placeholder packet data and an invented
  state shape; both failed. It marked its activity done, but the controller hit
  its wall limit before a complete final response. A local addressed note was
  delivered; no acknowledgement was observed.
- Codex used native context, activity, fresh source packets and checkpointing.
  It saved a valid checkpoint after repairing a missing `.json` suffix and a
  state schema error. Its fixture run finished in about 77 seconds. This does
  not establish restart/resume or all-host acceptance.

A further Claude fixture used the same ordinary task and an instance-only
`UserPromptSubmit` reminder containing the existing startup guidance. That hook
also executed successfully; the fix passed the independent oracle, but Claude
still bypassed Context. The experiment is retained, and no global prompt hook
was added on the strength of an unobserved benefit.

The 0.13.0 follow-up addresses this observed API friction: connection-local
packet IDs avoid source copying, the checkpoint state schema is discoverable,
and explicit configuration evidence can be included. These tool repairs do not
retroactively turn the unsuccessful host steps into passing results. Raw traces,
patches, controller receipts and oracle results stay in private acceptance
storage; they are not uploaded into the public repository.

### Accounting and delivery gates

The Kimi wire importer was replayed against two real selected exports, including
the fresh Kimi trial, using additive main-agent counters rather than cumulative
status. The task inventory reconciles all five retained native attempts and the
Ollama helper receipt. Earlier contaminated trials remain included. Primary
coordinator preparation/repair usage is missing, so the whole-task token total,
billing and savings remain unknown. An observed subtotal is not a whole-task
cost result.

The unchecked acceptance items above remain separate qualifications. Matching
hosted CI, public release assets and installed readback accompany shipment in the
release record; this document does not pre-claim those external effects.
