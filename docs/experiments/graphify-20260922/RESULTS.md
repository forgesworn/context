# Results: plain tools, Graphify and Context on eight frozen tasks

Locked protocol `three-way-plain-graphify-context-20260922-v1`, run on
22 September 2026 with Claude Code 2.1.278, `claude-sonnet-5` at medium effort
for every executor and high effort for every reviewer, Graphify 0.9.65 from an
isolated virtual environment and the current Context source build (0.3.3 plus
the packet tool). All twenty-four arm runs completed; every deterministic check
passed and every reviewer verdict parsed. Nothing here is a cash figure: the
account is a subscription, and the cost column is the client's list-price
estimate.

## Headline

Context did **not** meet the prospective decision rule. It matched plain tools
on accepted answers (four of eight each) while using 13.9 percent more executor
input and 8.1 percent more reviewer time. Graphify used 19.4 percent less input
than plain tools but had two accepted answers of eight, so its input per
accepted task was the highest of the three.

| Arm | Accepted | Tool calls | Input total | Uncached input | Output | Cost est. USD | Executor s | Reviewer s | Input per accepted task |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| plain | 4 of 8 | 143 | 6,526,527 | 355,135 | 106,634 | 3.72 | 1,211 | 475 | 1,631,632 |
| graphify | 2 of 8 | 141 | 5,260,690 | 331,277 | 103,582 | 3.35 | 1,161 | 598 | 2,630,345 |
| context | 4 of 8 | 166 | 7,433,566 | 450,000 | 111,036 | 4.31 | 1,219 | 514 | 1,858,392 |

Input total is fresh input plus cache writes plus cache reads across the
session; uncached input is fresh plus cache writes. Both are provider usage
counters. One task, the seeded-regression diagnosis on the Context repository,
consumed 7.5M of the 19.2M executor input tokens because every arm built and ran
the test suite repeatedly. Without it: plain 3.58M input and four accepted,
Graphify 3.68M and two, Context 4.47M and three. The ordering does not change.

## Per task

Accepted answers (deterministic check and blind reviewer):

| Task | plain | graphify | context |
| --- | --- | --- | --- |
| orientation, Context repo | yes | no | no |
| orientation, KithMoot | no | yes | no |
| diagnosis, Context repo | no | no | yes |
| diagnosis, KithMoot | yes | no | yes |
| impact, Context repo | no | no | no |
| impact, KithMoot | no | no | no |
| code change, Context repo | yes | no | yes |
| code change, KithMoot | yes | yes | yes |

Executor input tokens (thousands) and wall seconds:

| Task | plain | graphify | context |
| --- | ---: | ---: | ---: |
| orientation, Context repo | 948 / 72 | 881 / 82 | 706 / 59 |
| orientation, KithMoot | 652 / 66 | 632 / 63 | 535 / 51 |
| diagnosis, Context repo | 2,943 / 792 | 1,581 / 685 | 2,959 / 772 |
| diagnosis, KithMoot | 542 / 82 | 345 / 57 | 870 / 77 |
| impact, Context repo | 547 / 70 | 675 / 69 | 1,200 / 87 |
| impact, KithMoot | 159 / 26 | 348 / 92 | 311 / 47 |
| code change, Context repo | 400 / 52 | 485 / 66 | 423 / 40 |
| code change, KithMoot | 335 / 51 | 313 / 46 | 430 / 87 |

Neither impact task was accepted in any arm: the reviewer required every
rubric item (for example all six input classes in the test list) and no arm
supplied them all.

## How each tool was actually used

| Task | Context calls: status / refresh / search / packet | Context result bytes | Graphify CLI calls |
| --- | --- | ---: | ---: |
| orientation, Context repo | 1 / 1 / 11 / 0 | 52,811 | 2 |
| orientation, KithMoot | 1 / 1 / 8 / 1 | 61,536 | 2 |
| diagnosis, Context repo | 1 / 1 / 9 / 4 | 105,837 | 1 |
| diagnosis, KithMoot | 1 / 1 / 8 / 0 | 33,212 | 2 |
| impact, Context repo | 1 / 1 / 15 / 1 | 75,252 | 2 |
| impact, KithMoot | 1 / 1 / 5 / 0 | 15,706 | 4 |
| code change, Context repo | 1 / 1 / 1 / 1 | 73,829 | 2 |
| code change, KithMoot | 1 / 1 / 1 / 1 | 4,924 | 1 |

Context made 82 tool calls returning about 423 KB, 58 of them searches. The
search page is the cost driver: each returns up to forty lines with a 64-hex
hash per line, and the model paged through many of them before reading files.
On the two code-change tasks the model used one search and one packet, made the
fewest calls of any arm on the Context repository task (nine) and finished
fastest there (40 seconds), while still reading nothing outside the packet.

Graphify was invoked one to four times per task, always `query` or `explain`;
`explain` returned no matching node several times. Its results are pointer
lists, so the model then read files, and it read less than the other arms.
That is where its token saving comes from, and it coincides with the most
rubric omissions.

## Decision rule

The prospective rule required all Context tasks accepted, at least 20 percent
lower aggregate executor input per accepted task than each comparator, and no
higher reviewer time. Result: four of eight accepted; input per accepted task
13.9 percent higher than plain and 29.3 percent lower than Graphify; reviewer
time 8.1 percent higher than plain. **Not met.** No token, subscription or cash
saving is claimed from this run.

## What this does and does not show

- One model, one client build, one day, eight tasks on two ForgeSworn
  repositories. Verdicts moved between arms on identical prompts, so single
  tasks are noise; the aggregate is an operational pilot, not a general claim.
- The plain arm searched through Bash because the client hides Grep and Glob
  under bypass permissions; all arms shared that.
- Graphify indexed the whole workspace and Context only the selection policy.
  Graphify's arm-specific build averaged about seven seconds and is inside its
  arm time.
- Arm order rotated per task; no order effect is analysable at this size.
- Reviewer strictness is uniform across arms but harsh: it rejected on any
  omitted rubric fact.

## Harness lessons

Four earlier pilots were discarded before lock and are archived with notes:
the built-in agents-md plugin injected the frozen tree's AGENTS.md (which
instructs Context use) into every arm; the permission-bypass flag was missing so
Write and MCP calls were denied; each tool's own always-on text alone did not
make the model use it, so each arm now gets an equally forceful retrieval
instruction; and the Bash tool rebuilds PATH from the login profile, so the
`graphify` command was unresolvable until PATH was supplied through settings.

## Evidence

Receipts, transcripts, prompts, answers, diffs, reviews and the invalid pilots
are private under `~/.cache/z1p-delivery/20260922-graphify-comparison/`. The
committed `protocol.json`, `run.mjs` and `summarise.mjs` reproduce the run
against a private `local.json`. The v1 task pack in `../d5-20260921` was reused
unchanged; earlier D5 results are not pooled with this experiment.
