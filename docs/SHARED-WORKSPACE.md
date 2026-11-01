# Shared local workspace context and agent coordination

Context 0.7.0 adds an optional encrypted local store shared by coding hosts. It
contains a checkout catalogue, reusable file indexes, batch progress and an
advisory activity board. It uses Node 24's SQLite and crypto; no account,
inference, network endpoint, scheduler or extra daemon is required. Oathrun and
coding clients retain execution, provider choice, task authority and acceptance.

## Initialise and warm a workspace

Use the same absolute, canonical cache directory in every host. Initialise it
explicitly once; MCP startup does not create keys or silently enable persistence.

```sh
NODE CLI workspace init --cache-dir /absolute/private/z1p-cache
NODE CLI workspace discover /absolute/workspace --cache-dir /absolute/private/z1p-cache
NODE CLI workspace warm /absolute/workspace --cache-dir /absolute/private/z1p-cache \
  --priority /absolute/workspace/active-project --max-repositories 50
NODE CLI workspace warm /absolute/workspace --cache-dir /absolute/private/z1p-cache --resume
NODE CLI workspace status /absolute/workspace --cache-dir /absolute/private/z1p-cache
NODE CLI session --cache-dir /absolute/private/z1p-cache --handover-base /absolute/private/handovers
```

Replace `NODE CLI` with the discovered Node executable and installed CLI path.
Add `--cache-dir` to the existing user-level entries in Codex, Claude and Kimi.
Ollama coding hosts use their host's connection; direct workers receive verified
packets and coordination updates through their host. Preserve model/provider,
effort, trust, permission, signed-context and handover settings.

Discovery scans directories to depth 3, stopping at Git checkouts, then includes
registered worktrees inside the selected workspace. It skips symlink directories,
large generated/dependency directories, inaccessible/pruned worktrees and
worktrees outside that workspace. Independent nested repositories inside a
checkout are not inferred. The catalogue reports this scope and skipped paths;
it is not a promise that every possible Git repository was discovered. Git is
used only for metadata: no hooks, source commands, pulls or fetches are run.

Warm builds one checkout at a time in a separate process with a 768 MiB V8 heap
limit (native buffers/RSS are additional). Each worker has an abort deadline,
120 seconds by default, configurable with `--timeout-ms` from 100 to 120000;
an IPC watchdog, separate from the batch parent, enforces termination after a
further two seconds even if that parent dies. The worker registers its own PID
transactionally against a pre-published startup ticket before indexing. A resumed
owner invalidates old tickets, so an unregistered stale child cannot start work. Each invocation processes at
most `--max-repositories` (up to 2000) and runs for at most 30 minutes plus its
last bounded worker. Progress is committed after every result. A live prior
parent/worker prevents another warm run taking ownership. A crashed worker's
SQLite transaction rolls back on reopening. No source ignores or quotas are
automatically relaxed for a failed checkout.

`--resume` continues the captured run's pending roots. Completed entries include
their original verification time; resume does not claim they are still current.
A fresh warm run rediscovers and rechecks every checkout. `--missing-only`
instead fills absent snapshots and always checks priority roots; already cached
roots are not revalidated by that maintenance run. Its mode is recorded. This
is useful after raising a storage budget or filling a partially retained fleet. `workspace index ROOT`
checks/rebuilds one root, and `workspace forget-index ROOT` removes only that
root's disposable snapshot, including after the checkout was deleted. Index eviction means processed and currently retained
counts can differ. Catalogue/activity/progress records are not evicted to make
space for source indexes.

## Reuse and freshness

One index remains active in each MCP process. Switching checkouts drops it from
memory; the shared disk snapshot can be reused when returning or restarting.
Every request still explicitly supplies the selected canonical `expectedRoot`.
An index cannot be hydrated into another root, moved inode or different limits.
Policy and bounded source hashes are rechecked before a cached generation is
published. New process generations have new IDs and no persisted cursors.

Refresh reuses the prepared source lines and token arrays of unchanged files.
Changed/added files are parsed again, deleted/excluded files disappear, and a
new postings map is assembled. Status reports `reuse` with restored/reused,
parsed and removed counts. The per-file read ceiling is 2 MiB in navigation and source packets; the first
fleet run exposed legitimate 1.1 MiB source files blocked by the old 1 MiB cap.
Large `.min.js`, `.bundle.js` and `-bundle.js` outputs above that ceiling are
deliberately excluded and counted as `oversizedFiles`, rather than aborting the
whole checkout. Other oversized source still fails. This naming policy does not
prove how a file was generated. Output/aggregate bounds remain independent. Directory discovery, file reads and hashing still
cover the bounded selection; this is not a watcher, compiler graph, sublinear
refresh or an atomic filesystem snapshot. Packet creation retains independent
live source/HEAD checks. Other agents can edit during indexing: stale or unknown
evidence must be refreshed rather than treated as current.

