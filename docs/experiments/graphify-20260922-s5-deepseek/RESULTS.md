# Results S5: plain tools, Graphify and Context on a DeepSeek V4 Pro executor

Locked protocol `three-way-deepseek-v4-pro-20260922-s5`, run on 22 September
2026 (18:44 to 20:41 UTC) with Claude Code 2.1.280, every executor on
`deepseek-v4-pro:cloud` at medium effort through the local Ollama daemon's
Anthropic-compatible endpoint, every reviewer on `claude-sonnet-5` at high
effort on the subscription, Graphify 0.9.65 and the same Context build as v2
(0.3.3 plus `repository_explore`, compact rendering, `pathPrefix`). Tasks,
arms, retrieval instructions, arm orders, checker and acceptance are identical
to [v2](../graphify-20260922-v2/RESULTS.md); the executor model is the only
change. All twenty-four arm runs completed, every deterministic check passed
and every reviewer verdict parsed at the first attempt. Every executor message
in the transcripts reports `deepseek-v4-pro` and every reviewer message
`claude-sonnet-5`.

## Headline

Each arm accepted three of eight tasks. Context used 52.3 percent less
executor input than plain tools and 1.3 percent more than Graphify, in total
and per accepted task. The decision rule is **not met**: five Context tasks
were rejected, the margin over Graphify is negative, and Context's reviewer
time was 29.8 percent above plain tools.

| Arm | Accepted | Tool calls | Input total | Output | Executor s | Reviewer s | Input per accepted task |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 3 of 8 | 206 | 6,738,378 | 236,606 | 2,894 | 424 | 2,246,126 |
| graphify | 3 of 8 | 152 | 3,174,075 | 97,844 | 1,165 | 589 | 1,058,025 |
| context | 3 of 8 | 179 | 3,215,962 | 109,186 | 986 | 550 | 1,071,987 |

Input total is every prompt token the provider reported across the session,
cached or not. The uncached and cost columns that v1 and v2 report are left
out here: the route's cache accounting is provider-reported and inconsistent
between arms (all eight Context sessions were credited with cache reads, 2.73M
of their 3.22M, while six of eight plain and six of eight Graphify sessions
were credited with none), and the client's cost estimate is a list-price guess
for a model it does not recognise. Nothing here is a cash figure; executor
tokens were drawn from Ollama Cloud credits at a rate not read for this run.

## Per task

Accepted answers (deterministic check and blind reviewer):

| Task | plain | graphify | context |
| --- | --- | --- | --- |
| orientation, Context repo | no | no | no |
| orientation, KithMoot | no | no | yes |
| diagnosis, Context repo | yes | yes | no |
| diagnosis, KithMoot | no | no | no |
| impact, Context repo | no | no | no |
| impact, KithMoot | no | no | no |
| code change, Context repo | yes | yes | yes |
| code change, KithMoot | yes | yes | yes |

Executor input tokens (thousands) and wall seconds:

| Task | plain | graphify | context |
| --- | ---: | ---: | ---: |
| orientation, Context repo | 245 / 115 | 264 / 70 | 280 / 52 |
| orientation, KithMoot | 758 / 158 | 329 / 80 | 306 / 59 |
| diagnosis, Context repo | 3,085 / 1,880 | 1,321 / 503 | 1,169 / 434 |
| diagnosis, KithMoot | 333 / 136 | 331 / 208 | 227 / 69 |
| impact, Context repo | 405 / 98 | 248 / 75 | 217 / 59 |
| impact, KithMoot | 231 / 98 | 115 / 54 | 281 / 111 |
| code change, Context repo | 1,488 / 365 | 278 / 87 | 473 / 141 |
| code change, KithMoot | 194 / 45 | 289 / 87 | 262 / 61 |

Nine of twenty-four arms were accepted against twelve in v2 on Sonnet 5, with
the same reviewer and rubrics. Both code-change tasks passed in every arm;
neither impact task passed in any arm, as in v1 and v2; the KithMoot diagnosis
failed in every arm on the same dimension (the regression test to restore).
Every rejection was a rubric omission except one reviewer error: on the
Context-repo diagnosis the reviewer failed the Context answer's lost-invariant
dimension as a fabricated citation of `NAVIGATION-POLICY.md`, but the quoted
sentence is present verbatim at line 58 of that file in the frozen workspace.
That rejection stands on its other failed dimension (the regression test), so
no verdict changes, and it is recorded as a reviewer error, not a model one.

