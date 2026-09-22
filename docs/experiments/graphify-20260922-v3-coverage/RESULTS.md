# Results v3: Context with repository_coverage, single-arm screen

Locked protocol `context-coverage-single-arm-20260922-v3`, run on 22 September
2026 (21:08 to 21:48 UTC). Context arm only, `claude-sonnet-5` executors at
medium effort, reviewers at high effort, client 2.1.280, the eight v2 tasks.
Comparators are the recorded [v2 results](../graphify-20260922-v2/RESULTS.md).

**The screen failed.** Context accepted three of eight against five in v2, and
used 10.58M executor input against 3.62M. The pre-set rule (more than five
accepted without higher input per accepted task) is not met, so no three-way
run follows from this result.

| Task | v2 Context | v3 Context | v3 input | v2 input | Why v3 was rejected |
| --- | --- | --- | ---: | ---: | --- |
| orientation, Context repo | yes | no | 874,368 | 297,842 | checker: a Markdown token quoted with a space where the file wraps the line |
| orientation, KithMoot | no | yes | 1,064,095 | 533,795 | |
| diagnosis, Context repo | yes | no | 4,008,994 | 772,840 | checker: two Markdown tokens quoted across wrapped lines |
| diagnosis, KithMoot | yes | no | 746,331 | 563,125 | reviewer: regression test lacks the unsafe cast needed once the type fix applies |
| impact, Context repo | no | no | 960,024 | 482,298 | reviewer: unchanged semantics and two of five test focuses omitted (same dimensions as v2) |
| impact, KithMoot | no | no | 399,903 | 229,569 | reviewer: new edge-case tests and retention of the guard test not stated |
| code change, Context repo | yes | yes | 2,021,738 | 348,129 | |
| code change, KithMoot | yes | yes | 506,980 | 391,475 | |

| Run | Accepted | Tool calls | Input total | Output | Executor s | Reviewer s | Input per accepted task |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v2 Context | 5 of 8 | 128 | 3,619,073 | 49,179 | 573 | 558 | 723,815 |
| v3 Context | 3 of 8 | 228 | 10,582,433 | 164,490 | 1,791 | 549 | 3,527,478 |

## What the coverage tool did

- It was called ten times across seven tasks; its responses were small.
- On impact-KithMoot it had the intended effect on citation: the answer cites
  `test/log-redaction-scan.test.ts` for the first time in any run, and the
  privacy dimension passed where v2 failed. The guard dimension still failed
  because the answer did not state that the test must be retained. Mention is
  not reasoning.
- On impact-Context the executor passed qualified symbols
  (`RepositoryNavigation.search` and types), so explore reached three files
  and never the MCP test file that a replay with `search` flags. The tool can
  only report files its symbols reach.
- None of the five rejections is attributable to the tool: two are the
  executor quoting wrapped Markdown lines inexactly after reading the file
  directly, three are synthesis gaps (invariants that must hold, new test
  cases to add) that a file-mention check cannot supply.

## Variance dominates

Executor behaviour differed from v2 well beyond the coverage change: 44 Bash
and 31 Read calls against 15 and 9, and 2.9 times the input. The
code change, Context repo task, where no coverage call was made, used 2.02M
against 0.35M. With one repetition per task, run-to-run variance in this
client and model is larger than the effect being screened, and the same
caution applies to the v2 margins. Any further comparison needs repeated runs
per task and should report spread, not single figures.

## Follow-ups this run suggests

- An exact-token check before submission (does each cited token occur
  verbatim in its file?) would have caught both checker failures
  deterministically; it is cheaper and more direct than coverage.
- The remaining impact failures are about stating what must stay unchanged and
  which new cases to test, the category question set (idea 2), not file
  mention.
- Coverage should widen qualified symbols to their bare member as well, so
  `Owner.member` also reaches callers and tests that use the member name.

Private evidence: `~/.cache/z1p-delivery/20260922-context-coverage-v3/`.
Not pooled with v1, v2 or S5.
