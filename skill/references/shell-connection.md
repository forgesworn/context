# Shell connection

Read this only when the host exposes no native repository tools, or for a legacy
fixed-root `navigate` connection.

If this host exposes no native repository tools but the installed CLI includes
`connect`, use its task-scoped shell transport with the existing private cache
and handover directories. Keep that process open for the task; send newline-ended
JSON requests using the same repository tool names and arguments. It pins and
supplies `expectedRoot`, retains generations and addressed-note identity, and
rejects another root. Native MCP and shell connections have separate identities;
do not transfer activity revisions or generation IDs between them. Clean close
finishes tracked leases; process death leaves them to expire. This is shell use,
not native tool discovery. See [shell connection](https://github.com/forgesworn/context/blob/main/docs/GLOBAL-SESSIONS.md#shell-connection).

Use bounded local reads when neither transport is available.

For a legacy fixed-root `navigate` connection, compare the root named in its
instructions with the selected checkout and reject a mismatch. Do not use a global server
pinned to one project as context for unrelated work.
