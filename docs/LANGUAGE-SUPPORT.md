# Source coverage: Kotlin, C/C++, Dart and TypeScript

Updated for 0.3.2 on 22 September 2026. The original audit used 0.3.1
(`bb83fa3`); the six suffix eligibility gaps found there are fixed in 0.3.2.
This is a selected capability audit, not a complete language manifest. Source
allowlists establish eligibility; ignores, selection policy and resource bounds
can still exclude eligible files.

| Suffix | Repository navigation | Broad source scan | Exact `build` packet | Syntax-aware `plan` packet |
| --- | --- | --- | --- | --- |
| `.kt` | Yes | Kotlin lexical extraction | Yes | Unsupported |
| `.kts` | Yes | Kotlin lexical extraction | Yes | Unsupported |
| `.cpp` | Yes | C++ lexical extraction | Yes | Unsupported |
| `.cc`, `.cxx` | Yes | C++ lexical extraction | Yes | Unsupported |
| `.h` | Yes | Classified as C; lexical extraction | Yes | Unsupported |
| `.hh`, `.hpp`, `.hxx` | Yes | C++ lexical extraction | Yes | Unsupported |
| `.dart` | Excluded | Unsupported | Rejected | Unsupported |
| `.ts` | Yes | Not handled by this scanner; separate TS/JS scanner exists | Yes | TypeScript syntax blocks |

The source contracts are
[navigation's suffix allowlist](../packages/context-tools/src/repository-navigation.ts),
[the broad scanner's language map and lexical rules](../packages/context-tools/src/broad-source-scan.ts),
[the TS/JS scanner](../packages/context-tools/src/source-scan.ts), and
[packet source/plan allowlists and guards](../packages/context-tools/src/source-packet.mjs).


Navigation provides exact-token line lookup. Broad scanning uses regular
expressions and labels inferred relationships; it is not a language parser.
The dedicated TS/JS scanner and packet planner use TypeScript syntax trees. The
0.3.3 scanner also uses isolated compiler binding for scopes and
selected local import/re-export aliases; it does not load tsconfig, external
libraries or establish project-wide type-checked semantic resolution. Nested
callable bodies are not counted as direct calls of their parents. The packet
planner still establishes syntax completeness only. Exact build packets copy
selected lines with provenance; they make no syntax-completeness guarantee.
Unsupported plan suffixes are explicitly rejected by the planner guard before
TypeScript parsing; rejection is not a parser failure on those languages.

## Test evidence and remaining gaps

- [MCP packet tests](../packages/context-tools/src/repository-packet-mcp.test.ts)
  exercise each added suffix, plus uppercase `.HPP`, through exact search, packet
  lines and hashes, checkout/commit provenance, stale rejection, generation
  replacement and retrieval after an edit. Git-ignore exclusions still suppress
  search and reject packets. Syntax planning still rejects these suffixes.
- [Broad scanner tests](../packages/context-tools/src/broad-source-scan.test.ts)
  cover declarations and lexical provenance for all six suffixes and uppercase
  `.HPP`. Dart remains explicitly unsupported in scanning and MCP retrieval.
- [Installed package smoke](../test/context-package-smoke.mjs) retrieves all six
  suffixes through the installed stdio MCP server outside the workspace.
- Existing packet tests retain TS/JS syntax support and path/policy boundaries.
  These tests establish source retrieval and lexical coverage, not compiler-level
  understanding or complete evidence for an arbitrary development task.

Dart extraction and deeper Kotlin/C++ parsing remain separate work. A running
MCP server needs a reconnect after upgrading its implementation; refreshing the
source index alone does not load new server code. Measure benefits on actual
accepted tasks; no token or subscription saving follows from suffix coverage.

## Qualification provenance

Claude Code 2.1.278 used the independently installed 0.3.1 repository MCP package
for this audit, with `claude-sonnet-5` and requested medium effort. All four tools
were used. Host source review corrected a false `.kts`-absence claim, an incorrect
suffix count, planner-rejection wording and the incomplete proposed C++ suffix
set before accepting this document. The original draft is retained privately.
See [the execution ledger](DOGFOOD-EXECUTION.md) for usage and remaining client
acceptance limits. This is not a measured savings comparison.

## Explore resolution

`repository_explore` matches exact tokens in every navigated suffix. It resolves
declarations, enclosing scopes, test titles and import lines only for the
TypeScript and JavaScript suffixes handled by the `plan` packet column above,
using the parser without a type checker. Hits in other suffixes are listed
lexically with their file and line and no scope label; the response counts
those files so the reader can tell which references were not resolved.
