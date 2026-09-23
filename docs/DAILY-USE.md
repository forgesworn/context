# Daily use in Codex

Use the local navigation tools for a task that needs repository discovery.
For a tiny edit in a known file, read that file directly.

The first adoption priority is [measured daily ForgeSworn use](FORGESWORN-DOGFOOD-GOALS.md#immediate-savings-goals-fs0fs5)
in both Codex and Claude Code. Start a private
[daily task receipt](examples/daily-use-receipt.json) at the next task boundary;
retain client usage evidence and the final acceptance result. This manual draft
does not collect usage automatically. Claude's actual task acceptance is a
separate open gate; see [client assignments](CLIENTS-AND-LANGUAGES.md).

For explicit client exports, use the [offline daily usage importer](DAILY-USAGE.md)
to produce a private request receipt and task summary. It preserves missing
coverage and reports observed usage rather than claiming savings.

1. Call `repository_status` and confirm its root. If freshness is `stale` or
   `unknown`, call `repository_refresh`; an `unavailable` index is built by the
   first search, explore or coverage call. `current` only covers the bounded,
   allowlisted manifest, not every file in the repository.
2. Search for one exact ASCII identifier, starting small:

   ```json
   { "term": "RepositoryNavigation", "maxResults": 8, "maxBytes": 8192 }
   ```

3. Read the relevant source and tests using the returned paths, lines and
   hashes. A pointer or summary is not sufficient evidence for a code change.
   On a server exposing `repository_packet`, request a bounded packet with the
   current `expectedGeneration`: `plan` selects complete TS/JS syntax blocks;
   `build` takes reviewed exact ranges. See the [inline MCP example](WORKER-PACKETS.md#request-a-packet-through-mcp).
   No shell helper is required by the consuming model.
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

For a worker coding task, assemble and verify a [bounded source packet](WORKER-PACKETS.md)
after locating and reading the relevant source. Review the packet before dispatch
and keep accepted changes, checks and repair receipts with the task evidence.
Record host preparation, worker attempts and review costs using the
[whole-task report format](TASK-COST-REPORT.md). Partial records remain useful,
but do not qualify as a measured savings result.

For the current internal worker setup, select the M4 tunnel explicitly:

```sh
python3 "$HOME/.codex/skills/ollama-workers/scripts/ollama_task.py" \
  --endpoint http://127.0.0.1:11435 status
```

The endpoint option goes before the subcommand. Use the same endpoint for
`inventory` and `run`; check the prompt with `check` before dispatch. Local
`qwen3.8:latest` and cloud `deepseek-v4.1-flash:cloud` both completed reviewed
tasks with `--think false` on 21 September 2026. That is historical acceptance.
The updated project policy removes Qwen from the default workflow: use DeepSeek
Flash with thinking off for routine synthesis, implementation and tests. Use
deterministic extraction where possible. GLM/low is a candidate alternative to
qualify on useful bounded work; eligible Pro handles harder implementation.
Keep difficult design and consequential review on a qualified frontier lane.
Follow the [model assignments](FORGESWORN-DOGFOOD-GOALS.md#model-and-effort-policy).
The helper already defaults to this tunnel, but explicit selection prevents
environment overrides from choosing another daemon.

At that check, the M4 reported plan `max`; this Mac's separate port 11434
reported `free`. Plan labels do not establish remaining quota or billing cost.
The earlier port-11434 Flash refusal does not describe the verified M4 route.
Stop on a new refusal and inspect the retained `httpError.body` before recovery.
Keep account limits unchanged and reconcile unknown requests before replay;
the separate Oathrun Pro reservations remain unresolved. See the
[recovery evidence](DOGFOOD-EXECUTION.md#worker-availability-recovery) for scope.

Build from the checkout with `npm run build`. An MCP stdio client launches:

```sh
node packages/context-tools/bin/encrypted-context.mjs navigate /absolute/repository
```

Restart the client/server after changing the implementation. Source refresh alone
does not reload running JavaScript. Actual Codex retrieval has been exercised;
Claude tool use and whole-task monetary savings remain separate open gates.
See the [adoption goals](FORGESWORN-DOGFOOD-GOALS.md) for acceptance and routing.

For committed dependencies across explicitly selected ecosystem worktrees, use
the checkout-only [dependency snapshot helper](DEPENDENCY-SNAPSHOTS.md). It
distinguishes npm lock artifacts from selected local source references and
verifies source, worktree and tooling freshness before reuse.
