## Summary verdict

**Do not lock or run phase 2 as written. Revise, re-freeze, re-qualify, then run only if a likely negative result is still worth 96 model sessions.**

The phase-1 token result is not a payload-size accident. Context and plain each produced 23 observable model-response rounds, but Context used 284,034 more executor tokens. Of that gap, 271,232 tokens were cached input. Context returned fewer raw tool-result bytes than plain, so the dominant cause is context repeatedly carried across model calls—especially the permanently advertised seven-tool MCP surface and early navigation material—not larger source payloads.

The current protocol also has lock-blocking validity defects:

- executors and reviewers can read sibling cells, prompts, configs, hidden assessment material, and shared temporary storage;
- reviewer blinding is defeated by its parent directory;
- the implemented dependency score is weaker and broader than the stated quality measure, and deterministic scope acceptance is absent;
- leaked and already-used tasks remain in the confirmatory pack;
- “plan headroom” is not actually measured;
- the harness does not implement the complete declared cost, quality, bootstrap, or first-pass analysis;
- three repetitions over eight heterogeneous tasks have poor power for a 20% effect.

The plausible phase-2 Context/plain token ratio is roughly **0.8–1.8**, with the evidence concentrated around **1.1–1.4**. A token-gate pass at ≤0.80 is unlikely—plausibly single digits to low teens—and the complete gate is less likely still.

## 1. Token gap root cause

### Phase-1 accounting

Event indices below are zero-based.

| Quantity | Context | Plain | Difference |
|---|---:|---:|---:|
| Executor input | 1,201,067 | 918,055 | +283,012 |
| Cached input | 1,147,008 | 875,776 | +271,232 |
| Uncached input | 54,059 | 42,279 | +11,780 |
| Output | 10,762 | 9,740 | +1,022 |
| Executor total | 1,211,829 | 927,795 | +284,034 |
| Observable model-response rounds | 23 | 23 | 0 |
| MCP calls | 15 | 0 | +15 |
| Shell calls | 9 | 18 | −9 |
| Raw tool-response bytes, including file-change descriptors | 106,321 | 133,831 | −27,510 |

The aggregate usage appears at Context event 62 and plain event 52 in `receipts/attempt2/cell-001/executor-events.jsonl` and `receipts/attempt2/cell-002/executor-events.jsonl`. These agree with `receipts/attempt2/cell-001/executor.json` and `receipts/attempt2/cell-002/executor.json`.

The 23 response rounds are inferred from maximal batches of parallel `item.started` calls, followed by their completions, plus the terminal response. For example, Context events 7–10 are one four-search batch; plain has the same total number of such response rounds despite a different tool pattern. Codex does not emit an explicit per-API-call usage record, so 23 is the observable count, not proof that no hidden retry or compaction call occurred.

Using that observable denominator:

- Context averaged 52,220 input tokens per round, including 49,870 cached.
- Plain averaged 39,915 input tokens per round, including 38,077 cached.
- The difference was 12,305 input tokens per round, of which 11,793 were cached.
- Including output, the total gap was 12,349 tokens per round.

The prompts themselves are controlled: the Context prompt is 2,120 bytes and plain 2,122 bytes. The harness deliberately makes their arm-specific instructions similar (`os2/harness.py:42-52`; `os2/harness.test.py:78-83`).

### What Context carries

Plain has no MCP schema or server instruction. Context always advertises seven tools (`os2/harness.py:35-37`, `os2/harness.py:81-88`). The Context checkout enforces a combined server-instruction and tool-listing budget of at most **6,200 bytes plus the bound root**; the same test records that it had previously been 8,207 bytes (`context/packages/context-tools/src/repository-navigation-mcp.test.ts:62-75`). The programme record reports a measured trimmed listing of 6,068 bytes, about 530 first-prompt tokens (`context/docs/SAVINGS-PLAN.md:136-146`).

That surface is created by `createRepositoryNavigationServer`:

- server instructions: `context/packages/context-tools/src/repository-navigation-mcp.ts:122-145`;
- graph schema: `context/packages/context-tools/src/repository-navigation-mcp.ts:159-170`;
- status and refresh: `context/packages/context-tools/src/repository-navigation-mcp.ts:197-237`;
- explore, coverage, search, and packet: `context/packages/context-tools/src/repository-navigation-mcp.ts:239-338`.

The Context cell then returned 15 MCP results containing **87,953 text bytes**:

