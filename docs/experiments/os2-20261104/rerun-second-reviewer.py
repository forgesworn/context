#!/usr/bin/env python3
"""Rerun only the Codex second reviewer on assessed cells whose second review
never started (timeout with no events), reusing the saved review material.

The failed attempt moves to repair-codex-1/ in the cell. The primary (Claude)
verdict, the checker and the executor record are left as they are. Paid: one
Codex reviewer session per cell; run only with the owner's approval.

    python3 rerun-second-reviewer.py --plan ABS --codex ABS --auth-file ABS --toolchain ABS
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

FAILED = ('reviewer-home', 'review-probe-home', 'reviewer-events.jsonl', 'review-final.json')


def never_started(second):
    return bool(second) and second.get('exitCode') == 'timeout' and not second.get('valid') and not second['usage'].get('complete')


def rerun(codex, plan_doc, cell_dir, auth, toolchain, timeout):
    assessment = json.loads((cell_dir / 'assessment.json').read_text(encoding='utf8'))
    if not never_started(assessment.get('secondReviewer')):
        return assessment, False
    if (cell_dir / 'repair-codex-1').exists():
        raise SystemExit(f'{cell_dir.name}: already repaired once')
    if (cell_dir / 'reviewer-events.jsonl').exists() and (cell_dir / 'reviewer-events.jsonl').stat().st_size:
        raise SystemExit(f'{cell_dir.name}: the failed review has events; reconcile before any rerun')
    repair = cell_dir / 'repair-codex-1'
    repair.mkdir(mode=0o700)
    for name in FAILED:
        if (cell_dir / name).exists():
            shutil.move(str(cell_dir / name), str(repair / name))
    h.write_json(repair / 'secondReviewer.json', assessment['secondReviewer'])
    root = h.make_root(h.active_root(plan_doc, cell_dir.name, 'review'), 'review')
    review = root / 'review'
    shutil.rmtree(review, ignore_errors=True)
    shutil.copytree(cell_dir / 'review', review, symlinks=True)
    rubric_ids = [r['id'] for r in json.loads((review / 'rubric.json').read_text(encoding='utf8')).get('rubric', [])]
    try:
        second = h.codex_review(codex, cell_dir, root, review, toolchain, auth, rubric_ids, timeout)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    assessment['secondReviewer'] = second
    assessment['reviewerTokens']['codex'] = second['usage'].get('total') if second['usage'].get('complete') else None
    assessment['reviewerSeconds'] = assessment['reviewer']['seconds'] + second['seconds']
    assessment['secondReviewerRepair'] = {'attempt': 2, 'reason': 'first attempt inherited an open stdin and never sent a request'}
    h.write_json(cell_dir / 'assessment.json', assessment)
    return assessment, True


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for k in ('plan', 'codex', 'auth-file', 'toolchain'):
        p.add_argument(f'--{k}', required=True, type=pathlib.Path)
    p.add_argument('--timeout', type=int, default=1800)
    a = p.parse_args(argv)
    plan_doc = json.loads((a.plan / 'schedule.json').read_text(encoding='utf8'))
    codex = h.resolve_codex(a.codex)
    sample = plan_doc.get('agreementSample') or []
    rows = {}
    for name in sample:
        assessment, ran = rerun(codex, plan_doc, a.plan / name, a.auth_file, a.toolchain, a.timeout)
        s = assessment['secondReviewer']
        rows[name] = assessment
        print(json.dumps({'cell': name, 'rerun': ran, 'claudeAccepted': assessment['reviewer']['accepted'],
                          'codex': {k: s.get(k) for k in ('valid', 'accepted', 'exitCode', 'seconds')}
                                   | {'tokens': s['usage'].get('total'), 'complete': s['usage'].get('complete')}}))
    agreement = h.reviewer_agreement(rows, sample)
    print(json.dumps({'agreement': agreement}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
