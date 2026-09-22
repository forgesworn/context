# Results v2: plain tools, Graphify and Context after the explore tool

Locked protocol `three-way-plain-graphify-context-20260922-v2`, run on
22 September 2026 (17:29 to 18:35 UTC) with Claude Code 2.1.280,
`claude-sonnet-5` at medium effort for every executor and high effort for
every reviewer, Graphify 0.9.65 from the same isolated virtual environment as
v1, and the Context source build identified in `protocol.json` (0.3.3 plus
`repository_explore`, compact search and packet rendering, `pathPrefix`). All
twenty-four arm runs completed; every deterministic check passed and every
reviewer verdict parsed at the first attempt. Only the Context arm changed
from v1. Nothing here is a cash figure: the account is a subscription and the
cost column is the client's list-price estimate.

## Headline

Context accepted five of eight tasks, the most of any arm, with the lowest
executor input of the three. Per accepted task it used 44.1 percent less
input than plain tools and 36.3 percent less than Graphify. The decision rule
is still **not met**, because three Context tasks were rejected and its
reviewer time was 9.8 percent above plain tools.

| Arm | Accepted | Tool calls | Input total | Uncached input | Output | Cost est. USD | Executor s | Reviewer s | Input per accepted task |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 3 of 8 | 116 | 3,881,788 | 233,583 | 42,984 | 2.09 | 516 | 508 | 1,293,929 |
| graphify | 4 of 8 | 111 | 4,547,313 | 336,988 | 88,004 | 3.07 | 996 | 581 | 1,136,828 |
| context | 5 of 8 | 128 | 3,619,073 | 289,888 | 49,179 | 2.32 | 573 | 558 | 723,815 |

Input total is fresh input plus cache writes plus cache reads across the
session; uncached input is fresh plus cache writes. Context's uncached input
is 24.1 percent above plain because each session carries the tool schemas and
the project instruction appendix, which is why its cost estimate per session
is 10.7 percent above plain while its input total is 6.8 percent below. Per
accepted task the estimate is USD 0.46 for Context, 0.70 for plain and 0.77
for Graphify.

## Per task

Accepted answers (deterministic check and blind reviewer):

| Task | plain | graphify | context |
| --- | --- | --- | --- |
| orientation, Context repo | no | no | yes |
| orientation, KithMoot | no | yes | no |
| diagnosis, Context repo | yes | no | yes |
| diagnosis, KithMoot | no | yes | yes |
| impact, Context repo | no | no | no |
| impact, KithMoot | no | no | no |
| code change, Context repo | yes | yes | yes |
| code change, KithMoot | yes | yes | yes |

Executor input tokens (thousands) and wall seconds:

| Task | plain | graphify | context |
| --- | ---: | ---: | ---: |
| orientation, Context repo | 735 / 73 | 343 / 41 | 298 / 42 |
| orientation, KithMoot | 771 / 74 | 600 / 91 | 534 / 73 |
| diagnosis, Context repo | 891 / 162 | 2,044 / 607 | 773 / 148 |
| diagnosis, KithMoot | 264 / 37 | 237 / 42 | 563 / 107 |
| impact, Context repo | 554 / 61 | 404 / 53 | 482 / 75 |
| impact, KithMoot | 134 / 32 | 175 / 65 | 230 / 37 |
| code change, Context repo | 269 / 38 | 399 / 44 | 348 / 37 |
| code change, KithMoot | 265 / 39 | 345 / 52 | 391 / 54 |

Neither impact task was accepted in any arm, as in v1. Context's three
rejections were all synthesis omissions against the rubric: on the KithMoot
orientation the reviewer wanted the two-step logic of `verifyDelegation`, which
the explore output had returned verbatim (lines 15 to 18) and the answer folded
into another function's description; on the two impact tasks the answers again
omitted required test classes and one invariant statement.

## How each tool was actually used

