# Retrieval measured from recorded transcripts

No model calls. `analyse.mjs` reads the executor streams already recorded for
the v1, v2, S5, v3 coverage, Flash smoke and aborted Pro runs (98 cells; the
evidence stays private) and measures retrieval directly instead of through the
reviewer:

- **recall**: the share of each task's `requiredEvidence` tokens
  (`../d5-20260921/acceptance/`) that appear in any tool result. The Context
  tools print `local-source-unsigned` in their own metadata, so that token is
  excluded; counting it would credit the Context arm for reading its own
  status output.
- **bytes to full recall**: cumulative tool-result bytes when the last required
  token first appeared.
- **tool errors**: tool results flagged as errors.

## Retrieval is not what fails the structured tasks

Structured tasks only (code-change tasks have no required evidence), all runs
pooled:

| Arm | Cells | Mean recall | Full recall | Accepted with full recall | Accepted without |
| --- | ---: | ---: | ---: | ---: | ---: |
| plain | 23 | 0.90 | 16 | 4 of 16 | 1 of 7 |
| graphify | 23 | 0.96 | 20 | 4 of 20 | 0 of 3 |
| context | 29 | 0.92 | 23 | 6 of 23 | 1 of 6 |

Every arm usually retrieves everything the rubric needs, and three quarters of
full-recall answers are still rejected. On these tasks acceptance measures
synthesis and rubric fit; a retrieval tool can only show up as cost. The most
common miss in every arm is one test title in orientation-context
(`successfully used cursor is consumed`). Per task, Graphify and Context reach
full recall with fewer bytes than plain on the orientation tasks (median 63 to
70 KB against 97 KB on orientation-context) but not consistently elsewhere;
with three or four cells per task this is not a measured difference.

## Tool errors: the Context arm's real friction

| Run | plain | graphify | context |
| --- | ---: | ---: | ---: |
| v1 | 4 / 203 | 10 / 196 | 9 / 233 |
| v2 | 3 / 116 | 3 / 111 | 7 / 128 |
| S5 (DeepSeek Pro) | 3 / 206 | 4 / 152 | 37 / 179 |
| v3 coverage | | | 10 / 228 |
| Flash smoke | 0 / 60 | 0 / 36 | 8 / 68 |

(errors / tool results). On DeepSeek the Context arm failed one call in five.
Grouped by message, the Context errors were:

- `line range exceeds source length`: 31. Models ask for a whole file with a
  guessed `endLine`.
- empty or placeholder packet metadata rejected by the schema
  (`acceptanceChecks` empty, `allowedFiles` empty strings): 10, plus many
  accepted calls padded with `"a"` or `"ok"`.
- `repository packet already in progress`: 10 (fixed in #26, calls now queue).
- `no supported syntax block contains <file>:<line>`: 7, mostly plan anchors on
  imports.
- one-identifier search terms rejecting literals: 5 (fixed in #26), and one
  literal passed to `repository_explore`.
- a coverage draft naming more than eight symbols: 1 (fixed in #26).
- harness permission prompts in v1: 3 (not the tool).
- stale navigation after the model's own edits: 3 (correct behaviour).

## Changes made from this

In `repository_packet` through MCP only (the CLI spec stays strict):

- an `endLine` past the end of a file reads to its last line, and the packet's
  `originalSpec` records the range read, so `verifyPacket` still rebuilds it
  exactly; a range that starts past the end is still rejected;
- only `sources` is required; omitted or blank handoff metadata gets a neutral
  task and acceptance check;
- a plan anchor outside every supported block now says to request an exact
  range with `mode: "build"`.

Together with #26 these remove 57 of the 71 recorded Context errors and
redirect 7 more; the rest are harness prompts, stale navigation and one
misused tool.
The served tool listing fell to 5,550 bytes.

## What this does not show

Recall is token presence in tool output, not understanding; a token can appear
in a search listing without the model reading its context. Runs differ in
model, build and rubric, so cells are pooled only for this model-free measure.
