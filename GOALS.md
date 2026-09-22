# Z1P Core release goals

Updated: 22 September 2026.

We want coding agents to spend less time and inference rediscovering a codebase,
without making their answers or changes less reliable. The open-source core
comes first. It must be useful, dependable and independently installable;
commercial services remain optional for the local developer workflow.

This is an acceptance plan, not a claim that the gates have passed.  Existing code and tests are a starting point.  Record fresh evidence against the release commit before closing a gate.

Current results and open blockers are recorded in [RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md).

Use [the open-source execution plan](docs/OPEN-SOURCE-EXECUTION.md) for ordered
tasks, responsible owners, repository/file locations and model/effort assignments.
OS0–OS6 organise delivery; the G0–G4 gates below still govern release acceptance.
Enterprise implementation is deferred until working open-source value is proven.

[PRODUCT_DIRECTION.md](PRODUCT_DIRECTION.md) defines the general developer
product and shortest delivery route. Graphify replacement is an independent MIT
implementation goal, not a current parity claim. Acceptance must include an
explicitly selected non-ForgeSworn repository and a workflow requiring no
Oathrun, ForgeSworn account or private worker helper.

For immediate internal use, follow the [ForgeSworn dogfooding goals](docs/FORGESWORN-DOGFOOD-GOALS.md).
They define the shorter D0–D7 adoption sequence, model and effort assignments,
and whole-task savings experiment. Local dogfooding can start before the public
release gates below are complete.

## Order of work

1. Establish the release baseline and remaining gaps.
2. Prove trust boundaries, extraction and retrieval behaviour.
3. Prove installation and real consumer workflows.
4. Measure complete tasks, then publish a verified release.
5. Only then build paid operational offerings justified by real company use.

The core/service boundary remains [OPEN_CORE.md](OPEN_CORE.md). Local extraction,
indexing and refresh, graph exploration, verification, bounded retrieval, CLI,
MCP and portable formats stay MIT licensed. Provider routing and worker execution
belong in consumers. A generally useful core fix belongs here even if a private
pilot discovers it. Oathrun/KithMoot application integration is optional and is
not a prerequisite for these release gates.

## G0: A reproducible baseline

- [ ] Record the candidate commit, Node version, platform, commands and complete results in a release evidence document.
- [ ] Run `npm run check`, `npm run benchmark:tokens:check` and `npm run benchmark:tokens:parity` from a clean checkout using `npm ci --ignore-scripts`.
- [ ] Map the existing tests to G1-G3 below.  Record missing cases explicitly rather than treating a green suite as complete coverage.
- [ ] Classify release blockers by correctness, security, compatibility and usability; give each an owner and a regression test where applicable.
- [ ] Verify CI for the candidate commit.  If infrastructure prevents it running, record the blocker and local evidence separately; do not call CI passed.

Exit: another developer can reproduce the baseline, and every known release blocker has a concrete acceptance condition.

## G1: Trust boundaries we can rely on

- [ ] Exercise valid and tampered signatures, wrong keys, malformed input, unsupported versions and invalid grants through public APIs.
- [ ] Prove collection and project isolation, scoped access and revocation on subsequent reads.  Document that revocation cannot erase plaintext already obtained by an authorised reader.
- [ ] Prove graph edges, repository text and retrieved instructions cannot grant access, execute code or become trusted instructions merely by being retrieved.
- [ ] Test repository path escapes, symlinks, ignored/secret files, oversized inputs and traversal limits.  Document what is excluded and what is not guaranteed to be detected.
- [ ] Check CLI, MCP, errors and logs for unintended disclosure of keys, credentials and plaintext.  No network transfer without an explicit configured operation.
- [ ] Document the threat model, key custody, supported security properties and a private vulnerability-reporting route.

Exit: negative tests protect each stated boundary, with no unresolved release-blocking security or data-isolation defect.

## G2: Evidence that is correct enough to use

