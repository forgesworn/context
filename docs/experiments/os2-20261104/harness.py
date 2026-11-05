#!/usr/bin/env python3
"""OS2 runner, phase 0 part: schedule, arm setup, commands, usage and the cost gate.

`plan` writes every cell's Codex home config, prompt and argument list to a new
directory and never starts Codex. `prepare` and `assess --checker-only` start no
model either; `execute` and `assess` do, and each run needs its own approval.

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

HERE = pathlib.Path(__file__).resolve().parent

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
    # Not --ephemeral: the session log stays in the per-cell CODEX_HOME and is the only
    # record of per-call usage and of what code-mode scripts showed the model.
    argv = [str(codex), 'exec', '--sandbox', SANDBOXES[role], '--ignore-rules']
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
        # Opaque names: the reviewer runs inside the cell directory and must not see the arm.
        name = f"cell-{n:03d}"
        d = out / name
        d.mkdir(mode=0o700)
        workspace = d / 'workspace'
        (d / 'executor-config.toml').write_text(
            codex_config(cell['arm'], SETTINGS, workspace, args.node, args.navigation_cli), encoding='utf8')
        (d / 'executor-prompt.txt').write_text(executor_prompt(cell['arm'], by_id[cell['task']]), encoding='utf8')
        (d / 'executor-command.json').write_text(json.dumps(command(codex, 'executor', SETTINGS, workspace, d / 'final.txt'), indent=2) + '\n', encoding='utf8')
        (d / 'reviewer-config.toml').write_text(codex_config('reviewer', SETTINGS), encoding='utf8')
        cell['directory'] = name
    (out / 'schedule.json').write_text(json.dumps({'settings': SETTINGS, 'arms': arms, 'repetitions': args.repetitions,
                                                   'codex': str(codex), 'cells': cells}, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'cells': len(cells), 'out': str(out)}))
    return 0


# ---------------------------------------------------------------------------
# Execution path. Three stages, run separately:
#   prepare  per task: extract the frozen base archive, install, commit the tree.
#   execute  per cell: clone the template, run one executor session. Refuses to
#            start while any --forbid path exists, because Codex's sandbox limits
#            writes, not reads: hidden acceptance files must not be on the machine.
#   assess   per cell, after all executors: checker, dependency count, reviewer.
# ---------------------------------------------------------------------------
import hashlib
import shutil
import subprocess
import tarfile
import time
import datetime as dt

INSTALL = {'bray': 'npm ci && npm run build', 'h3': 'pnpm install --frozen-lockfile'}
# A copied pnpm tree is stale to pnpm 11, which reinstalls before every `pnpm <bin>`.
# Inside Codex's sandbox that reinstall cannot write the global store, fails offline
# and purges node_modules (phase 1 attempt 1). So each copy is relinked offline,
# outside the sandbox, and READY is then run under Codex's own sandbox before any
# model starts.
RELINK = {'h3': 'pnpm install --frozen-lockfile --offline'}
READY = {'h3': 'pnpm vitest --version'}
OFFLINE = ('(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
           '(allow network-outbound (remote unix-socket))')
SYSTEM_PREFIXES = ('/bin/', '/usr/', '/opt/homebrew/', '/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr', '/tmp/', '/private/tmp/')


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n', encoding='utf8')


def sha256_file(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def git(cwd, *args, check=True):
    env = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_PAGER': 'cat'}
    return subprocess.run(['git', '-c', 'user.name=os2', '-c', 'user.email=os2@example.invalid', '-c', 'core.hooksPath=/dev/null', *args],
                          cwd=cwd, env=env, text=True, capture_output=True, check=check)


def shell(command, cwd, offline=False, timeout=1200):
    argv = ['/bin/zsh', '-c', command]
    if offline:
        argv = ['sandbox-exec', '-p', OFFLINE] + argv
    started = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, timeout=timeout)
        code, out = p.returncode, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as exc:
        code, out = 'timeout', str(exc)
    return {'exitCode': code, 'seconds': round(time.monotonic() - started, 1), 'tail': out[-4000:]}


def prepare_template(task, archive, expected_sha, out, install=None):
    """Extract the frozen archive, install dependencies, then commit everything so
    the executor's later diff shows only its own changes."""
    if sha256_file(archive) != expected_sha:
        raise ValueError(f'archive hash mismatch for {task["id"]}')
    ws = out / task['id']
    ws.mkdir(parents=True)
    with tarfile.open(archive) as tar:
        tar.extractall(ws, filter='data')
    setup = shell(install or INSTALL[task['repository']], ws)
    git(ws, 'init', '-q'); git(ws, 'add', '-A'); git(ws, 'commit', '-qm', f'base {task["baseCommit"]}')
    record = {'taskId': task['id'], 'baseCommit': task['baseCommit'], 'archiveSha256': expected_sha, 'setup': setup,
              'tree': git(ws, 'rev-parse', 'HEAD^{tree}').stdout.strip()}
    write_json(out / f'{task["id"]}.template.json', record)
    return record


