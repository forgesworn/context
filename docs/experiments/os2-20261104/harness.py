#!/usr/bin/env python3
"""OS2 runner, phase 0 part: schedule, arm setup, commands, usage and the cost gate.

Model-free. `plan` writes every cell's Codex home config, prompt and argument list
to a new directory and never starts Codex. Executing cells is not implemented here:
it needs the task pack (preparer, checker, citation scope) and separate approval.

Derived from ../d5-20260921-v3/run-pair.py, which stays locked and unchanged.
Differences: the arm order rotates; arms are data (plain, context, graphify);
model and effort have one source; the Context arm exposes all seven 0.26.0
retrieval tools, including repository_packet; and usage is incomplete rather
than zero when a stream does not report it.

Usage assumptions, to be confirmed by the write probe on a real 0.166.0 stream:
  A1 cached_input_tokens is a subset of input_tokens;
  A2 reasoning_output_tokens is a subset of output_tokens;
  A3 one `codex exec` emits one turn.completed per model turn, each with
     per-turn (not cumulative) usage.
  A4 cache_write_input_tokens (seen in the 0.166.0 probe, 0 there) is within
     input_tokens. Unconfirmed: a cell where it is non-zero is flagged
     cacheWriteSeen so the accounting can be settled before lock.
The write probe (2026-11-04) saw one turn.completed per exec, aggregating
every model call in that turn, with all four usage fields plus cache writes.
"""
import argparse
import json
import os
import pathlib
import statistics
import sys

SETTINGS = {'model': 'gpt-5.6-sol', 'effort': 'high'}
ARM_NAMES = ('plain', 'context', 'graphify')
CONTEXT_TOOLS = ['repository_status', 'repository_refresh', 'repository_search', 'repository_explore',
                 'repository_packet', 'repository_coverage', 'repository_graph']
