# Deterministic code intelligence and better developer results

Updated: 22 September 2026. Product direction and implementation contracts;
not a claim that the proposed capabilities or benefit gates have passed.
This implements the owner's priority: do more without an LLM, deepen language
understanding, and make developers demonstrably more successful with Context.
The active owner/model queue remains [OS0–OS6](OPEN-SOURCE-EXECUTION.md).

## Product test

Developers may already use OpenCode, Graphify, compiler diagnostics and a mix of
frontier and inexpensive cloud models. Treat that as a target workflow to qualify,
not an established market-share claim. A smaller prompt or another graph is not
sufficient reason to switch. Context must reduce wrong conclusions, failed changes
and repeated investigation while preserving the developer's existing acceptance
bar. Cost reduction and better outcomes both need whole-task evidence.

OpenCode is a first-class qualification target alongside Claude Code and Codex.
Its current docs describe MCP, per-agent model selection and optional LSP
diagnostics; the LSP docs also describe resource/freshness tradeoffs. Graphify
already describes deterministic local code parsing. Therefore neither MCP nor
LLM-free parsing alone is a competitive advantage. This is a documentation
comparison, not executed acceptance of either product.

## What the machine should do without inference

| Work | Deterministic implementation direction | Evidence and boundary |
| --- | --- | --- |
| Discover code | Existing root/policy selection; parser-backed declarations and exact spans | Exclusions, parse failures and unsupported syntax remain visible |
| Resolve symbols | Compiler or language resolver for selected project configuration | Distinguish syntax, resolved static binding, possible dispatch and unknown target |
| Explain dependencies | Traverse typed relations; render evidence-backed templates | Explanation cites the supporting source and resolution assumptions; no generated narrative needed |
| Find relevant tests | Direct symbol/import links and explicit test configuration; optional imported coverage | Naming proximity is a candidate, not proof of coverage; tests remain client-executed |
| Assemble task evidence | Start with a symbol, diagnostic or diff; select definitions, references, contracts and test candidates under a budget | Return selection reasons, omitted candidates and unresolved dependencies; no claim of complete semantic closure |
| Reuse work | Content-addressed analysis; bounded changed-file invalidation and reverse-dependency updates | Include config, dependency, parser, policy and worktree identity; watcher events alone do not establish freshness |
| Transfer between models | Reuse source packets and structured handover state | Freshness verified again by each consumer; assertions and pending side effects are labelled |
| Account for benefit | Parse receipts, deduplicate requests and aggregate all attempts/review | Include refresh work, tool schemas, cached/uncached tokens, failures and human time |

Natural-language intent and code changes can still use the client's chosen model.
Context's deterministic route must work with no model account, embeddings, model
classification or generated summaries. Optional enrichment remains an external,
labelled input. Zero inference cost does not mean zero CPU, memory, disk or
maintenance cost; measure both initial analysis and repeated use.

## Confirmed correctness issue: shadowed TypeScript call

On `5df1b8b`, a disposable fixture passed to the built `scanSourceGraph` returned
`invoke --calls--> target` for this source:

```ts
export function target() { return 1 }
export function invoke(target: () => number) { return target() }
```

The called identifier is the parameter; the file-level function is not an
established target. The emitted record carries `typescript-ast` / `extracted`
provenance with confidence 90. That record-level label does not communicate the
incorrect call resolution. The probe used a fresh temporary root, fixed
`observedAt`, no model or network and removed only its own fixture afterwards.

The cause was the file-level name lookup in
[`source-scan.ts`](../packages/context-tools/src/source-scan.ts), which did not
resolve the lexical binding at the call site. The original source-scan tests covered
ordinary calls and some ambiguous object calls, but not this shadowing case.

**First implementation gate:** add the failing regression, then resolve the actual
binding or omit the unproven edge. Cover parameter/local/block/import shadowing,
destructuring, nested callbacks, duplicate method names and `this` rebinding.
Retain valid direct calls, aliases and cyclic imports. Correctness must not be
traded for graph density or benchmark compression. This was a confirmed
correctness defect in 0.3.2; it does not invalidate exact source packet copying.

Version 0.3.3 replaces name lookup with isolated TypeScript compiler
binding over selected trees. Regression fixtures cover the reproduced error,
TS/JS shadowing, call ownership and declaration identity, with additional compiler
access-boundary tests. Named default and local re-export aliases also resolve.
See the [execution ledger](DOGFOOD-EXECUTION.md) for final checks and review.
This is a bounded scanner correction, not a completed OS4b task query, project-aware
resolver, client qualification or measured developer savings result.

