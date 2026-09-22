# Provider-independent clients and language understanding

Updated: 22 September 2026. Current source inspected; client acceptance remains
separate from implementation. This supplements the
[open-source execution goals](OPEN-SOURCE-EXECUTION.md).

## Responsibility boundary

Context is the MIT code-understanding and evidence service. It owns repository
selection, extraction, graphs, freshness, bounded retrieval, provenance and
evidence access checks. Its supported local workflow needs no AI provider login,
API key, subscription or model invocation.

Claude Code, Codex or another client consumes that evidence over MCP or CLI.
The client chooses its model/effort and handles provider authentication, billing,
conversation, tool execution and approval UX. Oathrun owns those execution and
routing responsibilities when it is the chosen agent host. Using Context from
Claude Code directly must not require Oathrun.

| Concern | Owner |
| --- | --- |
| Claude/OpenAI/Ollama credentials, subscription and model selection | Client or optional agent runtime such as Oathrun |
| Root selection, source exclusions, snapshot identity, bounded output | Context |
| Signed evidence identity, verification and collection grants | Context's existing evidence protocol; not a provider login |
| Future remote MCP authentication and repository/tenant access checks | Context service boundary, independently of inference-provider accounts; enterprise service work remains deferred |
| Whether selected evidence is sent to a cloud model | Consuming client/operator; local Context extraction does not itself upload it |
| Optional model-generated annotations | Explicit external producer; Context may validate/import labelled evidence without inheriting provider credentials or treating generated claims as extracted facts |

Client setup examples and conformance tests are integrations, not provider
coupling. Do not add provider SDKs, OAuth login, account/quota management or
automatic model routing to the core to support Claude. Our development model
assignments describe how we build/test Context; they are not product dependencies.

## MCP already implemented

| Interface | Existing implementation | Scope and remaining gap |
| --- | --- | --- |
| Local repository navigation | `repository-navigation-mcp.ts`: `repository_status`, `repository_refresh`, `repository_search`, `repository_packet` | Explicit root, unsigned exact-token line navigation and bounded source packets. Packets accept inline exact ranges or TS/JS anchors and reject stale generations. Semantic repository graph queries remain separate work |
| Signed context | `context-mcp.ts`: `context_retrieve`, `context_graph`, `context_graph_path` and collection operations | Separate signed/granted cache contract; signed v1 still has a 128-record limit. Not the larger live repository index |
| Source packet and dependency snapshots | Shared packaged packet implementation plus checkout helpers under `scripts` | Packet assembly is exposed through repository MCP and the existing CLI. Dependency snapshots remain checkout-only |

Both existing servers use MCP stdio. Their source and protocol tests live in
`packages/context-tools/src`; CLI launch modes are in `context-cli.ts`.
Do not build a second provider-specific server. Extend shared, documented
contracts, keeping unsigned navigation and signed evidence clearly distinguished.

Actual Codex calls have succeeded, including this review. The recorded Claude
Code health check connected, but a previous Haiku attempt returned HTTP 429 for
a weekly limit before tool use. This is historical evidence, not a current quota
check. Claude task acceptance remains unverified. See
[the pilot record](DOGFOOD.md) and [navigation contract](LOCAL-NAVIGATION.md).

## OS1 client and retrieval assignments

