# @forgesworn/context-tools

The local CLI and MCP adapter for Z1P Core. It provides Node file persistence
and deterministic repository extraction around `@forgesworn/context`. MIT,
ESM, Node 24+. Separate from the browser-safe core: filesystem and MCP
dependencies never enter its root import. No KithMoot or NanoClaw runtime
dependency.

The 0.3.2 release tarballs include the setup doctor and require the matching core
package. Follow the [installation guide](../../docs/GETTING-STARTED.md) to install
both archives together. npm publication is pending; once published, use:

```sh
npm install @forgesworn/context-tools@0.3.2
```

The source is maintained in the public Z1P Core workspace. Build with
`npm run build:context`, then `npm pack --workspace @forgesworn/context-tools`.
For future versions, publish the matching core package first. Local tarballs
can also be installed together.

```sh
encrypted-context mcp --identity /private/assistant.key \
  --expect-pubkey '<full hexadecimal public key>' \
  --state /private/context.json --room '<64-character audience id>' \
  --server https://storage.example
```

Use `call context_list` instead of `mcp` to read a JSON request from stdin.
Use `--personal` instead of `--room` only for a separate private assistant.
Supply an existing identity; no key is minted. Startup does not contact
storage. The legacy `room` name denotes a hex audience binding; it does not
join any room. Use a separate state file for every identity and binding.

The tools are `context_list`, `context_read`, `context_retrieve`,
`context_graph`, `context_graph_path`, `context_create`, `context_append`,
`context_append_batch`,
`context_preview`, `context_import`, `context_upload`, `context_access`,
`context_grants` and `context_set_grants`. They preserve the
existing tool names and request shapes. Preview before importing. Writes stay
local until explicitly uploaded and access events delivered. Tools send no
messages and records are never execution authority.

`context_retrieve` requires `collection` and `query`. It returns complete signed
records selected by lexical relevance and optional one-hop provenance links,
with an 8192-byte compact JSON payload budget by default. `maxBytes` includes
record text, source, author, signed event IDs, head and derived-link explanations;
transport framing is outside that payload. `maxRecords`, `includeRelated` and
`observedSince` are optional. Oversized records are omitted, never silently cut.
Every call rechecks the cached grant and audience. No source URL is fetched,
no other collection is traversed, and no plaintext index persists.

`context_graph` returns a compact subgraph selected by a lexical query and
expanded over explicit signed relations within configurable byte, node and
depth limits. `context_graph_path` finds a shortest bounded path between two
records. These read-only tools preserve provenance and edge direction, never
cross collection boundaries and do not claim that a signed relationship is
true.

## Navigate a repository