## Architecture and language depth

Keep the browser-safe signed core separate from Node analysis. Build a derived
repository graph with bounded queries, then optionally project selected evidence
into the existing signed wire format. Do not route every repository symbol
through a 128-record signed collection or silently raise that protocol limit.
Extend the existing Node tools first; a new package needs a demonstrated packaging
reason. Preserve public names, unsigned/signed boundaries and explicit roots.

Define one internal extractor contract before adding grammars: language and parser
version, source hash, exact span, scoped symbol identity, relationship kind,
derivation/resolution method, selected build configuration, target candidates
and unresolved reason. A compiler-resolved symbol still does not prove runtime
dispatch. Define edge-level evidence internally without changing signed v1 fields
until a compatible projection has been reviewed. Numeric confidence is not a
measured probability.

| Order | Language work | First useful acceptance |
| --- | --- | --- |
| 1 | TS/JS: scope correctness, then bounded TypeScript Program/TypeChecker integration; explicit tsconfig, aliases, re-exports and project references | An API-change task follows the actual symbol through a barrel/alias, finds its callers and test candidates, and avoids shadowed names |
| 2 | Rust: parser-backed spans/modules/use/re-exports, impls and traits; explicit Cargo workspace/features/cfg identity | A module/trait change returns correct declarations and candidate references; unresolved macros and dispatch remain explicit |
| 3 | Kotlin: parsed packages/imports, complete declarations, extension/overload distinctions and selected module metadata | A contract-change task retrieves complete relevant Kotlin evidence and distinguishes same-named functions |
| 4 | Dart/Python/Swift/C++ according to selected developer tasks | Add eligibility, syntax spans, resolution and task evidence as separate support levels; no language-complete claim from an extension list |

Use the pinned TypeScript API already present before adding a TS parser. Its
official documentation distinguishes syntax trees, Programs and TypeCheckers and
warns that API generations differ. Investigate Tree-sitter for syntax coverage,
not as a substitute for symbol/type resolution. Evaluate rust-analyzer and other
language services as explicit optional adapters where they improve accepted tasks.
Do not run two expensive language services merely because the client already has
one; first establish whether a supported sharing/export interface exists.

All compiler-host file reads, including tsconfig extends, project references,
package metadata and declarations, must pass explicit scope and resource policy.
Dependencies outside the selected root require a declared additional scope; an
import is not access authority. No hidden package install, network fetch, build,
macro execution or Gradle evaluation. In particular, rust-analyzer documents
build-script/procedural-macro execution options: a future adapter must verify its
effective no-execution settings and qualify them before use, or require a separate
explicit execution operation. Ordinary approved client tests stay client-owned.

## Queries and handoffs that replace repeated model work

Proposed query operations are symbol, references, neighbours, path, impact
candidates and evidence packet. They are requirements, not newly available MCP
tool names. Prefer a compact shared query contract over many overlapping tools.
Start from exact identifiers, source locations, compiler diagnostics or changed
ranges. Natural-language decomposition can remain with the client.

Return exact source, relationship reasons, revision/generation and completeness
metadata in one bounded answer where possible. Include complete selected syntax
units and pertinent tests; support expansion without repeatedly returning the
entire packet. Measure wire/schema overhead as well as source tokens. Evidence
handles cannot assume a new model has read earlier content: materialise the
required source for each receiving model and verify the generation.

Reuse [`task-handover.mjs`](../scripts/task-handover.mjs) and packet contracts:
task, allowed files, acceptance checks, decisions, diff/source identity, unresolved
questions and pending effects. Package useful handover functionality after its
contract is qualified; today's helper is checkout tooling. A switch to a cheap
worker must not silently discard constraints, hide failed attempts or cause
another full repository exploration. The client owns model choice, escalation,
execution and review; Context owns the evidence.

## OpenCode and existing-tool adoption

Qualify a pinned OpenCode version with the same four repository tools and exact
worktree binding. Verify source use, edit/stale/refresh, wrong-root refusal,
restart, cancellation and disable in the actual client. Record its effective
agent permissions, model and tool inventory; a sample JSON file is preparation.
Provide concise setup and skill/instruction material that preserves existing
agents and Graphify configuration. Never claim that this plan installed OpenCode
or that its subscription/provider combinations have been tested.

Test selective use alongside Graphify separately from replacement. Record which
tool supplied each fact, prevent duplicate graph dumps and count both tools'
indexing and context overhead. Do not copy/integrate Graphify code or assume its
graph is authoritative. Defer a format adapter until a real coexistence task
needs one. Extend provider-neutral accounting to actual OpenCode exports after
inspecting a selected version's schema; missing usage remains unknown.