| Task | Owner / where | Model and effort | Acceptance |
| --- | --- | --- | --- |
| **OS1a — Claude Code alongside Codex. Next** | Context integration owner, Node tools, public setup docs and isolated client fixtures | Flash/thinking off for bounded docs/fixtures; Terra/medium integration; **Claude Sonnet 5/medium** as the first real Claude executor; **Claude Opus 5/high** for one consequential source-backed task after basic acceptance | A pinned package launches in both clients against an explicit root; real tool discovery, status/refresh/search, bounded evidence, edit/stale/refresh, restart and disable work. Record actual client/model/effort and accepted task, not just Connected |
| **OS1b — Sufficient evidence through MCP. Implemented locally; live client qualification remains** | Context implementation owner, shared packet module plus `packages/context-tools` adapters/tests | Terra/medium implementation; Sol/high boundary review; Flash/off for scoped fixtures | `repository_packet` returns bounded exact ranges or complete selected TS/JS blocks with provenance and stale rejection. Installed-tarball stdio retrieval, edit/refresh and restart pass. Reconnect existing clients to discover the new tool; actual Claude use remains open. No shell helper required by the consuming model; no arbitrary path escape |
| **OS1c — Graph questions through MCP** | Context graph owner, same tools adapter; follows OS3/OS4 evidence integration | Terra/medium; Sol/high review of scope/provenance | Bounded repository symbol/neighbour/path queries return precise source and derivation metadata in both clients; do not mistake the existing signed-cache graph tools for this capability |
| **OS1d — Other client surfaces** | Context integration owner, portable examples and clean-client acceptance | Flash/off for docs, Terra/medium review; user's chosen model for the actual client | Claude Desktop is separately qualified after Claude Code; other MCP clients follow demand. Never infer their acceptance from Claude Code or Codex |

