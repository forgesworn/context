# Rescore by reviewer dimension

Recorded on 22 September 2026, with no model calls. Each reviewer verdict in
v1, v2, S5 and v3 already lists a pass or fail per rubric dimension.
`rescore.mjs` counts dimensions instead of whole-task acceptance, which gives
about six observations per task instead of one.

```sh
node rescore.mjs v1=DIR v2=DIR s5=DIR v3=DIR
```

## Dimensions passed, by run and arm

| Run | plain | graphify | context |
| --- | ---: | ---: | ---: |
| v1 (Sonnet 5) | 38/48 (0.79) | 37/48 (0.77) | 35/42 (0.83) |
| v2 (Sonnet 5) | 33/42 (0.79) | 32/42 (0.76) | 36/42 (0.86) |
| S5 (DeepSeek V4 Pro) | 39/46 (0.85) | 40/48 (0.83) | 39/48 (0.81) |
| v3 (Sonnet 5, Context only) | | | 37/49 (0.76) |

## Per task, dimensions passed (`*` accepted)

| Task | v1 plain | v1 graphify | v1 context | v2 plain | v2 graphify | v2 context | S5 plain | S5 graphify | S5 context | v3 context |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| code-change-context | 5/5* | 3/5 | 5/5* | 5/5* | 5/5* | 5/5* | 5/5* | 5/5* | 5/5* | 5/5* |
| code-change-kithmoot | 11/11* | 11/11* | 5/5* | 5/5* | 5/5* | 5/5* | 9/9* | 11/11* | 11/11* | 11/11* |
| diagnosis-context | 1/5 | 4/5 | 5/5* | 5/5* | 2/5 | 5/5* | 5/5* | 5/5* | 3/5 | 0/5 |
| diagnosis-kithmoot | 5/5* | 4/5 | 5/5* | 4/5 | 5/5* | 5/5* | 4/5 | 4/5 | 4/5 | 4/5 |
| impact-context | 4/6 | 4/6 | 4/6 | 4/6 | 4/6 | 4/6 | 4/6 | 3/6 | 4/6 | 4/6 |
| impact-kithmoot | 3/6 | 3/6 | 5/6 | 3/6 | 2/6 | 3/6 | 5/6 | 5/6 | 5/6 | 4/6 |
| orientation-context | 5/5* | 3/5 | 2/5 | 3/5 | 4/5 | 5/5* | 3/5 | 3/5 | 2/5 | 4/6 |
| orientation-kithmoot | 4/5 | 5/5* | 4/5 | 4/5 | 5/5* | 4/5 | 4/5 | 4/5 | 5/5* | 5/5* |

## Reading

- **No arm separates at dimension level either.** Every arm passes 76 to 86
  percent of dimensions in every run. The largest gap between arms within a
  run (v2, 0.10) is no larger than the Context arm's own spread across runs
  (0.76 to 0.86), and v3 differed from v2 only by one added tool.
- **One task carries most of the churn.** diagnosis-context in the Context arm
  scored 5/5, 5/5, 3/5 and 0/5 across four runs; plain scored 1/5 then 5/5 on
  the same executor model. Whether that is executor or reviewer variance is not
  known from these data.
- **The reviewer does not use a stable dimension set.** Structured tasks
  mostly keep the rubric's ids, but v3 orientation-context reports six
  dimensions against five, and code-change tasks vary between 5, 9 and 11
  because the reviewer derives behaviour ids itself. Counts for code-change
  tasks are therefore not comparable across runs.
- **Impact never passes, and fails consistently.** impact-context is 4/6 in
  nine of ten cells; both impact tasks lose the same author-design dimensions
  in every arm.

## Consequences

A comparison that reports only whole-task acceptance on these eight tasks
cannot detect a tool effect, and dimension counts do not rescue it. Before any
new executor run, the reviewer's own agreement needs measuring (the same
answers reviewed several times, with a fixed dimension list per task), so that
executor variance and reviewer variance can be told apart.
