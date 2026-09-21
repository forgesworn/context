# Z1P Core

Portable, signed evidence for people and agents.

Z1P Core is the free, open-source foundation of [Z1P](https://z1p.app): signed,
encrypted project evidence, bounded retrieval and authorised relationship
graphs. It runs locally, requires no account and does not send source code or
records to a hosted service.

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

Both are MIT licensed. Provider routing, worker execution and application UI
belong to consumers, not this library. No model provider is required by core.

## Open-core boundary

This repository will remain the inspectable local and protocol foundation:
formats, cryptography, deterministic extraction, verification, bounded graph
operations, CLI and MCP tools. The commercial Z1P Platform is a separate
product for continuously maintained private graphs, repository connections,
team access, review workflows, hosted operation and enterprise controls.

The free core is intended to be useful on its own, not a time-limited trial.
See [OPEN_CORE.md](OPEN_CORE.md) for the durable product boundary and
compatibility policy.

See [GOALS.md](GOALS.md) for the core-first release gates, required evidence
and whole-task inference-cost evaluation.
The current candidate results and blockers are recorded in
[RELEASE_EVIDENCE.md](RELEASE_EVIDENCE.md).

To try a disposable local scan → signed cache → MCP retrieval workflow from
this checkout, see [the dogfood walkthrough](docs/DOGFOOD.md). It reports scan
omissions and checks restart persistence; it does not measure inference savings.

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