The Anthropic API model IDs for those qualification assignments are
`claude-sonnet-5` and `claude-opus-5`. Claude Fable 5.1
(`claude-fable-5-1`)/high remains an optional difficult-task lane, not a prerequisite.
Haiku 4.5 (`claude-haiku-4-5-20251001`) is an optional simple-task lane with no
`effort` control; do not label it low effort. Pin the actual provider model and
record the effective effort; aliases and account availability vary. These are
our proposed task assignments, not completed qualification or model switches.
Official references checked 22 September:
[models](https://platform.claude.com/docs/en/models/overview),
[Claude Code model/effort configuration](https://code.claude.com/docs/en/model-config)
and [MCP setup](https://code.claude.com/docs/en/mcp).

No provider call is part of this documentation update. Recheck an eligible
account before future qualification, and stop on a refusal/spending hold. Keep
each savings pair on one fixed provider/model/effort; run separate Claude and
Codex cohorts rather than comparing Claude-assisted with a Codex baseline.
The existing prospective Sol/high assignment remains the Codex cohort; Claude
client support does not require repeating every benchmark on every model.

## Current language depth and priorities

These findings come from this repository's source and tests, not a new scan of
every ForgeSworn project. The captured Heartwood pilot confirms Rust, TS/JS and
Kotlin inputs. Python also implements this project's new snapshot helpers.
Wider-stack priorities below need an explicit selected-repository inventory;
do not silently scan the parent workspace.

| Language / surface | Current support | Next useful depth |
| --- | --- | --- |
| TypeScript / JavaScript / TSX / JSX | Compiler API syntax trees; selected relative imports and syntactic call hints. No tsconfig loading or type checker; not complete semantic resolution | Aliases, re-exports, symbol identity and references with honest unresolved cases; keep dynamic calls and type-directed evidence distinct |
| Rust / Cargo | Lexical declarations and simple module-file guesses; manifest path dependencies in separate snapshots; Cargo lock resolution unsupported | Parser-backed modules, use/re-exports, types/traits/impls and call/reference candidates; selected workspace/features/cfg context; preserve unresolved macro/trait dispatch |
| Kotlin / Java | Lexical declaration inference; no meaningful compiler-resolved import/type/call graph | Parsed declarations/imports; package/module and Gradle dependency evidence, then explicitly qualified references. Do not execute Gradle scripts during indexing |
| Python | Lexical declarations and conservative relative-import guesses | Parsed scopes/imports and useful references; explicit environment/package assumptions; no import execution |
| C / C++ | Lexical declarations and quoted-include guesses; broad scanner accepts more suffixes than navigation | Align `.cc/.cxx/.hpp` selection; parse declarations/includes; distinguish build-config/preprocessor-dependent and FFI edges |
| Dart / Flutter | Absent from both the navigation allowlist and broad extractor | Add declared support and fixtures, then parsed imports/exports/parts and declarations with pub package/version evidence; no claim that adding `.dart` is semantic support |
| Swift | Lexical declarations; no module/type/call resolution | Parsed declarations/imports with selected package/build metadata and explicit unresolved cases |
| Vue / Svelte, SQL and build/config contracts | Dedicated parsing absent from these source extractors | Confirm use in selected projects; add component/script boundaries or schema/config relationships only against actual tasks |
| Go, C#, Ruby, PHP | Conservative lexical extraction; some local-import guesses | Retain explicit support level; deepen when an accepted task needs it |

Navigation and extraction must have a tested capability manifest so their suffix
support cannot silently diverge. Current navigation, for example, omits `.kts`
and several C++ suffixes which the broad scanner accepts. Source packets currently
have syntax-aware planning for TS/JS only; add complete-span planning for each
new parser rather than silently truncating another language's function.

## OS4 language and contract assignments

| Task / order | Owner / where | Implementation and review | Done when |
| --- | --- | --- | --- |
| **OS4a — Support matrix and source coverage. Next with OS1** | Context lead; scanner/navigation policy and tests in `packages/context-tools`, packet helper and public support docs | Deterministic selected inventory; Flash/off fixtures/docs; Terra/medium integration/review | Exact suffix, language, parser, relation and packet-span support published; exclusions and missing capabilities visible; Dart and suffix gaps have explicit tested outcomes |
| **OS4b — Rust + TS/JS depth. First parser work** | Context language implementer; scanner adapters, public fixtures, packet assembly | Sol/high defines evidence contract; Terra/medium integrates parser/resolver; Flash/off for bounded fixtures; Sol/high reviews semantic/provenance claims | A real mixed Rust/TS task retrieves necessary declarations, imports and references with exact spans, ambiguity and version identity; fewer repeated reads with unchanged accepted result |
| **OS4c — Kotlin then wider stack** | Context language implementer; same adapter interface and public fixtures | Terra/medium implementation; Flash/off fixtures; Sol/high for new build/FFI trust boundaries | Kotlin contract task accepted; then promote Dart, Swift, C/C++ or Python according to the explicitly selected task inventory, with a real fixture/task per supported capability |
| **OS4d — Cross-language contracts** | Context graph owner; ecosystem/version resolver plus contract fixtures | Sol/high design/review, Terra/medium integration | Rust↔TS serial/Nostr contracts and Kotlin-facing interfaces linked through explicit schemas/constants/FFI evidence. Same-named symbols alone never prove a wire contract, runtime call or compatible version |

Evaluate reusable parsers/compiler APIs independently; Tree-sitter or a language
service is a candidate, not a selected dependency or a guarantee of full semantics.
Check distribution licences/notices and packaging before adoption. Grammar
parsing, name resolution, type resolution and runtime behaviour are different
claims. Do not execute project builds, macros, package scripts or network fetches
as a hidden consequence of indexing. Deeper analysis requiring them needs a
separate explicit operation and bounded contract.

OS4a and the smallest useful OS4b slice are near-term product work, not enterprise
features. They can proceed with OS1 where they enable the current dogfood task;
do not wait for visualisation or try every language before shipping useful work.

## Graphify comparison boundary

Graphify's current documentation describes local deterministic code extraction,
several assistant integrations and an MCP server. It also offers optional model
backends for semantic processing of documents/media. Shared MCP authentication
is a separate concern from backend model credentials. This is documented product
behaviour, not acceptance tested here. See its
[README](https://github.com/Graphify-Labs/graphify) (checked 22 September 2026).

Context will preserve a stricter provider-independent extraction/retrieval
boundary. Optional model enrichment can be supplied by a client such as Oathrun,
Claude Code or another adapter. No Graphify code is copied or integrated.
