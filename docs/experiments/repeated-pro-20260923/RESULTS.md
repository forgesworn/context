# Repeated three-way run on a DeepSeek V4 Pro executor

Locked protocol `repeated-three-way-deepseek-v4-pro-20260923` (attempt 3, locked
2026-09-23T00:39:45Z), run 00:40 to 05:56 UTC on 23 September 2026 with
Claude Code 2.1.280. Every executor ran `deepseek-v4-pro:cloud` at medium
effort through the local Ollama route; structured answers were reviewed by
`claude-sonnet-5` at high effort against rubric version 3; code tasks were
accepted by checker and scope. Eight locked tasks, three arms, three
repetitions with rotated arm order: 72 cells, all completed, no provider
failure, no retry. `summarise.mjs`, committed before the first result, applies
the decision rule.

## Result: the decision rule is not met

| Comparator | Geometric mean input ratio, Context / comparator | 90% interval | Context-repo tasks | KithMoot tasks | Tasks accepted, Context vs comparator |
| --- | ---: | --- | ---: | ---: | --- |
| plain | 1.169 | 0.793 to 1.355 | 1.333 | 1.025 | 3 vs 5 |
| graphify | 1.313 | 0.935 to 1.639 | 1.446 | 1.191 | 3 vs 5 |

A ratio above 1 means Context used more executor input. The rule needed at
most 0.8 with the interval below 1, and no fewer accepted tasks; both parts
fail against both comparators. On this executor and task set, Context was
neither cheaper nor more often accepted.

| Arm | Executor input, all 24 cells | Output | Median turns | Accepted cells | Executor minutes |
| --- | ---: | ---: | ---: | ---: | ---: |
| plain | 15,694,617 | 628,448 | 17.5 | 15 of 24 | 93 |
| graphify | 12,823,047 | 419,252 | 17.5 | 13 of 24 | 70 |
| context | 15,198,553 | 726,119 | 22.0 | 11 of 24 | 94 |

Input totals include cache reads; the route's cache accounting is
inconsistent, so only totals are compared. Credit consumption was not read.

## Per task

| Task | Arm | Accepted | Median input | Input range | Median tool bytes | Tool errors | Median turns |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: |
| orientation-context | plain | 1 of 3 | 395,186 | 323,744 to 445,020 | 116,640 | 0 / 47 | 18 |
| orientation-context | graphify | 0 of 3 | 144,836 | 124,716 to 288,798 | 111,471 | 2 / 31 | 9 |
| orientation-context | context | 1 of 3 | 250,133 | 248,043 to 345,592 | 87,023 | 6 / 55 | 19 |
| orientation-kithmoot | plain | 1 of 3 | 502,732 | 478,081 to 622,940 | 107,982 | 0 / 77 | 25 |
| orientation-kithmoot | graphify | 0 of 3 | 316,911 | 262,293 to 324,383 | 94,660 | 1 / 60 | 22 |
| orientation-kithmoot | context | 0 of 3 | 329,316 | 328,618 to 353,720 | 107,651 | 3 / 64 | 24 |
| diagnosis-context | plain | 0 of 3 | 1,434,506 | 1,216,138 to 5,941,060 | 122,225 | 5 / 131 | 28 |
| diagnosis-context | graphify | 0 of 3 | 2,332,533 | 501,826 to 4,067,275 | 143,528 | 1 / 131 | 49 |
| diagnosis-context | context | 0 of 3 | 2,509,745 | 1,596,367 to 2,644,144 | 159,385 | 7 / 122 | 43 |
| diagnosis-kithmoot | plain | 3 of 3 | 236,355 | 192,110 to 367,797 | 57,582 | 0 / 46 | 16 |
| diagnosis-kithmoot | graphify | 3 of 3 | 228,206 | 214,408 to 351,316 | 95,634 | 0 / 45 | 15 |
| diagnosis-kithmoot | context | 3 of 3 | 204,273 | 192,691 to 277,170 | 47,799 | 2 / 51 | 18 |
| impact-context | plain | 2 of 3 | 366,147 | 308,469 to 408,217 | 149,565 | 0 / 50 | 17 |
| impact-context | graphify | 2 of 3 | 412,812 | 294,386 to 415,340 | 78,443 | 2 / 65 | 23 |
| impact-context | context | 1 of 3 | 277,023 | 208,943 to 344,248 | 75,886 | 0 / 60 | 23 |
| impact-kithmoot | plain | 2 of 3 | 174,419 | 92,415 to 177,550 | 68,637 | 1 / 40 | 13 |
| impact-kithmoot | graphify | 2 of 3 | 116,087 | 104,861 to 156,080 | 73,923 | 0 / 29 | 10 |
| impact-kithmoot | context | 0 of 3 | 185,361 | 170,463 to 239,603 | 32,897 | 2 / 54 | 20 |
| code-change-context | plain | 3 of 3 | 407,972 | 213,401 to 756,290 | 112,931 | 0 / 52 | 17 |
| code-change-context | graphify | 3 of 3 | 437,707 | 407,044 to 437,962 | 105,063 | 0 / 53 | 16 |
| code-change-context | context | 3 of 3 | 1,535,828 | 249,795 to 1,783,696 | 100,576 | 3 / 100 | 42 |
| code-change-kithmoot | plain | 3 of 3 | 184,583 | 147,967 to 301,518 | 43,215 | 2 / 45 | 16 |
| code-change-kithmoot | graphify | 3 of 3 | 250,162 | 234,101 to 399,004 | 76,832 | 2 / 51 | 15 |
| code-change-kithmoot | context | 3 of 3 | 339,157 | 241,678 to 342,946 | 32,649 | 6 / 72 | 26 |

## What drives the result

- **Turns, not bytes.** Context returned fewer tool-result bytes than plain in
  seven of eight tasks, but took more turns in seven. Each turn resends the
  conversation, so input follows turns. The Context arm averaged 24 tool calls
  per session against about 20; its documented workflow alone adds about 3.4
  (status, refresh and coverage), before explore (3.8) and packets (6.2).
- **One task is noisy.** code-change-context Context sessions took 42, 46 and
  15 turns (1.54M, 1.78M and 0.25M input). Two long sessions account for most
  of that task's ratio.
- **Remaining tool errors** (29 in 578 Context tool results, against about
  one in five on S5): 13 packets gave only a `path`, meaning "the whole file";
  4 overlapping ranges; 2 over the 64 KiB response cap; 2 stale after the
  model's own edit; the rest in Bash (counts by message are approximate).
- **Acceptance is set by synthesis.** Most rejections in every arm are single
  rubric points: for example, in the first repetition, all three diagnosis-context arms named the right
  repair but not "return unknown when re-inspection fails", and all three
  orientation-kithmoot arms missed the same `verifyDelegation` ordering point.
  The retrieval analysis (`../retrieval-recall-20260923/`) found the required
  evidence was usually retrieved in every arm.

## What this does and does not show

It shows that on this locked set, with DeepSeek V4 Pro through Claude Code,
Context 0.4.0-pre did not reduce executor input and was accepted less often
than either comparator. It does not measure a Claude executor, held-out tasks,
repositories outside this ecosystem, provider credit consumption or developer
time, and one repetition set of 72 cells cannot rule out effects smaller than
the spread shown above. No saving is claimed.
