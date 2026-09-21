# Daily use in Codex

Use the local navigation tools for a task that needs repository discovery.
For a tiny edit in a known file, read that file directly.

1. Call `repository_status`. If freshness is `unavailable`, `stale` or
   `unknown`, call `repository_refresh`. `current` only covers the bounded,
   allowlisted manifest, not every file in the repository.
2. Search for one exact ASCII identifier, starting small:

   ```json
   { "term": "RepositoryNavigation", "maxResults": 8, "maxBytes": 8192 }
   ```

3. Read the relevant source and tests using the returned paths, lines and
   hashes. A pointer or summary is not sufficient evidence for a code change.
   If more matches are needed, pass the returned `nextCursor` into the next
   search with the same term. Each cursor is single-use and expires after five
   minutes. Successful refresh invalidates previous cursors.
4. After edits, refresh explicitly. Failed refresh retains the old generation;
   do not treat it as updated. On missing evidence, exclusions or quota failure,
   use bounded `rg`/file reads and record the fallback.
   Changed or unverifiable repository policy blocks old-snapshot search until a
   successful refresh; inspect `repository_status.policy` to diagnose it.
5. Record the task, source commit and working-tree changes, client/model/effort,
   retrieved evidence, checks, repairs and accepted outcome. Include host and
   worker usage, elapsed time and review time; unavailable values are `null`.

The `local-source-unsigned` index is ephemeral. Each process needs its own
refresh. Signed `context_*` collections are separate and retain their 128-record
limit. This workflow does not automatically select a worker model.

Build from the checkout with `npm run build`. An MCP stdio client launches:

```sh
node packages/context-tools/bin/encrypted-context.mjs navigate /absolute/repository
```

Restart the client/server after changing the implementation. Source refresh alone
does not reload running JavaScript. Actual Codex retrieval has been exercised;
Claude tool use and whole-task monetary savings remain separate open gates.
See the [adoption goals](FORGESWORN-DOGFOOD-GOALS.md) for acceptance and routing.
