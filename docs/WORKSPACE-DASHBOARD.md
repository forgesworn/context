# Local workspace dashboard

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
first adapter consumes an **explicitly prepared local metadata file**. This is
not a Girnel export command, browser/IndexedDB connection, live sync or board
write API. No Girnel checkout, board credentials or room is opened implicitly.

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
restart, requiring a new explicit binding. One binding is allowed per checkout
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
It grants no board access. The dashboard contacts Girnel only when you choose to
open the link. Do not include invitation fragments, attachments, keys or secrets.

The future browser adapter should supply only explicitly selected card metadata
and stable IDs, preserve Girnel's normal session/write boundary and keep human
acceptance separate. This viewer introduces no second assignment executor or
KithMoot/Oathrun authority path.

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
