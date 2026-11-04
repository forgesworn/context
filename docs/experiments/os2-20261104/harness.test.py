#!/usr/bin/env python3
"""Fixture tests for harness.py. Model-free: Codex is a fake that records any call."""
import importlib.util
import json
import os
import pathlib
import stat
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harness', HERE / 'harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

TASKS = [f't{i}' for i in range(1, 9)]


def stream(*usages, extra=()):
    lines = [json.dumps({'event': {'type': 'thread.started'}})]
    for u in usages:
        lines.append(json.dumps({'event': {'type': 'turn.completed', 'usage': u}}))
    lines.extend(json.dumps({'event': e}) for e in extra)
    return '\n'.join(lines)


class Schedule(unittest.TestCase):
    def check(self, arms, expected_cells):
        cells = h.schedule(TASKS, arms, 3)
        self.assertEqual(len(cells), expected_cells)
        n = len(arms)
        for r in (1, 2, 3):
            for i, task in enumerate(TASKS, 1):
                block = [c for c in cells if c['task'] == task and c['repetition'] == r]
                self.assertEqual(sorted(c['arm'] for c in block), sorted(arms))
                first = next(c for c in block if c['position'] == 1)
                self.assertEqual(first['arm'], arms[(i + r - 1) % n])
        return cells

    def test_two_arms_give_48_cells_and_alternate_the_first_arm(self):
        cells = self.check(('plain', 'context'), 48)
        firsts = [c['arm'] for c in cells if c['task'] == 't1' and c['position'] == 1]
        self.assertEqual(firsts, ['context', 'plain', 'context'])  # (1 + r - 1) mod 2

    def test_three_arms_give_72_cells_and_each_arm_leads_once_per_task(self):
        cells = self.check(('plain', 'context', 'graphify'), 72)
        for task in TASKS:
            firsts = sorted(c['arm'] for c in cells if c['task'] == task and c['position'] == 1)
            self.assertEqual(firsts, ['context', 'graphify', 'plain'])

    def test_arm_sets_are_validated(self):
        for bad in (('plain',), ('plain', 'plain'), ('plain', 'other'), ('context', 'graphify')):
            with self.assertRaises(ValueError):
                h.schedule(TASKS, bad, 3)


class ArmSetup(unittest.TestCase):
    def test_only_context_gets_the_server_with_all_seven_tools_bound_to_its_workspace(self):
        ctx = h.codex_config('context', h.SETTINGS, '/w/ws', '/bin/node', '/c/cli.mjs')
        self.assertIn('args = ["/c/cli.mjs", "navigate", "/w/ws"]', ctx)
        self.assertIn('"repository_packet"', ctx)
        self.assertIn('enabled_tools = ' + json.dumps(h.CONTEXT_TOOLS), ctx)
        self.assertEqual(len(h.CONTEXT_TOOLS), 7)
        for arm in ('plain', 'graphify', 'reviewer'):
            self.assertNotIn('mcp_servers', h.codex_config(arm, h.SETTINGS))
        with self.assertRaises(ValueError):
            h.codex_config('context', h.SETTINGS, 'relative', '/bin/node', '/c/cli.mjs')

    def test_config_and_command_agree_on_model_and_effort(self):
        cfg = h.codex_config('plain', h.SETTINGS)
        argv = h.command('/opt/codex', 'executor', h.SETTINGS, '/w', '/w/final.txt')
        self.assertIn('model = "gpt-5.6-sol"', cfg)
        self.assertIn('model_reasoning_effort = "high"', cfg)
        self.assertEqual(argv[argv.index('-m') + 1], 'gpt-5.6-sol')
        self.assertEqual(argv[argv.index('-c') + 1], 'model_reasoning_effort="high"')

    def test_instructions_are_of_similar_length_and_the_task_body_is_shared(self):
        words = {a: len(t.split()) for a, t in h.INSTRUCTIONS.items()}
        self.assertLessEqual(max(words.values()) / min(words.values()), 1.25, words)
        bodies = {h.prompt(a, 'TASK').split('\n', 1)[1] for a in h.ARM_NAMES}
        self.assertEqual(len(bodies), 1)
        self.assertIn('No navigation service', h.prompt('plain', 'TASK'))


