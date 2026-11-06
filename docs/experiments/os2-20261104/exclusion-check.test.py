#!/usr/bin/env python3
"""Tests for exclusion-check.py: each exclusion is caught, and output never names a path or commit."""
import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('x', HERE / 'exclusion-check.py')
x = importlib.util.module_from_spec(spec)
spec.loader.exec_module(x)

A, B, C = 'a' * 40, 'b' * 40, 'c' * 40


def acc(i, change, deps, ev=(), scope=None):
    return {'id': i, 'sourceChange': change, 'dependencySet': [{'path': p} for p in deps],
            'requiredEvidence': [{'path': p, 'startLine': 1, 'endLine': 1} for p in ev],
            'scope': {'allowedPaths': ['src/*']} if scope is None else scope}


class Exclusions(unittest.TestCase):
    def setUp(self):
        self.existing = {'k-orientation': acc('k-orientation', None, [], ['secret/kept.ts']),
                         'old-impact': acc('old-impact', A, ['secret/old.ts'])}
        self.tasks = {'k-orientation': {'id': 'k-orientation', 'baseCommit': B}, 'old-impact': {'id': 'old-impact', 'baseCommit': C}}

    def run_check(self, new):
        return x.check(self.existing, self.tasks, ['k-orientation'], new)

    def test_a_clean_task_passes(self):
        out = self.run_check({'n-impact': (acc('n-impact', 'd' * 40, ['src/new.ts']), {'id': 'n-impact', 'baseCommit': 'e' * 40})})
        self.assertTrue(out['allClean'])

    def test_each_exclusion_is_caught(self):
        t = lambda base='e' * 40: {'id': 'n', 'baseCommit': base}
        cases = {'sourceChangeReused': (acc('n', A, ['src/new.ts']), t()),
                 'baseCommitReused': (acc('n', 'd' * 40, ['src/new.ts']), t(C)),
                 'pathsInExistingDependencySets': (acc('n', 'd' * 40, ['secret/old.ts']), t()),
                 'pathsInKeptRequiredEvidence': (acc('n', 'd' * 40, ['src/new.ts'], ['secret/kept.ts']), t()),
                 'scopeValid': (acc('n', 'd' * 40, ['src/new.ts'], scope='src only'), t())}
        for field, pair in cases.items():
            out = x.check(self.existing, self.tasks, ['k-orientation'], {'n': pair})
            self.assertFalse(out['allClean'], field)

    def test_new_tasks_must_not_share_dependency_paths(self):
        new = {'n1': (acc('n1', 'd' * 40, ['src/same.ts']), {'id': 'n1', 'baseCommit': 'e' * 40}),
               'n2': (acc('n2', 'f' * 40, ['src/same.ts']), {'id': 'n2', 'baseCommit': '1' * 40})}
        self.assertFalse(self.run_check(new)['allClean'])

    def test_stdout_never_names_a_path_or_commit(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            for name, files in (('existing', self.existing), ('etasks', self.tasks),
                                ('nacc', {'n': acc('n', A, ['secret/old.ts'], ['secret/kept.ts'])}), ('ntasks', {'n': {'id': 'n', 'baseCommit': C}})):
                (d / name).mkdir()
                for i, body in files.items():
                    (d / name / f'{i}.json').write_text(json.dumps(body))
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = x.main(['--existing', str(d / 'existing'), '--existing-tasks', str(d / 'etasks'), '--kept', 'k-orientation',
                               '--new', f"{d / 'nacc'}:{d / 'ntasks'}"])
            self.assertEqual(code, 1)
            for secret in ('secret', A, C, '.ts'):
                self.assertNotIn(secret, buf.getvalue())


if __name__ == '__main__':
    unittest.main()