The Context-repo diagnosis was the outlier in every arm. Plain tools spent
3.09M input over 61 turns and 31 minutes to pass it, with 164K output tokens
of extended thinking; Graphify 1.32M to pass; Context 1.17M and was rejected.
Excluding that task from all arms, input per accepted task is 0.68M for
Context, 0.93M for Graphify and 1.83M for plain tools. The margin against
plain tools holds either way; the comparison with Graphify turns on that task
in the opposite direction from v2.

## How each tool was actually used

| Task | Context calls: status / refresh / explore / search / packet | Context result bytes | Direct reads | Graphify CLI calls |
| --- | --- | ---: | ---: | ---: |
| orientation, Context repo | 1 / 1 / 2 / 0 / 0 | 5,817 | 9 | 1 |
| orientation, KithMoot | 1 / 1 / 6 / 0 / 3 | 29,122 | 10 | 5 |
| diagnosis, Context repo | 1 / 1 / 2 / 0 / 4 | 53,114 | 9 | 4 |
| diagnosis, KithMoot | 1 / 1 / 9 / 0 / 10 | 28,375 | 0 | 2 |
| impact, Context repo | 1 / 1 / 10 / 0 / 4 | 74,465 | 0 | 4 |
| impact, KithMoot | 1 / 1 / 1 / 5 / 16 | 22,863 | 2 | 2 |
| code change, Context repo | 1 / 1 / 1 / 1 / 7 | 54,092 | 1 | 4 |
| code change, KithMoot | 1 / 1 / 2 / 0 / 10 | 7,301 | 4 | 2 |

DeepSeek used the Context tools differently from Sonnet 5: 33 explores, 6
searches and 54 packets returning 275,149 bytes, against 25, 22 and 32 in v2,
with 35 direct file reads against 9. On the Context-repo orientation it called
explore twice and then read nine files directly without a search or packet.
Plain tools made 66 reads and 130 shell calls; Graphify made 24 CLI calls (15
in v2) plus 58 reads. Reviewer time was highest for Graphify and lowest for
plain tools in this run, the reverse of v2's ordering between Context and
Graphify.

## Decision rule

The prospective rule requires all Context tasks accepted, at least 20 percent
lower aggregate executor input per accepted task than each comparator, and no
higher reviewer time. Result: three of eight accepted; input per accepted task
52.3 percent lower than plain tools and 1.3 percent higher than Graphify;
reviewer time 29.8 percent higher than plain tools and 6.6 percent lower than
Graphify. Only the input clause against plain tools is met. **Not met.** No
token, credit, subscription or cash saving is claimed from this run.

## Against v2

The question this run asked was whether Context's margin over plain tools
widens on a cheaper executor. Per accepted task it did, from 44.1 percent in
v2 to 52.3 percent, because plain tools spent much more here (6.74M against
3.88M) while Context spent slightly less (3.22M against 3.62M). The margin
over Graphify disappeared: Graphify spent 30 percent less than in v2 and
accepted one fewer task, Context accepted two fewer.

| Arm | v2 accepted | S5 accepted | v2 input | S5 input | v2 output | S5 output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 3 | 3 | 3,881,788 | 6,738,378 | 42,984 | 236,606 |
| graphify | 4 | 3 | 4,547,313 | 3,174,075 | 88,004 | 97,844 |
| context | 5 | 3 | 3,619,073 | 3,215,962 | 49,179 | 109,186 |

Output tokens were 2.5 times v2's because DeepSeek emitted long thinking
blocks, one of 58K characters on the Context-repo diagnosis. The run took 116
minutes against 66 for v2, with executor time 2.4 times higher. No arm reached
the 80-turn cap; the highest was 61. The two runs differ in executor model
only and are reported side by side, not pooled with each other or with v1.

## What this does and does not show

- One executor model at one effort, eight tasks on two ForgeSworn
  repositories, one repetition, a reviewer that rejects on any omitted rubric
  fact. An operational pilot of the S5 routing question, not a general claim.
- Cache accounting on this route is not comparable between arms, so only
  input totals are compared; credit consumption was not read from the Ollama
  account for this run.
- The Ollama daemon was shared with another local session during the run,
  which may have affected wall time but not tokens or verdicts.
- Graphify indexed the whole workspace and Context only the selection policy;
  the plain arm searched through Bash because the headless client hides Grep
  and Glob under bypass permissions; all arms shared that.

## Evidence

Receipts, transcripts, prompts, answers, diffs and reviews are private under
`~/.cache/z1p-delivery/20260922-graphify-comparison-s5-deepseek/`, including
`summary.md` from `summarise.mjs` and `tool-use.md` from `tool-use.mjs`.
`protocol.json` in this directory records the executor route and the Context
build; `../graphify-20260922/run.mjs --protocol` reproduces the run against a
private `local.json`.
