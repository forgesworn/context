# First paired diagnostic trial — 21 September 2026

This is a narrow, host-assisted context-selection experiment, not measured
end-to-end savings or a billing result. Both arms needed reviewer correction.

## Protocol

Source revision: `3c2723e8e61ae8810a6e843de4b33b39e5074e4f`, subsequently
squash-merged as `ab8026b1a14be0472f0fe74581676124f5353950` in
[PR #9](https://github.com/forgesworn/context/pull/9). The two trees were verified
identical. Initial requests used the original revision; repair prompts retained
those exact source packets after the merge.

Task: diagnose whether `filesSkipped=0` and
`max(0, filesScanned + symbolsFound - records.length)` establish complete
repository coverage. Distinguish discovery, depth, record and read limits;
predict two fixture outcomes; recommend an honest bounded reporting change and
two regressions without changing signed v1. No implementation was requested.

Both arms used `deepseek-v4.1-flash:cloud`, `think=false`, a 16,384-token output
allowance, the same question and separate stateless requests through the M4
Ollama endpoint. Baseline ran first. No arm received the other arm's answer.

- Baseline: complete `source-scan.ts`, `source-scan.test.ts` and
  `scripts/dogfood.mjs`, with line numbers (46,584-byte initial packet).
- Assisted: after actual `repository_search(filesSkipped)` located the relevant
  code, the host selected scanner lines 1–30, 85–132, 175–220 and 260–268;
  test lines 90–116 and 130–152; harness lines 70–85. Same question and original
  line numbers (14,452-byte initial packet).

Acceptance criteria were written before inference. Both first answers got the
central coverage problem and fixture counts right but made material accounting
or API-recommendation errors. Each received one focused repair, including the
same reviewer corrections, its own prior answer and its original source packet.
The repairs therefore benefited from host-supplied ground truth, not autonomous
self-correction. The revised core diagnoses were accepted; their prose was not
accepted verbatim as an implementation specification.

## Worker usage, including repairs

| Arm | Initial tokens | Repair tokens | Total input | Total output | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full files | 16,164 | 20,015 | 29,335 | 6,844 | 36,179 |
| Selected excerpts | 6,589 | 9,083 | 10,847 | 4,825 | 15,672 |

The assisted arm used **56.7% fewer provider-reported worker tokens**, including
its repair. Four dispatched requests consumed 51,851 reported tokens in total.
All returned HTTP 200 and terminal `stop`; no transport retries or 402 occurred.
Helper-reported request durations sum to 34.480 seconds for baseline and 26.341
seconds for assisted. These are not total task completion times.

The helper summary records two partial first drafts and two accepted corrected
diagnoses. Model and thinking settings did not change between arms.

## Verified diagnosis

An executable fixture used three small root TypeScript files, each exporting
one named function. The built scanner returned:

| Case | maxFiles | maxRecords | Files scanned | Files skipped | Symbols | Records | Candidate omissions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 1 | 128 | 1 | 0 | 1 | 2 | 0 |
| B | 64 | 1 | 3 | 0 | 3 | 1 | 5 |

The formula is exact for omitted **constructed candidate records**: parsed file
candidates plus filtered/deduplicated symbol candidates minus retained records.
It does not count files outside discovery/depth limits. `filesSkipped` only
counts particular observed exclusions; even `lstat` failures currently bypass
that counter. Directory entries may have been enumerated without their files
being inspected, so "never enumerated" is not universally accurate wording.

Next implementation: preserve `filesSkipped: number`, all quotas and signed v1;
add explicit discovery-cap/depth-limit indicators and scoped coverage wording.
Reaching a cap means uncertainty, not proof that more eligible files exist.
Do not walk unvisited subtrees merely to invent an exact uncovered-file count.
Candidate-omission reporting should remain clearly separate from coverage.
This reporting change is **not implemented by this trial**.

## Limits and local evidence

- One pair, one diagnostic task, baseline-first order; no statistical claim.
- Comparison is against supplying three full relevant files, not an optimised
  `rg` workflow or an autonomous agent using competing navigation tools.
- Excerpt selection and review used Codex. Its token usage, initial review time,
  packet preparation time, cache hits and monetary cost are unknown (`null`),
  not zero. End-to-end cost reduction remains unmeasured.
- Instrumented final-review wall intervals were 14.279 seconds (baseline) and
  19.596 seconds (assisted); these include orchestration and exclude initial
  review and preparation. They are not total human/agent review time.
- No actual Claude-session inference was spent for acceptance; its connection
  check is still separate from interactive tool use.

Local prompt, answer, protocol, fixture and helper receipts are under
`/private/tmp/z1p-paired-trial.DRWL5j/`; this temporary evidence is not a durable
public archive. Prompt SHA-256 values in the receipts:

| Request | Prompt SHA-256 |
| --- | --- |
| Baseline | `099ca389f09c12e52ad0740defdd41dc7b4f3df70c3ea80bb8cab0268fc4b271` |
| Assisted | `a33b047ec371a1fcbb072195c9518fcad9f7bd88587eeffa54d09aedb7edebc2` |
| Baseline repair | `dc7b80b74e8ff90d10247b3b1fca104c8ca1f04351df0af83f4e31f414983c09` |
| Assisted repair | `b678c3c9ef967ce6487a2a771181076a505963b7c6e564dcfda9c1ce549b22a3` |
