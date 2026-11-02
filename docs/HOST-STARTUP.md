# Host startup guidance

Use `setup` to add a short, managed Z1P section to a coding host's global
instructions. It tells fresh sessions to load the shared skill, select the
authorised Git checkout explicitly, and use the repository tools or shell
fallback. It does not install the skill or configure MCP.

This is the default for project work: the user does not need to
mention Context or invoke the skill. One user-level setup applies to every
explicitly selected project. No per-project application dependency is needed.

Start with a quick status and, when configured, coordination check before
investigating project source. Behaviour changes also use activity, source
packets and a fresh checkpoint. A short bug fix requiring behaviour discovery
or regression tests follows that workflow; its size does not exempt it. A
trivial correction in an already identified file needs only the quick check.
Deferred native schemas should be discovered through the host tool search,
rather than treated as a missing server.

## Automatic host hooks

Fresh-session trials found that a connected server and written instructions
do not make every model follow the workflow. `setup-hooks` adds a deterministic
startup preflight and explicit context reminder through supported host hooks:

```sh
z1p setup-hooks claude --cache-dir /existing/private/cache \
  --handover-base /existing/private/handovers
z1p setup-hooks claude --cache-dir /existing/private/cache \
  --handover-base /existing/private/handovers --apply
z1p setup-hooks kimi --apply
z1p setup-hooks codex --apply
```

Preview is the default. `--remove --apply` removes the managed hook only.
`--config-dir ABS` selects an existing host configuration directory. An optional
`--launcher ABS` uses an existing stable executable wrapper as the hook command;
the default pins the current Node and installed CLI paths. The shared skill must
already exist. Models, providers, MCP entries and permission settings are not
changed. Existing JSON settings and hook handlers retain their bytes; Kimi's
owned TOML section is marked separately.

Claude and Codex use `SessionStart`; Kimi uses `UserPromptSubmit`, whose stdout
is appended to model context. Kimi's observation-only `SessionStart` does not
provide that contract. The installed `startup` command reads bounded hook input,
selects only the Git checkout containing the supplied local working directory,
and supplies the shared skill location and connection workflow. A parent
workspace remains unselected. It reads Git metadata, never source, runs no
project scripts and claims no fresh index or native tool discovery. Source
retrieval and task activity still follow the shared skill.

**Codex requires the owner to review and trust a new or changed hook through
`/hooks`.** The installer reports `trustReviewRequired`; it does not write trust
records, change managed policy or bypass hook trust. Until approved, the existing
global instructions and MCP connection remain the available default route.
Hooks may be disabled by host settings; configuration is not proof of execution.
Verify the actual hook output and subsequent tool use in a fresh session.

Host contracts: [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Kimi hooks](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/hooks.md).

## Preview, apply and remove

Run the installed `encrypted-context` executable. Preview is the default and
writes nothing:

```sh
encrypted-context setup codex
encrypted-context setup claude --config-dir /existing/claude-config
encrypted-context setup kimi --apply
```

The JSON result reports the effective file, proposed action, managed block and
whether a write occurred. `install`, `update`, `remove`, `current` and `absent`
describe the result; `applied` is true only after an actual write.

Add `--apply` to install or update the section. Remove it with:

```sh
encrypted-context setup codex --remove --apply
```

Omit `--apply` from that command to preview removal. Removal does not require
the shared skill. Setup supports `codex`, `claude` and `kimi`; other host names
are refused.

## Configuration directories and effective files

Each configuration directory must already exist and be specified as an absolute
path when overridden. Setup resolves it to its canonical path.

For Codex, removal follows the existing managed section even if a newly added
override shadows it. Remove that dormant section before installing into the
override. If both instruction files contain managed markers, setup refuses to
choose between them; inspect and reconcile them first.

