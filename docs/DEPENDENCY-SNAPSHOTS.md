# Dependency snapshots for ecosystem work

Use the original checkout helper to answer which package artifact a committed
npm lock records, or which explicitly selected local manifest a dependency path
references. It produces a dependency graph and bounded query results. Python
3.11+ and Git are required; it has no third-party Python dependencies. It is not
part of the published npm runtime or the MCP tool catalogue.

## Select, capture, verify, query

Create a private selection file. Repository paths are relative to the explicit
workspace root; manifests are relative to each selected Git worktree root.
Selecting one repository never selects its siblings implicitly. For example:

```json
{
  "version": 1,
  "repositories": [
    {"id": "heartwood-ledger", "path": "heartwood-ledger", "manifests": ["Cargo.toml"]},
    {"id": "heartwood-esp32", "path": "heartwood-esp32", "manifests": ["common/Cargo.toml"]},
    {"id": "signet-login", "path": "signet-login", "manifests": ["package.json"]},
    {"id": "signet", "path": "signet", "manifests": ["package.json"]},
    {"id": "signet-protocol", "path": "signet-protocol", "manifests": ["package.json"]}
  ]
}
```

From the Context checkout, replace these example absolute paths with your own:

```sh
python3 -B scripts/ecosystem_snapshot.py build \
  --root /absolute/workspace --spec /private/selection.json \
  --out /private/dependencies.json

python3 -B scripts/ecosystem_snapshot.py verify \
  --root /absolute/workspace --spec /private/selection.json \
  --snapshot /private/dependencies.json

python3 -B scripts/ecosystem_snapshot.py query \
  --snapshot /private/dependencies.json --repo signet-login \
  --package signet-protocol --max-results 3 --max-bytes 8192
```

`build` reads selected manifests and ancestor npm locks from each captured HEAD.
It records separate hashes of those working files, including the absence of
optional locks. It does not run project scripts, install dependencies, fetch
registry artifacts or allow Git lazy fetching. Output is private (0600), and
existing outputs are never overwritten. Use a new filename after rebuilding.

`verify` recaptures the explicit selection. Exit 0 means the selected inputs,
worktree/Git-administration identities, tooling hashes and derived relationships
still match; exit 1 means stale, and exit 2 means invalid or unavailable. Branch
and tracked-dirty flags are capture-time observations, not current-state claims.
An unrelated uncommitted source change does not invalidate this manifest-only
report. A new commit, selected file/lock change, moved worktree, selection change
or resolver change does. Capture checks are not an atomic filesystem snapshot.

`query` reads only the report; it never traverses paths contained in it. It does
not check freshness itself, so verify before reuse. `complete: false` means its
result or byte budget omitted matches. Checksums detect accidental changes;
these are unsigned local observations, not proof of an author's authority.

## What each edge means

| Resolution | Evidence | What remains unknown |
| --- | --- | --- |
| `locked-artifact` | Selected npm v2/v3 lock occurrence, exact declaration match, version, source digest and integrity | Installed bytes, semver validity, release/source provenance |
| `local-source-reference` | Declared file/path or lock link matches an explicitly selected manifest and package name | Whether the consumer built or installed that captured commit |
| `unresolved` | A declaration and an explicit reason; consulted lock evidence retained | Unsupported, ambiguous, missing or inconsistent evidence |

Registry artifacts are never mapped to a repository's HEAD by name or version.
`producerCandidates` are non-authoritative name matches within the same ecosystem;
they do not determine the dependency edge. A renamed npm dependency must have the
real package name in its selected lock entry. Duplicate producers remain separate.
`requested` is display-safe; `requestedSha256` hashes the original declaration
as canonical JSON. Source URL digests retain identity while displayed URL authorities omit userinfo,
query strings and fragments. Keep reports private; they still describe your
selected repository topology and package dependencies.

The closest ancestor npm lock takes precedence, with shrinkwrap preferred over
package-lock in the same directory. Missing, stale or unsupported preferred
locks do not fall back to a more convenient lock. Dependency occurrences are
looked up from the consumer directory towards the lock root, without using
sibling installations. A link recorded against a nonlocal, non-workspace request
stays unresolved; auto-workspace inference is outside this first version. Explicit local paths are normalised relative to the
consumer manifest (lock links relative to the lock root); their targets must be
selected. Local tarballs and link chains are unsupported.

Cargo normal, development, build and target-specific declarations are retained,
including renamed packages, path+version and features. Explicit paths can point
between selected repositories. Cargo registry/git lock resolution, mixed registry+path sources and workspace
inheritance are deliberately unresolved. Unknown Cargo dependency keys fail
validation; common feature, boolean and source-selector shapes are checked. Gradle, Dart, Python and protocol
compatibility require separate evidence. This is not a complete dependency
closure or source-code graph.

Selections are bounded to 32 nonoverlapping repository roots and 64 manifests.
The resolver accepts at most 128 documents and 4,096 declaration rows. Selected
ancestor locks count towards the document limit. Each file is limited to 4 MiB;
committed inputs and each working-input read pass are limited to 16 MiB. Reports
are limited to 16 MiB; resolver rows have a separate 4 MiB aggregate limit.
Hidden/generated selections, symlinks and escaping paths
are rejected. Unsupported/bounded-out capture fails rather than silently
truncating the evidence.

## Worktrees and colleagues

Choose the actual worktree path in the selection, using a distinct selection ID
when selecting multiple worktrees of one repository. A relative source dependency
resolves to the literal selected path, never to another checkout with the same
package name. The optional `repository` field must be a non-secret operator-supplied label, not
verified remote provenance. Local workspace/worktree/Git-administration identities
are hashed and intentionally differ on another developer's machine. Share
commit-addressed evidence as a report if authorised; local `verify` is not a
portable team attestation or an automatic shared graph.

## Validation and next use

Run `npm run test:ecosystem` for dependency and filesystem boundary tests. They
also run under `npm run check` with the repository's pinned Node version. The
helper starts in a new process each invocation; it does not change the shared
MCP server implementation or the active Heartwood session.

Use one bounded result to select the correct source for a real Heartwood task,
then assemble and verify a [worker packet](WORKER-PACKETS.md). Log preparation,
failed attempts, repairs and review under the [whole-task cost protocol](TASK-COST-REPORT.md).
A smaller query is not yet a measured inference-cost saving. The existing
[offline ecosystem viewer](HEARTWOOD-ECOSYSTEM-PILOT.md) is a separate pilot;
loading these maintained dependency edges into that viewer is a later slice.

Manifest semantics were checked against the primary [npm lockfile reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json/)
and [Cargo dependency reference](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html).
The helper implements the narrower observation contract above, not a package manager.
