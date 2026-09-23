# Structured rubrics, version 3

Version 2 made each rubric point explicit, which exposed a second fault: some
required points were never asked for by the task prompt. In the first
repetition of the Pro run (`../repeated-pro-20260923/`) all three arms were
rejected on orientation-context, mostly for the same omissions: none said a
cursor is bound to its search term, when the prompt asks only "how continuation
state is bounded", and two did not say retrieved source grants no authority,
when the prompt asks only "which evidence remains unsigned". When every arm
misses a point the prompt did not request, the task measures guessing the
author's rubric, not retrieval, and cannot separate the arms.

Version 3 keeps the prompts, dimension ids, required evidence, review rules and
checker, and limits each required point to what the prompt asks for. A point
the prompt does not ask for is marked "not required"; an answer that states it
wrongly can still fail through the source-contradiction rule. `node build.mjs`
writes `acceptance/*.json` with `version: 3` and refuses to build if any id
differs from version 1.

## Changes (7 of 30 dimensions)

| Task / dimension | Version 2 required | Version 3 required | Why |
| --- | --- | --- | --- |
| orientation-context / freshness | search re-inspects source and policy | search re-checks the policy before returning results or consuming a cursor | the prompt asks when search is blocked; source freshness labels results but never blocks |
| orientation-context / continuation | term and generation binding plus three bounds | the three bounds: single use, five minutes, 128 live | the prompt asks how continuation state is bounded |
| orientation-context / trust | unsigned marker, and data not instructions granting no authority | the unsigned marker, distinct from signed records | the prompt asks which evidence remains unsigned |
| diagnosis-kithmoot / regression | the unsafe cast must be named | a hostile verifier in the caller options, shown not to be used | the cast is an implementation detail of the test the prompt asks for |
| impact-context / response | eight response properties named unchanged | only: no existing field changes meaning | the prompt does not ask about response fields |
| impact-context / coverage | five named test cases | default unchanged, exact-case filtering, cross-mode cursor rejection | the three behaviours the prompt names |
| impact-kithmoot / tests | all six invalid-input classes named | valid input and at least three invalid classes | the prompt asks for tests, not a fixed list |

orientation-kithmoot and diagnosis-context are unchanged: every required point
answers something their prompts ask.

## What this does not show

Whether version 3 separates the arms is what the repeated run measures. It may
make some tasks easy enough that every arm passes, which would also leave them
unable to discriminate; the per-task results will show that. Version 3 verdicts
are not comparable with version 1 or 2 verdicts.