class NoAlias(unittest.TestCase):
    def test_commands_are_lists_with_one_sandbox_and_no_bypass(self):
        ex = h.command('/opt/codex', 'executor', h.SETTINGS, '/w', '/w/f')
        rv = h.command('/opt/codex', 'reviewer', h.SETTINGS, '/r', '/r/f', 'review this')
        self.assertEqual(ex[ex.index('--sandbox') + 1], 'workspace-write')
        self.assertEqual(rv[rv.index('--sandbox') + 1], 'read-only')
        self.assertEqual(ex[-1], '-')
        self.assertIn('--skip-git-repo-check', rv)
        self.assertNotIn('--skip-git-repo-check', ex)
        with self.assertRaises(ValueError):
            h.command('/opt/codex', 'reviewer', h.SETTINGS, '/r', '/r/f')

    def test_bypass_overrides_shells_and_strings_are_rejected(self):
        base = h.command('/opt/codex', 'executor', h.SETTINGS, '/w', '/w/f')
        for bad in (base + ['--dangerously-bypass-approvals-and-sandbox'], base + ['--full-auto'], base + ['-s', 'danger-full-access'],
                    base[:-1] + ['-c', 'sandbox_mode="danger-full-access"', '-'], ['codex'] + base[1:], ['/bin/zsh', '-lc', 'codex exec'],
                    [x for x in base if x not in ('--sandbox', 'workspace-write')], ' '.join(base)):
            with self.assertRaises(ValueError, msg=str(bad)[:80]):
                h.validate_command(bad)

    def test_resolve_codex_needs_an_absolute_executable_that_is_not_a_shell(self):
        with tempfile.TemporaryDirectory() as d:
            fake = pathlib.Path(d) / 'codex'
            fake.write_text('#!/bin/sh\n'); fake.chmod(0o755)
            link = pathlib.Path(d) / 'link'; link.symlink_to(fake)
            self.assertEqual(h.resolve_codex(link), fake.resolve())
            shell = pathlib.Path(d) / 'zsh'; shell.write_text(''); shell.chmod(0o755)
            for bad in ('codex', str(pathlib.Path(d) / 'missing'), str(shell)):
                with self.assertRaises(ValueError):
                    h.resolve_codex(bad)


class Usage(unittest.TestCase):
    U = {'input_tokens': 1000, 'cached_input_tokens': 600, 'output_tokens': 200, 'reasoning_output_tokens': 50}

    def test_complete_stream_reports_parts_without_double_counting(self):
        u = h.usage(stream(self.U, self.U))
        self.assertTrue(u['complete'])
        self.assertEqual((u['input'], u['cached'], u['uncached'], u['output'], u['reasoning'], u['total']),
                         (2000, 1200, 800, 400, 100, 2400))
        self.assertEqual(u['turns'], 2)

    def test_missing_usage_or_failure_is_incomplete_never_zero(self):
        for text in (stream(), stream(None), stream(self.U, {'output_tokens': 3}),
                     stream(self.U, extra=[{'type': 'turn.failed', 'error': {'message': 'x'}}])):
            u = h.usage(text)
            self.assertFalse(u['complete'])
            self.assertIsNone(u['total'])

    def test_cache_writes_are_reported_and_flagged_but_not_added_to_the_total(self):
        u = h.usage(stream({**self.U, 'cache_write_input_tokens': 0}))
        self.assertEqual((u['cacheWrite'], u['cacheWriteSeen'], u['total']), (0, False, 1200))
        u = h.usage(stream({**self.U, 'cache_write_input_tokens': 70}))
        self.assertEqual((u['cacheWrite'], u['cacheWriteSeen'], u['total']), (70, True, 1200))

    def test_raw_unwrapped_lines_and_junk_are_handled(self):
        text = 'junk\n' + json.dumps({'type': 'turn.completed', 'usage': self.U})
        self.assertEqual(h.usage(text)['total'], 1200)

    def test_cell_total_is_none_if_any_part_is_incomplete(self):
        good, bad = h.usage(stream(self.U)), h.usage(stream())
        self.assertEqual(h.cell_total([good, good]), 2400)
        self.assertIsNone(h.cell_total([good, bad]))
        self.assertIsNone(h.cell_total([]))