| Task | Context calls: status / refresh / explore / search / packet | Context result bytes | Direct reads | Graphify CLI calls |
| --- | --- | ---: | ---: | ---: |
| orientation, Context repo | 1 / 1 / 2 / 4 / 4 | 55,289 | 0 | 2 |
| orientation, KithMoot | 1 / 1 / 5 / 2 / 1 | 32,740 | 6 | 2 |
| diagnosis, Context repo | 1 / 1 / 2 / 2 / 8 | 93,452 | 0 | 2 |
| diagnosis, KithMoot | 1 / 1 / 3 / 9 / 8 | 36,901 | 0 | 2 |
| impact, Context repo | 1 / 1 / 10 / 3 / 3 | 43,024 | 0 | 2 |
| impact, KithMoot | 1 / 1 / 1 / 0 / 4 | 11,405 | 0 | 2 |
| code change, Context repo | 1 / 1 / 1 / 1 / 2 | 32,819 | 0 | 2 |
| code change, KithMoot | 1 / 1 / 1 / 1 / 2 | 5,300 | 3 | 1 |

Across the eight tasks Context made 95 MCP calls returning 310,930 bytes:
25 explores, 22 searches and 32 packets, against 58 searches and 8 packets
returning 390,419 bytes in v1. Direct file reads fell from 37 to 9 and shell
calls from 37 to 15. The model followed the intended path: explore the
symbol, then fetch complete blocks with packets. Graphify was invoked once or
twice per task, always `query` or `explain`, and its arm read the most file
bytes of the three (277,582 against 145,138 for plain and 38,694 for Context).

## Decision rule

The prospective rule requires all Context tasks accepted, at least 20 percent
lower aggregate executor input per accepted task than each comparator, and no
higher reviewer time. Result: five of eight accepted; input per accepted task
44.1 percent lower than plain and 36.3 percent lower than Graphify; reviewer
time 9.8 percent higher than plain and 4.0 percent lower than Graphify. The
input clause is met against both comparators; the acceptance and reviewer
time clauses are not. **Not met.** No token, subscription or cash saving is
claimed from this run.

The margin against Graphify rests on one task. Graphify spent 2.0M input on
the Context-repo diagnosis (ten minutes, rejected). Excluding that task from
all arms, Graphify's input per accepted task is 0.63M, Context's 0.71M and
plain's 1.50M. Context's margin against plain holds either way.

## Against v1

| Arm | v1 accepted | v2 accepted | v1 input | v2 input |
| --- | ---: | ---: | ---: | ---: |
| plain | 4 | 3 | 6,526,527 | 3,881,788 |
| graphify | 2 | 4 | 5,260,690 | 4,547,313 |
| context | 4 | 5 | 7,433,566 | 3,619,073 |

Context's input halved on the same eight prompts with the same model and
reviewer; the unchanged arms also moved, in both directions, so part of every
difference is day-to-day variance. Verdicts changed between runs on identical
prompts for six of the sixteen unchanged arm runs. The two runs are reported
side by side and not pooled.

## What this does and does not show

- One model, one client build, eight tasks on two ForgeSworn repositories,
  one repetition. The aggregate is an operational pilot, not a general claim.
- The client build moved from 2.1.278 to 2.1.280 between runs for all arms.
- The plain arm searched through Bash because the client hides Grep and Glob
  under bypass permissions; all arms shared that.
- Graphify indexed the whole workspace and Context only the selection policy.
- Reviewer strictness is uniform across arms and harsh: it rejected on any
  omitted rubric fact, and the impact rubrics have not been passed by any arm.

## Evidence

Receipts, transcripts, prompts, answers, diffs and reviews are private under
`~/.cache/z1p-delivery/20260922-graphify-comparison-v2/`. `protocol.json` in
this directory records the Context build by commit and dist digests;
`../graphify-20260922/run.mjs --protocol` reproduces the run against a private
`local.json`, `summarise.mjs` produced the aggregate and `tool-use.mjs` the
tool-use table.