- [ ] Prove indexed queries, refresh and resource budgets through the [enterprise scale plan](docs/ENTERPRISE-SCALE-REVIEW.md) before making whole-codebase claims or raising the 128-record limit.  ADR-001 remains provisional until its query and trust-boundary gaps are resolved.
- [ ] Verify deterministic output and stable source identity on repeat scans, with fixtures for edits, deletion, renames, duplicate names and ambiguous links.
- [ ] State snapshot freshness and how to replace or invalidate stale evidence.  A stale record must not silently masquerade as the current source.
- [ ] Keep TypeScript/JavaScript compiler-derived evidence separate from lexical and inferred evidence in output and documentation.
- [ ] Cover multi-repository manifests, explicit cross-repository links, missing repositories and ambiguous package names without widening access.
- [ ] Exercise retrieval budgets, truncation, empty results, corrections and path limits.  Return enough provenance to inspect the source and recognise incomplete answers.
- [ ] Retain full predeclared required-source recall in both existing benchmark gates.  Report raw answer evidence and navigation compression separately.

Exit: documented behaviour matches executable fixtures, including the cases where extraction cannot answer reliably.

## G3: A release someone else can actually use

- [ ] Test real package tarballs outside the workspace: imports, exports, browser isolation, CLI, MCP, notices and licences.
- [ ] Walk through the documented install, scan, persist, retrieve, export and import path on a clean machine or isolated environment.
- [ ] Exercise the supported local workflow on an explicitly selected non-ForgeSworn repository without workspace-specific paths, private worker helpers, Oathrun or a ForgeSworn account. State language/relationship coverage and gaps.
- [ ] Exercise an actual MCP client session, including initialisation, errors, cancellation and bounded output.  Name the tested client and version.
- [ ] Qualify actual Claude Code and Codex task/tool use separately, recording model/effort, source freshness, restart and disable. Connection health alone is insufficient; Claude Desktop is a separate client surface. Keep provider authentication outside Context.
- [ ] Verify compatibility fixtures for existing package names, APIs and signed wire formats.  Document any required migration before release.
- [ ] Test intended consumer integration in isolated branches or fixtures.  Do not silently repin or migrate live consumers.
- [ ] Reconcile README commands, package versions, changelog and extraction provenance.  Distinguish a prepared tarball from an available registry release.
- [ ] Publish through the authorised release process, then install the exact published versions from the registry outside the workspace and repeat the smoke workflow.

Exit: a newcomer can follow the published instructions successfully without local workspace links or unpublished dependencies.

## G4: Useful savings, with quality held constant

- [ ] Define representative tasks and acceptance tests before comparing baseline and Z1P-assisted runs.  Include repository orientation, bug investigation, change impact and an accepted code change.
- [ ] Hold repository revisions, task instructions, model settings and acceptance standards constant.  Separate context improvements from any later model-routing experiment.
- [ ] Count the whole task: retrieved source, input/output tokens, cached tokens where reported, retries, tool calls, failures and review time.  Include scan and refresh overhead.
- [ ] Record missing provider usage as unknown, never zero.  Keep observed billing, estimated token cost and fixed subscription costs distinct.
- [ ] Report accepted tasks, regressions and unsuccessful runs alongside cost.  Navigation compression alone is not an inference-bill saving.
- [ ] Publish a reproducible, non-sensitive evaluation and its limitations.  Keep private code, prompts, invoices and customer data out of this repository.

Exit: the tested workflow reduces cost per accepted outcome without lowering the agreed quality bar.  If it does not, record the result and fix the cause before making a savings claim.

## Definition of done

G0-G4 have linked evidence and reviewer sign-off for a named release.  No known release-blocking defect remains.  The free local route works without a Z1P account or service, and the published packages have passed an independent install check.

For each gate, record: status (`not assessed`, `in progress`, `blocked`, `passed`), owner, commit, environment, command or workflow, result, evidence link, reviewer and remaining limitations.  Unchecked items are unverified, not necessarily unimplemented.

Start with G0.  Do not broaden language support, build a graph editor or add hosted dependencies to avoid fixing the release path.
