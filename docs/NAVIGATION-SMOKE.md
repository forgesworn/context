# Repository-navigation MCP smoke

Run the SDK stdio smoke against the checkout CLI:

```sh
node scripts/navigation-smoke.mjs
```

To exercise a packaged or installed CLI, pass its absolute path. The script imports the MCP SDK from this checkout, but starts that supplied CLI in a separate Node process:

```sh
node scripts/navigation-smoke.mjs /absolute/path/to/encrypted-context.mjs
```

`--help` prints the same usage. Extra arguments and relative CLI paths are rejected.

The smoke makes one mode-0700 fixture directory under the system temporary directory and writes its mode-0600 JSON receipt there. Its final JSON summary gives the exact `receiptPath` and `fixture`. It does not write to the repository, configured user source, global configuration, or keys.

It verifies the three navigation MCP tools over stdio: unavailable status in each new session; explicit refresh; exact ASCII token paging and UTF-8 byte accounting; stale source after each fixture add, edit, delete, and rename, with a refresh between each mutation; cursor invalidation after refresh; budget rejection without consuming a cursor; invalid-UTF-8 refresh preservation and recovery; and equivalent source evidence and manifest revision in a second server process. Each request has a 30-second limit and the harness has a 120-second watchdog, including shutdown cleanup; it force-exits after a further two seconds if that cleanup hangs.

The receipt records client identity, Node version, CLI path and SHA-256, source evidence, revisions, generations, counts, timing, checks, and `null` usage/cache/cost fields. This is an SDK MCP smoke only. It is not desktop acceptance and does not establish inference savings. Cancellation robustness is covered by unit tests; this harness does not exercise or claim it.

Keep the printed fixture directory while reviewing its receipt. If it is no longer needed, remove only the exact printed fixture path; do not substitute a broader temporary or project path. The script deliberately never deletes any external path.
