#!/usr/bin/env python3
"""Tests for protocol-review.py. No model is started: Codex is a fake script."""
import importlib.util
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('protocol_review', HERE / 'protocol-review.py')
pr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pr)

FAKE_CODEX = r'''#!/usr/bin/env python3
import sys, json, pathlib
a = sys.argv
assert a[a.index('--sandbox') + 1] == 'read-only'
pathlib.Path(a[a.index('-o') + 1]).write_text('# Review\n')
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 10, "cached_input_tokens": 4, "output_tokens": 2,
                  "reasoning_output_tokens": 1, "cache_write_input_tokens": 0}}))
'''


class Bundle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.d = pathlib.Path(self.tmp.name).resolve()
        plan = self.plan = d / 'plan'
        cell = plan / 'cell-001'
        (cell / 'review').mkdir(parents=True)
        (cell / 'workspace').mkdir()
        (plan / 'schedule.json').write_text(json.dumps({'cells': [{'directory': 'cell-001', 'arm': 'plain', 'task': 't', 'position': 1}]}))
        for f in ('executor.json', 'executor-events.jsonl', 'assessment.json', 'review-final.json', 'reviewer-events.jsonl'):
            (cell / f).write_text('{}')
        (cell / 'review' / 'rubric.json').write_text('{"hidden": true}')
        (cell / 'workspace' / 'answer.json').write_text('{}')
        exp = d / 'repo' / 'docs' / 'experiments'
        (exp / 'old').mkdir(parents=True)
        (exp / 'REPEATED-RUNS.md').write_text('x'); (exp / 'old' / 'RESULTS.md').write_text('y')

    def tearDown(self):
        self.tmp.cleanup()

    def test_bundle_never_carries_reviewer_material(self):
        out = self.d / 'bundle'
        self.assertEqual(pr.main(['build', '--plans', f'a1={self.plan}', '--repo', str(self.d / 'repo'), '--out', str(out)]), 0)
        names = {p.name for p in out.rglob('*')}
        self.assertFalse({'rubric.json', 'review-final.json', 'reviewer-events.jsonl', 'review'} & names)
        cell = out / 'receipts' / 'a1' / 'cell-001'
        self.assertEqual(sorted(p.name for p in cell.iterdir()), ['answer.json', 'assessment.json', 'executor-events.jsonl', 'executor.json'])
        self.assertTrue((out / 'prior' / 'old' / 'RESULTS.md').is_file())
        self.assertIn('plain arm', (out / 'receipts' / 'README.md').read_text())

    def test_run_refuses_while_forbidden_paths_exist_and_then_reviews(self):
        out = self.d / 'bundle'
        pr.main(['build', '--plans', f'a1={self.plan}', '--repo', str(self.d / 'repo'), '--out', str(out)])
        codex = self.d / 'codex'; codex.write_text(FAKE_CODEX); codex.chmod(0o755)
        auth = self.d / 'auth.json'; auth.write_text('{}')
        common = ['run', '--bundle', str(out), '--repo', str(self.d / 'repo'), '--codex', str(codex), '--auth-file', str(auth)]
        with self.assertRaises(SystemExit):
            pr.main([*common, '--out', str(self.d / 'r1'), '--forbid', str(self.plan)])
        self.assertFalse((self.d / 'r1').exists())
        self.assertEqual(pr.main([*common, '--out', str(self.d / 'r2'), '--forbid', str(self.d / 'absent')]), 0)
        receipt = json.loads((self.d / 'r2' / 'receipt.json').read_text())
        self.assertTrue(receipt['reportPresent'])
        self.assertEqual(receipt['usage']['total'], 12)


if __name__ == '__main__':
    unittest.main()