def clone_tree(src, dst):
    """APFS copy-on-write clone where available, so per-cell copies are cheap."""
    r = subprocess.run(['cp', '-cR', str(src), str(dst)], capture_output=True, text=True)
    if r.returncode != 0:
        shutil.copytree(src, dst, symlinks=True)


def executor_prompt(arm, task):
    body = task['statement'].rstrip()
    if task.get('answerFormat'):
        body += '\n\nAnswer format: ' + task['answerFormat'].rstrip()
    body += '\nWrite answer.json in the workspace root before you finish.'
    return prompt(arm, body)


def outside_references(events_text, workspace):
    """Absolute or home paths in executed commands that point outside the workspace.
    Reported for review; a non-empty list flags the cell, it does not reject it."""
    import re
    ws = str(workspace)
    hits = set()
    for line in events_text.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        e = e.get('event', e) if isinstance(e, dict) else {}
        item = e.get('item') or {}
        if e.get('type') != 'item.completed' or item.get('type') != 'command_execution':
            continue
        cmd = item.get('command') or ''
        cmd = ' '.join(cmd) if isinstance(cmd, list) else cmd
        for token in re.findall(r"(?<![\w.*}])(~[^\s'\";|&)]*|\$HOME[^\s'\";|&)]*|/[^\s'\";|&)]+)", cmd):
            if token.startswith(ws) or token.startswith(SYSTEM_PREFIXES) or token in ('/bin/zsh', '/bin/bash', '/bin/sh'):
                continue
            if token.startswith('/') and token.count('/') == 1 and len(token) < 3:
                continue
            hits.add(token[:200])
    return sorted(hits)


def session_calls(home):
    """Per-call usage and model-visible tool traffic from the session log in one
    CODEX_HOME. Codex 0.166 runs tools inside a JavaScript `exec` sandbox, so the
    model sees what each script prints (custom_tool_call_output), not the raw tool
    result in the --json stream. None when no log was written."""
    logs = sorted(pathlib.Path(home).glob('sessions/**/rollout-*.jsonl'))
    if len(logs) != 1:
        return None if not logs else {'error': f'{len(logs)} session logs'}
    calls, scripts, script_bytes, shown_bytes, other = [], 0, 0, 0, {}
    for line in logs[0].read_text(encoding='utf8').splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        payload = e.get('payload') or {}
        if e.get('type') == 'event_msg' and payload.get('type') == 'token_count' and (payload.get('info') or {}).get('last_token_usage'):
            u = payload['info']['last_token_usage']
            calls.append({k: u.get(f) for k, f in (('input', 'input_tokens'), ('cached', 'cached_input_tokens'),
                                                    ('output', 'output_tokens'), ('reasoning', 'reasoning_output_tokens'))})
        elif e.get('type') == 'response_item':
            kind = payload.get('type')
            if kind == 'custom_tool_call':
                scripts += 1; script_bytes += len(payload.get('input') or '')
            elif kind == 'custom_tool_call_output':
                shown_bytes += len(json.dumps(payload.get('output')))
            elif kind:
                other[kind] = other.get(kind, 0) + 1
    return {'log': str(logs[0].relative_to(home)), 'calls': calls, 'scripts': scripts, 'scriptBytes': script_bytes,
            'shownBytes': shown_bytes, 'otherItems': other}


