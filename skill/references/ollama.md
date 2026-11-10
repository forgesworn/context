# Ollama

An Ollama-backed coding host uses that host's global MCP entry and this skill.
For direct text workers, the host retrieves and verifies a bounded source
packet, includes its provenance and relevant source in the worker prompt, and
reviews the result. Raw API inference does not discover MCP or read files.
Use the existing Ollama worker helper and its preflight, endpoint, model,
spending/refusal and unknown-outcome controls; do not add an alternative runner
or silently change providers. Include host preparation, repairs and review in
cost accounting. Smaller packets alone do not establish savings.
Adapters can include [the direct-worker preamble](ollama-worker.md)
in each packet. This is supplied text, not raw-API skill discovery; the host
still verifies the packet and represents the worker's activity and notes.