- status and refresh at events 4 and 6;
- four searches at events 11–14;
- packet at event 16;
- search/search/explore at events 20–22;
- packet at event 24;
- refresh, packet, status, and coverage at events 50, 52, 58, and 60.

The three packets alone returned 60,409 bytes. Context shell results contributed another 17,514 bytes. Plain shell results contained 132,976 raw bytes. Even weighting every result by how many later observable calls could resend it, Context accumulated about 1.674 million raw byte-calls versus plain’s 2.068 million. Raw stream bytes therefore do **not** explain Context’s higher reported input. Shell output may be rendered or truncated differently before the model sees it, so these are stream-level rather than exact model-visible byte counts.

### Root cause and scaling

The evidence supports:

1. **Not a fixed once-per-session charge.** If it were, it would not appear predominantly as 271,232 cached tokens.
2. **Not larger raw tool responses.** Context returned fewer raw bytes.
3. **Not more observable model calls in this pair.** Both had 23.
4. **A per-call context penalty.** The MCP instructions/schemas and accumulated navigation conversation are repeatedly present in later model calls. The Context source itself notes that earlier results are resent and therefore cost input on each turn (`context/packages/context-tools/src/repository-navigation-mcp.ts:131-145`).
5. **Across tasks, it will also scale with call count.** Historical Context sessions made more calls even while returning fewer bytes (`prior/repeated-pro-20260923/RESULTS.md:63-72`).

The exact 12,305-token per-round difference cannot be decomposed from these streams into schema, Codex MCP wrapper, reasoning history, and rendered results. The 6.2 KB served listing alone is too small to account literally for the entire reported difference. A no-MCP/MCP controlled probe with identical scripted calls would be needed for that decomposition.

### What would cut it

The highest-leverage changes are:

- defer schemas or enable only the tools needed for the task rather than all seven;
- collapse navigation operations so one tool call returns status/search/packet material;
- reduce model calls, particularly before edits;
- avoid forcing `status → refresh` in every fresh session. The server already auto-builds on first search/explore to save those calls (`context/packages/context-tools/src/repository-navigation-mcp.ts:148-157`), while the benchmark prompt directs the model to call status and refresh (`os2/harness.py:43-47`);
- use one bounded packet where possible. The oracle phase-0 exercise says every task’s required evidence fits in one packet (`os2/phase0-blind-checks.json:94-193`), although autonomous discovery remains a separate problem;
- shorten early response metadata and source payloads, because early material is resent most often.

Any Context build or workflow change after this result requires a new release, protocol revision, and qualification; it cannot be silently substituted into phase 2.

## 2. Metric design

### Cached input should not automatically count fully as “plan headroom”

Fully counting cached input is a valid measure of **reported model context processed**. It is not validated as a measure of ChatGPT-plan headroom. The protocol acknowledges that billing is plan allowance rather than metered cash (`os2/protocol.draft.json:406-413`), but it has no observation of actual plan debit, rate-limit weight, or cached-token weighting.

The defensible primary metric for the stated estimand is:

> **Actual plan-headroom units debited per completed cell**, including executor, reviewer, retries, and arm-specific setup, measured from an authoritative before/after allowance signal.

If no such signal is available, the benchmark should not claim to measure plan headroom. It should rename the primary outcome to:

> **Reported processed tokens: input plus output, with cached input included**, accompanied by uncached input, cached input, and output as prespecified secondary components.

A useful sensitivity statistic is:

\[
H(w)=\text{uncached input}+\text{output}+w\times\text{cached input}
\]

with externally justified \(w\), not a weight selected from these results.

For phase 1, complete-cell Context/plain ratios are:

- \(w=0\): 1.034
- \(w=0.10\): 1.203
- \(w=0.25\): 1.264
- \(w=0.50\): 1.295
- \(w=1\): 1.314

Thus no non-negative cached-token weight turns phase 1 into a Context saving. This is not merely a dispute about whether cached tokens count “enough.”

### Changing it now is a researcher degree of freedom

Yes. The phase-1 direction and the fact that 95% of the executor gap is cached are already known (`os2/README.md:434-440`). Selecting a cached-token weight now is outcome-informed.

Because the protocol is explicitly still a draft, correcting the estimand is legitimate, but it must be handled as a new protocol version:

- retain phase 1 as an exploratory qualification;
- document the original and revised metrics;
- choose the revised primary based on an external billing/headroom rule;
- freeze the weight before any new comparative cell;
- rerun qualification if the primary decision rule changes.

## 3. Power and expected outcome

### Three repetitions do not solve the observed variance

The historical repeated run has within-task max/min ratios of approximately:

- plain: median 1.92, with extremes up to 4.89;
- Context: median 1.43, with an extreme of 7.14.

Examples include:

- plain diagnosis: 1.216M–5.941M input;
- Context code change: 0.250M–1.784M input;
- Context code-change median 1.536M versus plain 0.408M.

See `prior/repeated-pro-20260923/RESULTS.md:34-61`.

Across the eight historical task median ratios, the log-ratio standard deviation is about 0.625. With eight tasks, the approximate standard error is 0.221. The distance between parity and a 20% saving is \(-\log(0.8)=0.223\): almost exactly one standard error. Under a rough normal approximation, power to distinguish a true 0.80 ratio from parity is only about **25% at a one-sided 5% level**. This is illustrative rather than an exact power analysis for the sum-of-medians statistic, but it correctly reflects the scale problem.

A ratio whose true value is exactly 0.80 also has only about a 50% chance of satisfying a point-estimate gate at 0.80. Reporting a 90% interval without using it in the decision does not make that threshold inferential (`os2/protocol.draft.json:406-410`).

### Evidence on the likely ratio

The evidence all points away from a 20% saving:

- Repeated historical geometric ratio: **1.169**, 90% interval **0.793–1.355** (`prior/repeated-pro-20260923/RESULTS.md:15-23`).
- 0.4.0 screen: **1.086**, interval **0.831–1.271** (`prior/screen-pro-040-20260923/RESULTS.md:15-24`).
- Phase-1 complete-cell ratio: **1.314** (`os2/README.md:418-440`).
- Using the historical tables but the new sum-of-task-medians form, the repeated Context/plain ratio is about **1.52**; for the 0.4.0 screen medians it is about **1.75**. Those are cross-protocol planning calculations, not pooled estimates.

A reasonable planning range for phase 2 is therefore **0.8–1.8**, with **1.1–1.4** the most plausible central region. Task-level ratios can be much wider.

My judgement:

- token gate pass as written: **low probability**, plausibly single digits to low teens;
- full gate, including quality, universal Context acceptance, and reviewer seconds: **lower still**.

To make a general 20% claim with historical heterogeneity, substantially more than eight independent tasks would be needed. A rough calculation suggests about 36 tasks for 80% power with a one-sided 10% criterion, assuming similar between-task variance. Extra repetitions help within-task noise but do not cure task heterogeneity.

## 4. Quality gate

The quality gate is unlikely to discriminate reliably.

The stated primary applies to impact and code-change tasks (`os2/README.md:452-471`), giving four tasks. Their hidden dependency-path counts are only:

- bray impact: 10;
- h3 impact: 5;
- bray code change: 3;
- h3 code change: 3.

See `os2/phase0-blind-checks.json:8-61` and `os2/phase0-blind-checks.json:34-82`.

Both phase-1 arms scored zero misses and zero incorrect dependencies (`os2/README.md:418-428`). Historical work also found that required evidence was usually retrieved by every arm and outcomes failed on synthesis instead (`prior/repeated-pro-20260923/RESULTS.md:77-82`). Detailed public task statements further reduce the opportunity for path-level retrieval differences; for example, `os2/tasks/h3-code-change.json:6-7` specifies nearly every behavioural branch.

The implementation weakens the measure further:

- `dependency_count` includes diagnosis tasks even though the narrative names impact and code-change (`os2/harness.py:434-452`).
- “Incorrect” means only an impact answer naming a path that does not exist. Over-including unrelated existing files is free (`os2/harness.py:443-452`).
- Code-change and diagnosis answers may claim coverage through `answer.json.filesChanged` even if the file was not actually changed (`os2/harness.py:434-440`).
- Scoring is path-level despite the public answers requesting symbols and affected call sites.
- Duplicate dependency entries in the same path would be counted separately rather than deduplicated to the claimed path level.
- The count is computed before acceptance and for rejected outcomes, despite the protocol saying it is counted after acceptance (`os2/harness.py:506-550`; `os2/protocol.draft.json:384-388`).