def sandbox_probe(codex, home, ws, command_text, timeout=300):
    """Run one command under Codex's own workspace-write sandbox, with no model,
    to check the tool chain works where the executor will run it."""
    home.mkdir(mode=0o700, exist_ok=True)
    argv = [str(codex), 'sandbox', '-c', 'sandbox_mode="workspace-write"', '/bin/zsh', '-lc', command_text]
    started = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=ws, env={**os.environ, 'CODEX_HOME': str(home)}, text=True, capture_output=True, timeout=timeout)
        code, out = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired as exc:
        code, out = 'timeout', str(exc)
    return {'exitCode': code, 'seconds': round(time.monotonic() - started, 1), 'tail': out[-2000:]}


def ready_environment(codex, cell_dir, ws, repository):
    """Relink the copied tree, then probe it under the sandbox. Raises before any
    model starts if either fails, removing the copy so the cell can be rerun."""
    env = {'relink': None, 'ready': None}
    if RELINK.get(repository):
        env['relink'] = shell(RELINK[repository], ws, offline=True)
    if READY.get(repository) and (env['relink'] is None or env['relink']['exitCode'] == 0):
        env['ready'] = sandbox_probe(codex, cell_dir / 'probe-home', ws, READY[repository])
    write_json(cell_dir / 'environment.json', env)
    if any(v is not None and v['exitCode'] != 0 for v in env.values()):
        shutil.rmtree(ws, ignore_errors=True)
        raise SystemExit(f'{cell_dir.name}: environment not ready, no model started (see environment.json)')
    return env


def run_executor(codex, cell_dir, arm, task, template, auth, node, navigation_cli, timeout):
    ws = cell_dir / 'workspace'
    clone_tree(template, ws)
    environment = ready_environment(codex, cell_dir, ws, task['repository'])
    home = cell_dir / 'executor-home'
    home.mkdir(mode=0o700)
    (home / 'auth.json').symlink_to(auth)
    (home / 'config.toml').write_text(codex_config(arm, SETTINGS, ws, node, navigation_cli), encoding='utf8')
    text = executor_prompt(arm, task)
    (cell_dir / 'executor-prompt.txt').write_text(text, encoding='utf8')
    argv = command(codex, 'executor', SETTINGS, ws, cell_dir / 'executor-final.txt')
    env = {**os.environ, 'CODEX_HOME': str(home)}
    started, clock = utc(), time.monotonic()
    try:
        p = subprocess.run(argv, cwd=ws, env=env, input=text, capture_output=True, text=True, timeout=timeout)
        code, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as exc:
        code = 'timeout'
        out = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or '')
        err = exc.stderr.decode() if isinstance(exc.stderr, bytes) else (exc.stderr or '')
    seconds = round(time.monotonic() - clock, 1)
    (cell_dir / 'executor-events.jsonl').write_text(out, encoding='utf8')
    (cell_dir / 'executor.stderr').write_text(err, encoding='utf8')
    git(ws, 'add', '-A', '--', '.', ':!answer.json', check=False)  # the answer is not part of the change
    diff = git(ws, 'diff', '--cached', '--binary', check=False).stdout
    (cell_dir / 'executor.diff').write_text(diff, encoding='utf8')
    changed = [f for f in git(ws, 'diff', '--cached', '--name-only', check=False).stdout.splitlines() if f]
    metrics = subprocess.run([str(node), str(HERE / 'metrics.mjs'), str(cell_dir / 'executor-events.jsonl'), '--root', str(ws)],
                             capture_output=True, text=True)
    # After the diff is taken: does the tool chain still work, or did the run break it?
    after = sandbox_probe(codex, cell_dir / 'probe-home', ws, READY[task['repository']]) if READY.get(task['repository']) else None
    environment['intactAfterRun'] = None if after is None else after['exitCode'] == 0
    return {'startedAt': started, 'seconds': seconds, 'exitCode': code, 'command': argv, 'environment': environment,
            'session': session_calls(home),
            'usage': {k: v for k, v in usage(out).items() if k != 'raw'}, 'changedFiles': changed,
            'answerPresent': (ws / 'answer.json').is_file(),
            'metrics': json.loads(metrics.stdout) if metrics.returncode == 0 else {'error': metrics.stderr[-500:]},
            'outsideReferences': outside_references(out, ws)}


