# Token-reduction benchmark

Run `npm run benchmark:tokens` to compare bounded Context retrieval with the
naive alternative of sending this repository's complete TypeScript and Markdown
corpus for every question. `npm run benchmark:tokens:check` also enforces full
required-source recall and a conservative 10x regression floor.

The benchmark counts the exact compact JSON strings with the offline
`o200k_base` tokenizer. Each fixed question declares the source files required
to answer it; reducing tokens by omitting required evidence fails the check.
Results are deterministic apart from intentional corpus changes and require no
model, API key or network access after dependencies are installed.

The fixture enters at the already-authorised `ContextView` boundary with fixed
record IDs, authors and event IDs. Signature and grant verification are tested
elsewhere; excluding fresh signatures prevents random signature bytes from
changing tokenizer merges between benchmark runs.

Run `npm run benchmark:tokens:parity` for the distinct source-navigation gate.
It compares the full raw TypeScript corpus with exact compact JSON returned from
the deterministic source graph, requiring every predeclared source to be found.
This measures the cost of knowing where to look, not the cost of reading enough
source to answer a question. The raw-evidence benchmark above remains the answer
evidence regression gate and the two results must not be combined.

Graphify publishes a 71.5x result (about 123k naive tokens versus 1.7k per query)
for its own 52-file mixed corpus. We record 71.5x as the parity target, but do
not call results directly comparable: Graphify does not publish its tokenizer,
full query set or evidence-recall protocol, and these benchmarks use a different
corpus. Reaching the number demonstrates measured navigation compression parity,
not reproduction of Graphify's result or sufficient evidence to answer.