## Acceptance: better outcomes and lower complete cost

Preserve all existing D5 results/protocols and benchmark thresholds. The following
is a new prospective evaluation to lock before running paid arms:

1. **Zero-model conformance first.** Fixtures check symbol/edge correctness,
   evidence precision/recall, exact spans, budgets, repeatability, edits/deletions,
   policy and config changes. Include the shadowing regression and examples the
   current implementation cannot answer correctly. Record analysis latency,
   memory and bytes read, cold and warm. Passing does not prove developer benefit.
2. **Qualify one representative task.** Use one versioned client/model/effort and
   useful task with predefined acceptance. Fix demonstrated evidence gaps before
   buying more comparisons. Every attempt and repair stays in the record.
3. **Compare competent workflows.** Ordinary search plus the client's normal
   compiler/LSP/test tools; the same workflow with a pinned Graphify configuration;
   and with Context. Hold repository, task, model, review and permissions fixed.
   Pin Graphify mode and optional semantic processing; count any extraction-model
   cost. Retain built-in tools in every arm, alternate order, isolate sessions and
   record cold/warm caches and all setup/amortisation assumptions. Graphify is an
   external evaluation dependency, never a core runtime prerequisite.
4. **Lock the quality and cost gates.** Retain OS2's proposed eight tasks across
   two repositories, one external. All Context outcomes must meet the common
   acceptance bar with no material regression. Require improvement in a named
   outcome measure: first-pass accepted changes, missed/incorrect dependencies,
   or substantive review repairs. A lower token count alone cannot pass the
   better-results claim. If the baseline is perfect, use a prospectively selected
   harder task class rather than claim an unobserved quality improvement. Retain
   the proposed 20% aggregate total-token reduction and no higher review-time
   target; additionally report wall time, local work and attributable money.
5. **Then qualify mixed models.** Keep the chosen frontier-planner/cheap-worker/
   reviewer policy identical across retrieval arms; count escalation and failed
   cheap attempts. Only a separate routing comparison may change that policy.
   A cheaper worker must pass the same task checks. Do not attribute routing
   gains to retrieval or require users to adopt our development model choices.

Report task classes won, lost and unknown against each baseline. Stop claiming a
general replacement if Context cannot beat the existing workflow at useful work.
Token reduction, subscription headroom and lower paid bills remain separate;
ordinary internal adoption continues while external claims remain gated.

## First delivery slices

| Slice | Owner and existing assignment | Concrete deliverable |
| --- | --- | --- |
| OS4b-1 correctness | Context language implementer; Sol/high contract/review, Terra/medium integration, Flash/off bounded fixtures | Regression and scope-aware call resolution; no false shadowed edge and retained valid relationships |
| OS4b-2 useful resolution | Same language owner; existing OS4b model assignments | Selected TS project resolution plus one symbol-to-caller/test evidence query, then first Rust parser slice |
| OS1e OpenCode | Context integration owner; Terra/medium integration, Flash/off fixtures/docs | Portable setup, client acceptance and one inspectable task receipt; no automatic model/account change |
| OS2 outcomes | Context lead and independent reviewer; existing OS2 assignments | Locked quality/cost comparison against competent ordinary and Graphify workflows; failed arms retained |
| OS5 measured reuse | Context indexing owner; Sol/high design/review, Terra/medium integration | Profile repeated analysis, then bounded reuse/invalidation only where it removes measured work |

These slices start alongside daily FS adoption and installation work, before the
viewer or enterprise work. They do not authorise paid experiments automatically,
select an external private repository or activate a provider. No new parser,
client acceptance or savings result was delivered by this planning change.

## Primary sources checked 22 September 2026

- [OpenCode MCP](https://opencode.ai/docs/mcp-servers/): local/remote tools and context overhead.
- [OpenCode agents](https://opencode.ai/docs/agents/): agent-specific model and permission configuration.
- [OpenCode LSP](https://opencode.ai/docs/lsp/): optional diagnostics and operational tradeoffs.
- [Graphify](https://github.com/Graphify-Labs/graphify): deterministic code extraction and graph workflow; vendor claims, not our acceptance results.
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API): Program, TypeChecker and version boundaries.
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/): incremental syntax parsing.
- [rust-analyzer configuration](https://rust-analyzer.github.io/book/configuration): build-script and procedural-macro behaviour.
