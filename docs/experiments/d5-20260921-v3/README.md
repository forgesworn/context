# D5 harness qualification v3

V2 was invalidated by an execution configuration defect: fresh executors defaulted
to read-only sandboxing, preventing answer.json creation and the public self-check.
V3 changes the experiment identity and explicit sandbox modes: executor
workspace-write on its own prepared root, reviewer read-only. Tool-call counts
now also include completed file-change events, exposed by the write-capability
check. Preserve all v2
results and setup failures; do not pool the two versions. The same source,
checker, review criteria, models, effort and retrieval treatment apply. The public
continuation question now explicitly asks for query validation and the exact
normalisation steps, matching the existing review criterion without supplying
the expected algorithm. Both arms receive this same clarification.


This is a prospective **one-pair harness qualification**, not the eight-pair D5
savings experiment. The [v1 failures](../d5-20260921/FIRST-PAIR.md) remain recorded
and its definitions remain unchanged. Do not pool these new results with v1 or
claim that the remaining fourteen v1 arms have been completed.

The frozen Context revision and source selection remain those of v1. Order is
baseline then assisted. Executor: `gpt-5.6-luna`, medium. Independent reviewer:
`gpt-5.6-sol`, high. Each role has a fresh session; each arm has its own archive,
Codex home and, for assisted, navigation server. Provider cache state is unknown.
Only Context is bound. Heartwood and its active session are outside this task.

The public task now includes all finding IDs, selection policy, semantic
questions and citation rules. Both arms receive an identical standalone public
self-check. It checks syntax, exact citations and implementation/test coverage;
it neither reveals expected answers nor replaces independent semantic review.
The reviewer uses the same public scope, with no mandatory secret citation
strings. The original trusted source-integrity checker also runs after each arm.

No inference may start before `lock.json` records hashes of the task, rubric,
preparer, checker, runner and their tests, verifier, toolchain.json, this definition,
REVIEW.md and inherited v1 dependencies, and a
qualified review has accepted the protocol. Any change after locking requires
a new version; never regenerate this lock to legitimise an existing run.

Each arm starts before preparation. Capture UTC timestamps and monotonic elapsed
time for preparation, executor, deterministic checks, reviewer and receipt
capture. Timestamp each observed JSONL event at receipt; these are local receipt
times, not provider generation times. Record real executor process completion
separately from checker completion. Preserve every model attempt and tool event.
The runner uses deterministic orchestration with no host model turn within the
arm; this does not make the parent session or preparation free. Shared design,
Flash drafts and qualified review are separate setup costs with unknown billing.
Retain original preparation hashes outside the executor workspace and reject
committed as well as uncommitted source/helper changes. The final public checker
runs from the locked host copy. Repository scope is an instruction and transcript
audit boundary, not a claim of operating-system sandbox enforcement.
Stop on an abnormal model exit or refusal; preserve unknown outcomes and do not
replay. A rejected answer still receives independent review.

Billing, provider cache state and parent-session usage remain unknown. Retain
nulls, never substitute zero or rate-card estimates. This qualification can
establish answer quality and capture mechanics, not monetary savings. A later
D5 revision needs an attributable-cost measurement basis before its monetary
gate can close.

An assisted arm must show successful status → refresh → search calls in order
on its own fresh root. The runner records this treatment check and rejects an
assisted answer that bypasses it.

Success means both fresh answers pass the public checker, trusted frozen-source
check and independent semantic review, with complete observable process records.
If either fails, retain it and address the specific failure before expanding.
No automatic retries, no host editing of answers and no model upgrades.

Run local qualification checks with Node 24 before locking:

```sh
node docs/experiments/d5-20260921-v3/verify.mjs /absolute/context
```

After qualified review and prospective lock, repeat with `--locked`, then use
`python3 run-pair.py --help` for the explicit private-output and executable
arguments. The checked-in toolchain binds the local Node/Codex binaries and the
pinned navigation entry, ForgeSworn runtime files and the entire installed release
tree, including third-party dependencies and installation manifests. A different
installation needs a new qualification definition; do not rewrite this one after
its first arm starts. Authentication is supplied locally and is never hashed or
copied into the protocol. The output root is private delivery storage.