class CostGate(unittest.TestCase):
    def cells(self, ctx, plain, ctx_seconds=10, plain_seconds=10):
        out = []
        for t in ('a', 'b'):
            for r, (c, p) in enumerate(zip(ctx, plain)):
                out.append({'task': t, 'arm': 'context', 'totalTokens': c, 'reviewerSeconds': ctx_seconds})
                out.append({'task': t, 'arm': 'plain', 'totalTokens': p, 'reviewerSeconds': plain_seconds})
        return out

    def test_twenty_percent_lower_passes_and_uses_medians(self):
        g = h.cost_gate(self.cells([80, 79, 10**9], [100, 100, 100]), ['plain'])
        self.assertTrue(g['passed'])
        self.assertAlmostEqual(g['comparisons']['plain']['tokenRatio'], 0.8)

    def test_fifteen_percent_lower_fails(self):
        self.assertFalse(h.cost_gate(self.cells([85] * 3, [100] * 3), ['plain'])['passed'])

    def test_higher_reviewer_time_fails(self):
        g = h.cost_gate(self.cells([50] * 3, [100] * 3, ctx_seconds=11), ['plain'])
        self.assertFalse(g['passed'])
        self.assertFalse(g['comparisons']['plain']['reviewerSecondsNoHigher'])

    def test_an_incomplete_cell_in_either_arm_fails_the_gate(self):
        for cells in (self.cells([50, None, 50], [100] * 3), self.cells([50] * 3, [100, 100, None])):
            g = h.cost_gate(cells, ['plain'])
            self.assertFalse(g['passed'])
            self.assertEqual(g['incompleteTasks'], ['a', 'b'])

    def test_each_comparator_must_be_beaten(self):
        cells = self.cells([80] * 3, [100] * 3)
        cells += [{'task': t, 'arm': 'graphify', 'totalTokens': 90, 'reviewerSeconds': 10} for t in ('a', 'b') for _ in range(3)]
        g = h.cost_gate(cells, ['plain', 'graphify'])
        self.assertTrue(g['comparisons']['plain']['passed'])
        self.assertFalse(g['comparisons']['graphify']['passed'])
        self.assertFalse(g['passed'])


