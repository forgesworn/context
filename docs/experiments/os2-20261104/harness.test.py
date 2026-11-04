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
                self.assertTrue((cd / 'executor-prompt.txt').read_text().endswith(f"Do {cell['task']}.\n"))
            with self.assertRaises(SystemExit):
                h.main(['plan', '--tasks', str(tasks), '--codex', str(fake), '--node', '/bin/node',
                        '--navigation-cli', '/c/cli.mjs', '--out', str(out)])


if __name__ == '__main__':
    unittest.main()
