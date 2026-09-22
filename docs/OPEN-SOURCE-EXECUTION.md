# Open-source delivery goals and assignments

Updated: 22 September 2026. Accountable owner: the product owner. Execution lead: the
Context development session. This is the active product work queue, governed by
[product direction](../PRODUCT_DIRECTION.md), the [MIT boundary](../OPEN_CORE.md)
and [G0–G4 release gates](../GOALS.md).

Immediate priority: [FS0–FS5 daily adoption and monthly savings](FORGESWORN-DOGFOOD-GOALS.md#immediate-savings-goals-fs0fs5)
for ForgeSworn developers using Claude and Codex. Start real usage and receipts
now; the external-project and full controlled release evaluation below follow
without blocking internal adoption. These FS goals apply this queue to the first
users, not a separate product or enterprise workstream.

The [client and language work packets](CLIENTS-AND-LANGUAGES.md) make Claude Code
and Codex first-class MCP clients and prioritise deeper Rust/TS/Kotlin evidence.
OS1a/OS1b and OS4a/the smallest OS4b slice are near-term work, not enterprise.
Provider authentication, model selection and runtime routing remain client-owned;
the model assignments here describe implementation/testing, not Context coupling.

Deliver an independently implemented MIT graph and context tool that any
developer can use on supported projects to reduce inference consumption without
lowering development quality. Heartwood is the first user, not a runtime
dependency. Oathrun integration is optional. Enterprise implementation is parked
until the open-source workflow works independently and delivers measured benefits.

These are assignments, not running jobs, new hires or automatic model switches.
No enterprise repository, service, customer deployment or provider call is
created by this plan. Existing uncommitted work and locked experiments must be
preserved. Status below records planning and known local evidence, not fresh CI.

## Who owns what

| Owner | Responsibility | Where |
| --- | --- | --- |
| the product owner | Product priorities, developer acceptance, choice of external pilot, release decision | This project and actual developer use |
| Context execution lead | Own the queue, produce bounded implementation tasks, integrate changes and record evidence | `context` repository; this session or its explicit successor |
| Context implementer | Complete one scoped change and its checks using the assigned model | An explicit Context checkout/worktree; no concurrent edits to the same files |
| Context reviewer | Independently check consequential boundaries and savings acceptance; review ordinary changes proportionately | Context diff, exact source/tests and private task receipts |
| Existing Heartwood session | Own Heartwood application changes, application tests and device acceptance | `~/WebstormProjects/heartwood-esp32`; its existing selected checkout |
| Independent developer/pilot | Follow installation instructions and report success/friction on a non-ForgeSworn project | An explicitly selected repository and isolated installation; person/repository not yet selected |

The Context session supplies a compact handoff to the Heartwood owner; it does
not duplicate the application task or alter that owner's checkout/configuration.
Role assignments do not authorise unsolicited messages or ambient repository
access. The execution lead owns progress until another owner is explicitly named.

## Model and effort assignments

| Name used below | Exact model / control | Assigned use |
| --- | --- | --- |
| Deterministic | No model; no reasoning effort | Scan, select/verify source, assemble packets, test, count usage and compare results |
| Flash/off | `deepseek-v4.1-flash:cloud`, `think=false` | Small implementation, fixtures and documentation against a complete contract |
| Terra/medium | `gpt-5.6-terra`, `medium` | Integration, ordinary review and bounded implementation when Flash is inadequate |
| Sol/high | `gpt-5.6-sol`, `high` | Architecture, provenance/access boundaries, difficult lifecycle work and savings acceptance |
| Luna/medium | `gpt-5.6-luna`, `medium` | Optional small mechanical/documentation fallback; not required for the critical path |
| GLM/low | `glm-5.3-flash:cloud`, `low` only after runtime support is verified | Deferred candidate qualification on one useful bounded task; not a dependency |
| Pro/off | `deepseek-v4-pro:cloud`, `think=false` after endpoint eligibility/reconciliation | Optional harder-worker experiment; not a dependency |
| Claude Sonnet/medium | `claude-sonnet-5`, `medium` | First Claude Code client qualification and routine coding acceptance; not yet qualified here |
| Claude Opus/high | `claude-opus-5`, `high` | Consequential Claude task/review acceptance after basic MCP qualification; not yet qualified here |

See [Claude assignments and official references](CLIENTS-AND-LANGUAGES.md) for
effective model/effort recording, optional Fable/Haiku lanes and account boundaries.

The Codex settings are supported by the official model references checked on
22 September 2026: [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna). Task assignments
are our judgement, not vendor guarantees of quality or savings. Ollama controls
are separate; retain actual returned model/control metadata in receipts.

Use the explicit M4 endpoint `http://127.0.0.1:11435` for our internal workers.
That endpoint and our private worker helper are development infrastructure, not
requirements for users of Context. Qwen is outside the default workflow.

Use one focused repair after a terminal inadequate worker draft, then resize
or escalate with concrete evidence. Do not replay unknown requests or bypass a
provider refusal/spending hold. The resolver's two rejected drafts already
justify frontier ownership of that contract; do not repeat the same experiment.
Do not run a cheap-model pass merely as a prerequisite to necessary frontier work.
No max/ultra effort is planned. The existing Heartwood owner retains its model
and effort; record the actual values rather than silently switching them.

## Ordered work queue

| Goal / status | What needs doing | Owner and location | Implementation | Review | Completion evidence |
| --- | --- | --- | --- | --- | --- |
| **OS0 — Useful daily task. Next; tools exist** | Supply one sufficient verified packet for a real task; reuse current evidence on two further tasks; capture repairs and usage | Context lead: `scripts/worker-packet.mjs`, `docs/WORKER-PACKETS.md`, private receipts. Heartwood owner: application task in its own checkout | Deterministic first; Flash/off only for a demonstrated small tooling gap. Application work keeps its existing frontier model/effort | Existing application review; Terra/medium for routine Context changes, Sol/high only for a boundary change | Three accepted tasks with task/revision/model, source selection, freshness, checks, failure and usage records. This proves usability, not savings |
| **OS1 — Independent developer installation and MCP clients. Next; partial local proof exists** | Package supported CLI/MCP use for **Claude Code and Codex**; expose bounded verified source packets; eliminate private-helper dependencies; follow OS1a–OS1d | Context implementer: `packages/context-tools`, `scripts`, package manifests, `test/context-package-smoke.mjs`, README and client docs | Flash/off for scoped packaging/docs; Terra/medium integration; Sonnet/medium then Opus/high for Claude qualification | Terra/medium; Sol/high for new disclosure/path boundaries | Pinned install outside workspace; actual task/tool use in both clients, edits → stale → refresh, restart/removal and bounded source; Node/Python prerequisites explicit; no Oathrun/provider credentials in Context/M4 required |
| **OS2 — Benefits with frontier quality. Open; previous assisted qualification failed** | Qualify the improved packet once, then prospectively lock and run a fair retrieval comparison using the same frontier model per pair; include non-ForgeSworn use | Context lead + reviewer: `benchmarks`, `test/task-cost-report.test.mjs`, `scripts/task-cost-report.mjs`, a new `docs/experiments` directory and private usage receipts; external pilot owns its repository | Deterministic accounting; Flash/off for small reporting gaps; **Sol/high for both new baseline and assisted executors**, separate fresh sessions | Independent Sol/high for protocol and accepted outcomes | Eight paired tasks across at least two explicit repositories, including one outside ForgeSworn; all assisted outcomes accepted; target ≥20% lower aggregate total model tokens and no higher aggregate review time. Report cached/uncached input and output separately; billing unknown leaves cash savings unproven |
| **OS3 — Usable local graph. Queued after OS0–OS2** | Bring the original viewer and dependency graph into maintained MIT tooling; expose neighbourhoods, search, source links, edge provenance and incomplete/unknown results | Context implementer: original private prototype as input, maintained implementation under `packages/context-tools`, tests and public fixtures | Flash/off for bounded UI/fixtures; Terra/medium for graph/tool integration | Terra/medium for usability; Sol/high for unsafe-content and source/disclosure boundaries | An independent install visualises a selected repository/ecosystem, explains each relationship and opens exact evidence; works offline without a service; no Graphify code; hostile labels/links and large result bounds tested |
| **OS4 — Correct versions and language understanding. Partial; OS4a/b start with OS1** | Connect snapshot evidence; publish exact support levels; deepen Rust and TS/JS, then Kotlin and task-selected wider-stack languages; follow OS4a–OS4d | Context lead: `scripts/ecosystem_resolution.py`, `scripts/ecosystem_snapshot.py`, source/ecosystem scanners in `packages/context-tools`, matching tests and fixtures | Sol/high version/provenance design; Terra/medium parser/integration work; Flash/off mechanically specified fixtures | Independent Sol/high for resolution/identity; Terra/medium ordinary extractor changes | Released package vs HEAD/worktree/ambiguity fixtures; parser-backed relationships and complete packets on real stack tasks; TS/JS syntax hints are not type-checked proof, and lexical inference remains labelled; unsupported cases visible |
| **OS5 — Practical local scale and refresh. Proposed; activate for measured need** | Qualify persistent local indexing and incremental refresh against actual workloads; resolve private-index storage policy before private source is persisted | Context lead: `docs/ENTERPRISE-SCALE-REVIEW.md`, `docs/BOUNDED-SEARCH-DESIGN.md`, `benchmarks/scale`, Node tools adapter; protocol changes only if justified | Sol/high for storage/generation design; Terra/medium for integration; Flash/off for scoped fixtures | Independent Sol/high | Predeclared corpus, latency/memory/work budgets, recall and update targets pass; cancellation, deletion, crash/recovery and concurrent readers tested; no silent plaintext private index. All local capabilities remain MIT |
| **OS6 — Dependable open-source release. Open** | Consolidate intended changes, finish applicable G0–G4 checks, document supported capability set and publish through the release process when authorised | Context lead + the product owner: Context packages, CI, `RELEASE_EVIDENCE.md`, README/changelog and registry acceptance | Deterministic build/install/checks; Flash/off for release docs; Terra/medium for packaging repairs | Terra/medium release review; Sol/high signs off unresolved consequential boundaries and savings evidence | Named commit, matching CI, clean independent install, exact published registry smoke and real external usage; honest scope/gaps, measured benefits and licence/notices inventory |

The OS2 token threshold is a proposed decision rule for a **new** prospective
protocol, to be fixed before running arms. Existing D5 v1/v2/v3 protocols and
results remain immutable. Also retain the separate D5 monetary target where
billing is attributable; tokens, cached allowances and cash are different
measures. Count host selection, execution, failed attempts, repair and review.
If complete usage is unavailable, mark the result incomplete rather than zero.
After one failed qualification, fix the observed cause before paying for eight
pairs. The three OS0 tasks are ordinary use, not controlled baseline arms.

## Dependencies and immediate handoffs

Start **OS0 now**. OS1 can proceed using the already accepted local workflow
while the Heartwood owner continues its application task. Start OS2's protocol
preparation alongside OS1, but run paid comparison arms only after the improved
handoff passes qualification. Keep model-routing comparisons separate.

Run Claude client acceptance as OS1a, with its own receipts and eligible account.
OS2's Sol/high pair is the Codex cohort; any Claude savings cohort must hold its
own Claude model/effort fixed. Passing one client is not evidence for another.

Prioritise OS0–OS2 over more ecosystem inventory. OS3 follows that benefit check.
Take only the OS4/OS5 slices that fix observed correctness or usability limits;
they may move earlier when they block OS0–OS2. Do not make every language,
every lockfile format or speculative million-node capacity a first-release
requirement. OS6 still requires all applicable G0–G4 acceptance for its declared
scope; a smaller release does not waive a known correctness/security defect.

| Next handoff | Sender → owner | Packet and expected return |
| --- | --- | --- |
| Actual application task | the product owner / existing Heartwood session → Context lead | Exact task, selected checkout/revision, relevant identifiers and acceptance checks; Context returns only needed current evidence and limitations |
| Developer install | Context lead → Context implementer | OS1 scoped package/CLI contract, exact source/tests and clean install fixture; return diff, checks and documented invocation |
| Qualification | Context lead → Context reviewer | New protocol draft, isolated task and acceptance checks, complete accounting plan; return approval or specific defects before execution |

These are ready-to-use assignments, not messages already sent. If the Heartwood
task handoff is not available, continue OS1 without reading or modifying its
active application work. Do not duplicate its session history in Context.

Every implementation handoff names allowed files, starting revision/source
hashes, model/effort, a bounded task and acceptance checks. Reuse exact verified
source rather than repeatedly sending the entire roadmap or conversation.
Use deterministic checks first. Reviews may inspect whatever authorised source
is necessary; token budgets must not hide material evidence.

## Enterprise and optional consumers: parked

No enterprise engineering goal is active. Do not start SSO/SCIM, shared hosted
graphs, billing, tenant services, managed connectors or deployments now. Preserve
the MIT/service boundary and avoid design choices that preclude later isolation,
but do not implement speculative enterprise infrastructure.

Revisit only after OS6 and repeat independent developer use demonstrate working
open-source value, and a real company identifies a paid operational need.
the product owner owns that future prioritisation; no implementation owner/model is assigned
yet. A later plan must define the customer, scope, repository, acceptance and
model budget. Useful local improvements continue to belong in this MIT project.
Oathrun/KithMoot integration remains a separate consumer-owned backlog item and
does not reopen this queue or delay the general release.

## Evidence and status updates

For each goal record `planned`, `in progress`, `blocked` or `accepted`, owner,
commit/worktree, actual model/effort, changed files, checks, all attempts, usage,
elapsed/review time, result and next action. Record local, CI, client, registry
and consumer acceptance separately in the
[execution ledger](DOGFOOD-EXECUTION.md) and
[release evidence](../RELEASE_EVIDENCE.md). Keep private prompts/source/billing
receipts outside the repository and publish only safe reproducible summaries.

Planning does not close a goal. New source changes need focused tests and the
required release checks; documentation-only planning needs link/consistency
checks, not fresh model trials or a full application test run.
