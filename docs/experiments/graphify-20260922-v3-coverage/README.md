# Context coverage check, single-arm screen (v3)

Locked design of [v2](../graphify-20260922-v2/README.md) with one change to
the Context arm: the `repository_coverage` tool, a deterministic pre-submit
check that lists the files `repository_explore` surfaces for the task's
identifiers which a draft answer does not cite. The server instructions, the
project instruction in `context-instructions.txt` and the Context retrieval
instruction each gain one sentence naming it. Tasks, `claude-sonnet-5` executors
at medium effort, reviewers at high effort, client 2.1.280, caps, checker and
acceptance are unchanged.

Only the Context arm runs. The comparators are the recorded v2 figures on the
same eight tasks; this is a screen for whether a full three-way run is worth
its cost, not the savings decision rule. One repetition cannot separate a
one-task change from reviewer or model variance.

```sh
node docs/experiments/graphify-20260922/run.mjs --local /private/local-v3.json --protocol docs/experiments/graphify-20260922-v3-coverage --all --arms context
```

Results are not pooled with v1, v2 or S5.
