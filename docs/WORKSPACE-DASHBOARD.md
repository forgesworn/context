# Local workspace dashboard

For task entry, managed Codex/Claude/Kimi/Ollama hosts and private notes to
existing registered agents, see the optional [local task console](AGENT-CONSOLE.md).
Explicit `--control-dir` mode enables external-agent linking and inboxes. Add
operator-configured `--codex`, `--claude`, `--kimi` and/or `--ollama-profile ABS`
to launch owned tasks as well. The default described below stays read-only.

Use the local ticket viewer to see reported agent work, shared file claims and
saved handovers across the **existing saved workspace catalogue**. It runs as an
explicit foreground command. It does not discover repositories, build indexes,
change tickets, run agents or contact a hosted service.

```sh
z1p workspace dashboard /absolute/workspace --cache-dir /absolute/private/cache
```

Open the private `http://127.0.0.1:PORT/RANDOM/` URL printed by the command. Keep
the command running; Ctrl-C stops it. No browser opens automatically. The viewer
refreshes observations every ten seconds while visible; Refresh observations
also retries a failed observation. Server observations are shared and cached for
five seconds to avoid concurrent repeated reads. Failed refreshes show an error
and label the previous display as potentially stale.

The command requires an existing initialised private cache and saved catalogue.
Use the [shared workspace setup](SHARED-WORKSPACE.md) if these are missing. It
opens the cache read-only; it will not recreate a lost database or key.

## Tickets and project selection

Agent activity appears as cards in Working, Blocked, Reviewing, Reported finished
and No recent activity. Filter by checkout or search task, agent, branch and path.
Each card expands to show its task, intended paths, reported checkout/branch/HEAD,
publication time and lease expiry. Labels are supplied by hosts: the viewer does
not infer a model or provider from a label.

The viewer includes the coordination store's recent inactive history. These
records are bounded/retained by coordination, not a durable ticket archive. A
lease does not prove process liveness. “Reported finished” does not mean reviewed,
merged, deployed or accepted. Missing publications do not prove no work exists.

Shared-path warnings compare active claims belonging to the same Git identity,
including verified worktrees. They recognise exact paths and directory prefixes,
not arbitrary globs or semantic conflicts. Claims are advisory, not locks. At
most 500 activity rows, 100 overlap pairs and 100,000 path comparisons are used;
partial observations and analysis limits are visible.

## Context health and saved handovers

The workspace view reports whether a cached index exists, with freshness **not
checked**. It does not hash source across all catalogue checkouts. Select one
checkout explicitly at launch to check its existing cached manifest:

```sh
z1p workspace dashboard /absolute/workspace --cache-dir /absolute/private/cache \
  --repo /absolute/workspace/project \
  --handover-base /absolute/private/task-handovers/repositories
```

`--repo` must name an exact canonical saved-catalogue checkout. Only that
checkout's existing index is checked, under a five-second abort signal. `current`
covers the bounded indexed manifest and policy, not whole-repository coverage.
No cache reports `unavailable`; a failed/stale/unusable cached validation reports
`unknown`. Use repository tools to inspect or refresh; the viewer never rebuilds.
The time bounds are cooperative; an ongoing filesystem or Git operation may finish later.

`--handover-base` explicitly enables summaries from the same canonical 0700
directory used by global sessions. Root directories use the existing SHA-256
checkout separation. Only task, saved time/HEAD, recorded status, check criteria
and outcomes, and next action are displayed. No source excerpts, evidence text,
keys or agent inboxes are returned. The record's packet checksum and state shape
are checked; live source freshness and reviewer acceptance are **not** checked by
summary reading. Use `repository_handover_resume` for current source verification.

At most twelve activity checkouts (or the one selected `--repo`) are inspected.
Within each, at most 128 directory entries are considered and the four most
recent checkpoint files inspected are shown. Limits/unavailable directories are
labelled. The JSON response is capped at 2 MiB; narrow with `--repo` if necessary.

## Girnel card links

Girnel can own the durable ticket while Z1P reports execution observations. The
adapter consumes an **explicitly prepared local metadata file**. No Girnel
checkout, board credentials or room is opened implicitly. Girnel 1.2 adds a
standalone browser connection for the selected card, described below.

```json
{
  "version": 1,
  "cards": [{
    "checkoutRoot": "/absolute/workspace/project",
    "agentId": "connection-uuid/task-slot",
    "appUrl": "https://girnel.app/app/",
    "boardId": "board-id",
    "cardId": "card-id",
    "title": "Fix queued-job cancellation",
    "column": "In progress",
    "observedAt": 1793620000000
  }]
}
```

```sh
z1p workspace dashboard /absolute/workspace --cache-dir /absolute/private/cache \
  --girnel-links /absolute/private/selected-girnel-cards.json
```

