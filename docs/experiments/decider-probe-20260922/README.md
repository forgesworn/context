# Decider replay probe

Tests whether batched yes/no completeness questions, derived only from each
task's brief and category, predict which recorded answers the blind reviewer
rejected. It replays answers already recorded by the v1, v2, S5 and v3 runs;
no executor runs. The decider is headless Claude Code with no tools and never
sees the rubric, source, checker result, arm or verdict. Questions, sample and
decision rule are locked in `protocol.json`, including a bias caveat: the
author had read the rubrics.

```sh
node docs/experiments/decider-probe-20260922/probe.mjs \
  --evidence /private/v1 --evidence /private/v2 --evidence /private/s5 --evidence /private/v3 \
  --out /private/decider-probe
```

Results, when present, are in `RESULTS.md`. This probe does not use or depend
on any third-party decision model; a decider, if built, would be our own.