| Host | Default configuration directory | Environment override | Effective instruction file |
| --- | --- | --- | --- |
| Codex | `~/.codex` | `CODEX_HOME` | `AGENTS.override.md` when that file is non-empty; otherwise `AGENTS.md` |
| Claude | `~/.claude` | `CLAUDE_CONFIG_DIR` | `CLAUDE.md` |
| Kimi | `~/.kimi-code` | `KIMI_CODE_HOME` | `AGENTS.md` |

`--config-dir ABS` takes precedence over the environment and default. Before
installing or updating, install the shared skill as this existing file within
the selected configuration directory:

```text
skills/z1p-context/SKILL.md
```

See [global session setup](GLOBAL-SESSIONS.md) for the separate user-level MCP
and skill configuration.

## Optional cache and handovers

Pass existing absolute directories to include them in the generated shell
fallback:

```sh
encrypted-context setup codex --apply \
  --cache-dir /existing/private/cache \
  --handover-base /existing/private/handovers
```

`--cache-dir` selects the shared workspace cache and enables the generated
guidance for activity labels, tasks and paths. Without it, activity requires a
separately configured shared cache. `--handover-base` selects checkout-scoped
handover storage. Both options are optional and do not create their directories.

## Shell fallback

When native repository tools are absent, the managed block includes the current
Node executable and installed CLI path in a `connect ROOT` command. Replace
`ROOT` with the selected canonical checkout, keep the process stdin open, and
send one newline-ended JSON tool request at a time. Add the requested label,
task and intended paths when a shared cache is configured. The fallback is a
task-scoped connection, not automatic tool injection; see
[the shell connection](GLOBAL-SESSIONS.md#shell-connection) for its protocol and
lifecycle.

## Preservation and refusals

Setup changes only text between its `z1p-context` start and end markers and
preserves instructions outside that block. Existing file permissions are
retained. Apply uses an installer lock, checks for concurrent changes, and uses
an exclusive create or atomic replacement.

Preview again after a refusal rather than editing around it. Setup refuses, among
other invalid states:

- missing configuration, cache or handover directories, relative directory
  paths, or a missing shared skill on install/update;
- symbolic or hard links, non-regular instruction files, files over 131,072
  bytes, invalid UTF-8, or an oversized result;
- malformed or duplicate managed markers; and
- instruction, Codex override or configuration-directory changes during apply.

The `setup` instruction command does not change hooks, models, approvals or MCP
settings. The separate `setup-hooks` command changes only its managed hook.

An existing installer lock requires checking the owning operation. Do not remove
a live or uncertain lock to retry. External editors do not participate in the
installer lock; its reread checks and atomic replacement do not provide a
cross-editor transaction or a guarantee against a later concurrent edit.

## Verify in a fresh session

Reconnect or start a new session after applying. Confirm that the host loads the
managed guidance and that the expected repository tools are actually exposed;
a written file is not evidence of either. Select the task repository's canonical
Git checkout explicitly. With native session tools, pass it as `expectedRoot` on
every request; a shell fallback pins its selected root.

Also start from a parent workspace that is not itself a checkout. Choose the
intended repository explicitly rather than scanning sibling projects, then check
status, source retrieval and any configured coordination or handover path. Use a
separate connection when switching shell-fallback checkouts. Existing project
configuration can shadow global MCP configuration, so inspect the effective host
setup if tools are missing.

These instructions guide behaviour; they cannot guarantee model adherence, tool
availability, coordination, handover success or adoption. Verify those in the
actual session and record acceptance separately.

## Direct Ollama workers

Do not run `setup ollama`. Direct Ollama work uses the existing coding-host
adapter and the bounded worker preamble in
[`skill/references/ollama-worker.md`](../skill/references/ollama-worker.md). The
host supplies and verifies the source packet, owns refresh, activity and notes,
and reviews the result. Raw Ollama inference does not discover the skill, MCP
tools, files or a shell by itself.

## Host references

The file choices follow the maintained host documentation:
[Codex global instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[Claude user instructions](https://code.claude.com/docs/en/memory), and
[Kimi data locations](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html).
Global instructions guide the model; they are not enforcement settings.
