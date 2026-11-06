#!/usr/bin/env python3
"""Fixture tests for harness.py. Model-free: Codex is a fake that records any call."""
import importlib.util
import json
import shutil
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


class SeededOrder(unittest.TestCase):
    def test_a_seed_shuffles_blocks_but_keeps_each_block_and_its_arm_rotation(self):
        plain = h.schedule(TASKS, ('plain', 'context'), 3)
        seeded = h.schedule(TASKS, ('plain', 'context'), 3, seed=7)
        self.assertEqual(seeded, h.schedule(TASKS, ('plain', 'context'), 3, seed=7))
        self.assertNotEqual([(c['task'], c['repetition']) for c in seeded], [(c['task'], c['repetition']) for c in plain])
        key = lambda c: (c['task'], c['repetition'], c['position'])
        self.assertEqual(sorted(map(json.dumps, plain)), sorted(map(json.dumps, seeded)))
        for i in range(0, len(seeded), 2):
            self.assertEqual((seeded[i]['task'], seeded[i]['repetition']), (seeded[i + 1]['task'], seeded[i + 1]['repetition']))
            self.assertEqual([seeded[i]['position'], seeded[i + 1]['position']], [1, 2])


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

    def test_isolated_config_denies_home_and_temp_and_writes_only_the_root(self):
        cfg = h.codex_config('plain', h.SETTINGS, root='/Users/Shared/os2-x-cell-001-cell', toolchain='/Users/Shared/os2-toolchain-a',
                             home='/Users/someone')
        self.assertIn('default_permissions = "os2"', cfg)
        self.assertIn('extends = ":workspace"', cfg)
        for line in ('"/Users/someone" = "deny"', '"/private/tmp" = "deny"', '"/private/var/folders" = "deny"',
                     '"/Users/Shared/os2-x-cell-001-cell/workspace" = "write"', '"/Users/Shared/os2-toolchain-a" = "read"'):
            self.assertIn(line, cfg)
        self.assertIn('inherit = "none"', cfg)
        self.assertIn('HOME = "/Users/Shared/os2-x-cell-001-cell/home"', cfg)
        self.assertNotIn('sandbox_mode', cfg)
        rv = h.codex_config('reviewer', h.SETTINGS, root='/Users/Shared/r', toolchain='/Users/Shared/os2-toolchain-a', home='/Users/someone')
        self.assertIn('extends = ":read-only"', rv)
        self.assertIn('"/Users/Shared/r/review" = "read"', rv)
        for bad in ('/Users/someone/plan', '/private/tmp/x', 'relative'):
            with self.assertRaises(ValueError):
                h.codex_config('plain', h.SETTINGS, root=bad, toolchain='/Users/Shared/t', home='/Users/someone')

    def test_only_isolated_executors_get_loopback_through_the_network_proxy(self):
        net = '[permissions.os2.network]\nenabled = true\nallow_local_binding = true\n'
        for arm in ('plain', 'context'):
            extra = ('/w/ws', '/bin/node', '/c/cli.mjs') if arm == 'context' else ()
            cfg = h.codex_config(arm, h.SETTINGS, *extra, root='/Users/Shared/os2-x', toolchain='/Users/Shared/os2-toolchain-a', home='/Users/someone')
            self.assertIn(net, cfg)
            self.assertIn('network_proxy = true', cfg)
            self.assertNotIn('domains', cfg)
        rv = h.codex_config('reviewer', h.SETTINGS, root='/Users/Shared/r', toolchain='/Users/Shared/os2-toolchain-a', home='/Users/someone')
        for cfg in (rv, h.codex_config('plain', h.SETTINGS)):
            self.assertNotIn('network', cfg)

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
        self.assertNotIn('repository_status', h.INSTRUCTIONS['context'])


