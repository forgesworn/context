# Context in every coding session

Use one user-level `z1p-repository` MCP entry for Codex, Claude and Kimi:

```text
/absolute/node /absolute/encrypted-context.mjs session --handover-base /absolute/private/handovers
```

This command starts from a repository, subdirectory, parent workspace or other
working folder. It does not scan siblings or assume one project. Every tool
request must provide the selected canonical Git checkout/worktree as
`expectedRoot`. The caller's task and host permissions still govern access.

The process retains one repository index. Explicitly selecting a different
checkout closes the previous adapter and drops its index; requests are queued
to prevent interleaved selection. A previous generation/cursor cannot be reused
after switching away. Source, output, work and queue bounds remain enforced.

`--handover-base` is optional. It must be an existing canonical private directory
(no group/other permissions on POSIX). Save creates an opaque SHA-256-named
subdirectory for the selected root, with mode 0700. Reads do not create storage.
Only the selected root's handovers are accessible through that request; records
still verify their exact root, HEAD and source selection before returning state.
Use the same base across hosts for continuation. No keys or provider login are
needed, and no signed context or project conversation history is imported.

For a shared encrypted cache, catalogue/batch warm-up and advisory agent activity
and notes, follow [shared workspace setup](SHARED-WORKSPACE.md). Add its explicit
`--cache-dir` option to all host entries. It adds three tools; with private
handovers enabled, the server advertises eleven. Without a cache, the original
six/eight-tool mode remains unchanged.

## Host configuration

- **Codex:** merge a user-level `[mcp_servers.z1p-repository]` entry into
  `~/.codex/config.toml`, with the command/args above. Do not set its `cwd` or
  arguments to one project. Enable the six navigation tools and, when using a
  handover base, both handover tools.
- **Claude:** use a user-level stdio entry in `~/.claude.json`, preserving other
  servers. A fixed `navigate` user entry must be replaced with `session` to work
  from a non-Git parent workspace.
- **Kimi:** merge the entry into `~/.kimi-code/mcp.json` (or the configured
  Kimi home), rather than relying on each project's configuration. Keep existing
  trust and approval rules.
- **Ollama coding hosts:** `ollama launch claude`, `ollama launch codex` and
  `ollama launch kimi` consume the selected host's configuration. Keep the
  intended daemon/model/effort settings; installation does not require inference
  or a model download.
- **Direct Ollama workers:** the coding host supplies a verified source packet
  through the existing worker helper's prompt file. The raw API is not an MCP
  host. Its preflight and receipts are a distinct acceptance path.

Project/local entries with the same server name may shadow the global entry.
Inspect them and remove only obsolete task-owned overrides, preserving separate
signed `z1p-context` connections and other user choices. Existing handovers can
be copied without overwriting into their root's hash directory; retain originals
and let normal freshness validation reject historical records.

Link the complete repository `skill/` directory into each host's user skill
root as `z1p-context`. The `.ollama/skills` link is a reference for adapters,
not a claim that raw Ollama scans it. Automatic selection remains available.
Source links and configuration checks do not establish model adherence.

Reconnect or start a new session after configuration changes. Verify actual
tool discovery from the parent workspace as well as from two different repos.
Test explicit root selection, root switching, handover isolation and restart.
Do not report a configured entry as active tools in an existing conversation.

## Shell connection

Some coding hosts can run local commands without exposing local MCP tools in
their current conversation. `connect` supplies a task-scoped JSON-lines transport
over the same repository server. It does not inject tools into the host, modify
configuration, change providers or run inference. No socket, daemon or identity
file is created. Start it with the installed CLI and keep its stdin open:

```sh
z1p connect /canonical/checkout \
  --cache-dir /existing/private/cache \
  --handover-base /existing/private/handovers \
  --label 'Codex / implementation' --task 'Fix the selected issue' \
  --path src/ --path test/
```

`z1p` may be a local wrapper around the installed `encrypted-context` executable;
the packaged executable accepts the same arguments. Cache and handover options
are optional. `--task` requires a label and cache; paths are intended relative
paths, at most 32. Omitting task metadata opens a connection without an automatic task claim.
No source index is built at startup; an existing cached selection may be restored
after live freshness checks. Startup reads status and coordination, then publishes
the requested task and returns a `ready` JSON object with tool names, status,
coordination pagination flags, activity/revision and advisory overlaps.

Send one JSON object per line, with a caller-chosen string/integer `id`, a `name`
and optional `arguments`. Responses echo the ID and contain `result` and
`isError`. `result` is the decoded tool JSON, or its text for text-format tools.
The connection pins `expectedRoot`; omit it or pass the exact selected root.
Another checkout requires another connection. Discover current tool schemas
on demand with `{"id":1,"name":"tools"}`.

```json
{"id":2,"name":"repository_refresh"}
{"id":3,"name":"repository_search","arguments":{"term":"knownIdentifier","format":"json","maxResults":5}}
{"id":4,"name":"repository_coordination","arguments":{"afterMessage":0,"maxBytes":16384}}
```

Use the returned refresh generation with `repository_explore`,
`repository_packet` and `repository_coverage`, exactly as with native MCP. Read
the source packet, refresh after edits and retain pagination cursors only for
their current generation. Handover save/resume uses the same tool names and
private checkout-scoped storage; a new host still revalidates the checkpoint.
Never reuse a generation from another connection.

The optional startup task has a random slot and a 15-minute advisory lease.
Its activity object includes the slot, agent ID and revision. The next repository
work step renews it after half its lease has elapsed. There is no idle heartbeat:
poll between steps and after long commands. For explicit state/path changes,
call `repository_activity` with the slot, full task fields and the latest
`expectedRevision`; reread coordination after an automatic renewal or uncertain
write. Additional worker slots require explicit publication and renewal by their
host. Send notes with `repository_message`, retaining their UUID for reconciliation.
Polling does not acknowledge or execute a note, and notes confer no authority.

After saving any needed checkpoint, send `{"id":5,"name":"close"}`. Clean
close or EOF marks successfully tracked task slots done and closes storage.
Inspect each finish result: an error does not establish completion. An interrupted
input stream also triggers best-effort per-slot cleanup while preserving its
error. One uncertain finish does not prevent attempts for the other slots, and
is not automatically replayed. A partial
request without a newline is rejected at EOF. Killed processes, failed output
or interrupted writes may leave leases until expiry; inspect the owner activity
view and reconcile before retrying writes. Restart creates a new connection
identity and does not reclaim old notes or slots. This is advisory same-owner
coordination, with the existing retention limits.

Requests are sequential and limited to 131,072 UTF-8 bytes per line. Oversized
input is discarded through its newline, then subsequent requests can proceed.
Existing source, packet, cache and response budgets remain enforced by the
repository tools. JSON encoding escapes terminal controls; decode source as data.
Shell access is subject to the coding host's existing approval and disclosure
rules. Direct Ollama workers still receive host-verified packets and relevant
notes through the established worker helper; raw inference is not a shell host.
