#!/usr/bin/env python3
"""OS2 v2 reviewer and quality-measure pilot on recorded cells (outside phase 2).

For each recorded executor cell (copied, never moved): run the hidden checker
and the dependency count, then the v2 primary reviewer (Claude, no tools) and
the second reviewer (Codex, read-only profile) on the same review material.
Paid: two reviewer sessions per cell; run only with the owner's approval.

The recorded cells ran under protocol v1, whose acceptance scope is text, so
scope is not enforced here (it is reported as None). Prints counts and
booleans only: accepted per reviewer, rubric agreement and dependency counts.

    python3 pilot.py --cells PLAN/cell-001 ... --tasks DIR --acceptance DIR --repos DIR
        --codex ABS --claude ABS --auth-file ABS --toolchain ABS --out NEW_DIR
"""
import argparse
import importlib.util
import json
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harness', HERE / 'harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

COPY = ('executor.json', 'executor.diff', 'executor-events.jsonl', 'workspace')


def pilot_cell(codex, claude, plan_doc, cell_dir, task, acc, repo, auth, toolchain, timeout):
    receipt, answer, checker, deps, _ = h.run_checker(cell_dir, task, acc, repo, strict_scope=False, toolchain=toolchain)
    ws = cell_dir / 'workspace'
    root = h.make_root(h.active_root(plan_doc, cell_dir.name, 'review'), 'review')
    review = root / 'review'
    h.write_json(review / 'task.json', {k: task[k] for k in ('id', 'repository', 'class', 'statement', 'answerFormat')})
    h.write_json(review / 'answer.json', answer if answer is not None else {'error': 'answer.json missing or invalid'})
    if (cell_dir / 'executor.diff').read_text(encoding='utf8'):
        shutil.copy2(cell_dir / 'executor.diff', review / 'executor.diff')
    h.write_json(review / 'checker.json', {k: checker.get(k) for k in ('ran', 'passed', 'exitCode', 'tail')})
    h.write_json(review / 'rubric.json', {k: acc.get(k) for k in ('rubric', 'requiredEvidence', 'scope', 'notes')})
    h.evidence_excerpts(ws, answer, review)
    ids = [r['id'] for r in acc.get('rubric', [])]
    try:
        primary = h.claude_review(claude, cell_dir, review, ids, timeout)
        second = h.codex_review(codex, cell_dir, root, review, toolchain, auth, ids, timeout)
    finally:
        if review.exists():
            shutil.move(str(review), str(cell_dir / 'review'))
        shutil.rmtree(root, ignore_errors=True)
    result = {'checker': {k: checker.get(k) for k in ('ran', 'passed')}, 'dependencies': deps, 'reviewer': primary,
              'secondReviewer': second, 'executorTokens': receipt['usage'].get('total')}
    h.write_json(cell_dir / 'pilot.json', result)
    return result


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--cells', nargs='+', required=True, type=pathlib.Path)
    for k in ('tasks', 'acceptance', 'repos', 'codex', 'claude', 'auth-file', 'toolchain', 'out'):
        p.add_argument(f'--{k}', required=True, type=pathlib.Path)
    p.add_argument('--timeout', type=int, default=1800)
    a = p.parse_args(argv)
    if not a.out.is_absolute() or a.out.exists():
        raise SystemExit('--out must be a new absolute directory')
    codex, claude = h.resolve_codex(a.codex), h.resolve_codex(a.claude)
    tasks = {t['id']: t for _, t in h.load_tasks(a.tasks)}
    a.out.mkdir(mode=0o700)
    plan_doc = {'planId': 'pilot' + h.uuid.uuid4().hex[:8], 'activeBase': str(h.ACTIVE_BASE), 'reviewer': h.REVIEWER}
    rows = {}
    for n, src in enumerate(a.cells, 1):
        sched = json.loads((src.parent / 'schedule.json').read_text(encoding='utf8'))
        cell = next(c for c in sched['cells'] if c['directory'] == src.name)
        d = a.out / f'cell-{n:03d}'
        d.mkdir(mode=0o700)
        for name in COPY:
            s = src / name
            if s.is_dir():
                shutil.copytree(s, d / name, symlinks=True)
            elif s.exists():
                shutil.copy2(s, d / name)
        task = tasks[cell['task']]
        acc = json.loads((a.acceptance / f"{task['id']}.json").read_text(encoding='utf8'))
        r = pilot_cell(codex, claude, plan_doc, d, task, acc, a.repos / task['repository'], a.auth_file, a.toolchain, a.timeout)
        rows[d.name] = {'reviewer': r['reviewer'], 'secondReviewer': r['secondReviewer']}
        print(json.dumps({'cell': d.name, 'arm': cell['arm'], 'source': f'{src.parent.name}/{src.name}',
                          'checkerPassed': r['checker'].get('passed'),
                          'claude': {k: r['reviewer'][k] for k in ('valid', 'accepted', 'exitCode', 'seconds', 'diffTruncated')}
                                    | {'tokens': r['reviewer']['usage'].get('total'), 'complete': r['reviewer']['usage']['complete']},
                          'codex': {k: r['secondReviewer'][k] for k in ('valid', 'accepted', 'exitCode', 'seconds')}
                                   | {'tokens': r['secondReviewer']['usage'].get('total'), 'complete': r['secondReviewer']['usage'].get('complete')},
                          'dependencies': {k: r['dependencies'].get(k) for k in ('total', 'missed', 'incorrect', 'extra', 'recall', 'precision')}}))
    agreement = h.reviewer_agreement(rows, sorted(rows))
    h.write_json(a.out / 'agreement.json', agreement)
    print(json.dumps({'agreement': agreement}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
