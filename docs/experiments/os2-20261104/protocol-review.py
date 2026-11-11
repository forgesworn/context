#!/usr/bin/env python3
"""OS2 independent protocol review: one Sol/high session in a read-only sandbox.

  build  copy the protocol folder, phase 1 receipts and earlier results into a new
         bundle. Receipt files are taken from an allowlist, so the reviewer's
         rubric copies, verdict reasons and event stream are never included.
  run    refuse while any --forbid path exists (the sandbox reads anywhere), then
         run one reviewer session over the bundle and write a receipt.

`build` starts no model; `run` starts one and needs approval.
"""
import argparse
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harness', HERE / 'harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

RECEIPT_FILES = ('executor.json', 'executor-events.jsonl', 'executor.diff', 'executor-prompt.txt', 'executor-config.toml',
                 'executor-final.txt', 'environment.json', 'assessment.json', 'checker-only.json')

PROMPT = """You are the independent protocol reviewer for OS2, a benchmark comparing a plain Codex arm with a Context arm \
(Z1P Core 0.26.0 repository tools over MCP). The protocol is a draft that is locked before phase 2. Do a deep, adversarial, \
specific review: the owner needs to know whether phase 2 is worth running and what must change first.

Material, read-only, in the current directory:
- os2/: README.md (protocol narrative and phase records), protocol.draft.json (machine protocol, including protocolReviewBrief), \
harness.py and harness.test.py, metrics.mjs, blind-check.mjs, history-candidates.mjs, write-probe.py, tasks/ (public task \
statements) and phase0-blind-checks.json.
- receipts/: phase 1 cells. attempt1 is invalid (broken pnpm environment); attempt2 passed. receipts/README.md maps cells to \
arms. Each cell has executor.json (usage and metrics), executor-events.jsonl (the full Codex JSON stream), executor.diff, the \
prompt and config, answer.json and assessment.json.
- prior/: earlier experiments in this programme (REPEATED-RUNS.md and RESULTS.md files), including the September repeated \
run and screens.
- The Context source checkout at {repo} may be read for tool schemas, response rendering and instruction text \
(packages/context-tools and packages/context).

Hidden acceptance material (checkers, rubrics, dependency sets) is deliberately absent. Do not look for it.

Answer each, with evidence (bundle path:line, checkout path:line, or event index):
1. Token gap root cause. From the event streams, quantify what the Context arm carries that plain does not: tool schema and \
instruction bytes, tool response sizes, number of model calls, context re-sent per call. Does the gap scale with calls, with \
response bytes, or with a fixed per-session overhead? Codex reports one turn.completed per exec, aggregating every model call; \
derive per-call figures where the stream allows. Name the Context source that drives the overhead and what would cut it.
2. Metric design. Billing is ChatGPT plan headroom, not cash. 95% of the phase 1 executor gap is cached input. Should cached \
input count fully toward the token gate? Propose a defensible primary metric, and say whether changing it now is a researcher \
degree of freedom given that phase 1 results are known.
3. Power and expected outcome. With 8 tasks, 3 repetitions, 2 arms, per-task medians and a 20% reduction gate, can phase 2 \
tell a true 20% saving from noise, given the variance in prior/ (repeated-pro-20260923, screen-pro-040-20260923)? Give the \
plausible range of the phase 2 token ratio from all evidence so far and your judgement of how likely the gate is to pass as \
written.
4. Quality gate. Does "fewer missed or incorrect dependencies than the comparator on at least 2 tasks and more on none" \
discriminate on these tasks, given path-level counting and 0 for both arms in phase 1?
5. Reviewer. Reviewer seconds as a gate input with one review per cell; the reviewer is the same model as the executor; the \
reviewer's working directory sits inside the cell directory, whose parent holds the executor config and prompt naming the arm.
6. Read exposure. Codex read-only and workspace-write sandboxes can read anywhere; outsideReferences exempts /tmp and \
/private/tmp. Assess adequacy and propose fixes.
7. Task pack. Tasks were authored by a blind Claude session from merged history; its final reply leaked partial hints for \
bray-impact, bray-diagnosis and one h3 file shared by h3 tasks (README, known issues). Should those tasks be replaced, and how \
without unblinding the tool side?
8. Harness and metrics defects. Read harness.py, metrics.mjs and their tests; list concrete bugs or gaps with path:line, \
including usage assumptions A1 to A4.
9. Other threats to validity: the tool side built the harness and the tools, tuning on the test set, public repositories the \
model may already know, anything else.

Then give ranked changes before lock, each tagged [free] or [paid] and [blocking] or [recommended], and a plain \
recommendation on phase 2: run as written, revise then run, or stop, with reasons.

Rules: read-only. You may run read-only analysis commands (rg, jq, python3 -c, node -e). Do not write or modify files, use \
the network, MCP or workers. Cite paths relative to the bundle or the checkout, never absolute paths, and do not name people.

Output Markdown only, with sections: Summary verdict; 1 to 9 as above; Ranked changes; Phase 2 recommendation. End with one \
fenced json block: {{"readyToLock": boolean, "blocking": [string], "recommended": [string], \
"phase2Recommendation": "run" | "revise-then-run" | "stop", "confidence": "low" | "medium" | "high"}}.
"""