def answer_paths(task, answer, changed):
    """Paths an outcome covers, for the dependency count."""
    if task['class'] == 'impact':
        return {x.get('path') for x in (answer or {}).get('mustChange', []) if isinstance(x, dict)}
    if task['class'] in ('code-change', 'diagnosis'):
        return set(changed) | {p for p in (answer or {}).get('filesChanged', []) if isinstance(p, str)}
    return set()


def dependency_count(task, acc, answer, changed, base_paths):
    """Missed: dependency-set paths the outcome does not cover. Incorrect: impact
    paths that do not exist at base. Path level only; symbol-level judgement is
    the reviewer's. Orientation tasks are not counted."""
    if task['class'] == 'orientation':
        return None
    covered = answer_paths(task, answer, changed)
    missed = [d['path'] for d in acc['dependencySet'] if d['path'] not in covered]
    incorrect = [p for p in covered if task['class'] == 'impact' and p not in base_paths]
    return {'missed': len(missed), 'incorrect': len(incorrect), 'total': len(missed) + len(incorrect)}


REVIEW_PROMPT = ('Independently review one task outcome. Read task.json, answer.json, executor.diff (if present), '
                 'checker.json, rubric.json and only the supplied source/. Judge each rubric item against the cited '
                 'source and the diff. Return strict JSON only: {"accepted":boolean,"findings":[{"id":string,"passed":boolean,'
                 '"reason":string}],"materialIssues":[string]}. Use every rubric id exactly once. No memory, network, MCP, '
                 'other directories or workers. Do not modify files.')


def review_outcome(report, rubric_ids):
    try:
        valid = (isinstance(report, dict) and set(report) == {'accepted', 'findings', 'materialIssues'}
                 and isinstance(report['accepted'], bool) and isinstance(report['materialIssues'], list)
                 and isinstance(report['findings'], list) and len(report['findings']) == len(rubric_ids)
                 and {f.get('id') for f in report['findings'] if isinstance(f, dict)} == set(rubric_ids)
                 and all(isinstance(f, dict) and isinstance(f.get('passed'), bool) and isinstance(f.get('reason'), str) and f['reason'].strip()
                         for f in report['findings'])
                 and all(isinstance(i, str) and i.strip() for i in report['materialIssues']))
    except (KeyError, TypeError, AttributeError):
        valid = False
    accepted = bool(valid and report['accepted'] and not report['materialIssues'] and all(f['passed'] for f in report['findings']))
    return {'valid': valid, 'accepted': accepted}


def run_checker(cell_dir, task, acc, repo):
    """Hidden checker and dependency count for one cell, with no model."""
    ws = cell_dir / 'workspace'
    receipt = json.loads((cell_dir / 'executor.json').read_text(encoding='utf8'))
    try:
        answer = json.loads((ws / 'answer.json').read_text(encoding='utf8'))
        answer = answer if isinstance(answer, dict) else None
    except (OSError, ValueError):
        answer = None
    checker = {'ran': False}
    if task['class'] in ('code-change', 'diagnosis'):
        check_ws = cell_dir / 'check'
        shutil.rmtree(check_ws, ignore_errors=True)
        clone_tree(ws, check_ws)
        if RELINK.get(task['repository']):
            checker['relinkExit'] = shell(RELINK[task['repository']], check_ws, offline=True)['exitCode']
        for rel in acc['checker']['testFiles']:
            content = git(repo, 'show', f"{acc['sourceChange']}:{rel}").stdout
            target = check_ws / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf8')
        result = shell(acc['checker']['command'], check_ws, offline=True, timeout=900)
        checker = {**checker, 'ran': True, 'passed': result['exitCode'] == 0, **result}
        shutil.rmtree(check_ws, ignore_errors=True)
    base_paths = set(git(repo, 'ls-tree', '-r', '--name-only', task['baseCommit']).stdout.splitlines())
    deps = dependency_count(task, acc, answer, receipt.get('changedFiles', []), base_paths)
    return receipt, answer, checker, deps


