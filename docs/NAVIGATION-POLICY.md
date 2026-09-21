# Repository selection policy

The local navigation bridge selects source under one explicit root. Its fixed
hidden-file, symlink, extension and generated-directory exclusions apply first.
Repository policy can narrow that selection; it cannot widen those boundaries.

## Git ignore files

The bridge reads `.gitignore` in the root and in each directory it actually
traverses. Rules are relative to their directory and case-sensitive. Nested
rules can override ancestor patterns, but cannot recover children of a directory
that was already excluded from traversal.

Matching follows the [Git ignore pattern rules](https://git-scm.com/docs/gitignore)
through the [ignore library](https://github.com/kaelzhang/node-ignore).
This is a source-selection policy, not a call to Git: patterns also exclude
tracked files, and global Git configuration, `.git/info/exclude` and ignore
files above the selected root are not consulted. No repository hooks run.

## Explicit project selection

An optional `.z1p-navigation.json` in the selected root narrows the source scope:

```json
{
  "version": 1,
  "include": ["src", "test", "README.md"],
  "exclude": ["src/generated", "test/private-fixtures"]
}
```

Paths are literal relative POSIX file-or-directory prefixes, not glob patterns.
For example `src` includes `src/a.ts`, but not `src-old/a.ts`. Directories leading
to an included path remain traversable. Missing `include` means all otherwise
eligible paths; an explicit empty list includes none. `exclude` always wins.
Include entries cannot override `.gitignore`, hidden-file or symlink exclusions.

Unknown fields, unsupported versions, malformed paths and unreadable policies
are errors. Policy reads reject symlinks and non-regular files, invalid UTF-8,
files over 64 KiB, and totals over 256 policy files or 1 MiB per discovery.
Configuration lists have at most 128 entries each, with paths of at most 512
UTF-8 bytes. These are bounded-input controls, not hard CPU or wall-time limits.

## Refresh and policy changes

Both refresh and freshness inspection use the same selector. Source revisions
include policy-file hashes, so changing an ignore file or configuration changes
the revision even when the selected source happens to be identical.

Ordinary source edits leave a labelled stale snapshot searchable. A changed or
unverifiable policy blocks search until a successful refresh: excluding a file
must not leave its old text retrievable from the previous index. Status remains
available to diagnose the condition. Failed refresh retains the prior generation
but does not grant permission to bypass the new policy.

The process still runs with the operator's OS permissions. These exclusions are
not a secret detector, filesystem sandbox or shared-room access grant. Policy
files and source can change while being read; hashes identify observed bytes,
not an atomic filesystem snapshot. Keep each client bound to the intended root.

## A bounded pilot on a large repository

Start by measuring the actual root. If it exceeds a build quota, use an explicit
include list for the modules needed by the task and record that limited scope.
Do not increase quotas or silently drop files to manufacture successful coverage.
Keep the configuration local until its repository owner adopts it; do not alter
consumer package versions as part of navigation setup.