`encrypted-context navigate /absolute/repository` serves six stdio MCP tools
over an unsigned in-memory index of that root: `repository_status`,
`repository_refresh`, `repository_explore` (one call for a symbol: declaration,
references with enclosing declarations, importing files and tests),
`repository_coverage` (which explored files a draft answer leaves uncited,
and whether each cited token is quoted exactly),
`repository_search` (exact identifier or literal lines grouped by file, with
`pathPrefix`)
and `repository_packet` (verbatim ranges or complete TypeScript/JavaScript
blocks). Search, explore and packet responses are compact text by default and
JSON with `format: "json"`. See the
[navigation guide](https://github.com/forgesworn/context/blob/main/docs/LOCAL-NAVIGATION.md).

## Check a repository installation

```sh
encrypted-context doctor /absolute/path/to/repository --term knownIdentifier
```

Use the exact Git checkout/worktree root with an existing commit and an identifier
in an indexed source file. This read-only command starts the installed stdio
server, verifies all five repository tools, explores the identifier and checks a
source packet against the search result and Git provenance. The JSON report contains binding details,
exclusions and a source location/hash, without source text. It makes no model
calls and writes no repository files or client settings.

A passing probe establishes installation health. It does not check saved client
configuration or prove Claude/Codex acceptance: merge the binding for that project,
reconnect and verify the tools in the actual client. See the
[portable setup guide](https://github.com/forgesworn/context/blob/main/docs/GETTING-STARTED.md).

## Local ecosystem and source scanning

For a multi-repository project, create a manifest beneath the common ecosystem
directory. Repository paths are relative to that manifest and IDs become stable
portable `repo://` source namespaces:

```json
{
  "v": 1,
  "repositories": [
    { "id": "context", "path": "context" },
    { "id": "kithmoot", "path": "kithmoot" }
  ]
}
```

```sh
encrypted-context scan-ecosystem /projects/forgesworn/ecosystem.json \
  --max-repositories 32 --max-files 128 --max-records 128 \
  --observed-at 1800000000
```

The command emits a single append-safe graph containing repository nodes,
package manifests, Markdown documents and ATX-heading sections, in that priority
order. Package dependencies link across repositories only when the package name
is globally unambiguous. Relative Markdown links connect retained documents;
sections connect to their document and repository. Duplicate headings receive
deterministic occurrence suffixes. Fenced code is not treated as rationale.

The manifest is an explicit allow-list, not permission to discover arbitrary
sibling folders. Scans reject escaping paths and symlinks, ignore hidden and
generated trees, enforce file/byte/record limits and never execute repositories,
contact a model or sign/store records. When the 128-record collection limit is
reached, `recordsOmitted` reports the loss and no dangling relationship is
emitted. Submit the returned records explicitly with `context_append_batch`,
then use `context_graph` or `context_graph_path` for bounded traversal.

`encrypted-context scan <directory>` recursively reads bounded `package.json`
manifests without an identity, network access, source-file contents or package
execution. It emits deterministic evidence records and internal dependency
edges suitable for `context_append_batch`. Signed-record paths are root-relative
`repo://` sources; the canonical absolute root is returned only as local
operator diagnostics.

```sh
encrypted-context scan /projects/my-ecosystem \
  --max-packages 64 --max-depth 4 --observed-at 1800000000
```

The scan ignores symlinks, hidden directories, `.git`, `node_modules`, build,
dist and coverage output. This is package-manifest extraction, not full semantic
code analysis. Malformed or excess manifests are counted as skipped, ambiguous
duplicate package names are not linked, and inferred edges remain evidence to
review. Nothing is signed or stored until the returned `records` are explicitly
submitted with the collection's current head.

`encrypted-context scan-source <directory>` parses bounded local TypeScript and
JavaScript files without executing code, loading a `tsconfig`, contacting a
model or following symlinks. It emits deterministic file and declaration
records plus syntax-backed internal `imports`, `calls` and `relates-to` edges.

```sh
encrypted-context scan-source /projects/my-project \
  --max-files 64 --max-depth 8 --max-bytes 1048576 \
  --max-file-bytes 262144 --max-records 128 --observed-at 1800000000
```

The analyser supports `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`,
`.mjs` and `.cjs`. Version 0.3.3 binds identifier calls using an
isolated TypeScript Program/TypeChecker over already selected syntax trees.
Parameter, local, block and import shadowing use the actual declaration identity.
Selected named default function declarations and re-export aliases can resolve through local
modules; type-only aliases and re-export names without a local binding do not
establish value calls. `this.method()` uses the selected method declaration.
Conflicting value targets from named/star barrels produce no call edge;
explicit exports take precedence over stars. When a class has both static and
instance members with the same name, their source identities are separated:
`Class.static.member` and `Class.member`. Other member identities stay unchanged.
Nested functions, arrows and classes are not attributed as direct calls of an
enclosing callable; their unindexed symbols remain outside this graph. Sibling
arrow declarations are analysed independently.

Compiler binding has no filesystem fallback, default libraries, configuration
loading or additional dependency discovery. It only follows relative modules
already resolved against the bounded source selection. Version 0.3.2 and earlier
retain the earlier name-based call hints.
Default-export expression assignments (`export default value`), dynamic imports,
computed calls, object dispatch, package exports and type-level
project resolution are deliberately not inferred. These records are reviewable static
evidence, not proof of runtime behaviour or semantic intent.

`encrypted-context scan-broad-source <directory>` adds conservative navigation
for Python, Rust, Go, Java, Kotlin, Swift, C, C++, C#, Ruby and PHP. It uses a
bounded lexical pass rather than pretending regular expressions are compiler
ASTs. File observations are labelled `extracted`; declaration candidates are
`inferred` with confidence 60; files carrying heuristically resolved local
imports are `ambiguous` with confidence 30.

```sh
encrypted-context scan-broad-source /projects/my-project \
  --max-files 64 --max-depth 8 --max-bytes 1048576 \
  --max-file-bytes 262144 --max-records 128 --observed-at 1800000000
```

Only deliberately local forms are linked: relative Python imports, Rust
modules, quoted C/C++ includes, Ruby `require_relative`, PHP `__DIR__` includes
and relative Go imports. Package registries, build systems, namespaces and
runtime dispatch are not resolved. All scanners remain model-free at runtime.

Applications can import `scanEcosystem`, `scanSourceGraph`, `scanBroadSourceGraph` and
`scanPackageEcosystem` from the package root, `ContextFileStore` from `./store`, tool registration and dispatch
from `./mcp`, or `main` from `./cli`. The CLI's `configureVault`
callback accepts trusted application configuration such as a proof verifier.
The default accepts direct identity grants and refuses unrecognised agent
proofs. KithMoot retains `kithmoot-context` with its verified ownership adapter;
existing NanoClaw MCP configurations should keep using that command.

Cache writes retain mode 0600, an exclusive writer lock, file sync and atomic
rename. Lock contention is reported for retry. A crash may leave a stale
`.lock`; only remove it after checking no process owns it. Key files and cache
locations are the operator's responsibility. MCP does not authenticate other
users of the same host account, and grants do not replace the agent host's
caller access controls.

## Licence and provenance

MIT, Copyright (c) 2026 TheCryptoDonkey. See [LICENSE](./LICENSE) and
[third-party notices](./THIRD_PARTY_NOTICES.md) for dependency licences,
source attribution and the documented upstream WASM notice omission.