Use actual board/card IDs and the exact published Z1P `agentId`, not matching
titles or agent display names. An agent connection/slot can change after a
restart, requiring a new explicit binding. For a console-managed isolated task,
use its saved source project as `checkoutRoot` and its exact console agent ID.
Z1P 0.20.1 follows the console's retained task association into its execution
worktree. The observation retains the actual execution root, branch and HEAD;
project filtering also includes the saved source project. Other agents still
need an exact checkout/agent binding. Shared names or Git ancestry grant no
association. One binding is allowed per checkout
and agent ID; several agents may bind to the same card. Those observations group
into one ticket, with blockers taking precedence over working/reviewing lanes.
The newest supplied metadata supplies its title and Girnel column. Card status
and metadata time remain separate from the observed execution lane. The file is
reread on refresh; no acceptance or Girnel status change is ever inferred.

Set `agentId` to `null` to show a selected card before assigning a Z1P agent slot.
Cards with no matching published activity stay visible under No recent activity;
their Girnel column is retained, and they are never inferred to be finished.

The file accepts only the listed fields, at most 500 bindings/256 KiB, saved
catalogue roots, and safe HTTPS or loopback HTTP app URLs without credentials,
queries or fragments. Links use Girnel's `#/b/BOARD/c/CARD` route; opening one
requires access in that browser and compatible routing at the chosen app URL.
It grants no board access. The dashboard makes no outgoing Girnel requests. Opening the link
contacts Girnel; connecting the feed lets that Girnel browser origin read the
selected observations from loopback. Do not include invitation fragments, attachments, keys or secrets.

### Live card activity and reviewed comments

In the dashboard card's **Task, files & provenance**, copy **Read-only Girnel
feed**. Open that same card in standalone Girnel 1.2 or newer, choose **Z1P
activity**, paste the address and connect. Permit local-network access if the
browser asks. Activity refreshes every ten seconds while the sheet is open.
Closing or disconnecting stops it; reopening requires an explicit connection.
A stopped dashboard or blocked browser connection shows unavailable data and
disables review. No feed is contacted before connecting.

The feed shares only that card's explicitly bound task observations: agent IDs,
labels/task text, checkout names and opaque checkout IDs, branches/HEADs, relative
paths, reported states and lease times. It omits dedicated absolute checkout-root and source fields,
checkpoints, inboxes and console/control state. Selected task text and labels
are shared as supplied; they are not a secret scrubber. The 256 KiB version-1 envelope is
`z1p-girnel-observation`; partial workspace observations remain labelled partial.
It uses a separate random-server-secret capability and exact configured Girnel
origin. It cannot invoke console actions. Do not share the dashboard/control URL.

In Girnel, **Review update for comment** freezes an exact bounded comment preview.
**Save reviewed update as comment** uses your current Girnel board access and
identity. New observations invalidate a changed preview; stale/wrong-card data
cannot be reviewed. Existing matching update markers suppress sequential repeat
saves, including reopening the sheet. This is not a distributed exactly-once
promise across concurrent devices. Local durability and ordinary encrypted board
sync remain separate. No column movement, assignment acceptance or new execution
authority is inferred.

Removing a binding revokes the feed on its next request, without waiting for the
five-second observation cache. Removing one agent stops its disclosure; removing
all card bindings disables the feed. A restarted dashboard issues new addresses.
Previously read plaintext and saved comments cannot be recalled by revocation.
The selected Girnel origin can read its explicitly shared feed; do not point
`appUrl` at an origin you do not trust. Browser local-network policy can require
permission or refuse the connection. Girnel does not proxy a refused connection
through a hosted service. Embedded hosts retain their existing UI/network policy.
This introduces no KithMoot/Oathrun assignment or execution authority path.

## Local access and data

The server binds only `127.0.0.1` on an ephemeral port, requires its random path,
checks Host/Origin, refuses cross-site fetches and accepts GET only. It serves
only the page and its bounded snapshot, never arbitrary files. Responses disable
caching and framing. The page uses a hashed content-security policy, DOM text
rendering, system fonts, no external assets and no telemetry. Treat the private
URL as a local capability; other software running as your OS user is not isolated
from your cache or this viewer. Girnel links open with no referrer.

No new ForgeSworn-operated service, identity, key, provider or account is added.
The foreground process holds the decrypted observations in memory until stopped.


Managed control sessions support isolated task worktrees, three concurrent host
runs by default (`--max-active 1–4`), and per-task inboxes with separate delivery
and acknowledgement states. The browser defaults new tasks to committed-HEAD
worktrees; selected-checkout tasks retain existing local changes and run
exclusively in their repository. Filter tasks by pending decisions or unread
notes. See [the console contract](AGENT-CONSOLE.md#concurrent-work-and-shared-inbox-0190)
for source/branch handling, native worker registration, Ollama turn-boundary
notes, restart reconciliation and retained worktree cleanup.
