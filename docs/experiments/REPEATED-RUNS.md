# Repeated-run protocol (design, not yet run)

v3 showed that one run per task cannot separate a tool change from run-to-run
variance: the Context arm's input tripled against v2, including on a task where
the changed tool was never called. Every later comparison uses this design.

## Shape

- **Repetitions.** Three independent runs of every task in every arm, each in
  a fresh workspace, session and server. Arm order rotates per repetition as
  well as per task.
- **Tasks.** The eight locked tasks plus at least four held-out tasks
  (orientation, diagnosis, impact, code change), whose rubrics are written and
  hashed by a separate session. Nobody who designs tools, instructions or
  questions reads the held-out rubrics before results are recorded. Results
  are reported for the two sets separately.
- **Executor.** One model per run, recorded with effort and client version.
  The next run uses `claude-opus-5-5`, with the reviewer unchanged
  (`claude-sonnet-5`, high) so verdicts stay comparable with earlier runs.
- **Code-change acceptance.** Checker plus the deterministic scope check
  (`"codeAcceptance": "checker-and-scope"`, see `code-acceptance-20260923/`);
  the model reviewer judges structured answers only.
- **Arms.** Plain tools, Graphify, and Context at its current build, which
  includes `repository_explore` and `repository_coverage` with the exact-quote
  check. A category checklist in the instructions, if tested, is a fourth arm
  rather than a change to the Context arm.

## Reporting

Per task and arm: accepted count out of three, median and range of executor
input, output and seconds. Per arm: tasks accepted in at least two of three
repetitions, the sum of per-task medians of input, and input per accepted
repetition. Runs are never pooled with v1, v2, S5 or v3.

## Decision rule

Context is better only if, on both the locked and held-out sets, it accepts at
least as many tasks (two of three repetitions) as each comparator, and its sum
of per-task median input is at least 20 percent lower than each comparator's,
with no higher median reviewer time. A difference in acceptance of one task is
reported as inconclusive.

## Cost

About three times a single three-way run per model. For scale: v2 used 12.0M
executor input across three arms and eight tasks on Sonnet 5, so this design
is of the order of 50M executor input tokens with twelve tasks, before
reviewer usage. It is not run without explicit approval of the model and
scope.