class NoAlias(unittest.TestCase):
    def test_commands_are_lists_with_no_sandbox_flag_or_bypass(self):
        ex = h.command('/opt/codex', 'executor', h.SETTINGS, '/w', '/w/f')
        rv = h.command('/opt/codex', 'reviewer', h.SETTINGS, '/r', '/r/f', 'review this')
        for argv in (ex, rv):
            self.assertNotIn('--sandbox', argv)
            self.assertNotIn('-s', argv)
        self.assertEqual(ex[-1], '-')
        self.assertIn('--skip-git-repo-check', rv)
        self.assertNotIn('--skip-git-repo-check', ex)
        with self.assertRaises(ValueError):
            h.command('/opt/codex', 'reviewer', h.SETTINGS, '/r', '/r/f')

    def test_bypass_sandbox_mode_profile_overrides_shells_and_strings_are_rejected(self):
        base = h.command('/opt/codex', 'executor', h.SETTINGS, '/w', '/w/f')
        for bad in (base + ['--dangerously-bypass-approvals-and-sandbox'], base + ['--full-auto'], base + ['-s', 'read-only'],
                    base + ['--sandbox', 'workspace-write'], base + ['--sandbox=workspace-write'], base + ['-p', 'other'],
                    base[:-1] + ['-c', 'sandbox_mode="workspace-write"', '-'], base[:-1] + ['-c', 'default_permissions="x"', '-'],
                    base[:-1] + ['-c', 'shell_environment_policy.inherit="all"', '-'],
                    ['codex'] + base[1:], ['/bin/zsh', '-lc', 'codex exec'], ' '.join(base)):
            with self.assertRaises(ValueError, msg=str(bad)[:80]):
                h.validate_command(bad)

    def test_the_version_1_command_is_unchanged_for_the_scripts_that_ran_with_it(self):
        ex = h.command_v1('/opt/codex', 'executor', h.SETTINGS, '/w', '/w/f')
        rv = h.command_v1('/opt/codex', 'reviewer', h.SETTINGS, '/r', '/r/f', 'review this')
        self.assertEqual(ex[:5], ['/opt/codex', 'exec', '--sandbox', 'workspace-write', '--ignore-rules'])
        self.assertEqual(rv[:5], ['/opt/codex', 'exec', '--sandbox', 'read-only', '--ignore-rules'])

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
    U = {'input_tokens': 1000, 'cached_input_tokens': 600, 'output_tokens': 200, 'reasoning_output_tokens': 50, 'cache_write_input_tokens': 0}

    def test_complete_stream_reports_parts_without_double_counting(self):
        u = h.usage(stream(self.U))
        self.assertTrue(u['complete'], u['incompleteReasons'])
        self.assertEqual((u['input'], u['cached'], u['uncached'], u['output'], u['reasoning'], u['total']),
                         (1000, 600, 400, 200, 50, 1200))

    def test_each_assumption_failure_is_incomplete_never_zero(self):
        cases = {
            'no-usage': stream(), 'missing-usage-field': stream({k: v for k, v in self.U.items() if k != 'reasoning_output_tokens'}),
            'A3-multiple-usage-events': stream(self.U, self.U),
            'A1-cached-exceeds-input': stream({**self.U, 'cached_input_tokens': 1001}),
            'A2-reasoning-exceeds-output': stream({**self.U, 'reasoning_output_tokens': 201}),
            'A4-cache-write-unsettled': stream({**self.U, 'cache_write_input_tokens': 70}),
            'turn-failed': stream(self.U, extra=[{'type': 'turn.failed', 'error': {'message': 'x'}}]),
            'malformed-lines': 'junk\n' + stream(self.U),
        }
        for reason, text in cases.items():
            with self.subTest(reason):
                u = h.usage(text)
                self.assertFalse(u['complete'])
                self.assertIn(reason, u['incompleteReasons'])
                self.assertIsNone(u['total'])
        self.assertIn('exit-nonzero', h.usage(stream(self.U), exit_code=1)['incompleteReasons'])

    def test_session_log_must_sum_to_the_stream(self):
        good = {'calls': [{'input': 600, 'output': 120}, {'input': 400, 'output': 80}]}
        self.assertTrue(h.usage(stream(self.U), session=good)['complete'])
        bad = {'calls': [{'input': 600, 'output': 120}]}
        self.assertIn('A3-session-stream-mismatch', h.usage(stream(self.U), session=bad)['incompleteReasons'])
        self.assertIn('A3-session-stream-mismatch', h.usage(stream(self.U), session={})['incompleteReasons'])

    def test_cell_total_is_none_if_any_part_is_incomplete(self):
        good, bad = h.usage(stream(self.U)), h.usage(stream())
        self.assertEqual(h.cell_total([good, good]), 2400)
        self.assertIsNone(h.cell_total([good, bad]))
        self.assertIsNone(h.cell_total([]))
        self.assertEqual(h.sensitivity([good, good]), {'0.0': 1200, '0.1': 1320.0, '1.0': 2400})


class CostGate(unittest.TestCase):
    def cells(self, ctx, plain, tasks=('a', 'b', 'c', 'd'), ctx_seconds=10, plain_seconds=10):
        out = []
        for t in tasks:
            for c, p in zip(ctx, plain):
                out.append({'task': t, 'arm': 'context', 'totalTokens': c, 'reviewerSeconds': ctx_seconds})
                out.append({'task': t, 'arm': 'plain', 'totalTokens': p, 'reviewerSeconds': plain_seconds})
        return out

    def test_twenty_percent_lower_with_a_tight_interval_passes_and_uses_medians(self):
        g = h.cost_gate(self.cells([80, 79, 10**9], [100, 100, 100]), ['plain'], 3)
        self.assertTrue(g['passed'])
        self.assertAlmostEqual(g['comparisons']['plain']['tokenRatio'], 0.8)
        self.assertLess(g['comparisons']['plain']['bootstrap']['sumRatioInterval'][1], 1.0)

    def test_fifteen_percent_lower_fails(self):
        self.assertFalse(h.cost_gate(self.cells([85] * 3, [100] * 3), ['plain'], 3)['passed'])

    def test_a_point_pass_with_an_interval_reaching_parity_fails(self):
        cells = []
        for t, (c, p) in {'a': (10, 100), 'b': (10, 100), 'c': (250, 100), 'd': (10, 100)}.items():
            cells += [{'task': t, 'arm': 'context', 'totalTokens': c, 'reviewerSeconds': 1}] * 3
            cells += [{'task': t, 'arm': 'plain', 'totalTokens': p, 'reviewerSeconds': 1}] * 3
        g = h.cost_gate(cells, ['plain'], 3)
        self.assertLessEqual(g['comparisons']['plain']['tokenRatio'], 0.8)
        self.assertGreaterEqual(g['comparisons']['plain']['bootstrap']['sumRatioInterval'][1], 1.0)
        self.assertFalse(g['passed'])

    def test_reviewer_time_is_reported_not_gated(self):
        g = h.cost_gate(self.cells([50] * 3, [100] * 3, ctx_seconds=99), ['plain'], 3)
        self.assertTrue(g['passed'])
        self.assertEqual(g['arms']['context']['reviewerSeconds'], 4 * 99)

    def test_an_incomplete_cell_or_a_wrong_repetition_count_fails(self):
        for cells in (self.cells([50, None, 50], [100] * 3), self.cells([50] * 3, [100, 100, None])):
            g = h.cost_gate(cells, ['plain'], 3)
            self.assertFalse(g['passed'])
            self.assertEqual(g['incompleteTasks'], ['a', 'b', 'c', 'd'])
        with self.assertRaises(ValueError):
            h.cost_gate(self.cells([50] * 2, [100] * 2), ['plain'], 3)

    def test_each_comparator_must_be_beaten(self):
        cells = self.cells([80] * 3, [100] * 3)
        cells += [{'task': t, 'arm': 'graphify', 'totalTokens': 90, 'reviewerSeconds': 10} for t in 'abcd' for _ in range(3)]
        g = h.cost_gate(cells, ['plain', 'graphify'], 3)
        self.assertTrue(g['comparisons']['plain']['passed'])
        self.assertFalse(g['comparisons']['graphify']['passed'])
        self.assertFalse(g['passed'])