Snapshots are disposable optimisations. Invalid-format/incompatible snapshots
are ignored; authentication failures are reported rather than repaired by
changing hashes or replacing a key. The navigation snapshot format must change
when its preparation/tokenisation semantics change. Existing signed encrypted
`context_*` records and unsigned task-handover formats remain separate.

## Agents: who is doing what, and where

With `--cache-dir`, the session advertises three additional tools:

| Tool | Purpose |
| --- | --- |
| `repository_activity` | Publish a task/worker slot, label, intended relative files/directories, progress state and renewable lease. Return advisory overlaps. |
| `repository_coordination` | Read activity plus notes addressed to this connection, using bounded pages. |
| `repository_message` | Send a local addressed note with a caller-retained UUID for retry reconciliation. |

Choose a unique `slot` per agent/task, including each worker represented by a
host. Keep that slot until the task ends. Initial `expectedRevision` is 0;
subsequent updates use the returned agent revision. Read/reconcile an uncertain
update before retrying. Publish the actual task and paths before edits, renew
before lease expiry, and update state/progress after significant work. States
are `working`, `blocked`, `reviewing` and `done`; none establishes acceptance.
The default lease is 15 minutes, configurable from one minute to one hour.
Inactive leases are labelled, not interpreted as live processes or safe files.

Activity is grouped by Git's verified canonical common directory and physical
identity, so replacing that directory does not inherit another project's board, allowing
agents in worktrees of the same repository to see intended overlapping paths.
Responses include each checkout's root, branch and HEAD and distinguish the same
checkout from another worktree. Independent clones/projects remain separate.
Source tools never retrieve another worktree's source through this grouping.
Path overlap is a case-sensitive lexical comparison; use actual checkout
spelling. Symlink/hard-link aliases are not resolved. Claims are advisory: no file locks, execution grants or merge guarantees are
created. Overlap needs coordination before modifying shared files; different
worktrees can still produce conflicting patches.

Poll coordination between work steps and before overlapping edits. Retain
`nextOffset` and `nextMessage`, note `boardRevision` changes, and increase
`maxBytes` when `minimumBytesRequired` reports that an item cannot fit. Board
pagination is an observation of changing activity, not a stable snapshot.
Messages have monotonically increasing sequences; only notes to this connection's
slots appear in its inbox. A recipient must have a current lease. Reconnection
creates a new connection identity, so select its newly published recipient ID.
A completed/disconnected session's old address is not a continuation channel.

Save a message UUID with its exact text and recipient before sending. Same-content
retries deduplicate within seven-day retention; changed content with the same ID
is rejected. Delivery does not prove it was read or accepted. Polling is explicit;
there is no automatic interruption of a running model. For direct Ollama workers,
the host publishes their slots, supplies relevant notes in the next bounded
prompt and reviews their results. It cannot interrupt raw text inference through
these tools.

A board retains at most 128 agents and 256 notes. Old agent records (24 hours
after lease expiry) and notes (seven days) are pruned on the board's next write.
Full boards return a capacity error. Notes/task text are data, not instructions
that override owner authority or project acceptance gates. This is same-OS-owner
coordination, not authenticated multi-user messaging. No human contact is sent.

## Private storage and bounds

Payloads are compressed then encrypted with AES-256-GCM, with the document key
bound as authenticated data. A separate random 32-byte cache key stays in a
0600 file inside a canonical 0700 directory. Database payloads, rollback journal
payloads, catalogue paths, source lines and messages are encrypted; opaque key
hashes, entry kinds, lengths and timestamps remain metadata. The key is not a
signed-context identity, and is never included in MCP results or logs.

The default budget is 2 GiB of encrypted payloads, with oldest index snapshots
evicted first. Each encrypted value is capped at 32 MiB and decoded JSON at
128 MiB. SQLite's page count also has a physical cap; transaction journal and
memory overhead are additional. These are resource bounds, not a latency/RSS
promise. Directory/file privacy is checked on operations. The same OS owner can
read the key, memory, swap and client transcripts; encryption does not isolate
agents from that owner. Copying the database alone does not carry its key.

Keep the key when keeping catalogue/activity history. Stop clients before
removing the whole cache. Index-only deletion does not delete activity or saved
handovers. No existing index data is migrated from plaintext storage.
