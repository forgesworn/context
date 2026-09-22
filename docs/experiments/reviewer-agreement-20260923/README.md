# Reviewer agreement probe (design, not yet run)

The dimension rescore found that no arm separates and that one task's verdicts
swing between runs, without being able to say whether the executor or the
reviewer moved. This probe holds the answers fixed and re-reviews each of the
80 recorded answers (v1, v2, S5, v3) three times under two conditions:

- **replay**: the recorded reviewer prompt, byte for byte, with the recorded
  schema;
- **fixed**: the same prompt plus an explicit dimension list, enforced by the
  schema, so every review reports the same dimension ids.

No executor runs. Design, measures, decision rule and cost basis are in
`protocol.json`, which is locked (`lockedAt`) before the first model call.

```sh
node docs/experiments/reviewer-agreement-20260923/agree.mjs \
  --evidence v1=/private/v1 --evidence v2=/private/v2 \
  --evidence s5=/private/s5 --evidence v3=/private/v3 \
  --out /private/reviewer-agreement --estimate
```

Drop `--estimate` to run, add `--conditions replay` for the cheaper half, and
use `--summarise` to rebuild the report from finished reviews. Finished
reviews are never repeated, so an interrupted run resumes where it stopped. A
provider or quota failure stops the probe without retry.

## Cost estimate

From the 80 recorded reviews (client-reported, Sonnet 5, high effort), with
`--estimate` reproducing these figures:

| Scope | Reviews | Client-reported cost | Input (uncached) | Output | Review time |
|-------|--------:|---------------------:|-----------------:|-------:|------------:|
| replay and fixed, 3 repeats | 480 | about $65 | 13.8M (7.6M) | 3.3M | 8.9 h serial, about 3 h at concurrency 3 |
| replay only, 3 repeats | 240 | about $32 | 6.9M (3.8M) | 1.7M | 4.5 h serial, about 1.5 h |

The client's cost is an API-price estimate; on a subscription the reviews draw
on the Sonnet weekly quota instead. The pipeline was exercised end to end
against a stub reviewer (no model calls) before this was committed.

Results, when present, are in `RESULTS.md`. `../reviewer-evidence-20260923/RESULTS.md` already shows, without model calls, that at least three of the five v1 to v2 flips on unchanged arms came from the reviewer.
