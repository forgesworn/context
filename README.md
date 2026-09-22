# Z1P Core

Local code graphs and bounded evidence for coding agents.

**Use Context on your own machine and repositories:** follow the
[Codex and Claude Code setup guide](docs/GETTING-STARTED.md), including current
source-build availability, worktrees and first-request verification.

Z1P Core is the free, open-source foundation of [Z1P](https://z1p.app): signed,
encrypted project evidence, bounded retrieval and authorised relationship
graphs. It runs locally, requires no account and does not send source code or
records to a hosted service.

The product goal is an independently built, MIT-licensed Graphify alternative
for developers on their own projects, with less repeated discovery and smaller,
sufficient model context. Feature parity and whole-task savings remain unproven.
See [the product direction](PRODUCT_DIRECTION.md) for priorities and current gaps.
ForgeSworn projects are early users; Oathrun is an optional consumer, not a
required runtime.

The Node tools include deterministic, bounded TypeScript and JavaScript source
analysis that emits reviewable file, declaration, import and call evidence into
the same signed graph format. It runs locally without executing a repository or
contacting a model.

The bounded source tools cover TypeScript/JavaScript through the compiler API,
plus conservative lexical navigation for Python, Rust, Go, Java, Kotlin, Swift,
C/C++, C#, Ruby and PHP. Every derived record can carry signed method,
derivation and integer confidence metadata.

An explicit ecosystem manifest can also join package dependencies and Markdown
design rationale across multiple repositories. The resulting append-safe graph
uses the existing bounded query and path traversal; extraction remains local and
deterministic, so routine scans consume no model tokens.

- `packages/context`: browser-safe core, published as `@forgesworn/context`.
- `packages/context-tools`: Node persistence, CLI and MCP, published as
  `@forgesworn/context-tools`.

Both are MIT licensed. Provider routing, worker execution and coding-agent UI
belong to consumers. Local graph exploration belongs in the MIT developer tool;
the current ecosystem viewer is a prototype, not a packaged capability.
No model provider is required by core.

Local stdio MCP servers already provide repository navigation and separate signed
context/graph tools. Claude Code and Codex are first-class target clients; actual
Codex use is recorded, while Claude model/tool acceptance remains open. See the
[client and language plan](docs/CLIENTS-AND-LANGUAGES.md) for current capabilities,
deeper Rust/TS/Kotlin work and the provider-authentication boundary.

## Open-core boundary

This repository will remain the complete MIT local developer tool: formats,
cryptography, extraction, verification, indexing and refresh, bounded graph
operations, local exploration, CLI and MCP tools. Some of that scope remains
planned. The commercial offering can provide managed shared graphs, repository
connections, company administration, deployment and support around that engine.

The free core is intended to be useful on its own, not a time-limited trial.
See [OPEN_CORE.md](OPEN_CORE.md) for the durable product boundary and
compatibility policy.

See [GOALS.md](GOALS.md) for the core-first release gates, required evidence
and whole-task inference-cost evaluation.
See [the execution plan](docs/OPEN-SOURCE-EXECUTION.md) for ordered work, owners,
locations and model/effort assignments. Enterprise development comes after a
working open-source release with demonstrated benefits.
The current candidate results and blockers are recorded in
[RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md).

To try a disposable local scan → signed cache → MCP retrieval workflow from
this checkout, see [the dogfood walkthrough](docs/DOGFOOD.md). It reports scan
omissions and checks restart persistence; it does not measure inference savings.

For the remaining work to use this across ForgeSworn, see the
[dogfooding goals and model assignments](docs/FORGESWORN-DOGFOOD-GOALS.md).
The immediate path uses the local MCP bridge while measuring complete tasks.
For coding handoffs from this checkout, the [worker packet helper](docs/WORKER-PACKETS.md)
assembles bounded source excerpts and rejects stale packets before reuse.

For repository navigation beyond the signed collection's 128-record limit,
see [local repository navigation](docs/LOCAL-NAVIGATION.md): a separate unsigned,
in-memory MCP index with explicit refresh, larger response budgets and pagination.

The formats and APIs are project-agnostic. A collection can describe one
repository or an explicitly assembled ecosystem; graph operations never make
another collection visible or turn an extracted relationship into authority.

Use Node 24 LTS. The repository pins the currently validated release in `.nvmrc`:

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:packages
npm run benchmark:tokens:check
npm run benchmark:tokens:parity
```

The [measured token-reduction benchmarks](benchmarks/README.md) keep complete
raw-evidence retrieval separate from compact source navigation. Both count exact
bounded payloads and require all predeclared sources. The navigation gate tracks
Graphify's published 71.5x figure without treating different corpora or
undisclosed tokenisation methodology as directly comparable or claiming that a
source pointer contains enough code to answer.

The smoke test builds real tarballs and installs them outside the workspace to
check exports, browser isolation, CLI/MCP behaviour and licence notices.
See [extraction evidence](EXTRACTION.md) for provenance and publication status.