class QualityGuard(unittest.TestCase):
    def row(self, task, arm, accepted, total, cls='code-change'):
        return {'task': task, 'class': cls, 'arm': arm, 'accepted': accepted, 'dependencies': {'total': total}}

    def test_more_misses_on_any_task_or_fewer_acceptances_fails(self):
        ok = [self.row('a', 'context', True, 0), self.row('a', 'plain', True, 1), self.row('b', 'context', True, 0), self.row('b', 'plain', True, 2)]
        q = h.quality_guard(ok, ['plain'])
        self.assertTrue(q['passed'])
        self.assertTrue(q['comparisons']['plain']['better'])
        worse = ok[:-1] + [self.row('b', 'plain', True, 0), self.row('b', 'context', True, 1)]
        self.assertFalse(h.quality_guard(worse[:2] + worse[3:], ['plain'])['passed'])
        fewer = [self.row('a', 'context', False, 0), self.row('a', 'plain', True, 0)]
        self.assertFalse(h.quality_guard(fewer, ['plain'])['passed'])

    def test_all_zero_is_inconclusive_and_orientation_is_not_counted(self):
        rows = [self.row('a', 'context', True, 0), self.row('a', 'plain', True, 0), self.row('o', 'context', True, 5, 'orientation'),
                self.row('o', 'plain', True, 0, 'orientation')]
        q = h.quality_guard(rows, ['plain'])
        self.assertTrue(q['passed'])
        self.assertTrue(q['comparisons']['plain']['inconclusive'])
        self.assertEqual(list(q['comparisons']['plain']['dependencyMedians']), ['a'])


def fake_toolchain(base):
    """A toolchain directory with a valid manifest, built by the real subcommand."""
    prefix = base / 'node-prefix'
    (prefix / 'bin').mkdir(parents=True)
    (prefix / 'bin' / 'node').write_text('#!/bin/sh\necho v0\n'); (prefix / 'bin' / 'node').chmod(0o755)
    corepack = base / 'corepack-home' / 'v1' / 'pnpm' / '11.9.0'
    corepack.mkdir(parents=True); (corepack / 'pnpm.mjs').write_text('')
    rg = base / 'rg'; rg.write_text(''); rg.chmod(0o755)
    out = base / 'shared' / 'os2-toolchain-test'
    assert h.main(['toolchain', '--node-prefix', str(prefix), '--corepack-home', str(base / 'corepack-home'),
                   '--pnpm-version', '11.9.0', '--rg', str(rg), '--out', str(out)]) == 0
    return out


class Toolchain(unittest.TestCase):
    def test_every_pinned_pnpm_is_copied_and_a_missing_one_stops_the_build(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d).resolve()
            prefix = d / 'node-prefix'; (prefix / 'bin').mkdir(parents=True)
            (prefix / 'bin' / 'node').write_text('#!/bin/sh\necho v0\n'); (prefix / 'bin' / 'node').chmod(0o755)
            for v in ('11.9.0', '12.3.4'):
                c = d / 'cp' / 'v1' / 'pnpm' / v; c.mkdir(parents=True); (c / 'pnpm.mjs').write_text(v)
            rg = d / 'rg'; rg.write_text(''); rg.chmod(0o755)
            base = ['toolchain', '--node-prefix', str(prefix), '--corepack-home', str(d / 'cp'), '--rg', str(rg)]
            self.assertEqual(h.main(base + ['--pnpm-version', '11.9.0', '12.3.4', '--out', str(d / 'shared' / 'tc')]), 0)
            m = json.loads((d / 'shared' / 'tc' / 'manifest.json').read_text())
            self.assertEqual(m['pnpmVersions'], ['11.9.0', '12.3.4'])
            for v in ('11.9.0', '12.3.4'):
                self.assertEqual((d / 'shared' / 'tc' / 'corepack' / 'v1' / 'pnpm' / v / 'pnpm.mjs').read_text(), v)
            with self.assertRaises(SystemExit):
                h.main(base + ['--pnpm-version', '11.9.0', '11.22.0', '--out', str(d / 'shared' / 'tc2')])
            self.assertFalse((d / 'shared' / 'tc2').exists())


class FakeHome:
    """Point the home directory and denied trees at a test sandbox."""
    def __init__(self, d):
        self.home = d / 'home'; self.home.mkdir()
        self.saved = os.environ.get('HOME'), h.DENY_READ

    def __enter__(self):
        os.environ['HOME'] = str(self.home); h.DENY_READ = ()
        return self.home

    def __exit__(self, *exc):
        if self.saved[0] is None:
            os.environ.pop('HOME', None)
        else:
            os.environ['HOME'] = self.saved[0]
        h.DENY_READ = self.saved[1]


class PlanDryRun(unittest.TestCase):
    def test_plan_writes_every_cell_skips_the_manifest_and_never_starts_codex(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d).resolve()
            with FakeHome(d) as home:
                toolchain = fake_toolchain(d)
                marker = d / 'codex-was-run'
                fake = d / 'codex'
                fake.write_text(f'#!/bin/sh\ntouch {marker}\n'); fake.chmod(0o755)
                tasks = d / 'tasks'; tasks.mkdir()
                for t in TASKS:
                    (tasks / f'{t}.json').write_text(json.dumps({'id': t, 'statement': f'Do {t}.'}))
                (tasks / 'manifest.json').write_text(json.dumps({'tasks': TASKS}))
                out = home / 'plan'
                args = ['plan', '--tasks', str(tasks), '--codex', str(fake), '--claude', str(fake), '--node', '/bin/node', '--navigation-cli', '/c/cli.mjs',
                        '--toolchain', str(toolchain), '--active-base', str(d / 'shared'), '--out', str(out)]
                self.assertEqual(h.main(args), 0)
                self.assertFalse(marker.exists())
                plan = json.loads((out / 'schedule.json').read_text())
                self.assertEqual(len(plan['cells']), 48)
                self.assertEqual(len(plan['agreementSample']), 12)
                self.assertEqual(plan['lock']['reviewer'], h.REVIEWER)
                self.assertEqual(sorted(plan['lock']['taskSha256']), TASKS)
                self.assertEqual(plan['seed'], h.SEED)
                for cell in plan['cells']:
                    cd = out / cell['directory']
                    argv = json.loads((cd / 'executor-command.json').read_text())
                    h.validate_command(argv)
                    self.assertEqual(argv[0], str(fake.resolve()))
                    cfg = (cd / 'executor-config.toml').read_text()
                    self.assertEqual('mcp_servers' in cfg, cell['arm'] == 'context')
                    self.assertIn(f'{json.dumps(str(home))} = "deny"', cfg)
                    root = h.active_root(plan, cell['directory'])
                    self.assertIn(f'{json.dumps(str(root / "workspace"))} = "write"', cfg)
                    if cell['arm'] == 'context':
                        self.assertIn(json.dumps(str(root / 'workspace')), cfg.split('[mcp_servers')[1])
                    self.assertIn(f"Do {cell['task']}.", (cd / 'executor-prompt.txt').read_text())
                    self.assertRegex(cell['directory'], r'^cell-\d{3}$')
                with self.assertRaises(SystemExit):
                    h.main(args)
                with self.assertRaises(SystemExit):
                    h.main(args[:-4] + ['--active-base', str(home / 'x'), '--out', str(home / 'plan2')])


