# Reviewer consistency from recorded reviews (no model calls)

Source: the 80 recorded reviews of v1, v2, S5 and v3 (Sonnet 5, high effort),
their answers, diffs and deterministic checker results. `analyse.mjs` computes
the mechanical measures; the side-by-side readings were made by hand from the
same files. Nothing was re-reviewed.

## The five flips on unchanged arms

Between v1 and v2 the plain and Graphify arms did not change (same tools,
same Sonnet 5 executor), and 5 of their 16 task verdicts flipped. Reading each
pair side by side:

| Task / arm | v1 to v2 | Answers | Cause |
|------------|----------|---------|-------|
| code-change-context / Graphify | rejected to accepted | same one-line code change, only the comment differs | reviewer |
| diagnosis-context / plain | rejected to accepted | same claims on all five findings (repair "already present" at commit; test "kept") | reviewer: four dimensions judged oppositely |
| orientation-context / plain | accepted to rejected | both omit "do not grant authority" and "generation-and-term bound" | reviewer: v1 notes the omissions and passes, v2 fails them |
| diagnosis-kithmoot / plain | accepted to rejected | v1 names the unsafe cast (`as any`), v2 does not | executor; reviewer consistent |
| diagnosis-kithmoot / Graphify | rejected to accepted | v2 names the cast (`as ContextVaultOptions`), v1 does not | executor; reviewer consistent |

At least three of the five flips come from the reviewer judging equivalent
answers differently, and two from real differences between answers. The
reviewer is consistent where the rubric names a concrete, checkable element
(the unsafe cast) and inconsistent where passing depends on whether a framing
counts as equivalent ("re-verified before commit" against "generation made
stale").

## Identical code, different verdicts

Nine of the ten code-change-context diffs make the same code change (delete
the early `this.cursors.delete(options.cursor)`), differing only in a comment.
All nine passed the deterministic checker, which runs the four behaviour
probes. The reviewer accepted eight and rejected one (v1 Graphify) for
material issues that apply equally to all nine ("no test file changes"). For
the same code that is a disagreement probability of 0.22 between two reviews.
All 20 code-change diffs passed the checker; the reviewer added no correct
rejection on them.

## Other mechanical signals

- **Dimension ids.** 6 of 20 code-change reviews ignored the prompt's
  `b1..bN` plus `scope` instruction (9 or 11 dimensions for 5 expected); 1 of
  60 structured reviews departed from the rubric ids.
- **Self-contradiction.** None: every verdict's `accepted` agrees with its
  dimensions and material issues.
- **Similar wording, different verdict.** For the same task dimension, pairs
  of findings disagree 33 percent of the time at low word overlap (Jaccard
  below 0.2) and still 12.5 percent at 0.5 or above (7 of 56 pairs). Examples
  read by hand include orientation-context freshness (v2 Context passed by
  crediting another finding; S5 Context, with nearly the same text, failed).
- **Lexical rubric coverage** predicts the reviewer's pass only weakly
  (AUC 0.69 over 320 dimension rows), so a word-overlap check cannot stand
  in for the reviewer on structured tasks.

## Consequences

- Reviewer variance accounts for a large share of the recorded churn, so
  single-review whole-task acceptance cannot distinguish arms that differ by
  one or two tasks. The paid replay condition of
  `reviewer-agreement-20260923` would mainly put a number on this; it is not
  needed to establish it.
- For code-change tasks the deterministic checker already carries the
  behaviour; the reviewer's contribution on these 20 diffs was noise. Accepting
  on the checker plus a deterministic scope check (only the expected files
  changed, no test weakened) needs no model.
- For structured tasks the unstable dimensions are those whose rubric text
  admits more than one reading. Rewriting each such dimension as explicit,
  checkable claims (as the diagnosis-kithmoot regression dimension already
  is) is the model-free step; whether it steadies the reviewer can only be
  measured by re-reviewing.
