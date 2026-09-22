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

## Raw-evidence benchmark v2: growing corpora

The original v1 runner rejected a corpus above 128 chunks because it used one
synthetic signed-collection view. The repository grew to 136 chunks while adding
the installation doctor. V2 retains the complete original file selection,
3,600-character chunks, fixed questions and required sources. It partitions the
ordered records into consecutive collections of at most 128 records, within the
existing maximum of 32 collections. Nothing is dropped, and partitioning does
not depend on the query or expected answer. Larger corpora still fail explicitly.
Production signed-collection limits and authorisation are unchanged.

For every question, v2 calls the existing `retrieveView` once for **every**
collection, each with the original 8,192-byte, four-record response limits and
related expansion disabled. Token and byte totals sum each complete response,
including empty responses, metadata and duplicate evidence. Required-source
recall uses the union of returned sources; accounting never deduplicates or
discards responses. The report exposes each collection's cost, call count,
collection sizes, indexed record count and a corpus digest.

The per-call budgets are unchanged; the **total per-question budget scales with
the number of collections**. This is an explicit benchmark runner loop, not a
new production aggregate API, global ranking or cross-collection graph traversal.
It measures response payloads only: request tokens, MCP framing, model work,
indexing, signature verification and host/reviewer effort are outside this gate.
The existing 10x regression floor and full required-source recall still apply.
For a single collection the retrieval payload remains identical to v1. Multi-
collection results have a new `forgesworn-context-token-reduction-v2` label and
must not be presented as directly comparable to historical v1 results. The v1
runner remains reproducible from Git history; locked D5 experiments are untouched.
This synthetic naive-baseline comparison does not establish subscription or cash
savings, or guarantee a sufficient answer merely because a source was returned.

`npm run test:benchmark-corpus` checks partition boundaries, capacity rejection,
evidence beyond record 128, empty-response accounting and v1 single-view parity.

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