def build(args):
    out = args.out
    if not out.is_absolute() or out.exists():
        raise SystemExit('--out must be a new absolute directory')
    out.mkdir(parents=True, mode=0o700)
    shutil.copytree(HERE, out / 'os2', ignore=shutil.ignore_patterns('__pycache__'))
    lines = ['# Phase 1 receipts', '', 'See os2/README.md, Phase 1, for each attempt. attempt1 is invalid (broken pnpm environment).', '']
    for item in args.plans:
        name, _, path = item.partition('=')
        plan = pathlib.Path(path)
        schedule = json.loads((plan / 'schedule.json').read_text(encoding='utf8'))
        for cell in schedule['cells']:
            src, dst = plan / cell['directory'], out / 'receipts' / name / cell['directory']
            dst.mkdir(parents=True)
            for f in RECEIPT_FILES:
                if (src / f).is_file():
                    shutil.copy2(src / f, dst / f)
            if (src / 'workspace' / 'answer.json').is_file():
                shutil.copy2(src / 'workspace' / 'answer.json', dst / 'answer.json')
            lines.append(f"- {name}/{cell['directory']}: {cell['arm']} arm, task {cell['task']}, position {cell['position']}")
    (out / 'receipts' / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf8')
    experiments = args.repo / 'docs' / 'experiments'
    (out / 'prior').mkdir()
    shutil.copy2(experiments / 'REPEATED-RUNS.md', out / 'prior' / 'REPEATED-RUNS.md')
    for results in sorted(experiments.glob('*/RESULTS.md')):
        if results.parent.name == HERE.name:
            continue
        (out / 'prior' / results.parent.name).mkdir()
        shutil.copy2(results, out / 'prior' / results.parent.name / 'RESULTS.md')
    print(json.dumps({'bundle': str(out), 'files': sum(1 for p in out.rglob('*') if p.is_file())}))
    return 0


def run(args):
    for path in args.forbid:
        if pathlib.Path(path).exists():
            raise SystemExit(f'refusing to run: {path} exists on this machine (the reviewer can read it)')
    codex = h.resolve_codex(args.codex)
    bundle, out = args.bundle, args.out
    out.mkdir(mode=0o700)
    home = out / 'reviewer-home'
    home.mkdir(mode=0o700)
    (home / 'auth.json').symlink_to(args.auth_file)
    (home / 'config.toml').write_text(h.codex_config('reviewer', h.SETTINGS), encoding='utf8')
    text = PROMPT.format(repo=args.repo)
    (out / 'prompt.txt').write_text(text, encoding='utf8')
    argv = h.command_v1(codex, 'reviewer', h.SETTINGS, bundle, out / 'protocol-review.md', text)
    started, clock = h.utc(), time.monotonic()
    try:
        p = subprocess.run(argv, cwd=bundle, env={**os.environ, 'CODEX_HOME': str(home)}, capture_output=True, text=True,
                           timeout=args.timeout)
        code, stdout, stderr = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as exc:
        code = 'timeout'
        stdout = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or '')
        stderr = exc.stderr.decode() if isinstance(exc.stderr, bytes) else (exc.stderr or '')
    (out / 'events.jsonl').write_text(stdout, encoding='utf8')
    (out / 'stderr.txt').write_text(stderr, encoding='utf8')
    receipt = {'startedAt': started, 'seconds': round(time.monotonic() - clock, 1), 'exitCode': code,
               'usage': {k: v for k, v in h.usage(stdout).items() if k != 'raw'},
               'outsideReferences': h.outside_references(stdout, bundle),
               'reportPresent': (out / 'protocol-review.md').is_file()}
    h.write_json(out / 'receipt.json', receipt)
    print(json.dumps({k: receipt[k] for k in ('seconds', 'exitCode', 'reportPresent')} | {'total': receipt['usage'].get('total'),
                      'outside': len(receipt['outsideReferences'])}))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('build')
    q.add_argument('--plans', nargs='+', required=True, help='name=plan-directory, one per phase 1 attempt')
    q.add_argument('--repo', required=True, type=pathlib.Path)
    q.add_argument('--out', required=True, type=pathlib.Path)
    q = sub.add_parser('run')
    q.add_argument('--bundle', required=True, type=pathlib.Path)
    q.add_argument('--repo', required=True, type=pathlib.Path)
    q.add_argument('--codex', required=True, type=pathlib.Path)
    q.add_argument('--auth-file', required=True, type=pathlib.Path)
    q.add_argument('--out', required=True, type=pathlib.Path)
    q.add_argument('--timeout', type=int, default=7200)
    q.add_argument('--forbid', nargs='*', default=[])
    args = p.parse_args(argv)
    return {'build': build, 'run': run}[args.cmd](args)


if __name__ == '__main__':
    sys.exit(main())
