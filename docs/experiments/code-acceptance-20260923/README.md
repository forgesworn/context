# Code-change acceptance without a model reviewer

On code-change tasks the pack's checker (`d5-20260921/accept.mjs`) already
builds, runs the focused tests and probes each required behaviour. The recorded
reviews added nothing correct on top: all 20 recorded code-change diffs passed
the checker, and the reviewer's one rejection was of a diff whose code is
identical to eight it accepted (`../reviewer-evidence-20260923/RESULTS.md`).

`scope.mjs` replaces the reviewer's `scope` dimension with a deterministic
check of the workspace against its base commit:

- every changed path is inside the task's selection policy;
- no package manifest, lockfile, TypeScript, Vite, Vitest or Jest config,
  `.gitignore`, `.npmrc` or `.github/` file changed;
- no test file deleted, no test declaration removed, no `skip`, `only`, `todo`,
  `xit` or `xdescribe` added;
- at least one file changed.

Assertion counts are reported but not judged: a behaviour change legitimately
rewrites assertions (S5 Graphify on code-change-kithmoot replaced two
assertions of the old behaviour with one looped assertion over seven invalid
inputs), and the checker runs its own behaviour probes regardless of the
agent's tests.

A task is accepted when the checker and the scope check both pass. The harness
uses this rule only when a protocol sets `"codeAcceptance": "checker-and-scope"`;
the locked v1, v2, S5 and v3 protocols do not, so their runs replay unchanged.

## Recorded runs re-scored

`node rescore.mjs v1=DIR v2=DIR s5=DIR v3=DIR` (no model calls):

| Run | Arms | Recorded accepted | Checker and scope |
|-----|------|------------------:|------------------:|
| v1 | plain, Graphify, Context | 2, 1, 2 of 2 | 2, 2, 2 of 2 |
| v2 | plain, Graphify, Context | 2, 2, 2 of 2 | 2, 2, 2 of 2 |
| S5 | plain, Graphify, Context | 2, 2, 2 of 2 | 2, 2, 2 of 2 |
| v3 | Context | 2 of 2 | 2 of 2 |

The only change is v1 Graphify on code-change-context, rejected by the
reviewer for the same code the other eight arms were accepted for. All 20
cells pass the scope check. The rule would have avoided 20 reviews: 1,199
seconds and $2.20 client-reported.

These two tasks discriminate no arm under either rule; they measure cost, not
acceptance.
