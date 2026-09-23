# Context 0.4.0 cost screen on a DeepSeek V4 Pro executor

Locked protocol `context-040-screen-deepseek-v4-pro-20260923` (locked
2026-09-23T06:26:15Z), run 06:27 to 08:24 UTC on 23 September 2026 with
Claude Code 2.1.280. The Context arm alone ran the 0.4.0 release build
(tag v0.4.0, e581a40, dist digests in `protocol.json`) on the eight locked
tasks, three repetitions: 24 cells, all completed, no provider failure, no
retry. The plain and Graphify comparators are the recorded cells of
`../repeated-pro-20260923/`. Structured answers were not reviewed; code tasks
were accepted by checker and scope. `summarise.mjs`, committed before the
first cell, applies the decision rule.

## Result: the screen does not pass

| Against | Geometric mean input ratio, 0.4.0 / comparator | 90% interval | Screen |
| --- | ---: | --- | --- |
| plain | 1.086 | 0.831 to 1.271 | does not pass |
| graphify | 1.219 | 1.007 to 1.536 | does not pass |
| earlier Context (reported only) | 0.929 | 0.831 to 1.237 | - |

The rule needed at most 0.8 with the interval's upper end below 1. On this
executor and task set, 0.4.0 is not cheaper than plain or Graphify. Against the
earlier Context cells it is slightly lower in the point estimate, with an
interval that includes no change.

## Per task

| Task | 0.4.0 median input | Earlier Context | Plain | Graphify | 0.4.0 median turns | Earlier Context turns | 0.4.0 tool errors | Code accepted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| orientation-context | 380,269 | 250,133 | 395,186 | 144,836 | 22 | 19 | 3 / 62 | not reviewed |
| orientation-kithmoot | 303,587 | 329,316 | 502,732 | 316,911 | 22 | 24 | 1 / 62 | not reviewed |
| diagnosis-context | 4,380,206 | 2,509,745 | 1,434,506 | 2,332,533 | 74 | 43 | 5 / 215 | not reviewed |
| diagnosis-kithmoot | 201,232 | 204,273 | 236,355 | 228,206 | 15 | 18 | 0 / 45 | not reviewed |
| impact-context | 279,439 | 277,023 | 366,147 | 412,812 | 19 | 23 | 1 / 55 | not reviewed |
| impact-kithmoot | 137,355 | 185,361 | 174,419 | 116,087 | 16 | 20 | 0 / 44 | not reviewed |
| code-change-context | 480,117 | 1,535,828 | 407,972 | 437,707 | 22 | 42 | 2 / 64 | 3 of 3 |
| code-change-kithmoot | 333,332 | 339,157 | 184,583 | 250,162 | 24 | 26 | 1 / 72 | 3 of 3 |

Executor input across all 24 cells was 19,911,272 (earlier Context arm:
15,198,553). Input totals include cache reads; the route's cache accounting is
inconsistent, so only totals are compared. Credit consumption was not read.

## What changed and what did not

- Tool errors fell from 29 of 578 tool results in the earlier Context arm to
  13 of 619.
- Median turns fell on six of eight tasks. code-change-context fell from 42 to
  22 turns and from 1.54M to 0.48M median input, and all six code cells were
  accepted.
- diagnosis-context rose to 4.90M, 4.20M and 4.38M input (80, 70 and 74
  turns; the first hit the 80-turn cap and still returned success). Those
  sessions used the navigation tools (10 to 14 packets, up to 6 explores) and
  then read files directly as well (up to 24 `Read` calls), so the tools added
  turns rather than replacing reads. This task alone accounts for 13.5M of the
  19.9M total and keeps the ratio against plain above 1.
- The KithMoot tasks, which do not ask about Context's own code, were at or
  below the earlier Context arm on every task, but still above plain on the
  code-change task.

## Limits

Structured answers were not reviewed, so acceptance is unknown for six tasks.
Comparator cells come from an earlier run on the same day. The fixes were found
on this task set. A pass would only have justified a held-out comparison; the
failure means 0.4.0 shows no measured cost benefit on this executor.
