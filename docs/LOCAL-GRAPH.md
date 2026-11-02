# Local source graph and offline viewer

The installed tools provide an unsigned derived graph for one explicitly selected
checkout. It is separate from signed v1 collections and their 128-record limit.
No project code, build script, Gradle configuration, macro or inference runs.

```sh
z1p graph /canonical/git/checkout --out /absolute/private/project-graph.html
z1p graph /canonical/git/checkout --out /absolute/private/project-graph.json --json
z1p graph /canonical/git/checkout --out /absolute/private/api-graph.html \
  --project tsconfig.json --path-prefix src/
```

`z1p` can be the owner's wrapper; the packaged executable is `encrypted-context`.
Output is a new mode-0600 file in an existing canonical directory; overwriting
and linked ancestors are refused. The HTML contains selected source text. It is
a private snapshot, not an encrypted cache or a live view. Open it directly in a
browser. Search names/paths, filter languages, select a node, follow relationships
and inspect the embedded source and hashes. There is no listener, CDN, upload,
external navigation or browser fetch; CSP restricts the document to its own code.

## Agent queries

Fresh clients discover `repository_graph` alongside existing repository tools.
The global session requires `expectedRoot` on every request. A shell connection
pins it. `query` is a strictly validated object; unknown fields are rejected.

```json
{"name":"repository_graph","arguments":{"expectedRoot":"/canonical/git/checkout","query":{"action":"symbol","symbol":"send","maxBytes":16384}}}
```

Actions are `summary`, `symbol`, `neighbours`, `impact`, `path` and `dependencies`. Neighbour,
reverse impact and path queries take an unambiguous node ID as `from`; path also
requires `to`. IDs come from this graph. The default depth is 3 (maximum 8),
default node output 100 (maximum 500). `expectedGeneration` rejects an old index.
`project` selects a root-relative TypeScript config; `pathPrefix` narrows source.
MCP returns locations and relationships, not an entire source export. Retrieve a
current `repository_packet` for the implementation and tests before reasoning
from those pointers.

## Evidence and limits

- TypeScript/JavaScript imports and references use an isolated compiler host
  over selected source only. Explicit config supports root-confined relative
  `extends`, `baseUrl` and `paths`; no libraries, plugins or packages are loaded
  from outside the selection. Project references and package-based `extends`
  currently reject. Binding is static evidence, not proof of runtime dispatch.
- Rust/Kotlin declarations and complete packet spans use installed Tree-sitter
  grammars. Extension functions, impl/trait members and overloads keep their own
  spans. References are labelled `name-candidate`; same names do not establish
  a call or cross-language contract. Parse failures remain visible. Macro
  expansion, Cargo cfg/features and Kotlin compiler overload resolution are
  outside this syntax capability.
- The existing navigation policy selects files. Graph preparation selects at
  most 256 supported files and 8 MiB, retaining at most 20,000 nodes and 40,000
  edges with a bounded analysis work allowance. Omissions, parse failures,
  unresolved imports and exhausted analysis are reported. This is not whole
  repository coverage or a sublinear refresh claim.
- Browser lists show at most 200 matches, 24 neighbours, 100 relationship rows
  and 400 source lines at once; counts and limits are shown. The export itself
  is capped at 16 MiB. Narrow the selection when that budget is insufficient.
- Source and policy are checked before and after graph construction. Refresh
  after relevant edits. An exported HTML/JSON snapshot cannot check later edits.

Dependency queries and the viewer also inspect the selected root's allowed
`package.json`, `package-lock.json`, `Cargo.toml` and `Cargo.lock`. They retain
file hashes and separate declared ranges, local pointers and locked candidates.
Multiple Cargo versions remain ambiguous. Source paths are never followed,
and installed versions, release-to-source identity, active Cargo cfg/features
and evaluated Kotlin/Gradle configuration remain unverified. Missing, excluded,
linked, oversized or malformed metadata is reported. No registry fetch occurs.

The standalone ecosystem viewer and arbitrary cross-repository graph federation
remain distinct from this single-checkout viewer. A dependency edge grants no
authority to open another checkout.
