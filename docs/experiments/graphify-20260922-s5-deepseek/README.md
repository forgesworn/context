# Three-way comparison on a cheaper executor (S5, DeepSeek V4 Pro)

The routing measurement from [the savings plan](../../SAVINGS-PLAN.md): the
[v2 protocol](../graphify-20260922-v2/README.md) rerun with every executor on
`deepseek-v4-pro:cloud`, routed by Claude Code's base URL through the local
Ollama daemon to Ollama Cloud, and the reviewers unchanged on `claude-sonnet-5`
at high effort. Tasks, arms, retrieval instructions, Context build, arm orders,
checker and acceptance are identical to v2, so the only variable is the
executor model.

A smoke test on 22 September 2026 confirmed the route: Claude Code 2.1.280 ran
Bash, connected the Context MCP server, called `repository_refresh` and
`repository_explore` and answered correctly through the Anthropic-compatible
endpoint of Ollama 0.34.2. The client's cost estimate is meaningless for this
model and no budget cap is applied; usage counters are recorded and credit
consumption is read from the Ollama account.

```sh
node docs/experiments/graphify-20260922/run.mjs --local /private/local-s5.json --protocol docs/experiments/graphify-20260922-s5-deepseek --all
node docs/experiments/graphify-20260922/summarise.mjs --evidence /private/evidence-s5 --out docs/experiments/graphify-20260922-s5-deepseek/RESULTS.md
```

Results are not pooled with v1 or v2. The comparison of interest is the
acceptance rate and input per accepted task of each arm on the cheaper
executor, and whether Context's margin over plain tools widens when the
executor is weaker. The run completed the same day: see
[RESULTS.md](RESULTS.md).
