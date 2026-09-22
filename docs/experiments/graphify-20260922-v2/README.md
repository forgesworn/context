# Three-way comparison, second run (v2)

Same locked design as [the first run](../graphify-20260922/README.md): eight
frozen tasks from the v1 pack, three arms (plain tools, Graphify 0.9.65,
Context), headless Claude Code with `claude-sonnet-5` executors at medium
effort and reviewers at high effort, rotated arm order, deterministic checker
plus blind reviewer, one repetition per task.

Only the Context arm changes. It runs the source build that adds
`repository_explore`, compact text rendering for search and packet responses,
`pathPrefix` on search, rewritten server instructions and the rewritten
project instruction snippet in `context-instructions.txt`. The build is
identified in `protocol.json` by commit and dist digests. The retrieval
instruction for the Context arm names explore first; the plain and Graphify
instructions are unchanged.

Run with the shared harness:

```sh
node docs/experiments/graphify-20260922/run.mjs --local /private/local-v2.json --protocol docs/experiments/graphify-20260922-v2 --all
node docs/experiments/graphify-20260922/summarise.mjs --evidence /private/evidence-v2 --out docs/experiments/graphify-20260922-v2/RESULTS.md
```

Results are not pooled with v1. The decision rule in
[the savings plan](../../SAVINGS-PLAN.md) applies unchanged.
