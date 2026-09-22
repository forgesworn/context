# Context / Z1P product direction

Updated: 22 September 2026. Product direction and acceptance plan, not a claim
that the capabilities below are all shipped.

Context must help developers produce better accepted changes with less complete
task cost. Smaller model context alone is insufficient: fewer wrong conclusions,
missed dependencies and repair rounds must be demonstrated against competent
existing workflows. Deterministic analysis and deeper language resolution are
near-term product priorities. See the [implementation and benefit contract](docs/DETERMINISTIC-CODE-INTELLIGENCE.md).
The target is an independently implemented, MIT-licensed alternative to Graphify
for repository graphs, exploration and coding-agent context. Do not copy or
integrate Graphify code. Replacement is a product goal; feature parity and
whole-task savings have not been demonstrated.

The active [open-source execution plan](docs/OPEN-SOURCE-EXECUTION.md) assigns
owners, code locations, models/effort, dependencies and acceptance evidence.
Enterprise engineering is deferred until independent open-source use delivers
measured benefits and the core release gates pass.

The immediate users are ForgeSworn ecosystem developers. Follow
[FS0–FS5](docs/FORGESWORN-DOGFOOD-GOALS.md#immediate-savings-goals-fs0fs5) to start
daily Claude/Codex use, capture whole-task usage and reconcile monthly costs.
General developer support remains the product goal; outside-ecosystem validation
follows the internal pilot rather than delaying it. Tokens, subscription headroom
and actual cash savings are separate outcomes.

## Product boundaries

Claude Code, Codex and OpenCode are first-class target MCP clients. Context already
has stdio MCP interfaces; each needs separate complete developer acceptance.
OpenCode qualification is planned, not delivered. Support developers who already
combine Graphify and frontier/cheap models; measure the benefit over that workflow
without requiring them to replace their client or routing policy.
Provider login, credentials, model selection and execution belong to the client
or optional Oathrun runtime. Context retains its own source/evidence access
boundaries. See [client and language goals](docs/CLIENTS-AND-LANGUAGES.md).

- **Context / Z1P Core owns code understanding:** extraction, repository and
  dependency graphs, evidence selection, freshness, local exploration, CLI,
  MCP and portable data. It must work without a ForgeSworn account, workspace,
  model provider or running agent platform.
- **Coding clients own development:** their chosen model, conversation, edits,
  execution and review. Context supplies inspectable evidence; it does not
  need to become a worker supervisor or automatically switch models.
- **Oathrun and other applications are optional consumers.** Their room,
  execution, deployment and integration gates do not block the general Context
  developer workflow. Preserve existing public APIs and signed wire names.
- **ForgeSworn projects are early users and test cases.** Heartwood dogfooding
  is valuable evidence, but general acceptance also needs a repository outside
  that ecosystem. No implicit cross-repository access follows from a graph edge.

Any developer/project is the intended audience, not a claim of complete support
for every language or build system. Publish precise support levels: semantic,
lexical, manifest-derived, inferred or unsupported. Keep unknown relationships
visible rather than inventing links.

## Complete MIT developer core

The useful local workflow stays in this MIT repository, including improvements
needed to make it practical on large repositories:

- deterministic indexing, supported language extractors and relationship queries;
- bounded source packets, provenance, freshness checks and local incremental refresh;
- explicit multi-repository selection, branch/worktree identity and dependency
  version distinctions;
- local graph exploration and visualisation;
- CLI, MCP, public integration APIs and documented portable import/export;
- local configuration, exclusions and the verification/security primitives
  required to use these features safely; and
- repeatable quality, token-use and performance evaluation tools.

These are commitments about where capabilities belong, not completion claims.
Do not impose account, seat, private-repository or artificial graph-size gates
on local use. Document genuine resource limits and improve them as engineering
work. Existing signed v1 limits remain until a compatible replacement is proven.
Do not move a generally useful fix behind a paid boundary because a company
requested it. See [OPEN_CORE.md](OPEN_CORE.md).

## What companies can pay for

The future commercial direction is paid operation and support around the MIT
engine. This section preserves the boundary; it is not an active workstream.
First deliver a working, beneficial open-source product, then validate company
demand before building an enterprise platform.

| Company need | Potential paid offering | Boundary to preserve |
| --- | --- | --- |
| Always-current shared evidence | Managed repository connections, refresh jobs and hosted MCP | Local indexing, refresh and MCP remain usable independently |
| Distributed teams | Managed shared workspaces, identity lifecycle and central administration | Portable evidence and explicit access boundaries remain in core |
| Company governance | Operated SSO/SCIM integration, policy distribution, audit retention and export | Correct isolation and safe local defaults are not paid upgrades |
| Controlled deployment | Managed customer-cloud/on-prem deployment, backups, recovery and upgrades | Local self-hosting remains possible without our service |
| Procurement and reliability | Support contracts, onboarding, SLAs and maintenance | Paying buys service commitments, not permission to use the MIT tool |

These are proposed offerings, not implemented features, security assurances or
licence changes. Code distributed in this repository remains MIT, including
enterprise-useful improvements. A paid service does not require a proprietary
developer feature tier. Any future separate software licensing proposal needs
an explicit decision; this plan does not authorise moving core features out.

Design shared operation around explicit repository grants, authorisation before
search, tenant isolation, revocation, audit and deletion. Organisation membership
or a dependency edge alone must not expose source. Geography does not change the
need to identify each repository, commit, worktree and selected release artifact.
The [scale review](docs/ENTERPRISE-SCALE-REVIEW.md) contains proposed engineering
contracts; it is not enterprise readiness evidence.

## Shortest delivery route

| Order | Deliverable | Acceptance |
| --- | --- | --- |
| 1 | Use existing retrieval and verified packets on real Heartwood work | Accepted changes with complete usage and repair records; the active Heartwood session owns implementation |
| 2 | Make the successful workflow independently installable | A developer can install a pinned build, select their repository, retrieve evidence in an actual MCP client, refresh after changes and remove it without ForgeSworn tooling or accounts |
| 3 | Qualify general usefulness and savings | Exercise an explicitly selected non-ForgeSworn repository; compare efficient ordinary tools with Context on fixed tasks/models and the same acceptance checks, counting discovery, failures and review |
| 4 | Complete the local graph workflow | Package the original graph exploration prototype with supported relationships and visible freshness/version/ambiguity metadata; expand language depth and indexing only against demonstrated task needs |
| 5 | Pilot a paid company deployment | An interested team validates a concrete administration/operation need, with separate isolation, lifecycle and commercial acceptance |

Steps 1–3 take priority over more ecosystem inventory, a new worker runtime or
an extensive competitive benchmark. Small repeat-use observations guide work;
they do not replace the controlled savings gate. Keep retrieval qualification
on a fixed model before testing cheaper-model routing separately. Frontier
development and its acceptance standards remain available throughout.

The [release goals](GOALS.md) govern general availability. The
[dogfood goals](docs/FORGESWORN-DOGFOOD-GOALS.md) govern internal adoption only.
Their Oathrun/KithMoot integration goal is optional for the general product.
Public publication, enterprise operation and measured savings each need their
own evidence; none follows merely from local tests passing.

## Current gaps

The local navigation and packet workflows exist. Dependency snapshot helpers
are checkout tools, and the ecosystem viewer is a private prototype rather than
a packaged general developer experience. The signed collection still has its
documented 128-record limit; the larger unsigned navigation index has a different
contract. Persistent scalable indexing, deeper cross-language relationships,
installed/release provenance and shared company operation remain incomplete.

The latest controlled qualification rejected the assisted answer and did not
show savings. See the [results](docs/experiments/d5-20260921-v3/RESULTS.md) and
[execution ledger](docs/DOGFOOD-EXECUTION.md). Prioritise a useful accepted task
and a reproducible independent install before claiming a Graphify replacement.