SHELLS = {'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'env'}
FORBIDDEN = ('--dangerously-bypass-approvals-and-sandbox', '--yolo', '--full-auto', 'danger-full-access')
SANDBOXES = {'executor': 'workspace-write', 'reviewer': 'read-only'}

# One retrieval instruction per arm, of similar length and force (protocol retrievalInstructionRule).
INSTRUCTIONS = {
    'plain': ('Discover source with bounded rg searches and exact file reads inside this workspace. '
              'Read the implementation and tests you rely on before answering. No navigation service is available.'),
    'context': ('Discover source with the z1p-repository tools: check repository_status, refresh if not current, '
                'then search or explore and read exact implementation and tests with repository_packet.'),
    'graphify': ('Discover source with the prebuilt Graphify graph in graphify-out/ and the graphify CLI, '
                 'then read the exact implementation and tests it points to before answering.'),
}
COMMON = ('Do not use network search, memory, sibling directories, another arm, acceptance files or workers. '
          'You may run the compiler and focused tests.\n\n')


def schedule(task_ids, arms, repetitions):
    """Cells in run order. Repetition r (1-based) of task i (1-based) uses `arms`
    rotated left by (i + r - 1) mod n."""
    if len(set(arms)) != len(arms) or not set(arms) <= set(ARM_NAMES) or 'plain' not in arms or 'context' not in arms:
        raise ValueError(f'arms must be distinct, include plain and context, and come from {ARM_NAMES}')
    n, cells = len(arms), []
    for r in range(1, repetitions + 1):
        for i, task in enumerate(task_ids, 1):
            k = (i + r - 1) % n
            for position, arm in enumerate(list(arms[k:]) + list(arms[:k]), 1):
                cells.append({'task': task, 'taskIndex': i, 'repetition': r, 'arm': arm, 'position': position})
    return cells


def toml_string(value):
    return json.dumps(str(value))


def codex_config(arm, settings, workspace=None, node=None, navigation_cli=None):
    """config.toml text for one fresh CODEX_HOME. Only the context arm gets an MCP server."""
    if arm not in ARM_NAMES and arm != 'reviewer':
        raise ValueError(f'unknown arm {arm!r}')
    text = ('model = ' + toml_string(settings['model']) + '\n'
            'model_reasoning_effort = ' + toml_string(settings['effort']) + '\n'
            'project_doc_max_bytes = 0\nweb_search = "disabled"\n'
            '[features]\napps = false\nmemories = false\nmulti_agent = false\n')
    if arm == 'context':
        for name, path in (('workspace', workspace), ('node', node), ('navigation_cli', navigation_cli)):
            if path is None or not pathlib.Path(path).is_absolute():
                raise ValueError(f'context arm needs an absolute {name}')
        text += ('\n[mcp_servers.z1p-repository]\ncommand = ' + toml_string(node) +
                 '\nargs = ' + json.dumps([str(navigation_cli), 'navigate', str(workspace)]) +
                 '\nenabled_tools = ' + json.dumps(CONTEXT_TOOLS) +
                 '\nstartup_timeout_sec = 30\ntool_timeout_sec = 120\n')
    return text


def prompt(arm, task_statement):
    return INSTRUCTIONS[arm] + '\n' + COMMON + task_statement.rstrip('\n') + '\n'


def resolve_codex(path):
    """The Codex binary by absolute path, resolved, never via a shell or alias."""
    p = pathlib.Path(path)
    if not p.is_absolute():
        raise ValueError('codex must be an absolute path (shell aliases are never used)')
    real = p.resolve()
    if not real.is_file() or not os.access(real, os.X_OK):
        raise ValueError(f'codex is not an executable file: {real}')
    if real.name in SHELLS:
        raise ValueError('codex path resolves to a shell')
    return real


def command(codex, role, settings, cwd, final, prompt_text=None):
    """Argument list for one Codex session. Executors read the prompt on stdin."""
    if role == 'reviewer' and not prompt_text:
        raise ValueError('reviewer needs its prompt')
    argv = [str(codex), 'exec', '--sandbox', SANDBOXES[role], '--ephemeral', '--ignore-rules']
    if role == 'reviewer':
        argv.append('--skip-git-repo-check')
    argv += ['--json', '-m', settings['model'], '-c', 'model_reasoning_effort=' + toml_string(settings['effort']),
             '-C', str(cwd), '-o', str(final), '-' if role == 'executor' else prompt_text]
    validate_command(argv)
    return argv


def validate_command(argv):
    if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
        raise ValueError('command must be a list of strings, never a shell string')
    if not pathlib.Path(argv[0]).is_absolute() or pathlib.Path(argv[0]).name in SHELLS:
        raise ValueError('command must start with the absolute Codex binary')
    if any(a == f or a.startswith(f + '=') for a in argv for f in FORBIDDEN) or '-s' in argv:
        raise ValueError('command contains a sandbox bypass or override flag')
    if any(argv[j - 1] == '-c' and 'sandbox' in argv[j] for j in range(1, len(argv))):
        raise ValueError('command overrides the sandbox through -c')
    i = argv.index('--sandbox') if '--sandbox' in argv else -1
    if i < 0 or argv[i + 1] not in SANDBOXES.values() or argv.count('--sandbox') != 1:
        raise ValueError('command must set exactly one workspace-write or read-only sandbox')
    return argv


def usage(events):
    """Token usage from one recorded `codex exec --json` stream (raw or {"event": ...} lines).
    Returns totals only when every model turn reported usage; otherwise complete=False and
    totals are None, never zero."""
    turns, raw, abnormal = 0, [], False
    for line in events.splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        event = value.get('event', value) if isinstance(value, dict) else None
        if not isinstance(event, dict):
            continue
        kind = event.get('type')
        if kind in ('turn.failed', 'error'):
            abnormal = True
        if kind == 'turn.completed':
            turns += 1
            raw.append(event.get('usage'))
    fields = ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'cache_write_input_tokens')
    complete = turns > 0 and not abnormal and all(
        isinstance(u, dict) and isinstance(u.get('input_tokens'), int) and isinstance(u.get('output_tokens'), int) for u in raw)
    result = {'turns': turns, 'raw': raw, 'abnormal': abnormal, 'complete': complete,
              'assumptions': ['A1 cached within input', 'A2 reasoning within output', 'A3 per-turn usage', 'A4 cache writes within input'],
              'cacheWriteSeen': any(isinstance(u, dict) and (u.get('cache_write_input_tokens') or 0) > 0 for u in raw)}
    if not complete:
        result.update({f: None for f in ('input', 'cached', 'uncached', 'cacheWrite', 'output', 'reasoning', 'total')})
        return result
    s = {f: sum(int(u.get(f) or 0) for u in raw) for f in fields}
    result.update({'input': s['input_tokens'], 'cached': s['cached_input_tokens'],
                   'uncached': s['input_tokens'] - s['cached_input_tokens'], 'cacheWrite': s['cache_write_input_tokens'], 'output': s['output_tokens'],
                   'reasoning': s['reasoning_output_tokens'], 'total': s['input_tokens'] + s['output_tokens']})
    return result


def cell_total(parts):
    """Total tokens for one cell: executor, reviewer, setup, repairs and failed attempts.
    Any incomplete part makes the cell incomplete."""
    if not parts or any(not p.get('complete') for p in parts):
        return None
    return sum(p['total'] for p in parts)


