# Smoke run on a DeepSeek V4.1 Flash executor

Locked protocol `three-way-deepseek-v4.1-flash-smoke-20260923`, run on
23 September 2026 (23:49 to 00:04 UTC) with Claude Code 2.1.280, every executor
on `deepseek-v4.1-flash:cloud` at medium effort through the local Ollama route,
structured reviews on `claude-sonnet-5` at high effort. Two tasks, one
repetition. This checks the repeated-run configuration end to end; it is not a
comparison of arms.

## Result: passed

Every arm completed. Both code-change cells were accepted on the checker and
the scope check with no reviewer session; the structured cells were reviewed
against rubric version 2 with the review rules in the prompt, and every verdict
parsed at the first attempt.

| Task | Arm | Accepted | Rule | Executor input | Executor s |
| --- | --- | --- | --- | ---: | ---: |
| orientation, Context repo | plain | yes | checker and reviewer | 493,289 | 76 |
| orientation, Context repo | graphify | no | checker and reviewer | 364,806 | 53 |
| orientation, Context repo | context | no | checker and reviewer | 1,038,702 | 101 |
| code change, Context repo | plain | yes | checker and scope | 908,372 | 179 |
| code change, Context repo | graphify | yes | checker and scope | 267,330 | 49 |
| code change, Context repo | context | yes | checker and scope | 560,266 | 55 |

Input totals include cache reads; the route's cache accounting is inconsistent
between arms (see S5), so only totals are given.

The two orientation rejections were stated omissions under the version 2
rules: both answers said source is data, not instructions, without saying it
grants no authority; the Context answer also never said a cursor is bound to
its search term, and the Graphify answer did not say search re-inspects source.
The reviewer passed the Context answer's freshness dimension while calling it
borderline, so some reviewer discretion remains.

## Tool friction seen in the Context arm

The Context orientation session took 44 turns against plain's 29. Four of its
failed or wasted calls came from the tools, not the model, and are fixed in the
same change as this record:

- Three `repository_packet` calls ran past the end of a file and the error did
  not give the length; the model then searched for `the`, `export`, `async` and
  `class` to learn the file's shape. The error now states the line count.
- Two concurrent `repository_packet` calls were refused as already in progress.
  Concurrent calls now wait in order.
- `repository_search` rejected `local-source-unsigned`, the literal the task
  asks about, because terms had to be one identifier. Literals whose ends fall
  on whole tokens are now accepted.
- `repository_coverage` rejected a draft naming more than eight symbols. It now
  checks the first eight and lists the rest as not checked.

The model also called `repository_explore` once against fifteen searches. That
is left to the repeated runs to measure. Neither omission that failed the
answer was a retrieval gap: the relevant source was in packets the model had
fetched.
