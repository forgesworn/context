#!/usr/bin/env python3
"""OS2 write probe: two tiny Sol/high sessions on a throwaway repository. Paid.

1. Executor, set up as the Context arm with `--sandbox workspace-write`: call
   repository_packet on a file, read the same file with cat, then write a file.
   Passes if the file is written (the v2 defect was an executor that could not
   write) and the stream gives the metric and usage fields.
2. Reviewer, `--sandbox read-only`, no MCP: try to write a file. Passes if the
   file does not exist afterwards.

Streams and receipts go to a new private directory. Prints a summary only.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import time
import importlib.util

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harness', HERE / 'harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

SOURCE = '\n'.join([f'export function step{i}(x: number): number {{ return x + {i} }}' for i in range(1, 41)]) + '\n'
EXECUTOR_TASK = ('This is a harness probe, not a coding task. Do exactly these steps and nothing else:\n'
                 '1. Call repository_status. If it is not current, call repository_refresh.\n'
                 '2. Call repository_packet in build mode for src/a.ts lines 1 to 20, using the current generation.\n'
                 '3. Run this shell command: cat src/a.ts\n'
                 '4. Write the text OK into a new file probe-write.txt in the workspace.\n'
                 'Then reply with the single word DONE.')
REVIEWER_TASK = ('This is a harness probe. Using the shell, try to create a file named probe-readonly.txt '
                 'containing OK in the current directory. Do not try any other way. Reply in one line saying whether it worked.')


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def git(cwd, *args):
    env = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1'}
    subprocess.run(['git', '-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', *args],
                   cwd=cwd, env=env, check=True, capture_output=True)


def home(root, auth, config):
    root.mkdir(mode=0o700)
    (root / 'auth.json').symlink_to(auth)
    (root / 'config.toml').write_text(config, encoding='utf8')


def run(argv, cwd, codex_home, stdin, events, timeout=600):
    env = {**os.environ, 'CODEX_HOME': str(codex_home)}
    started, clock = utc(), time.monotonic()
    try:
        p = subprocess.run(argv, cwd=cwd, env=env, input=stdin, capture_output=True, text=True, timeout=timeout)
        code, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as exc:
        code, out, err = 'timeout', exc.stdout or '', exc.stderr or ''
        out = out.decode() if isinstance(out, bytes) else out
        err = err.decode() if isinstance(err, bytes) else err
    events.write_text(out, encoding='utf8')
    events.with_name(events.stem + '.stderr').write_text(err, encoding='utf8')
    return {'startedAt': started, 'seconds': round(time.monotonic() - clock, 1), 'exitCode': code}


def usage_fields(text):
    present = set()
    for line in text.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if isinstance(e, dict) and e.get('type') == 'turn.completed' and isinstance(e.get('usage'), dict):
            present |= set(e['usage'])
    return sorted(present)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--codex', required=True, type=pathlib.Path)
    p.add_argument('--node', required=True, type=pathlib.Path)
    p.add_argument('--navigation-cli', required=True, type=pathlib.Path)
    p.add_argument('--auth-file', required=True, type=pathlib.Path)
    p.add_argument('--out', required=True, type=pathlib.Path)
    a = p.parse_args()
    if not a.out.is_absolute() or a.out.exists():
        p.error('--out must be a new absolute directory')
    codex = h.resolve_codex(a.codex)
    a.out.mkdir(mode=0o700, parents=True)
    receipt = {'experiment': 'os2-write-probe', 'codex': str(codex), 'settings': h.SETTINGS, 'startedAt': utc()}

    ws = a.out / 'workspace'
    (ws / 'src').mkdir(parents=True)
    (ws / 'src' / 'a.ts').write_text(SOURCE, encoding='utf8')
    git(ws, 'init', '-q'); git(ws, 'add', '.'); git(ws, 'commit', '-qm', 'probe')
    home(a.out / 'executor-home', a.auth_file, h.codex_config('context', h.SETTINGS, ws, a.node, a.navigation_cli))
    argv = h.command(codex, 'executor', h.SETTINGS, ws, a.out / 'executor-final.txt')
    receipt['executorCommand'] = argv
    receipt['executor'] = run(argv, ws, a.out / 'executor-home', h.prompt('context', EXECUTOR_TASK), a.out / 'executor-events.jsonl')

    rv = a.out / 'review'
    rv.mkdir(mode=0o700)
    home(a.out / 'reviewer-home', a.auth_file, h.codex_config('reviewer', h.SETTINGS))
    argv = h.command(codex, 'reviewer', h.SETTINGS, rv, a.out / 'reviewer-final.txt', REVIEWER_TASK)
    receipt['reviewerCommand'] = argv
    receipt['reviewer'] = run(argv, rv, a.out / 'reviewer-home', None, a.out / 'reviewer-events.jsonl')

    ex_text = (a.out / 'executor-events.jsonl').read_text(encoding='utf8')
    rv_text = (a.out / 'reviewer-events.jsonl').read_text(encoding='utf8')
    metrics = subprocess.run([str(a.node), str(HERE / 'metrics.mjs'), str(a.out / 'executor-events.jsonl'), '--root', str(ws)],
                             capture_output=True, text=True)
    write_file = ws / 'probe-write.txt'
    summary = {
        'executorWrote': write_file.is_file() and write_file.read_text().strip() == 'OK',
        'reviewerBlocked': not (rv / 'probe-readonly.txt').exists(),
        'executorExit': receipt['executor']['exitCode'], 'reviewerExit': receipt['reviewer']['exitCode'],
        'executorSeconds': receipt['executor']['seconds'], 'reviewerSeconds': receipt['reviewer']['seconds'],
        'executorUsage': {k: v for k, v in h.usage(ex_text).items() if k != 'raw'},
        'reviewerUsage': {k: v for k, v in h.usage(rv_text).items() if k != 'raw'},
        'usageFieldsPresent': {'executor': usage_fields(ex_text), 'reviewer': usage_fields(rv_text)},
        'eventTypes': sorted({(json.loads(l).get('type'), (json.loads(l).get('item') or {}).get('type')) .__str__()
                              for l in ex_text.splitlines() if l.startswith('{')}),
        'metrics': json.loads(metrics.stdout) if metrics.returncode == 0 else {'error': metrics.stderr[-500:]},
    }
    receipt['summary'] = summary
    receipt['completedAt'] = utc()
    (a.out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf8')
    print(json.dumps(summary, indent=2))
    return 0 if summary['executorWrote'] and summary['reviewerBlocked'] else 1


if __name__ == '__main__':
    sys.exit(main())
