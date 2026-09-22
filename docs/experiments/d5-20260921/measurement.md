# D5 measurement definition

Version 1, locked with experiment `d5-context-kithmoot-20260921-v1`.

Preparation executable SHA-256: `2395768c4fd854f62674e0b5a707e9f16d7177ef2cc44d53becd1336d56d1c9e`.

Common preregistration, immutable archive creation and identical dependency
provisioning may happen before either arm and are excluded from both arms. The
timed arm starts before any arm-specific retrieval, packet or prompt assembly.
It includes assisted scan/refresh or baseline discovery, then the fresh executor
session. It ends when the arm has produced its final answer or diff, the
deterministic acceptance checker has finished, the independent reviewer has
returned a terminal decision, and all usage and evidence have been saved. Count
setup or dependency installation whenever it is arm-specific or occurs after
that start; use the same boundary for both arms of a pair.

Use one new Codex session, one newly prepared source directory and, for the
assisted arm, one new Context server/index per arm. No session, index, answer,
diff, test result or source excerpt may be reused across arms. Execute pairs in
the order declared in `protocol.json`; finish both arms of a pair before starting
the next pair. Do not show either arm the other arm's result.

Prepend exactly one retrieval instruction to the unchanged task prompt:

- Baseline: `Use only bounded rg and exact file reads for source discovery,
  confined to the task selectionPolicy. Do not call Context repository tools.`
- Assisted: `Start with repository_status on this explicit arm root. If its
  state is unavailable, stale or unknown, call repository_refresh. Use bounded
  repository_search for source discovery, then exact reads only for returned
  source within the task selectionPolicy.`

Both wrappers continue: `Do not use network search, memory, sibling repositories,
another arm, or any D5 acceptance/reference file. You may run the same compiler
and tests. The trusted harness checks the final output after this session.` The
task's `.d5-task.json` supplies the prompt and public output schema. No other
source hints or task-specific context may be supplied.

Declare cache state before the start. `cold` means no executor prompt cache, no
repository index and no dependency/build output in the arm. `warm` must name
exactly what is shared, such as the npm download cache; source trees, build
outputs, Context indexes and model conversations still remain separate. If the
state cannot be established, record `unknown`, which leaves the report
incomplete. Record any accidental exposure to another arm or to the acceptance
answer/reference files as contamination; do not replace the run silently.

Count every executor and reviewer model attempt, retry, refusal, cancellation
and repair. Record provider-reported input, cached-input, output and reasoning
output fields without adding subset fields twice. Record deterministic host
preparation, retrieval, editing, tests, checker execution, evidence capture and
review coordination as tool calls/source reads and in whole-arm elapsed time.
Record human or model review duration as `reviewSeconds`; do not infer it from
model token usage.

Variable inference cost qualifies only with arm-attributable billing evidence,
or an explicit zero-provider-charge basis for a truly local inference attempt.
Dated rate estimates, fixed subscriptions and token allowance changes remain
separate and cannot close the monetary gate. Convert an attributed non-GBP
charge using a dated source retained with the private receipt. Missing evidence
is `null`, never zero.

The deterministic checker and Sol/high reviewer apply the same acceptance file
to both arms. A task is accepted only when every check passes and the reviewer
finds no material correctness, security or scope regression. Failed attempts
remain in the numerator. The decision rule is all eight assisted tasks accepted
to the same standard, at least 20% lower aggregate attributable variable
inference cost per accepted task, and no increase in aggregate review time.
Report every pair, unsuccessful attempt and total elapsed time. Eight pairs are
an operational pilot, not a general performance claim.