# A fake Codex. `sandbox` enforces the config's "deny" paths with a real seatbelt
# profile (unless OS2_FAKE_NO_DENY is set, to simulate a broken profile); `exec`
# plays executor or reviewer and writes a session log that sums to its stream.
FAKE_CODEX = r"""#!/usr/bin/env python3
import sys, json, pathlib, subprocess, os, re
a = sys.argv
home = pathlib.Path(os.environ['CODEX_HOME'])
if a[1] == 'sandbox':
    cfg = (home / 'config.toml').read_text()
    deny = re.findall(r'^"([^"]+)" = "deny"$', cfg, re.M)
    if os.environ.get('OS2_FAKE_NO_DENY') or not deny:
        sys.exit(subprocess.run(a[2:]).returncode)
    net = '(deny network*)' + ('(allow network-bind (local ip "*:*"))(allow network-inbound (local ip "localhost:*"))'
                               '(allow network-outbound (remote ip "localhost:*"))' if 'allow_local_binding = true' in cfg else '')
    profile = '(version 1)(allow default)' + net + ''.join(f'(deny file-read* (subpath "{p}"))' for p in deny)
    sys.exit(subprocess.run(['sandbox-exec', '-p', profile] + a[2:]).returncode)
cwd = pathlib.Path(a[a.index('-C') + 1]); out = pathlib.Path(a[a.index('-o') + 1])
U = {"input_tokens": 100, "cached_input_tokens": 40, "output_tokens": 10, "reasoning_output_tokens": 2, "cache_write_input_tokens": 0}
log = home / 'sessions' / '2026' / 'rollout-x.jsonl'
log.parent.mkdir(parents=True, exist_ok=True)
log.write_text('\n'.join(json.dumps(x) for x in [
    {"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec", "input": "text(1)"}},
    {"type": "response_item", "payload": {"type": "custom_tool_call_output", "output": "1"}},
    {"type": "event_msg", "payload": {"type": "token_count", "info": {"last_token_usage": {"input_tokens": 60, "cached_input_tokens": 20, "output_tokens": 4, "reasoning_output_tokens": 1}}}},
    {"type": "event_msg", "payload": {"type": "token_count", "info": None}},
    {"type": "event_msg", "payload": {"type": "token_count", "info": {"last_token_usage": {"input_tokens": 40, "cached_input_tokens": 20, "output_tokens": 6, "reasoning_output_tokens": 1}}}}]) + '\n')
if '--skip-git-repo-check' not in a:
    sys.stdin.read()
    (cwd / 'src.ts').write_text('export const v = "fixed"\n')
    if os.environ.get('OS2_FAKE_EXTRA'):
        (cwd / 'other.ts').write_text('x\n')
    (cwd.parent / 'escape.txt').write_text('outside the workspace\n')
    (cwd / 'answer.json').write_text(json.dumps({"filesChanged": ["src.ts"], "summary": "s", "testsRun": [],
        "evidence": [{"path": "src.ts", "startLine": 1, "endLine": 1, "claim": "c"}, {"path": "../escape.txt", "startLine": 1, "endLine": 1, "claim": "x"}]}))
    print(json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "/bin/zsh -lc 'cat /etc/hosts && cat src.ts'", "exit_code": 0, "status": "completed"}}))
else:
    rubric = json.loads((cwd / 'rubric.json').read_text())
    excerpt = (cwd / 'source' / 'src.ts').read_text()
    assert excerpt.startswith('1: export const v'), excerpt
    assert not (cwd / 'escape.txt').exists() and not (cwd / 'source' / 'escape.txt').exists()
    out.write_text(json.dumps({"accepted": True, "findings": [{"id": r["id"], "passed": True, "reason": "ok"} for r in rubric["rubric"]], "materialIssues": []}))
print(json.dumps({"type": "turn.completed", "usage": U}))
"""


# A fake Claude reviewer: no tools, the review material inline on stdin, a JSON result.
FAKE_CLAUDE = r"""#!/usr/bin/env python3
import sys, json, os, re
a = sys.argv
assert a[a.index('--tools') + 1] == '' and '--no-session-persistence' in a and '--strict-mcp-config' in a, a
assert os.environ.get('CLAUDE_CODE_DISABLE_CLAUDE_MDS') == '1'
text = sys.stdin.read()
assert 'executor.diff' in text and 'source/src.ts' in text, 'material not inlined'
rubric = json.loads(re.search(r'===== rubric.json =====\n(.*?)(?=\n=====|\Z)', text, re.S).group(1))
ok = not os.environ.get('OS2_FAKE_CLAUDE_REJECT')
rep = {"accepted": ok, "findings": [{"id": r["id"], "passed": ok, "reason": "checked"} for r in rubric["rubric"]], "materialIssues": []}
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "num_turns": 2, "total_cost_usd": 0.01,
                  "result": json.dumps(rep), "structured_output": rep,
                  "usage": {"input_tokens": 5, "cache_read_input_tokens": 7, "cache_creation_input_tokens": 3, "output_tokens": 2}}))
"""


class ChangeRecord(unittest.TestCase):
    def test_answer_and_build_outputs_are_left_out_of_the_recorded_change(self):
        self.assertEqual(h.change_pathspec('h3'), [':!answer.json'])
        self.assertEqual(h.change_pathspec('bray'), [':!answer.json', ':!site/tools-manifest.json'])