class PlanDryRun(unittest.TestCase):
    def test_plan_writes_every_cell_and_never_starts_codex(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            marker = d / 'codex-was-run'
            fake = d / 'codex'
            fake.write_text(f'#!/bin/sh\ntouch {marker}\n'); fake.chmod(0o755)
            tasks = d / 'tasks'; tasks.mkdir()
            for t in TASKS:
                (tasks / f'{t}.json').write_text(json.dumps({'id': t, 'statement': f'Do {t}.'}))
            out = d / 'plan'
            self.assertEqual(h.main(['plan', '--tasks', str(tasks), '--codex', str(fake), '--node', '/bin/node',
                                     '--navigation-cli', '/c/cli.mjs', '--out', str(out)]), 0)
            self.assertFalse(marker.exists())
            plan = json.loads((out / 'schedule.json').read_text())
            self.assertEqual(len(plan['cells']), 48)
            for cell in plan['cells']:
                cd = out / cell['directory']
                argv = json.loads((cd / 'executor-command.json').read_text())
                h.validate_command(argv)
                self.assertEqual(argv[0], str(fake.resolve()))
                cfg = (cd / 'executor-config.toml').read_text()
                self.assertEqual('mcp_servers' in cfg, cell['arm'] == 'context')
                if cell['arm'] == 'context':
                    self.assertIn(json.dumps(str(cd / 'workspace')), cfg)
                self.assertIn(f"Do {cell['task']}.", (cd / 'executor-prompt.txt').read_text())
                self.assertRegex(cell['directory'], r'^cell-\d{3}$')
            with self.assertRaises(SystemExit):
                h.main(['plan', '--tasks', str(tasks), '--codex', str(fake), '--node', '/bin/node',
                        '--navigation-cli', '/c/cli.mjs', '--out', str(out)])


FAKE_CODEX = r'''#!/usr/bin/env python3
import sys, json, pathlib
a = sys.argv
cwd = pathlib.Path(a[a.index('-C') + 1]); out = pathlib.Path(a[a.index('-o') + 1])
U = {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 10, "reasoning_output_tokens": 2, "cache_write_input_tokens": 0}
if a[a.index('--sandbox') + 1] == 'workspace-write':
    sys.stdin.read()
    (cwd / 'src.ts').write_text('export const v = "fixed"\n')
    (cwd.parent / 'escape.txt').write_text('outside the workspace\n')
    (cwd / 'answer.json').write_text(json.dumps({"filesChanged": ["src.ts"], "summary": "s", "testsRun": [],
        "evidence": [{"path": "src.ts", "startLine": 1, "endLine": 1, "claim": "c"}, {"path": "../escape.txt", "startLine": 1, "endLine": 1, "claim": "x"}]}))
    print(json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "/bin/zsh -lc 'cat /etc/hosts && cat src.ts'", "exit_code": 0, "status": "completed"}}))
else:
    rubric = json.loads((cwd / 'rubric.json').read_text())
    assert (cwd / 'source' / 'src.ts').is_file() and not (cwd / 'escape.txt').exists()
    out.write_text(json.dumps({"accepted": True, "findings": [{"id": r["id"], "passed": True, "reason": "ok"} for r in rubric["rubric"]], "materialIssues": []}))
print(json.dumps({"type": "turn.completed", "usage": U}))
'''


class ExecutionPath(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.d = pathlib.Path(self.tmp.name).resolve()
        self.codex = d / 'codex'; self.codex.write_text(FAKE_CODEX); self.codex.chmod(0o755)
        self.auth = d / 'auth.json'; self.auth.write_text('{}')
        repo = self.repo = d / 'repos' / 'r'; repo.mkdir(parents=True)
        g = lambda *a: h.git(repo, *a).stdout.strip()
        g('init', '-q')
        (repo / 'src.ts').write_text('export const v = "buggy"\n'); (repo / '.gitignore').write_text('node_modules/\n')
        g('add', '-A'); g('commit', '-qm', 'base'); base = g('rev-parse', 'HEAD')
        (repo / 'src.ts').write_text('export const v = "fixed"\n'); (repo / 'check.test.ts').write_text('// expects fixed\n')
        g('add', '-A'); g('commit', '-qm', 'fix'); change = g('rev-parse', 'HEAD')
        self.archive_dir = d / 'archives'; self.archive_dir.mkdir()
        h.git(repo, 'archive', '--format=tar', '-o', str(self.archive_dir / 'r-code-change.tar'), base)
        self.tasks = d / 'tasks'; self.tasks.mkdir()
        self.task = {'id': 'r-code-change', 'repository': 'r', 'class': 'code-change', 'baseCommit': base,
                     'statement': 'Make v fixed.', 'answerFormat': '{"filesChanged": [...]}'}
        (self.tasks / 'r-code-change.json').write_text(json.dumps(self.task))
        self.acc = d / 'acceptance'; self.acc.mkdir()
        (self.acc / 'r-code-change.json').write_text(json.dumps({'id': 'r-code-change', 'sourceChange': change,
            'requiredEvidence': [{'path': 'src.ts', 'startLine': 1, 'endLine': 1}], 'dependencySet': [{'path': 'src.ts', 'symbol': 'v'}],
            'checker': {'setup': 'true', 'command': 'grep -q fixed src.ts && test -f check.test.ts', 'testFiles': ['check.test.ts']},
            'rubric': [{'id': 'R1', 'requirement': 'v is fixed'}], 'scope': 'src.ts', 'notes': ''}))
        self.archives = d / 'archives.json'
        self.archives.write_text(json.dumps({'r-code-change': h.sha256_file(self.archive_dir / 'r-code-change.tar')}))

    def tearDown(self):
        self.tmp.cleanup()

    def run_all(self, forbid=()):
        d = self.d
        h.INSTALL['r'] = 'true'
        self.assertEqual(h.main(['prepare', '--tasks', str(self.tasks), '--archives', str(self.archives),
                                 '--archive-dir', str(self.archive_dir), '--templates', str(d / 'templates')]), 0)
        self.assertEqual(h.main(['plan', '--tasks', str(self.tasks), '--repetitions', '1', '--codex', str(self.codex),
                                 '--node', '/bin/node', '--navigation-cli', '/c/cli.mjs', '--out', str(d / 'plan')]), 0)
        common = ['--plan', str(d / 'plan'), '--tasks', str(self.tasks), '--codex', str(self.codex), '--auth-file', str(self.auth)]
        node = os.environ.get('OS2_NODE', '/usr/local/bin/node')
        return h.main(['execute', *common, '--templates', str(d / 'templates'), '--node', node,
                       '--navigation-cli', '/c/cli.mjs', '--forbid', *forbid]), common

    def test_prepare_rejects_a_changed_archive(self):
        self.archives.write_text(json.dumps({'r-code-change': '0' * 64}))
        with self.assertRaises(ValueError):
            h.main(['prepare', '--tasks', str(self.tasks), '--archives', str(self.archives),
                    '--archive-dir', str(self.archive_dir), '--templates', str(self.d / 'templates')])

    def test_execute_refuses_while_acceptance_files_are_on_the_machine(self):
        with self.assertRaises(SystemExit):
            self.run_all(forbid=[str(self.acc)])

    def test_execute_then_assess_end_to_end(self):
        code, common = self.run_all(forbid=[str(self.d / 'not-here')])
        self.assertEqual(code, 0)
        cells = sorted((self.d / 'plan').glob('cell-*'))
        self.assertEqual(len(cells), 2)
        for cell in cells:
            ex = json.loads((cell / 'executor.json').read_text())
            self.assertEqual(ex['changedFiles'], ['src.ts'])
            self.assertTrue(ex['answerPresent'])
            self.assertEqual(ex['usage']['total'], 110)
            self.assertEqual(ex['outsideReferences'], ['/etc/hosts'])
            self.assertIn('fixed', (cell / 'executor.diff').read_text())
        self.assertEqual(h.main(['assess', *common, '--acceptance', str(self.acc), '--repos', str(self.d / 'repos')]), 0)
        for cell in cells:
            a = json.loads((cell / 'assessment.json').read_text())
            self.assertTrue(a['checker']['passed'])
            self.assertEqual(a['dependencies'], {'missed': 0, 'incorrect': 0, 'total': 0})
            self.assertTrue(a['reviewer']['valid'])
            self.assertTrue(a['accepted'])
            self.assertEqual(a['totalTokens'], 220)
            self.assertFalse((cell / 'check').exists())

    def test_a_failed_checker_is_never_accepted(self):
        code, common = self.run_all()
        acc = json.loads((self.acc / 'r-code-change.json').read_text())
        acc['checker']['command'] = 'exit 1'
        (self.acc / 'r-code-change.json').write_text(json.dumps(acc))
        h.main(['assess', *common, '--acceptance', str(self.acc), '--repos', str(self.d / 'repos')])
        for cell in sorted((self.d / 'plan').glob('cell-*')):
            a = json.loads((cell / 'assessment.json').read_text())
            self.assertFalse(a['checker']['passed'])
            self.assertTrue(a['reviewer']['accepted'])
            self.assertFalse(a['accepted'])

    def test_dependency_count_and_review_validation(self):
        task = {'class': 'impact'}
        acc = {'dependencySet': [{'path': 'a.ts'}, {'path': 'b.ts'}]}
        answer = {'mustChange': [{'path': 'a.ts'}, {'path': 'invented.ts'}]}
        self.assertEqual(h.dependency_count(task, acc, answer, [], {'a.ts', 'b.ts'}), {'missed': 1, 'incorrect': 1, 'total': 2})
        self.assertIsNone(h.dependency_count({'class': 'orientation'}, acc, answer, [], set()))
        good = {'accepted': True, 'findings': [{'id': 'R1', 'passed': True, 'reason': 'ok'}], 'materialIssues': []}
        self.assertEqual(h.review_outcome(good, ['R1']), {'valid': True, 'accepted': True})
        self.assertEqual(h.review_outcome({**good, 'materialIssues': ['x']}, ['R1']), {'valid': True, 'accepted': False})
        self.assertEqual(h.review_outcome({**good, 'findings': []}, ['R1'])['valid'], False)
        self.assertEqual(h.review_outcome(None, ['R1'])['valid'], False)


if __name__ == '__main__':
    unittest.main()
