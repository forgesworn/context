# V2 result: rejected; sandbox configuration defect

The locked qualification ran baseline then assisted on 21 September 2026.
Each had one Luna/medium executor and one fresh Sol/high reviewer. Both rejected.
Neither frozen source nor the locked protocol was repaired after the run began.

Fresh executors inherited Codex's read-only default. Both attempted to write
answer.json and received an explicit sandbox denial, so the prescribed public
self-check was unavailable. The host retained final JSON and checked it outside
the model session. This is a harness configuration defect, not evidence that the
model freely chose to omit the check. V2 cannot qualify the intended workflow.

Baseline failed an exact citation: it collapsed a two-line source comment into
one string. Semantic review also found missing query-normalisation details.
Assisted passed deterministic citations and frozen-source checks but omitted
source-unknown/policy-current behaviour and parts of cursor normalisation,
invalidation and successor handling. Its scoped status → refresh → search
sequence passed; one search request failed and is retained in the event log.

| Captured measure | Baseline | Assisted |
| --- | ---: | ---: |
| Executor input, including cached subset | 269,141 | 261,595 |
| Executor output, including reasoning subset | 5,039 | 3,775 |
| Reviewer input, including cached subset | 104,137 | 247,202 |
| Reviewer output, including reasoning subset | 2,750 | 4,263 |
| Executor + reviewer input | 373,278 | 508,797 |
| Reviewer seconds | 94.51 | 133.28 |
| Accepted | No | No |
| Attributable billing | Unknown | Unknown |

The host attempted to prevent assisted preparation once the sandbox defect was
identified, but that arm had started between the status read and the attempted
fresh-output reservation. No output was overwritten. The in-flight arm was
allowed to reach a definite terminal outcome; there was no provider retry.
This race and the error are retained in private SANDBOX-DEFECT.json.

Raw timestamps, usage subsets, tool events, answers, reviews and source-integrity
receipts are private under
`~/.cache/z1p-delivery/20260921-d5-v2-6xsgi2qq/runs`. Parent-session, preparation,
and independent design-review costs remain unknown. No monetary savings or
accepted-outcome comparison is established. Heartwood was not accessed.

[V3](../d5-20260921-v3/README.md) prospectively corrects sandbox configuration,
counts completed file-change events and clarifies the public normalisation
question. It keeps this failed qualification and the original v1 failures.