The rule “better on at least two tasks and worse on none” has a strong floor effect and no allowance for measurement error. The perfect-baseline remedy—replace a class after observing the baseline—is a new experiment, not a valid continuation (`os2/protocol.draft.json:400-404`).

Recommended replacement:

- score symbol/call-site dependency recall and precision, not merely paths;
- require actual diff coverage for code changes;
- predefine how alternate valid implementations are adjudicated;
- aggregate paired scores with an interval;
- make a zero-zero pack inconclusive, without post-result task replacement inside the same protocol.

## 5. Reviewer

The reviewer is neither securely blind nor a sound source of gate-level time.

### Blinding failure

The reviewer runs with `-C cell-NNN/review` (`os2/harness.py:506-533`). Its parent contains:

- `executor-config.toml`, including the MCP server only for Context;
- `executor-prompt.txt`, whose first line names the Context workflow;
- executor events, diff, and receipts.

Those files are created at `os2/harness.py:231-244`. A relative read such as `cat ../executor-prompt.txt` is not detected by `outside_references`, which searches only absolute and home-prefixed tokens (`os2/harness.py:340-363`). Opaque cell names therefore do not create arm blinding.

During assessment, the private acceptance directory and other cells also exist. Read-only prevents modification, not reading.

### Same-model review

Executor and reviewer are both `gpt-5.6-sol`/high (`os2/README.md:187-194`). This creates correlated blind spots and possible self-style preference. It is not an independent judgement in the substantive sense.

Each outcome gets only one review. Three repetitions produce three different outcomes, not multiple ratings of the same outcome, so reviewer reliability is unmeasured. Earlier programme analysis had already identified the lack of reviewer-agreement measurement (`context/docs/SAVINGS-PLAN.md:136-151`).

### Reviewer seconds

Reviewer wall time includes provider latency, reasoning variability, and incidental tool behaviour. It is not human review effort. Phase 1 produced 55.4 seconds versus 31.4 despite nearly identical evidence volumes (`os2/README.md:418-440`). With one review per outcome, that is too noisy for a hard no-higher gate.

Fixes:

- run reviewers in a filesystem root containing only the current review bundle;
- use a different model family or a blinded multi-reviewer panel;
- measure agreement on a fixed sample;
- remove model wall-clock seconds from the hard gate, or replace it with blinded human review time if developer-review burden is the estimand;
- report reviewer tokens, calls, and wall time descriptively.

## 6. Read exposure

The current controls are inadequate.

`workspace-write` and `read-only` constrain writes, not reads. The protocol recognizes this (`os2/protocol.draft.json:440-444`), but the implementation relies on prompts, a list of exact forbidden paths, and transcript heuristics.

Concrete exposures include:

- sibling cell prompts, configs, schedules, and completed outputs;
- previous arm outputs in sequential execution;
- the author transcript or hidden files if an omitted path is not passed through `--forbid`;
- reviewer access to all private assessment material;
- `/tmp` and `/private/tmp`, explicitly exempted and shared (`os2/harness.py:264-275`);
- relative `..` paths, shell variables, symlink traversal, subprocesses, Python/Node file reads, and reads that never appear as a recognisable absolute shell token.

`--forbid` checks only whether explicitly supplied paths exist (`os2/harness.py:557-560`). `outside_references` only reports; it does not reject the cell (`os2/harness.py:340-363`). Phase-1 attempt 1 already demonstrated a real unflagged move into `/private/tmp` (`os2/README.md:400-408`).

Required fix:

- run each executor in an OS-level VM/container/mount namespace exposing only its workspace and a minimal read-only toolchain;
- give each cell a private temporary filesystem and private process namespace;
- run each reviewer in a separately mounted review root with only its current inputs;
- keep checker secrets in a trusted control process never mounted into model environments;
- fail, rather than merely report, any containment violation;
- resolve and audit relative paths and symlinks as defence in depth, but do not treat transcript parsing as the security boundary.

## 7. Task pack

The affected tasks should be replaced.

The author leaked partial answer information for bray-impact and bray-diagnosis and revealed that the two h3 code-producing tasks share a source file (`os2/README.md:174-180`). That affects:

- bray-impact;
- bray-diagnosis;
- h3-diagnosis;
- h3-code-change.

Additionally, h3-code-change has already been run twice in phase 1, with both arm outputs now known. It cannot remain a clean confirmatory task even without the author leak.

Replacement procedure:

1. Freeze the tool build, harness, prompts, metric, and analysis code first.
2. Give an isolated independent custodian a precommitted candidate-selection rule and task-shape constraints.
3. Have that custodian choose replacements and create public statements, private acceptance files, and hashes.
4. Return only public tasks, hashes, and blind pass/fail validation results to the tool side.
5. Make no Context, prompt, or harness changes after the replacements are visible.
6. Use a separate ninth calibration task for qualification; never reuse a qualification task in the confirmatory pack.
7. Prefer non-overlapping source areas and recent commits, and record candidate exclusions without revealing selected hidden dependencies.

If the tool build needs changes after blind validation, regenerate the affected confirmatory tasks under a new protocol.

## 8. Harness and metrics defects

### Harness and analysis

1. **The public task directory cannot be planned directly.** `plan()` loads every `*.json`, including `manifest.json`, and requires `id` and `statement` (`os2/harness.py:220-227`). `prepare()` explicitly skips the manifest (`os2/harness.py:603-612`). The dry-run test omits a manifest (`os2/harness.test.py:189-218`).

2. **Deterministic scope acceptance is absent.** The private `scope` is copied into the reviewer rubric, but acceptance is only reviewer verdict plus checker result (`os2/harness.py:511-516`, `os2/harness.py:543-550`). This does not implement the claimed checker-and-scope rule.

3. **Quality-gate logic is not implemented.** There is a dependency counter but no function applying “lower on two, higher on none,” no task-class filter, and no CLI summarisation path (`os2/harness.py:434-452`, `os2/harness.py:617-651`).

4. **The bootstrap and geometric-mean report are not implemented.** The protocol declares them, but the harness contains only `cost_gate()` (`os2/protocol.draft.json:406-413`; `os2/harness.py:180-211`).

5. **The cost gate is not called by any CLI path.** `main()` exposes plan, prepare, execute, and assess only (`os2/harness.py:617-651`).

6. **“Complete cost” is not implemented.** `cell_total()` sums only the supplied usage parts, and assessment supplies executor plus reviewer (`os2/harness.py:172-177`, `os2/harness.py:543-551`). Setup, repairs, protocol review, blind authoring, invalid attempts, and reruns are not attributed despite the protocol claiming inclusion (`os2/protocol.draft.json:384-390`).

7. **Setup failures do not stop preparation.** Install exit status is recorded, then the tree is committed regardless (`os2/harness.py:308-321`). Existing templates are skipped without hash or readiness revalidation (`os2/harness.py:603-612`).

8. **Execution does not verify the locked plan.** It does not verify task hashes, template tree, Codex path against `schedule.json`, Context CLI digest, Node/pnpm version, or arm configuration before running (`os2/harness.py:557-575`). Phase 1 reports pnpm 11.9.0 while the protocol names pnpm 12.3.4.

9. **The declared model version is not a service snapshot.** The CLI is pinned, but a remotely served model may change during a long sequential run.

10. **Three-run ordering is unbalanced within task.** For task 1, first arms are Context, plain, Context (`os2/harness.test.py:41-45`). Across the whole pack it balances, but each per-task median remains confounded with position under temporal or cache drift.

11. **Cost-gate row counts are not checked.** Any nonempty number of rows per task/arm is accepted and medianed; exactly three completed repetitions are not enforced (`os2/harness.py:193-201`).

12. **Reviewer evidence is neither bounded nor frozen.** Entire cited files are copied from the executor-modified workspace (`os2/harness.py:517-525`), whereas the protocol promises bounded frozen-source excerpts (`os2/protocol.draft.json:119-126`).

13. **Parent-symlink containment is not checked.** Only the final path’s `is_symlink()` is tested; a symlinked ancestor can escape the workspace (`os2/harness.py:517-525`).

14. **Assess need not wait for every executor.** It simply assesses whichever cells have receipts (`os2/harness.py:578-600`), contrary to the stated all-executors-then-assess separation.

15. **First-pass acceptance is not measured.** It is declared in the protocol (`os2/protocol.draft.json:387-388`) but no executor self-check event or first-test result is captured.

### Usage assumptions A1–A4