def cost_gate(cells, comparators, threshold=0.8):
    """cells: [{task, arm, totalTokens (None when incomplete), reviewerSeconds}].
    Statistic: sum over tasks of per-task median total tokens, per arm. Context passes
    only if no task has an incomplete cell in a compared arm, its sum is at most
    threshold x each comparator's, and its sum of per-task median reviewer seconds is
    no higher."""
    tasks = sorted({c['task'] for c in cells})
    arms = ['context'] + list(comparators)
    incomplete = sorted({c['task'] for c in cells if c['arm'] in arms and c['totalTokens'] is None})
    report = {'incompleteTasks': incomplete, 'arms': {}, 'comparisons': {}, 'passed': False}
    if incomplete:
        return report
    for arm in arms:
        per = {}
        for t in tasks:
            rows = [c for c in cells if c['task'] == t and c['arm'] == arm]
            if not rows:
                raise ValueError(f'no cells for task {t} arm {arm}')
            per[t] = {'tokens': statistics.median(c['totalTokens'] for c in rows),
                      'reviewerSeconds': statistics.median(c['reviewerSeconds'] for c in rows)}
        report['arms'][arm] = {'perTask': per, 'tokens': sum(v['tokens'] for v in per.values()),
                               'reviewerSeconds': sum(v['reviewerSeconds'] for v in per.values())}
    ctx = report['arms']['context']
    passed = True
    for arm in comparators:
        other = report['arms'][arm]
        ratio = ctx['tokens'] / other['tokens'] if other['tokens'] else None
        ok = ratio is not None and ratio <= threshold and ctx['reviewerSeconds'] <= other['reviewerSeconds']
        report['comparisons'][arm] = {'tokenRatio': ratio, 'reviewerSecondsNoHigher': ctx['reviewerSeconds'] <= other['reviewerSeconds'], 'passed': ok}
        passed = passed and ok
    report['passed'] = passed
    return report


def plan(args):
    out = args.out
    if not out.is_absolute() or out.exists():
        raise SystemExit('--out must be a new absolute directory')
    codex = resolve_codex(args.codex)
    arms = tuple(args.arms.split(','))
    tasks = []
    for path in sorted(args.tasks.glob('*.json')):
        value = json.loads(path.read_text(encoding='utf8'))
        if not isinstance(value.get('id'), str) or not isinstance(value.get('statement'), str):
            raise SystemExit(f'task {path.name} needs string id and statement')
        tasks.append(value)
    if not tasks:
        raise SystemExit('no task files')
    out.mkdir(mode=0o700)
    cells = schedule([t['id'] for t in tasks], arms, args.repetitions)
    by_id = {t['id']: t for t in tasks}
    for n, cell in enumerate(cells, 1):
        name = f"{n:03d}-{cell['task']}-r{cell['repetition']}-{cell['arm']}"
        d = out / name
        d.mkdir(mode=0o700)
        workspace = d / 'workspace'
        (d / 'executor-config.toml').write_text(
            codex_config(cell['arm'], SETTINGS, workspace, args.node, args.navigation_cli), encoding='utf8')
        (d / 'executor-prompt.txt').write_text(prompt(cell['arm'], by_id[cell['task']]['statement']), encoding='utf8')
        (d / 'executor-command.json').write_text(json.dumps(command(codex, 'executor', SETTINGS, workspace, d / 'final.txt'), indent=2) + '\n', encoding='utf8')
        (d / 'reviewer-config.toml').write_text(codex_config('reviewer', SETTINGS), encoding='utf8')
        cell['directory'] = name
    (out / 'schedule.json').write_text(json.dumps({'settings': SETTINGS, 'arms': arms, 'repetitions': args.repetitions,
                                                   'codex': str(codex), 'cells': cells}, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'cells': len(cells), 'out': str(out)}))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description='OS2 phase 0 runner: writes cell plans; never starts a model.')
    sub = p.add_subparsers(dest='cmd', required=True)
    q = sub.add_parser('plan')
    q.add_argument('--tasks', required=True, type=pathlib.Path, help='directory of public task JSON files')
    q.add_argument('--arms', default='plain,context')
    q.add_argument('--repetitions', type=int, default=3)
    q.add_argument('--codex', required=True, type=pathlib.Path)
    q.add_argument('--node', required=True, type=pathlib.Path)
    q.add_argument('--navigation-cli', required=True, type=pathlib.Path)
    q.add_argument('--out', required=True, type=pathlib.Path)
    args = p.parse_args(argv)
    return plan(args)


if __name__ == '__main__':
    sys.exit(main())
