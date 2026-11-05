#!/usr/bin/env python3
"""Tests for isolation-probe.py. No model: the fake Codex runs the three probe
commands itself under a seatbelt profile built from the config's deny paths."""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('probe', HERE / 'isolation-probe.py')
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
h = probe.h

FAKE = r"""#!/usr/bin/env python3
import sys, json, pathlib, subprocess, os, re
a = sys.argv
home = pathlib.Path(os.environ['CODEX_HOME'])
deny = re.findall(r'^"([^"]+)" = "deny"$', (home / 'config.toml').read_text(), re.M)
if os.environ.get('FAKE_NO_DENY'):
    deny = []
profile = '(version 1)(allow default)' + ''.join(f'(deny file-read* (subpath "{p}"))' for p in deny)
run = lambda cmd, cwd=None: subprocess.run(['sandbox-exec', '-p', profile, '/bin/zsh', '-c', cmd], cwd=cwd, capture_output=True, text=True)
if a[1] == 'sandbox':
    r = run(a[-1]); sys.stdout.write(r.stdout + r.stderr); sys.exit(r.returncode)
assert '--sandbox' not in a
cwd = pathlib.Path(a[a.index('-C') + 1])
task = sys.stdin.read()
entries = []
for cmd in re.findall(r'^\d\. (.+)$', task, re.M):
    r = run(cmd, cwd)
    js = 'const r = await tools.exec_command(' + json.dumps({"cmd": cmd, "workdir": str(cwd)}) + '); text(JSON.stringify(r))'
    entries.append({"type": "response_item", "payload": {"type": "custom_tool_call", "name": "exec", "input": js}})
    entries.append({"type": "response_item", "payload": {"type": "custom_tool_call_output", "output": [{"type": "input_text", "text": json.dumps({"exit_code": r.returncode, "output": r.stdout + r.stderr})}]}})
    if r.returncode == 0:  # Codex 0.166 leaves sandbox-denied commands out of the --json stream
        print(json.dumps({"type": "item.completed", "item": {"type": "command_execution", "command": "/bin/zsh -c " + json.dumps(cmd),
                          "aggregated_output": r.stdout + r.stderr, "exit_code": r.returncode, "status": "completed"}}))
entries.append({"type": "event_msg", "payload": {"type": "token_count", "info": {"last_token_usage": {"input_tokens": 9, "cached_input_tokens": 0, "output_tokens": 1, "reasoning_output_tokens": 0}}}})
log = home / 'sessions' / 'rollout-x.jsonl'; log.parent.mkdir(parents=True, exist_ok=True)
log.write_text('\n'.join(json.dumps(x) for x in entries) + '\n')
print(json.dumps({"type": "turn.completed", "usage": {"input_tokens": 9, "cached_input_tokens": 0, "output_tokens": 1, "reasoning_output_tokens": 0, "cache_write_input_tokens": 0}}))
"""


class Probe(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.d = pathlib.Path(self.tmp.name).resolve()
        self.home = d / 'home'; self.home.mkdir()
        self.saved = os.environ.get('HOME'), h.DENY_READ
        os.environ['HOME'] = str(self.home); h.DENY_READ = ()
        self.codex = d / 'codex'; self.codex.write_text(FAKE); self.codex.chmod(0o755)
        self.auth = d / 'auth.json'; self.auth.write_text('{}')
        self.toolchain = d / 'shared' / 'os2-toolchain-t'; self.toolchain.mkdir(parents=True)

    def tearDown(self):
        os.environ['HOME'] = self.saved[0]; h.DENY_READ = self.saved[1]
        os.environ.pop('FAKE_NO_DENY', None)
        self.tmp.cleanup()

    def args(self, name):
        return ['--codex', str(self.codex), '--auth-file', str(self.auth), '--toolchain', str(self.toolchain),
                '--active-base', str(self.d / 'shared'), '--out', str(self.home / name)]

    def test_passes_when_the_canary_is_denied_and_the_workspace_works(self):
        self.assertEqual(probe.main(self.args('ok')), 0)
        r = json.loads((self.home / 'ok' / 'receipt.json').read_text())
        self.assertTrue(r['passed'])
        self.assertTrue(r['canary']['denied'])
        self.assertFalse(r['canary']['leaked'])
        self.assertTrue(r['usage']['complete'], r['usage']['incompleteReasons'])
        self.assertEqual([p.name for p in (self.d / 'shared').iterdir()], ['os2-toolchain-t'])

    def test_no_model_starts_when_the_profile_is_not_in_effect(self):
        os.environ['FAKE_NO_DENY'] = '1'
        with self.assertRaises(SystemExit):
            probe.main(self.args('broken'))
        self.assertFalse((self.home / 'broken' / 'executor-events.jsonl').exists())

    def write_log(self, home, pairs):
        log = home / 'sessions' / 'rollout-x.jsonl'; log.parent.mkdir(parents=True)
        lines = []
        for cmd, out in pairs:
            lines.append({'type': 'response_item', 'payload': {'type': 'custom_tool_call', 'input': 'tools.exec_command(' + json.dumps({'cmd': cmd}) + ')'}})
            lines.append({'type': 'response_item', 'payload': {'type': 'custom_tool_call_output', 'output': [{'type': 'input_text', 'text': out}]}})
        log.write_text('\n'.join(json.dumps(x) for x in lines) + '\n')

    def test_judge_uses_what_the_model_saw_and_needs_a_denial_without_the_canary_text(self):
        leak, ok = self.d / 'leak', self.d / 'ok'
        self.write_log(leak, [('cat /x/isolation-canary.txt', 'SECRET'), ('cat hello.txt', 'hello from the workspace')])
        self.assertFalse(probe.judge(leak, True, 'SECRET')['passed'])
        self.write_log(ok, [('cat /x/isolation-canary.txt', 'cat: x: Operation not permitted'), ('cat hello.txt', 'hello from the workspace')])
        self.assertTrue(probe.judge(ok, True, 'SECRET')['passed'])
        self.assertFalse(probe.judge(ok, False, 'SECRET')['passed'])


if __name__ == '__main__':
    unittest.main()