- **A1, cached within input:** assumed but not validated. Negative `uncached` is possible because the code simply subtracts (`os2/harness.py:156-168`).
- **A2, reasoning within output:** assumed but not checked. Missing reasoning is silently treated as zero.
- **A3, per-turn usage:** the comment says multiple `turn.completed` events are per-turn and should be summed, but the real probe observed one aggregate event for the whole exec (`os2/harness.py:14-23`). If a future client emits cumulative intermediate events, summing will double count.
- **A4, cache writes within input:** a nonzero value merely sets `cacheWriteSeen`; it neither makes the cell incomplete nor blocks the gate (`os2/harness.py:156-168`). The protocol says this should be settled before lock.
- Completeness requires only integer input and output. Cached, reasoning, and cache-write fields may be absent and are replaced by zero (`os2/harness.py:156-168`).
- Malformed JSON is silently skipped, and process exit status is not part of usage completeness (`os2/harness.py:137-169`).

These assumptions need schema validation, inequality checks, client-version-specific fixtures, and fail-closed behaviour.

### `metrics.mjs`

1. Malformed event lines are silently ignored, with no transcript-integrity flag (`os2/metrics.mjs:36-45`).

2. The shell parser is not a security-grade or complete read classifier. It treats `git`, `node`, `python`, `jq`, `xargs`, and similar commands as non-reads even though they can read arbitrary files (`os2/metrics.mjs:28-34`, `os2/metrics.mjs:170-172`).

3. It misses command substitutions, scripts, loops, process substitution, aliases, glob expansion, `git show`, `perl`, and language one-liners.

4. Pipeline semantics are wrong for common commands such as `nl file | sed -n 10,20p`: `nl` is counted as a whole-file read rather than composing the downstream range (`os2/metrics.mjs:131-169`).

5. `tail` is always treated as a whole-file read, while `head` receives partial range handling (`os2/metrics.mjs:157-168`).

6. A successful packet with no parseable ranges increments `packets` but leaves coverage empty and the ratio null (`os2/metrics.mjs:198-205`, `os2/metrics.mjs:225-236`). Qualification has no automated fail-closed check for this case.

7. `toolErrorRate` mixes MCP calls, shell executions, and file changes in one denominator (`os2/metrics.mjs:193-213`). This can dilute repository-tool failures with successful unrelated commands. MCP and host-tool error rates should be separate.

8. Unclassified segments are reported but do not invalidate the reads-after-packet metric. A passing threshold can therefore coexist with known blind spots.

9. The metric counts distinct files, not bytes, lines, or repeated reads. One one-line overlap and repeated whole-file rereads receive the same task-level contribution.

10. The tests are useful fixtures but cover only a small grammar and do not test the escape cases above (`os2/metrics.test.mjs:17-107`). The only real-stream probe was a prescribed `cat`, not the historical failure pattern (`os2/README.md:251-280`).

11. No metrics are captured for model-response rounds, MCP schema bytes, rendered result bytes, or context growth, even though those appear to drive cost.

## 9. Other threats to validity

- **Builder conflict:** the same tool side built Context, the benchmark harness, metrics, prompts, and qualification procedure. An independent code and analysis audit is needed before lock.

- **Test-set tuning:** prior Context releases and workflow changes were informed by earlier benchmark tasks. The current pack is newer, but four tasks are leaked or exposed, and h3-code-change was used for qualification.

- **Oracle phase-0 packet construction:** showing that hidden required evidence fits into an oracle packet establishes capacity, not that the model can discover the evidence cheaply.

- **Public-repository memorisation:** h3 is popular, and both repositories and their merged fixes are public. Network denial does not remove parametric memory. Recent commits reduce but do not eliminate this risk (`os2/README.md:85-118`).

- **Merged diff is not necessarily the unique dependency set:** an alternate valid implementation can touch a different set of files or symbols. Treating the historical patch as ground truth can reward imitation and penalize valid designs.

- **One ForgeSworn repository:** bray remains in the tool builder’s ecosystem, so repository conventions may be unusually familiar.

- **Prompt saturation:** the code-change and impact statements enumerate much of the desired design. This can eliminate the dependency-discovery difference the quality gate is intended to detect.

- **Remote-model drift:** 96 sessions may span rate limits or backend changes. Client binary pinning does not pin the served model.

- **Sequential order and cache state:** deterministic execution can correlate arm, task, time of day, provider load, and prompt-cache state.

- **Nonmodel Context cost is excluded:** index construction, storage, CPU, server startup, and tool development are outside the “complete model cost.” That is acceptable only if the claim is explicitly limited to model-session consumption.

