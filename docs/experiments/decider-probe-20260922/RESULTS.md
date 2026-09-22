# Decider replay probe: results

Run on 22 September 2026 over the 60 recorded orientation, diagnosis and
impact answers from v1, v2, S5 and v3 (15 accepted). Every structured
response parsed. Decider usage: 1.87M input and 21K output tokens, mostly the
headless client's fixed per-session context, not the answers.

**The decision rule is not met. No in-loop decider is built.**

| Scope | Answers | Rejected | AUC | Answers with a "no" | Rejections caught | Accepted flagged |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 60 | 45 | 0.68 | 31 | 25 of 45 | 6 of 15 |
| checker passed | 58 | 43 | 0.70 | 31 | 25 of 43 | 6 of 15 |
| orientation | 19 | 13 | 0.51 | 9 | 5 of 13 | 4 of 6 |
| diagnosis | 19 | 10 | 0.51 | 5 | 3 of 10 | 2 of 9 |
| impact | 20 | 20 | n/a | 17 | 17 of 20 | none accepted |

The rule needed AUC of at least 0.75 over checker-passed answers and at least
two thirds of rejections caught, with no more than half of accepted answers
flagged. AUC was 0.70 and 58 percent of rejections were caught.

## Reading

- On orientation and diagnosis the questions are at chance (AUC 0.51): they
  flag accepted and rejected answers alike. The rejections there turn on
  correctness and attribution details that a text-only completeness judge
  cannot see.
- The overall AUC comes almost entirely from impact, where every answer in
  every run was rejected and 17 of 20 drew at least one "no". The impact
  questions flagged mostly missing new test cases (10) and missing
  consequences for callers or data (7). That is consistent with the reviewer
  reasons, but with no accepted impact answer it cannot show discrimination,
  and the questions were written by someone who had read those rubrics.
- So the questions are a plausible writing checklist for impact tasks (idea 2,
  a prompt-side category checklist), not evidence for a model-judged gate.

## Caveats

One decider model at low effort, one repetition, 60 answers from eight
tasks, and questions whose author had seen the rubrics. A future test belongs
on held-out tasks with unseen rubrics, inside the repeated-run protocol.

Private evidence: `~/.cache/z1p-delivery/20260922-decider-probe/`.
