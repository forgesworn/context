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
