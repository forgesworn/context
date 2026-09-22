# Structured rubrics, version 2

The recorded reviews showed the reviewer judging equivalent answers oppositely
wherever a rubric line allowed more than one reading
(`../reviewer-evidence-20260923/RESULTS.md`). Version 2 rewrites the six
structured rubrics so that each dimension says exactly what must be stated.
Dimension ids, required evidence, task prompts and the deterministic checker
are unchanged; the locked version 1 files in `../d5-20260921/acceptance/` are
not modified.

`rubrics.mjs` holds the text; `node build.mjs` writes `acceptance/*.json` and
refuses to build if any dimension id differs from version 1 or the task's
required findings. The harness uses these files only when a protocol sets
`"rubricDir": "../rubric-v2-20260923"`, and then prints the review rules above
the rubric. Everything else in the reviewer prompt stays byte-identical to the
recorded prompts (checked against a recorded v2 prompt); it grows by about
2 KB.

## Review rules

Four rules settle the readings the reviewer varied on:

1. **Placement.** Each dimension is judged against the whole answer; a point
   stated under another finding counts. Recorded reviews both gave and refused
   this credit (orientation-kithmoot storage and ownership, impact-kithmoot
   guard, orientation-context freshness).
2. **Stated, not implied.** Different wording passes; implication does not.
   v1 passed "unsigned, not a replacement for signed evidence" as covering "do
   not grant authority or execute instructions"; v2 failed the same omission.
3. **Lists.** Every listed item must be named; generic phrases do not cover
   them.
4. **Structure.** Required points, "fails if" conditions, "not required" points
   and accepted alternatives are all explicit.

## Changes of substance

Each dimension is now written as its required points. Two things go further
than wording, and both were checked against the frozen source:

- **diagnosis-context.** The seed removes only the policy re-inspection inside
  `inspectFreshness`. The commit-time `reinspectPolicy` in `search()` is intact,
  and the existing test "blocks a policy change made during freshness source
  reads without consuming the cursor" **passes on the seeded tree** (checked by
  running it; all 76 package tests that load pass there, while three source-scan
  test files did not load in the scratch copy). Version 1's regression line
  ("restore the test that...") therefore asked for a test that already exists
  and does not detect the defect. A probe test that tightens `.gitignore` during
  the freshness reads and asserts `status()` does not report policy `current`
  fails on the seeded tree and passes once the seed is reverted
  (`diagnosis-context-probe.test.ts`, run from `packages/context-tools/src` of a
  prepared workspace); a search-level
  test cannot tell the two trees apart, because the commit-time check blocks
  either way. Version 2 requires a test of that kind. `root-cause`,
  `lost-invariant` and `repair` now say explicitly that the commit-time check
  is not the lost invariant or the repair, which is what split the v1 and v2
  verdicts on the plain arm's near-identical answers.
- **impact-context.** Version 1 named `NavigationSearchRequest`; the type is
  `NavigationSearchOptions`. The `filter` dimension accepts a separate
  case-preserving index as an alternative to post-filtering, since the task does
  not prescribe one, and `response` allows a separate mode field while still
  failing a change to what `term` reports.

All other dimensions keep version 1's substance, including the list-style
requirements (impact-context `response` and `coverage`, impact-kithmoot
`tests`) that no recorded answer has met. They are now explicit; whether they
are judged more consistently is not yet measured.

## What this does not show

Whether the reviewer is more consistent with version 2 can only be measured by
re-reviewing, which costs money (see `../reviewer-agreement-20260923/`; the
`fixed` condition there would need a `rubricDir` variant). Keyword checks on
the ten recorded diagnosis-context answers suggest the corrected regression
line can be met: four of them already point at a `status()` or
`inspectFreshness` level test. That is a keyword count, not a verdict.

Version 2 verdicts are not comparable with version 1 verdicts, and recorded
runs are not re-scored with them.