class ClaudeReviewer(unittest.TestCase):
    def test_command_has_no_tools_no_instructions_no_mcp_and_no_saved_session(self):
        argv = h.claude_command('/opt/claude')
        self.assertEqual(argv[argv.index('--tools') + 1], '')
        for flag in ('--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--json-schema'):
            self.assertIn(flag, argv)
        self.assertEqual(argv[argv.index('--model') + 1], h.REVIEWER['model'])
        self.assertEqual(argv[argv.index('--setting-sources') + 1], 'project')

    def test_usage_fails_closed(self):
        good = {'type': 'result', 'subtype': 'success', 'is_error': False, 'num_turns': 1,
                'usage': {'input_tokens': 5, 'cache_read_input_tokens': 7, 'cache_creation_input_tokens': 3, 'output_tokens': 2}}
        u = h.claude_usage(json.dumps(good))
        self.assertTrue(u['complete']); self.assertEqual(u['total'], 17); self.assertEqual(u['cached'], 7)
        bad = [('not json', 0), (json.dumps({**good, 'subtype': 'error_max_turns'}), 0), (json.dumps({**good, 'is_error': True}), 0),
               (json.dumps({**good, 'usage': {'input_tokens': 5}}), 0), (json.dumps(good), 1),
               (json.dumps({**good, 'usage': {**good['usage'], 'output_tokens': True}}), 0)]
        for text, code in bad:
            u = h.claude_usage(text, code)
            self.assertFalse(u['complete'], text[:60]); self.assertNotIn('total', u)

    def test_report_prefers_structured_output_and_falls_back_to_result(self):
        rep = {'accepted': True, 'findings': [], 'materialIssues': []}
        self.assertEqual(h.claude_report(json.dumps({'structured_output': rep, 'result': 'x'})), rep)
        self.assertEqual(h.claude_report(json.dumps({'result': json.dumps(rep)})), rep)
        self.assertIsNone(h.claude_report('nope'))

    def test_prompt_inlines_everything_and_caps_the_diff(self):
        with tempfile.TemporaryDirectory() as d:
            r = pathlib.Path(d)
            for n in ('task.json', 'answer.json', 'checker.json', 'rubric.json'):
                (r / n).write_text('{"n": "%s"}' % n)
            (r / 'executor.diff').write_text('+x\n' * (h.REVIEW_DIFF_BYTES // 3 + 10))
            (r / 'source' / 'a').mkdir(parents=True); (r / 'source' / 'a' / 'b.ts').write_text('1: code\n')
            text, truncated = h.claude_review_prompt(r)
            self.assertTrue(truncated)
            self.assertIn('[diff truncated]', text)
            self.assertIn('===== source/a/b.ts', text)
            for n in ('task.json', 'answer.json', 'checker.json', 'rubric.json'):
                self.assertIn(f'===== {n} =====', text)
            (r / 'executor.diff').write_text('+small\n')
            self.assertFalse(h.claude_review_prompt(r)[1])


class Agreement(unittest.TestCase):
    def test_sample_is_every_cell_in_a_small_plan_and_six_per_arm_otherwise(self):
        small = [{'directory': f'cell-{i:03d}', 'arm': a} for i, a in enumerate(['plain', 'context'], 1)]
        self.assertEqual(h.agreement_sample(small, 1), ['cell-001', 'cell-002'])
        cells = h.schedule(TASKS, ('plain', 'context'), 3, seed=h.SEED)
        for n, c in enumerate(cells, 1):
            c['directory'] = f'cell-{n:03d}'
        s = h.agreement_sample(cells, h.SEED)
        self.assertEqual(len(s), 12)
        self.assertEqual(s, h.agreement_sample(cells, h.SEED))
        arm = {c['directory']: c['arm'] for c in cells}
        self.assertEqual(sorted(arm[x] for x in s).count('plain'), 6)

    def review(self, accepted, items):
        return {'valid': True, 'accepted': accepted, 'report': {'findings': [{'id': i, 'passed': v} for i, v in items.items()]}}

    def test_agreement_counts_and_reliability(self):
        a = {f'c{i}': {'reviewer': self.review(True, {'R1': True}), 'secondReviewer': self.review(True, {'R1': True})} for i in range(5)}
        r = h.reviewer_agreement(a, sorted(a))
        self.assertTrue(r['reliable']); self.assertEqual((r['acceptedAgree'], r['rubricAgree']), (5, 5))
        a['c0']['secondReviewer'] = self.review(False, {'R1': False}); a['c1']['secondReviewer'] = self.review(False, {'R1': True})
        r = h.reviewer_agreement(a, sorted(a))
        self.assertEqual(r['acceptedAgree'], 3); self.assertEqual(r['rubricAgree'], 4); self.assertFalse(r['reliable'])
        a['c0']['secondReviewer'] = None; a['c1']['secondReviewer'] = self.review(True, {'R1': True})
        self.assertFalse(h.reviewer_agreement(a, sorted(a))['reliable'])   # a missing second review is never reliable
        self.assertFalse(h.reviewer_agreement(a, [])['reliable'])


class ProviderFailure(unittest.TestCase):
    def cell(self, d, code, events):
        d.mkdir(); (d / 'executor.json').write_text(json.dumps({'exitCode': code})); (d / 'executor-events.jsonl').write_text(events)
        (d / 'workspace').mkdir()
        return d

    def test_only_a_failure_with_no_model_output_is_set_aside_and_only_once(self):
        with tempfile.TemporaryDirectory() as t:
            t = pathlib.Path(t)
            failed = self.cell(t / 'a', 1, '{"type":"thread.started"}\n')
            self.assertTrue(h.set_aside_provider_failure(failed))
            self.assertFalse((failed / 'executor.json').exists())
            self.assertTrue((failed / 'repair-1' / 'executor.json').is_file())
            self.assertTrue((failed / 'repair-1' / 'repair.json').is_file())
            (failed / 'executor.json').write_text(json.dumps({'exitCode': 1})); (failed / 'executor-events.jsonl').write_text('')
            self.assertFalse(h.set_aside_provider_failure(failed))   # never twice
            spoke = self.cell(t / 'b', 1, '{"type":"item.completed"}\n')
            self.assertFalse(h.set_aside_provider_failure(spoke))
            fine = self.cell(t / 'c', 0, '')
            self.assertFalse(h.set_aside_provider_failure(fine))


class ExecutionPath(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.d = pathlib.Path(self.tmp.name).resolve()
        self.fake_home = FakeHome(d); self.home = self.fake_home.__enter__()
        self.toolchain = fake_toolchain(d)
        self.codex = d / 'codex'; self.codex.write_text(FAKE_CODEX); self.codex.chmod(0o755)
        self.claude = d / 'claude'; self.claude.write_text(FAKE_CLAUDE); self.claude.chmod(0o755)
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
        (self.tasks / 'manifest.json').write_text('{}')
        self.acc = d / 'acceptance'; self.acc.mkdir()
        (self.acc / 'r-code-change.json').write_text(json.dumps({'id': 'r-code-change', 'sourceChange': change,
            'requiredEvidence': [{'path': 'src.ts', 'startLine': 1, 'endLine': 1}], 'dependencySet': [{'path': 'src.ts', 'symbol': 'v'}],
            'checker': {'setup': 'true', 'command': 'grep -q fixed src.ts && test -f check.test.ts', 'testFiles': ['check.test.ts']},
            'rubric': [{'id': 'R1', 'requirement': 'v is fixed'}], 'scope': {'allowedPaths': ['src.ts', 'test/*']}, 'notes': ''}))
        self.archives = d / 'archives.json'
        self.archives.write_text(json.dumps({'r-code-change': h.sha256_file(self.archive_dir / 'r-code-change.tar')}))
        self.saved = dict(h.RELINK), dict(h.READY), dict(h.INSTALL)
        h.RELINK['r'] = 'mkdir -p node_modules && touch node_modules/relinked'
        h.READY['r'] = 'test -f node_modules/relinked'
        h.INSTALL['r'] = 'true'

    def tearDown(self):
        for live, saved in zip((h.RELINK, h.READY, h.INSTALL), self.saved):
            live.clear(); live.update(saved)
        for k in ('OS2_FAKE_NO_DENY', 'OS2_FAKE_EXTRA', 'OS2_FAKE_CLAUDE_REJECT'):
            os.environ.pop(k, None)
        self.fake_home.__exit__()
        self.tmp.cleanup()

    def plan(self):
        d = self.d
        node = os.environ.get('OS2_NODE', '/usr/local/bin/node')
        self.assertEqual(h.main(['prepare', '--tasks', str(self.tasks), '--archives', str(self.archives),
                                 '--archive-dir', str(self.archive_dir), '--templates', str(self.home / 'templates')]), 0)
        self.assertEqual(h.main(['plan', '--tasks', str(self.tasks), '--repetitions', '1', '--codex', str(self.codex),
                                 '--claude', str(self.claude), '--node', node, '--navigation-cli', '/c/cli.mjs', '--toolchain', str(self.toolchain),
                                 '--active-base', str(d / 'shared'), '--out', str(self.home / 'plan')]), 0)
        self.common = ['--plan', str(self.home / 'plan'), '--tasks', str(self.tasks), '--codex', str(self.codex),
                       '--auth-file', str(self.auth), '--toolchain', str(self.toolchain)]
        self.node = node

    def execute(self, forbid=()):
        return h.main(['execute', *self.common, '--templates', str(self.home / 'templates'), '--node', self.node,
                       '--navigation-cli', '/c/cli.mjs', '--forbid', *forbid])

    def run_all(self, forbid=()):
        self.plan()
        return self.execute(forbid), self.common

    def assess(self, *extra):
        return h.main(['assess', *self.common, '--acceptance', str(self.acc), '--repos', str(self.d / 'repos'),
                       '--claude', str(self.claude), *extra])

    def test_prepare_rejects_a_changed_archive_and_a_failed_install(self):
        self.archives.write_text(json.dumps({'r-code-change': '0' * 64}))
        with self.assertRaises(ValueError):
            h.main(['prepare', '--tasks', str(self.tasks), '--archives', str(self.archives),
                    '--archive-dir', str(self.archive_dir), '--templates', str(self.home / 'templates')])
        self.archives.write_text(json.dumps({'r-code-change': h.sha256_file(self.archive_dir / 'r-code-change.tar')}))
        h.INSTALL['r'] = 'exit 4'
        with self.assertRaises(SystemExit):
            h.main(['prepare', '--tasks', str(self.tasks), '--archives', str(self.archives),
                    '--archive-dir', str(self.archive_dir), '--templates', str(self.home / 'templates')])
        self.assertFalse((self.home / 'templates' / 'r-code-change').exists())

    def test_execute_refuses_while_forbidden_paths_exist(self):
        with self.assertRaises(SystemExit):
            self.run_all(forbid=[str(self.acc)])

    def test_execute_refuses_when_a_planned_input_changed(self):
        self.plan()
        (self.tasks / 'r-code-change.json').write_text(json.dumps({**self.task, 'statement': 'Something else.'}))
        with self.assertRaises(SystemExit):
            self.execute()
        self.assertFalse((self.home / 'plan' / 'cell-001' / 'executor.json').exists())

    def test_execute_refuses_a_template_changed_after_prepare(self):
        self.plan()
        (self.home / 'templates' / 'r-code-change' / 'src.ts').write_text('tampered\n')
        with self.assertRaises(SystemExit):
            self.execute()

    def test_no_model_starts_if_the_canary_is_readable(self):
        self.plan()
        os.environ['OS2_FAKE_NO_DENY'] = '1'
        with self.assertRaises(SystemExit):
            self.execute()
        cell = self.home / 'plan' / 'cell-001'
        env = json.loads((cell / 'environment.json').read_text())
        self.assertEqual(env['isolation']['exitCode'], 97)
        self.assertFalse((cell / 'executor-events.jsonl').exists())
        self.assertEqual(list((self.d / 'shared').glob('os2-*-cell')), [])

    def test_the_probe_needs_loopback_for_executors_and_no_outside_network(self):
        ws = self.d / 'ws'; ws.mkdir()
        canary = self.home / 'probe' / h.CANARY; canary.parent.mkdir(); canary.write_text('x\n')
        root = pathlib.Path('/Users/Shared/os2-x'); tc = '/Users/Shared/os2-toolchain-a'
        executor = h.codex_config('plain', h.SETTINGS, root=root, toolchain=tc, home=self.home)
        reviewer = h.codex_config('reviewer', h.SETTINGS, root=root, toolchain=tc, home=self.home)
        run = lambda cfg, name, **k: h.isolation_probe(self.codex, self.d / name, ws, cfg, canary, ws, **k)['exitCode']
        self.assertEqual(run(executor, 'e', loopback=True), 0)
        self.assertEqual(run(reviewer, 'r'), 0)
        self.assertEqual(run(reviewer, 'r2', loopback=True), 98)
        for k in ('OUTSIDE_PROBE',):
            saved = getattr(h, k); setattr(h, k, 'true')
            try:
                self.assertEqual(run(executor, 'open', loopback=True), 99)
            finally:
                setattr(h, k, saved)

    def test_execute_then_assess_then_analyse_end_to_end(self):
        code, common = self.run_all(forbid=[str(self.d / 'not-here')])
        self.assertEqual(code, 0)
        cells = sorted((self.home / 'plan').glob('cell-*'))
        self.assertEqual(len(cells), 2)
        self.assertEqual(sorted(p.name for p in (self.d / 'shared').iterdir()), ['os2-toolchain-test'])
        for cell in cells:
            ex = json.loads((cell / 'executor.json').read_text())
            self.assertEqual(ex['changedFiles'], ['src.ts'])
            self.assertTrue(ex['answerPresent'])
            self.assertTrue(ex['usage']['complete'], ex['usage']['incompleteReasons'])
            self.assertEqual(ex['usage']['total'], 110)
            self.assertEqual(ex['outsideReferences'], ['/etc/hosts'])
            self.assertIn('fixed', (cell / 'executor.diff').read_text())
            for step in ('relink', 'isolation', 'ready'):
                self.assertEqual(ex['environment'][step]['exitCode'], 0, step)
            self.assertTrue(ex['environment']['intactAfterRun'])
            self.assertTrue(ex['activeRoot'].startswith(str(self.d / 'shared')))
            self.assertTrue((cell / 'workspace' / 'src.ts').is_file())
            self.assertEqual([c['input'] for c in ex['session']['calls']], [60, 40])
            self.assertNotIn('--sandbox', ex['command'])
        with self.assertRaises(SystemExit):
            h.main(['analyse', '--plan', str(self.home / 'plan'), '--tasks', str(self.tasks)])
        self.assertEqual(self.assess(), 0)
        for cell in cells:
            a = json.loads((cell / 'assessment.json').read_text())
            self.assertTrue(a['checker']['passed'])
            self.assertEqual(a['scope'], {'passed': True, 'outside': []})
            self.assertEqual(a['dependencies']['total'], 0)
            self.assertTrue(a['reviewer']['valid'])
            self.assertEqual(a['reviewer']['family'], 'claude')
            self.assertTrue(a['reviewer']['usage']['complete'])
            self.assertTrue(a['secondReviewer']['valid'])          # a two-cell plan reviews every cell twice
            self.assertTrue(a['secondReviewer']['isolation'])
            self.assertTrue(a['accepted'])
            self.assertEqual(a['excerpts'], ['src.ts'])
            self.assertEqual(a['totalTokens'], 110)                 # executor only
            self.assertEqual(a['reviewerTokens'], {'claude': 17, 'codex': 110})
            self.assertFalse((cell / 'review' / 'source' / 'escape.txt').exists())
            self.assertFalse((cell / 'check').exists())
            self.assertTrue((cell / 'review' / 'rubric.json').is_file())
        self.assertEqual(sorted(p.name for p in (self.d / 'shared').iterdir()), ['os2-toolchain-test'])
        self.assertEqual(h.main(['analyse', '--plan', str(self.home / 'plan'), '--tasks', str(self.tasks)]), 0)
        report = json.loads((self.home / 'plan' / 'analysis.json').read_text())
        self.assertEqual(report['cost']['comparisons']['plain']['tokenRatio'], 1.0)
        self.assertTrue(report['quality']['reliable'])
        self.assertEqual(report['quality']['reviewerAgreement']['acceptedAgree'], 2)
        self.assertEqual(report['reviewerTokens'], {'claude': 34, 'codex': 220})
        self.assertFalse(report['passed'])

    def test_the_claude_verdict_decides_and_disagreement_makes_quality_unreliable(self):
        os.environ['OS2_FAKE_CLAUDE_REJECT'] = '1'
        self.run_all()
        self.assess()
        for cell in sorted((self.home / 'plan').glob('cell-*')):
            a = json.loads((cell / 'assessment.json').read_text())
            self.assertFalse(a['reviewer']['accepted']); self.assertTrue(a['secondReviewer']['accepted'])
            self.assertFalse(a['accepted'])
        h.main(['analyse', '--plan', str(self.home / 'plan'), '--tasks', str(self.tasks)])
        report = json.loads((self.home / 'plan' / 'analysis.json').read_text())
        self.assertFalse(report['quality']['reliable'])
        self.assertFalse(report['passed'])

    def test_assess_refuses_a_reviewer_that_differs_from_the_plan(self):
        self.run_all()
        other = self.d / 'claude2'; other.write_text(FAKE_CLAUDE + '\n# changed\n'); other.chmod(0o755)
        with self.assertRaises(SystemExit):
            h.main(['assess', *self.common, '--acceptance', str(self.acc), '--repos', str(self.d / 'repos'), '--claude', str(other)])

    def test_a_change_outside_scope_is_never_accepted(self):
        os.environ['OS2_FAKE_EXTRA'] = '1'
        self.run_all()
        self.assess()
        for cell in sorted((self.home / 'plan').glob('cell-*')):
            a = json.loads((cell / 'assessment.json').read_text())
            self.assertEqual(a['scope'], {'passed': False, 'outside': ['other.ts']})
            self.assertTrue(a['reviewer']['accepted'])
            self.assertFalse(a['accepted'])

    def test_an_unreadable_scope_stops_assessment(self):
        self.run_all()
        acc = json.loads((self.acc / 'r-code-change.json').read_text()); acc['scope'] = 'src.ts'
        (self.acc / 'r-code-change.json').write_text(json.dumps(acc))
        with self.assertRaises(SystemExit):
            self.assess()
        self.assertEqual(self.assess('--checker-only'), 0)
        rec = json.loads((self.home / 'plan' / 'cell-001' / 'checker-only.json').read_text())
        self.assertIsNone(rec['scope'])

    def test_assess_waits_for_every_executor(self):
        self.plan()
        h.main(['execute', *self.common, '--templates', str(self.home / 'templates'), '--node', self.node,
                '--navigation-cli', '/c/cli.mjs', '--only', 'cell-001'])
        with self.assertRaises(SystemExit):
            self.assess()

    def test_no_model_starts_unless_the_copy_is_relinked_and_ready(self):
        for relink, ready in (('exit 3', 'true'), ('true', 'test -f node_modules/relinked')):
            with self.subTest(relink=relink, ready=ready):
                for x in ('plan', 'templates'):
                    shutil.rmtree(self.home / x, ignore_errors=True)
                h.RELINK['r'], h.READY['r'] = relink, ready
                with self.assertRaises(SystemExit):
                    self.run_all()
                cell = self.home / 'plan' / 'cell-001'
                self.assertFalse((cell / 'executor.json').exists())
                self.assertFalse((cell / 'executor-events.jsonl').exists())
                self.assertFalse((cell / 'workspace').exists())
                self.assertTrue((cell / 'environment.json').is_file())
                self.assertEqual(list((self.d / 'shared').glob('os2-*-cell')), [])

    def test_checker_only_runs_no_reviewer(self):
        self.run_all()
        self.assertEqual(self.assess('--checker-only'), 0)
        for cell in sorted((self.home / 'plan').glob('cell-*')):
            rec = json.loads((cell / 'checker-only.json').read_text())
            self.assertTrue(rec['checkerPassed'])
            self.assertFalse((cell / 'review').exists())
            self.assertFalse((cell / 'assessment.json').exists())

    def test_outside_references_ignore_globs_and_catch_parent_paths(self):
        line = json.dumps({'type': 'item.completed', 'item': {'type': 'command_execution',
                           'command': "/bin/zsh -lc \"rg -g 'test/**/*.ts' x; find node_modules -path '*/vitest.mjs'; cat /etc/passwd; cat ../cell-002/x\""}})
        self.assertEqual(h.outside_references(line, pathlib.Path('/w')), ['../cell-002/x', '/etc/passwd'])

    def test_a_failed_checker_is_never_accepted(self):
        self.run_all()
        acc = json.loads((self.acc / 'r-code-change.json').read_text())
        acc['checker']['command'] = 'exit 1'
        (self.acc / 'r-code-change.json').write_text(json.dumps(acc))
        self.assess()
        for cell in sorted((self.home / 'plan').glob('cell-*')):
            a = json.loads((cell / 'assessment.json').read_text())
            self.assertFalse(a['checker']['passed'])
            self.assertTrue(a['reviewer']['accepted'])
            self.assertFalse(a['accepted'])

    def test_dependency_count_and_review_validation(self):
        task = {'class': 'impact'}
        acc = {'dependencySet': [{'path': 'a.ts'}, {'path': 'b.ts'}]}
        answer = {'mustChange': [{'path': 'a.ts'}, {'path': 'invented.ts'}, {'path': 'a.ts'}]}
        d = h.dependency_count(task, acc, answer, [], {'a.ts', 'b.ts'})
        self.assertEqual((d['missed'], d['incorrect'], d['extra'], d['total'], d['recall'], d['precision']), (1, 1, 1, 2, 0.5, 0.5))
        self.assertIsNone(h.dependency_count({'class': 'orientation'}, acc, answer, [], set()))
        self.assertIsNone(h.dependency_count({'class': 'diagnosis'}, acc, answer, [], set()))
        claims = {'filesChanged': ['a.ts', 'b.ts']}
        self.assertEqual(h.dependency_count({'class': 'code-change'}, acc, claims, ['a.ts'], set())['missed'], 1)
        good = {'accepted': True, 'findings': [{'id': 'R1', 'passed': True, 'reason': 'ok'}], 'materialIssues': []}
        self.assertEqual(h.review_outcome(good, ['R1']), {'valid': True, 'accepted': True})
        self.assertEqual(h.review_outcome({**good, 'materialIssues': ['x']}, ['R1']), {'valid': True, 'accepted': False})
        self.assertEqual(h.review_outcome({**good, 'findings': []}, ['R1'])['valid'], False)
        self.assertEqual(h.review_outcome(None, ['R1'])['valid'], False)

    def test_denied_accesses_are_counted_from_the_session_log(self):
        log = self.d / 'h' / 'sessions' / 'rollout-x.jsonl'; log.parent.mkdir(parents=True)
        out = lambda t: json.dumps({'type': 'response_item', 'payload': {'type': 'custom_tool_call_output', 'output': [{'type': 'input_text', 'text': t}]}})
        log.write_text('\n'.join([out('cat: /x: Operation not permitted'), out('fine'), 'junk']) + '\n')
        self.assertEqual(h.denied_reads(self.d / 'h'), 1)
        self.assertEqual(h.denied_reads(self.d / 'none'), 0)

    def test_evidence_excerpts_are_bounded_and_stay_inside_the_workspace(self):
        ws = self.d / 'ws'; ws.mkdir(); dest = self.d / 'dest'; dest.mkdir()
        (ws / 'big.ts').write_text(''.join(f'line {n}\n' for n in range(1, 1001)))
        (self.d / 'outside.ts').write_text('secret\n')
        (ws / 'link').symlink_to(self.d)
        answer = {'evidence': [{'path': 'big.ts', 'startLine': 500, 'endLine': 502}, {'path': 'link/outside.ts', 'startLine': 1},
                               {'path': '../outside.ts', 'startLine': 1}, {'path': '/etc/hosts', 'startLine': 1}]}
        self.assertEqual(h.evidence_excerpts(ws, answer, dest), ['big.ts'])
        lines = (dest / 'source' / 'big.ts').read_text().splitlines()
        self.assertEqual((lines[0], lines[-1], len(lines)), ('480: line 480', '522: line 522', 43))


if __name__ == '__main__':
    unittest.main()