- **Environment mismatch:** in phase 1 the agents could not run the socket-backed Node matrix because of local-port restrictions, even though the frozen repository tests used a profile allowing loopback. This changes the competent-workflow baseline.

- **Universal acceptance is brittle:** one stochastic reviewer rejection among 24 Context outcomes fails quality, while the cost statistic uses medians. These components have very different robustness.

- **Conditional Graphify round:** running Graphify only after Context beats plain creates a selected comparison and cannot support an unconditional three-way claim (`os2/README.md:221-229`).

## Ranked changes

1. **[free] [blocking]** Put every executor and reviewer in a true read-isolated filesystem/process environment with private temporary storage. Remove sibling cells, parent configs, schedules, and other acceptance files from the mount.

2. **[free] [blocking]** Fix the harness before lock: manifest handling, setup fail-closed behaviour, locked-artifact verification, exact repetition counts, deterministic scope enforcement, frozen bounded reviewer evidence, and all-executors-before-assess.

3. **[free] [blocking]** Implement and fixture-test the actual analysis: quality rule, task-class filtering, complete-cost attribution, bootstrap interval, first-pass measure, and final gate calculation. Make the analysis artifact hash part of the lock.

4. **[free] [blocking]** Resolve A1–A4 with fail-closed validation. Reject missing component fields, invalid inequalities, nonzero unsettled cache writes, unexpected event shapes, and ambiguous multiple usage events.

5. **[free] [blocking]** Define the estimand honestly. Measure authoritative plan-headroom debit if available; otherwise rename the primary outcome to reported processed tokens and freeze a separate cached-token sensitivity analysis.

6. **[paid] [blocking]** Replace bray-impact, bray-diagnosis, h3-diagnosis, and h3-code-change through an isolated custodian. Use a separate qualification task excluded from phase 2.

7. **[paid] [blocking]** Redesign and validate the quality measure using symbol/call-site precision and recall, actual diff coverage, and rules for alternate valid implementations. Pilot discrimination on tasks not used in phase 2.

8. **[paid] [blocking]** Repair reviewer independence: isolated review roots, a different model family or multiple blinded reviewers, and an agreement study. Remove model wall-clock seconds from the gate unless it is replaced by a validated review-effort measure.

9. **[free] [blocking]** Make read-after-packet and tool-error metrics fail closed when events are malformed, coverage is unparseable, or read segments are unclassified. Separate MCP errors from shell/file-change errors.

10. **[paid] [recommended]** Increase independent task count substantially or narrow the claim to this exact eight-task pack. If retaining a general 20% claim, make uncertainty decisive rather than report-only.

11. **[paid] [recommended]** Run a small scripted MCP/no-MCP overhead probe with identical call structure before phase 2. Record schema bytes, rendered tool-result bytes, response rounds, and usage to resolve the unexplained 12.3K-token per-round difference.

12. **[paid] [recommended]** If reducing Context overhead, release and re-pin a build with deferred/fewer schemas and a lower-call workflow, then rerun qualification under a new protocol version.

13. **[free] [recommended]** Randomize or block task and arm order, record provider/cache state where available, and finish within a predefined time window.

14. **[free] [recommended]** State explicitly that CPU, indexing, storage, and tool-development cost are excluded, and report executor wall time and local preprocessing separately.

## Phase 2 recommendation

**Revise then run.**

Do not spend the full phase-2 budget on the present draft: even a result would be contestable because blinding, containment, quality scoring, task independence, and declared analysis are not implemented as claimed.

After revision, phase 2 is worth running if the purpose is a credible falsification attempt and a likely negative result is useful. It is not worth running merely in the expectation of passing the current gate. Existing evidence makes a ≥20% Context token saving unlikely, but a properly isolated, prospectively scored negative result would still be informative.

```json
{"readyToLock":false,"blocking":["read isolation and reviewer blinding are not enforced","declared quality and scope gates are not implemented correctly","complete cost and usage assumptions A1-A4 are not validated","leaked and phase-1-exposed tasks remain in the confirmatory pack","the primary metric does not measure plan headroom","the reviewer design and reviewer-seconds gate are not reliable","the harness lacks the declared final quality, bootstrap, and gate analysis"],"recommended":["increase independent task information or narrow the claim","run a controlled MCP overhead probe","reduce the always-advertised tool surface and model-call count","randomize or block execution order","report nonmodel Context costs and executor time separately"],"phase2Recommendation":"revise-then-run","confidence":"high"}
```