def assess_cell(codex, cell_dir, task, acc, repo, auth, timeout):
    receipt, answer, checker, deps = run_checker(cell_dir, task, acc, repo)
    ws = cell_dir / 'workspace'
    review = cell_dir / 'review'
    review.mkdir(mode=0o700)
    write_json(review / 'task.json', {k: task[k] for k in ('id', 'repository', 'class', 'statement', 'answerFormat')})
    write_json(review / 'answer.json', answer if answer is not None else {'error': 'answer.json missing or invalid'})
    if (cell_dir / 'executor.diff').read_text(encoding='utf8'):
        shutil.copy2(cell_dir / 'executor.diff', review / 'executor.diff')
    write_json(review / 'checker.json', {k: checker.get(k) for k in ('ran', 'passed', 'exitCode', 'tail')})
    write_json(review / 'rubric.json', {k: acc.get(k) for k in ('rubric', 'requiredEvidence', 'scope', 'notes')})
    for item in (answer or {}).get('evidence', [])[:64]:
        rel = item.get('path') if isinstance(item, dict) else None
        src = ws / rel if isinstance(rel, str) else None
        if (not src or '..' in pathlib.PurePosixPath(rel).parts or pathlib.PurePosixPath(rel).is_absolute()
                or not src.is_file() or src.is_symlink() or 'node_modules' in rel):
            continue
        dest = review / 'source' / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    home = cell_dir / 'reviewer-home'
    home.mkdir(mode=0o700)
    (home / 'auth.json').symlink_to(auth)
    (home / 'config.toml').write_text(codex_config('reviewer', SETTINGS), encoding='utf8')
    argv = command(codex, 'reviewer', SETTINGS, review, cell_dir / 'review-final.json', REVIEW_PROMPT)
    clock = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=review, env={**os.environ, 'CODEX_HOME': str(home)}, capture_output=True, text=True, timeout=timeout)
        code, out = p.returncode, p.stdout
    except subprocess.TimeoutExpired as exc:
        code, out = 'timeout', exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or '')
    seconds = round(time.monotonic() - clock, 1)
    (cell_dir / 'reviewer-events.jsonl').write_text(out, encoding='utf8')
    try:
        report = json.loads((cell_dir / 'review-final.json').read_text(encoding='utf8'))
    except (OSError, ValueError):
        report = None
    verdict = review_outcome(report, [r['id'] for r in acc.get('rubric', [])])
    reviewer_usage = {k: v for k, v in usage(out).items() if k != 'raw'}
    accepted = bool(verdict['accepted'] and answer is not None and code == 0
                    and (not checker['ran'] or checker['passed']))
    result = {'checker': {k: checker.get(k) for k in ('ran', 'passed', 'exitCode', 'seconds', 'relinkExit')}, 'dependencies': deps,
              'reviewer': {'exitCode': code, 'seconds': seconds, 'usage': reviewer_usage, 'session': session_calls(home), **verdict},
              'accepted': accepted,
              'totalTokens': cell_total([receipt['usage'], reviewer_usage]),
              'reviewerSeconds': seconds}
    result['reviewer']['outsideReferences'] = outside_references(out, review)
    write_json(cell_dir / 'assessment.json', result)
    return result


def execute(args):
    for path in args.forbid:
        if pathlib.Path(path).exists():
            raise SystemExit(f'refusing to execute: {path} exists on this machine (executors can read it)')
    codex = resolve_codex(args.codex)
    plan_doc = json.loads((args.plan / 'schedule.json').read_text(encoding='utf8'))
    tasks = {t['id']: t for t in (json.loads(p.read_text(encoding='utf8')) for p in args.tasks.glob('*.json') if p.name != 'manifest.json')}
    for cell in plan_doc['cells']:
        if args.only and cell['directory'] not in args.only:
            continue
        cell_dir = args.plan / cell['directory']
        if (cell_dir / 'executor.json').exists():
            continue
        result = run_executor(codex, cell_dir, cell['arm'], tasks[cell['task']], args.templates / cell['task'],
                              args.auth_file, args.node, args.navigation_cli, args.timeout)
        write_json(cell_dir / 'executor.json', result)
        print(json.dumps({'cell': cell['directory'], 'exit': result['exitCode'], 'seconds': result['seconds'],
                          'complete': result['usage']['complete'], 'outside': len(result['outsideReferences'])}))
    return 0


