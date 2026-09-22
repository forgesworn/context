# D5 locked paired-task protocol

This directory defines experiment `d5-context-kithmoot-20260921-v1`. It compares
efficient `rg` plus exact file reads with the local Context navigation tools on
eight paired tasks. The [first pair](FIRST-PAIR.md) has now run and both answers were rejected;
accounting remains incomplete. This is not evidence of a cost saving.

Protocol design and final acceptance review used Sol/high. Bounded routine
harness work used Terra/medium because the shared M4 worker was occupied by an
authorised Heartwood job; no Ollama job was dispatched or interrupted. No D5
executor or reviewer inference arm ran during protocol preparation.

The source inputs are immutable Git archives:

| Repository | Revision | Git archive SHA-256 | Qualification |
| --- | --- | --- | --- |
| Context | `496bfca9ef1b6a0d5befe0e4dca3ff7b7258a13c` | `6e93afe49b6124f65f11afc848bf9c79c0e1eebd83457af27547c19de13657f3` | D0-D2 and fresh D3 enabled/disabled client evidence in `docs/DOGFOOD-EXECUTION.md`; private D3 receipts `20260921-d3-client-w6qs0oay` |
| KithMoot | `35fbdbed3d70a574499e84ba6b08817222110df3` | `3c0f1dd0637c6f0a53a187e05808ff407dec72d60acf92b70aa8bafe7377a24d` | D3 scoped-root source task and fresh enabled/disabled client evidence in `docs/DOGFOOD-EXECUTION.md`; private D3 receipts `20260921-d3-client-w6qs0oay` |

Each arm is prepared from `git archive`, receives the same checked-in selection
policy and, for diagnosis tasks, the same seeded fault. Never point an arm at a
live checkout. The preparer refuses an existing output directory. Keep baseline
and assisted sessions, working directories, indexes and transcripts separate.

The executor is `gpt-5.6-luna` at medium effort in a fresh Codex session. Luna
is the qualified small Codex lane and can operate both retrieval modes directly.
The independent acceptance reviewer is `gpt-5.6-sol` at high effort and receives
the answer or diff, task definition, deterministic acceptance evidence and only
the bounded cited frozen source or trusted tests needed to apply the rubric.
Those reviewer reads and usage are charged to the arm. It must not receive the other arm's work. This measures retrieval, not model
routing; neither role changes within a pair.

Only the retrieval tools differ. The baseline may use bounded `rg` and exact
file reads inside the archive; it must not use Context. The assisted
arm starts with `repository_status`, refreshes when unavailable, stale or
unknown, then uses bounded `repository_search` and exact reads of returned
source. Both may use the same editor, compiler and tests; the trusted harness
applies the same deterministic checker after each executor session ends.
Source discovery and discretionary reads in both arms are confined to that
task's `selectionPolicy`; deterministic builds and tests may execute against the
whole frozen snapshot but do not broaden model-visible source. Exact source
supplied to either model must come from the declared selection.
Network search, memory, sibling repositories and the protocol's acceptance or
reference directories are unavailable to both arms.

Run the lock verifier with Node 24:

```sh
node docs/experiments/d5-20260921/verify.mjs \
  --context-root /path/to/context --kithmoot-root /path/to/kithmoot
```

Prepare one private arm directory:

```sh
node docs/experiments/d5-20260921/prepare-arm.mjs \
  --pair diagnosis-context --arm baseline \
  --source-root /path/to/context --output /absolute/private/arm-directory
```

For structured tasks, save the response as `answer.json` using the schema in
the task file, then run the trusted checker outside the executor session:

```sh
node docs/experiments/d5-20260921/accept.mjs \
  --pair orientation-context --workspace /absolute/private/arm-directory \
  --answer /absolute/private/arm-directory/answer.json
```

The executor cannot invoke or read the checker, acceptance definitions or
reference repairs. For code tasks omit `--answer`. Install dependencies independently in each arm
before the timed task or include installation in both timed arms under the same
declared cache state. The checker runs focused existing tests and external
behaviour checks. Reference patches exist only to prove the checkers before the
lock; do not expose this experiment directory to executor sessions.

Copy the wrapped `protocol.json` document to private storage and append receipts
there; do not nest it inside the draft template. Record every host and reviewer attempt, including
failed drafts, as well as tool calls, source reads, scan/refresh time, elapsed
time and review time. Provider billing is not established here. Unknown token or
cost fields remain `null`; token counters and subscription headroom are not cash
evidence. D5 stays open until all sixteen arms have complete accepted receipts
and the report's quality, attributed-variable-cost and review-time rules pass.