def assess(args):
    codex = resolve_codex(args.codex)
    plan_doc = json.loads((args.plan / 'schedule.json').read_text(encoding='utf8'))
    tasks = {t['id']: t for t in (json.loads(p.read_text(encoding='utf8')) for p in args.tasks.glob('*.json') if p.name != 'manifest.json')}
    for cell in plan_doc['cells']:
        cell_dir = args.plan / cell['directory']
        done = cell_dir / ('checker-only.json' if args.checker_only else 'assessment.json')
        if (args.only and cell['directory'] not in args.only) or not (cell_dir / 'executor.json').exists() or done.exists():
            continue
        task = tasks[cell['task']]
        acc = json.loads((args.acceptance / f"{task['id']}.json").read_text(encoding='utf8'))
        if args.checker_only:
            # No reviewer: checker pass/fail and dependency counts only, never the checker output.
            _, answer, checker, deps = run_checker(cell_dir, task, acc, args.repos / task['repository'])
            rec = {'cell': cell['directory'], 'answerPresent': answer is not None, 'checkerRan': checker['ran'],
                   'checkerPassed': checker.get('passed'), 'relinkExit': checker.get('relinkExit'), 'dependencies': deps}
            write_json(cell_dir / 'checker-only.json', rec)
            print(json.dumps(rec))
            continue
        result = assess_cell(codex, cell_dir, task, acc, args.repos / task['repository'], args.auth_file, args.timeout)
        print(json.dumps({'cell': cell['directory'], 'accepted': result['accepted'], 'totalTokens': result['totalTokens'],
                          'dependencies': result['dependencies']}))
    return 0


def prepare(args):
    archives = json.loads(args.archives.read_text(encoding='utf8'))
    args.templates.mkdir(parents=True, exist_ok=True)
    for p in sorted(args.tasks.glob('*.json')):
        if p.name == 'manifest.json':
            continue
        task = json.loads(p.read_text(encoding='utf8'))
        if (args.templates / task['id']).exists():
            continue
        rec = prepare_template(task, args.archive_dir / f"{task['id']}.tar", archives[task['id']], args.templates)
        print(json.dumps({'task': task['id'], 'setupExit': rec['setup']['exitCode'], 'seconds': rec['setup']['seconds']}))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description='OS2 runner. plan and prepare start no model; execute and assess do.')
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('execute', 'assess'):
        q = sub.add_parser(name)
        q.add_argument('--plan', required=True, type=pathlib.Path)
        q.add_argument('--tasks', required=True, type=pathlib.Path)
        q.add_argument('--codex', required=True, type=pathlib.Path)
        q.add_argument('--auth-file', required=True, type=pathlib.Path)
        q.add_argument('--timeout', type=int, default=1800)
        q.add_argument('--only', nargs='*', default=None, help='cell directory names to run')
        if name == 'execute':
            q.add_argument('--templates', required=True, type=pathlib.Path)
            q.add_argument('--node', required=True, type=pathlib.Path)
            q.add_argument('--navigation-cli', required=True, type=pathlib.Path)
            q.add_argument('--forbid', nargs='*', default=[], help='paths that must not exist while executors run')
        else:
            q.add_argument('--acceptance', required=True, type=pathlib.Path)
            q.add_argument('--repos', required=True, type=pathlib.Path)
            q.add_argument('--checker-only', action='store_true', help='run the hidden checker and dependency count only; no reviewer, no model')
    q = sub.add_parser('prepare')
    q.add_argument('--tasks', required=True, type=pathlib.Path)
    q.add_argument('--archives', required=True, type=pathlib.Path, help='JSON map task id -> archive sha256')
    q.add_argument('--archive-dir', required=True, type=pathlib.Path)
    q.add_argument('--templates', required=True, type=pathlib.Path)
    q = sub.add_parser('plan')
    q.add_argument('--tasks', required=True, type=pathlib.Path, help='directory of public task JSON files')
    q.add_argument('--arms', default='plain,context')
    q.add_argument('--repetitions', type=int, default=3)
    q.add_argument('--codex', required=True, type=pathlib.Path)
    q.add_argument('--node', required=True, type=pathlib.Path)
    q.add_argument('--navigation-cli', required=True, type=pathlib.Path)
    q.add_argument('--out', required=True, type=pathlib.Path)
    args = p.parse_args(argv)
    return {'plan': plan, 'prepare': prepare, 'execute': execute, 'assess': assess}[args.cmd](args)


if __name__ == '__main__':
    sys.exit(main())
