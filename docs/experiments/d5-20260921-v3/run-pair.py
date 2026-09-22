#!/usr/bin/env python3
"""Run the prospective D5 v2 orientation pair without repairing model output."""
import argparse
import codecs
import datetime as dt
import hashlib
import json
import os
import pathlib
import selectors
import shutil
import stat
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
CONTEXT = pathlib.Path(__file__).resolve().parents[3]
V1 = HERE.parent / 'd5-20260921'
PAIR = 'orientation-context'
EXECUTOR = {'model': 'gpt-5.6-luna', 'effort': 'medium'}
REVIEWER = {'model': 'gpt-5.6-sol', 'effort': 'high'}
LOCKED_FILES = [
    'README.md', 'task.json', 'review-rubric.json', 'prepare.mjs',
    'public-check.mjs', 'public-check.test.mjs', 'run-pair.py', 'run-pair.test.py', 'verify.mjs', 'REVIEW.md', 'toolchain.json',
    '../d5-20260921/prepare-arm.mjs', '../d5-20260921/accept.mjs',
    '../d5-20260921/tasks/orientation-context.json',
    '../d5-20260921/acceptance/orientation-context.json',
]


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n', encoding='utf8')


def record(stage, fn):
    started, clock = utc(), time.monotonic()
    try:
        result = fn()
        return result, {'startedAt': started, 'completedAt': utc(), 'seconds': time.monotonic() - clock, 'exitCode': getattr(result, 'returncode', 0)}
    except Exception as exc:
        return None, {'startedAt': started, 'completedAt': utc(), 'seconds': time.monotonic() - clock, 'exitCode': getattr(exc, 'returncode', 1), 'error': str(exc)}


def require_regular(path):
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        raise ValueError(f'missing required file: {path}')
    if not stat.S_ISREG(mode):
        raise ValueError(f'required file is not regular: {path}')


def validate_lock():
    lock = HERE / 'lock.json'
    require_regular(lock)
    value = json.loads(lock.read_text(encoding='utf8'))
    if not value.get('lockedAt') or value.get('reviewAccepted') is not True:
        raise ValueError('lock.json must have lockedAt and reviewAccepted true')
    if value.get('experimentId') != 'd5-orientation-context-20260921-v3' or 'sha256' in value:
        raise ValueError('lock experiment or canonical files mapping mismatch')
    dt.datetime.fromisoformat(value['lockedAt'].replace('Z', '+00:00'))
    hashes = value.get('files')
    if not isinstance(hashes, dict):
        raise ValueError('lock.json has no SHA-256 mapping')
    if set(hashes) != set(LOCKED_FILES):
        raise ValueError('lock.json SHA-256 mapping does not exactly cover protocol files')
    for rel, expected in hashes.items():
        path = HERE / rel
        require_regular(path)
        path = path.resolve()
        # The two inherited dependencies deliberately retain their relative keys.
        allowed = (path == (HERE / rel).resolve() and
                   (path == HERE or HERE in path.parents or path in [(HERE / x).resolve() for x in LOCKED_FILES if x.startswith('../')]))
        if not allowed:
            raise ValueError(f'lock path escapes experiment tree: {rel}')
        if not isinstance(expected, str) or sha256(path) != expected:
            raise ValueError(f'lock SHA-256 mismatch: {rel}')
    return value


def validate_toolchain(args):
    path = HERE / 'toolchain.json'
    require_regular(path)
    value = json.loads(path.read_text(encoding='utf8'))
    supplied = {'node': args.node, 'codex': args.codex, 'navigation': args.navigation_cli}
    for role, actual in supplied.items():
        entry = value.get(role)
        if not isinstance(entry, dict) or not isinstance(entry.get('path'), str) or not isinstance(entry.get('sha256'), str) or not isinstance(entry.get('version'), str):
            raise ValueError(f'toolchain {role} entry is invalid')
        pinned = pathlib.Path(entry['path'])
        if not pinned.is_absolute() or actual != pinned.resolve() or sha256(actual) != entry['sha256']:
            raise ValueError(f'toolchain {role} does not match supplied executable')
    runtime = value['navigation'].get('runtimeFiles')
    if not isinstance(runtime, dict): raise ValueError('toolchain navigation runtimeFiles is invalid')
    for raw, expected in runtime.items():
        runtime_path = pathlib.Path(raw)
        if not runtime_path.is_absolute() or not isinstance(expected, str) or sha256(runtime_path) != expected:
            raise ValueError(f'navigation runtime hash mismatch: {raw}')
    tree = value['navigation']['runtimeTree']
    entries = []
    runtime_root = pathlib.Path(tree['root'])
    for file in sorted(runtime_root.rglob('*')):
        if file.is_symlink(): digest = 'link:' + str(file.readlink())
        elif file.is_file(): digest = sha256(file)
        else: continue
        entries.append(str(file.relative_to(runtime_root)) + '\0' + digest + '\n')
    if len(entries) != tree['files'] or hashlib.sha256(''.join(entries).encode()).hexdigest() != tree['sha256']:
        raise ValueError('pinned navigation dependency tree changed')
    return value


def run_capture(command, cwd, env, events, stderr, stdin=None, timeout=900):
    """Retain observed JSONL through EOF with a bounded process-group lifetime."""
    with events.open('w', encoding='utf8') as out, stderr.open('w', encoding='utf8') as err:
        proc = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.PIPE if stdin else None,
                                stdout=subprocess.PIPE, stderr=err, start_new_session=True)
        abnormal, completed = False, False
        decoder = codecs.getincrementaldecoder('utf8')('replace')
        pending = ''
        deadline = time.monotonic() + timeout
        selector = selectors.DefaultSelector()
        selector.register(proc.stdout, selectors.EVENT_READ)
        eof = False

        def emit(raw):
            nonlocal abnormal, completed
            if not raw:
                return
            item = {'receivedAt': utc(), 'raw': raw}
            try:
                event = json.loads(raw)
                if not isinstance(event, dict):
                    raise ValueError('event must be an object')
                item['event'] = event
                completed |= event.get('type') == 'turn.completed'
                abnormal |= bool(event.get('type') in {'error', 'turn.failed'} or event.get('error') or
                                 event.get('status') in {'refused', 'refusal'})
            except (ValueError, TypeError):
                item['parseError'] = True
                abnormal = True
            out.write(json.dumps(item, separators=(',', ':')) + '\n')
            out.flush()

        try:
            if stdin:
                proc.stdin.write(stdin.encode('utf8'))
                proc.stdin.close()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    abnormal = True
                    try: os.killpg(proc.pid, 9)
                    except ProcessLookupError: pass
                    # Drain bytes already produced, bounded after terminating this process group.
                    drain_until = time.monotonic() + 1
                    while not eof and time.monotonic() < drain_until:
                        for _, _ in selector.select(0.05):
                            chunk = os.read(proc.stdout.fileno(), 65536)
                            if not chunk:
                                eof = True
                                selector.unregister(proc.stdout)
                                break
                            pending += decoder.decode(chunk)
                            lines = pending.split('\n'); pending = lines.pop()
                            for raw in lines: emit(raw)
                    break
                for _, _ in selector.select(min(0.1, remaining)):
                    chunk = os.read(proc.stdout.fileno(), 65536)
                    if not chunk:
                        eof = True
                        selector.unregister(proc.stdout)
                        continue
                    pending += decoder.decode(chunk)
                    lines = pending.split('\n')
                    pending = lines.pop()
                    for raw in lines:
                        emit(raw)
                if eof and proc.poll() is not None:
                    break
            pending += decoder.decode(b'', final=True)
            if pending:
                emit(pending)
            code = proc.wait(timeout=5)
        finally:
            selector.close()
            proc.stdout.close()
            if proc.poll() is None:
                try: os.killpg(proc.pid, 9)
                except ProcessLookupError: pass
                proc.wait(timeout=5)
        return code, abnormal or not completed


def usage_and_tools(events):
    usages, tools = [], 0
    if not events.exists():
        return {'usage': usages, 'toolCalls': tools}
    for line in events.read_text(encoding='utf8').splitlines():
        try:
            event = json.loads(line).get('event', {})
        except json.JSONDecodeError:
            continue
        if event.get('type') == 'turn.completed' and event.get('usage') is not None:
            usages.append(event['usage'])
        item = event.get('item', {})
        if event.get('type') == 'item.completed' and item.get('type') in ('command_execution', 'mcp_tool_call', 'file_change'):
            tools += 1
    return {'usage': usages, 'toolCalls': tools}


def check_retrieval(events, arm, workspace):
    calls = []
    for line in events.read_text().splitlines():
        event = json.loads(line).get('event', {})
        item = event.get('item', {})
        if event.get('type') != 'item.completed' or item.get('type') != 'mcp_tool_call': continue
        if item.get('tool') not in {'repository_status', 'repository_refresh', 'repository_search'}: continue
        result = item.get('result') or {}
        root = None
        for content in result.get('content', []):
            try: root = json.loads(content.get('text', '{}')).get('root', root)
            except (ValueError, AttributeError): pass
        calls.append({'tool': item.get('tool'), 'root': root,
                      'success': item.get('status') == 'completed' and not item.get('error') and not result.get('isError') and item.get('server') == 'z1p-repository'})
    needed = ['repository_status', 'repository_refresh', 'repository_search']
    position = 0
    for call in calls:
        if position < 3 and call['tool'] == needed[position] and call['success']:
            if position < 2 and call['root'] != str(workspace): continue
            position += 1
    return {'passed': not calls if arm == 'baseline' else position == 3, 'calls': calls}


def safe_source(workspace, rel, manifest, cited=False):
    selected = ('packages/context-tools/', 'docs/LOCAL-NAVIGATION.md', 'docs/NAVIGATION-POLICY.md')
    if (not isinstance(rel, str) or not rel or '\\' in rel or pathlib.PurePosixPath(rel).is_absolute() or '..' in pathlib.PurePosixPath(rel).parts or
            (cited and (rel.startswith('.') or '/.' in rel or not (rel.startswith(selected[0]) or rel in selected[1:])))):
        raise ValueError(f'invalid cited path: {rel!r}')
    if rel not in manifest:
        raise ValueError(f'citation is not in frozen manifest: {rel}')
    current, target = workspace, workspace / rel
    for part in pathlib.PurePosixPath(rel).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f'citation has symlink component: {rel}')
    if not target.is_file() or sha256(target) != manifest[rel]:
        raise ValueError(f'citation hash mismatch: {rel}')
    return target


def git_tree(workspace):
    env = os.environ.copy()
    env.update({'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull,
                'GIT_PAGER': 'cat', 'GIT_EXTERNAL_DIFF': ''})
    return subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', 'rev-parse', 'HEAD^{tree}'],
                          cwd=workspace, env=env, text=True, capture_output=True, check=True).stdout.strip()


def host_snapshot(workspace):
    prepared = workspace / '.d5-prepared.json'
    require_regular(prepared)
    value = json.loads(prepared.read_text(encoding='utf8'))
    source = value.get('sourceHashes')
    if not isinstance(source, dict) or not source:
        raise ValueError('preparer did not supply a source hash map')
    helpers = ['.d5-prepared.json', '.d5-task.json', '.d5-public-check.mjs', '.z1p-navigation.json']
    for name in helpers:
        require_regular(workspace / name)
    return {'sourceHashes': source, 'preparedTree': git_tree(workspace),
            'helpers': {name: sha256(workspace / name) for name in helpers}}


def check_host_snapshot(workspace, snapshot):
    errors = []
    try:
        if git_tree(workspace) != snapshot['preparedTree']:
            errors.append('prepared git tree changed')
    except Exception as exc:
        errors.append(f'cannot read prepared git tree: {exc}')
    for name, expected in snapshot['helpers'].items():
        try:
            require_regular(workspace / name)
            if sha256(workspace / name) != expected: errors.append(f'helper changed: {name}')
        except Exception as exc: errors.append(str(exc))
    for rel, expected in snapshot['sourceHashes'].items():
        try: safe_source(workspace, rel, snapshot['sourceHashes'])
        except Exception as exc: errors.append(str(exc))
    return errors


def extract_answer(arm_dir, workspace):
    final = arm_dir / 'final.txt'
    for answer in (workspace / 'answer.json', arm_dir / 'answer.json'):
        if answer.is_file() and not answer.is_symlink():
            return answer
    answer = arm_dir / 'answer.json'
    if not final.is_file():
        return None
    raw = final.read_text(encoding='utf8').strip()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(value, dict):
        return None
    write_json(answer, value)
    return answer


def make_home(root, auth, settings, navigation=None, node=None, arm=None):
    root.mkdir(mode=0o700)
    os.chmod(root, 0o700)
    (root / 'auth.json').symlink_to(auth)
    config = ('model = ' + json.dumps(settings['model']) + '\n'
              'model_reasoning_effort = ' + json.dumps(settings['effort']) + '\n'
              'project_doc_max_bytes = 0\nweb_search = "disabled"\n'
              '[features]\napps = false\nmemories = false\nmulti_agent = false\n')
    if navigation:
        config += ('\n[mcp_servers.z1p-repository]\ncommand = ' + json.dumps(str(node)) + '\nargs = ' +
                   json.dumps([str(navigation), 'navigate', str(arm)]) +
                   '\nenabled_tools = ["repository_status", "repository_refresh", "repository_search"]\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n')
    (root / 'config.toml').write_text(config, encoding='utf8')


def task_prompt(assisted):
    wrapper = ('Start with repository_status on this explicit arm root. If unavailable, stale or unknown, call repository_refresh. Use bounded repository_search for source discovery, then read only returned source within selectionPolicy.\n'
               if assisted else 'Use only bounded rg and exact file reads for source discovery within the explicit arm workspace selectionPolicy. Do not use a navigation service.\n')
    return wrapper + ('Do not use network search, memory, sibling repositories, another arm, D5 acceptance/reference files, or workers. You may run compiler and focused tests. The trusted harness checks output after this session.\n\n' +
                      json.dumps(json.loads((HERE / 'task.json').read_text(encoding='utf8')), indent=2) + '\n')


def invoke_prepare(node, output, arm):
    return subprocess.run([str(node), str(HERE / 'prepare.mjs'), '--source-root', str(CONTEXT), '--output', str(output), '--arm', arm],
                          text=True, capture_output=True, check=False)


def checker(node, script, workspace, answer):
    return subprocess.run([str(node), str(script), '--workspace', str(workspace), '--answer', str(answer)], text=True, capture_output=True)


def finalize_receipt(root, receipt, arm_clock):
    receipt['completedAt'] = utc()
    receipt['elapsedSeconds'] = time.monotonic()-arm_clock
    save_start, save_clock = utc(), time.monotonic()
    write_json(root / 'receipt.json', receipt)
    receipt['stages'].append({'name': 'receipt-capture', 'startedAt': save_start, 'completedAt': utc(), 'seconds': time.monotonic()-save_clock, 'exitCode': 0})
    receipt['elapsedSeconds'] = time.monotonic()-arm_clock
    receipt['completedAt'] = utc()
    write_json(root / 'receipt.json', receipt)


def run_arm(args, pair_root, arm):
    arm_clock = time.monotonic()
    root = pair_root / arm
    root.mkdir(mode=0o700)
    receipt = {'experimentId': 'd5-orientation-context-20260921-v3', 'pair': PAIR, 'arm': arm, 'providerCacheState': 'unknown', 'billing': None,
               'modelSettings': {'executor': EXECUTOR, 'reviewer': REVIEWER}, 'stages': [], 'startedAt': utc()}
    workspace = root / 'workspace'
    receipt['status'] = 'pending-preparation'
    write_json(root / 'receipt.json', receipt)
    prepared, stage = record('prepare', lambda: invoke_prepare(args.node, workspace, arm))
    receipt['stages'].append({'name': 'prepare', **stage})
    (root / 'prepare.json').write_text(prepared.stdout if prepared else '', encoding='utf8')
    (root / 'prepare.stderr').write_text(prepared.stderr if prepared else stage.get('error', ''), encoding='utf8')
    if stage['exitCode']:
        receipt['status'] = 'prepare-failed'; finalize_receipt(root, receipt, arm_clock); return False
    try:
        snapshot = host_snapshot(workspace)
        if json.loads(prepared.stdout).get('preparedTree') != snapshot['preparedTree']:
            raise ValueError('prepare stdout preparedTree does not match host tree')
        write_json(root / 'host-snapshot.json', snapshot)
    except Exception as exc:
        receipt['status'] = 'prepare-integrity-failed'; receipt['integrityErrors'] = [str(exc)]
        finalize_receipt(root, receipt, arm_clock); return False
    receipt['status'] = 'pending-executor'
    write_json(root / 'receipt.json', receipt)
    # Keep preparer output as a record without parsing it into a claim.
    # A fresh executor home is created only after the arm workspace exists.
    make_home(root / 'executor-home', args.auth_file, EXECUTOR,
              args.navigation_cli if arm == 'assisted' else None, args.node, workspace)
    prompt = task_prompt(arm == 'assisted')
    (root / 'executor-prompt.txt').write_text(prompt, encoding='utf8')
    final = root / 'final.txt'
    command = [str(args.codex), 'exec', '--sandbox', 'workspace-write', '--ephemeral', '--ignore-rules', '--json', '-m', EXECUTOR['model'],
               '-c', 'model_reasoning_effort="medium"', '-C', str(workspace), '-o', str(final), '-']
    env = os.environ.copy(); env['CODEX_HOME'] = str(root / 'executor-home')
    started, clock = utc(), time.monotonic()
    code, abnormal = run_capture(command, workspace, env, root / 'executor-events.jsonl', root / 'executor.stderr', prompt)
    receipt['stages'].append({'name': 'executor', 'startedAt': started, 'completedAt': utc(), 'seconds': time.monotonic()-clock, 'exitCode': code, 'abnormal': abnormal})
    receipt['executor'] = usage_and_tools(root / 'executor-events.jsonl')
    receipt['retrieval'] = check_retrieval(root / 'executor-events.jsonl', arm, workspace)
    receipt['elapsedSeconds'] = time.monotonic() - arm_clock
    receipt['status'] = 'executor-abnormal' if (code or abnormal) else 'pending-review'
    write_json(root / 'receipt.json', receipt)
    if code or abnormal:
        receipt['status'] = 'executor-abnormal'; finalize_receipt(root, receipt, arm_clock); return False
    answer = extract_answer(root, workspace)
    if answer:
        if answer.parent != workspace:
            # The executor may create it in the isolated workspace; raw final fallback lives in archive.
            shutil.copy2(answer, workspace / 'answer.json'); answer = workspace / 'answer.json'
        before = check_host_snapshot(workspace, snapshot)
        write_json(root / 'integrity-before-checks.json', {'errors': before})
        public, stage = record('public-check', lambda: checker(args.node, HERE / 'public-check.mjs', workspace, answer))
        (root / 'public-check.json').write_text((public.stdout if public else '') or '', encoding='utf8')
        (root / 'public-check.stderr').write_text((public.stderr if public else stage.get('error', '')) or '', encoding='utf8')
        receipt['stages'].append({'name': 'public-check', **stage, 'checkerExitCode': public.returncode if public else stage['exitCode']})
        if before:
            trusted, stage = subprocess.CompletedProcess([], 1, '', 'skipped: host snapshot changed before legacy checker'), {
                'startedAt': utc(), 'completedAt': utc(), 'seconds': 0, 'exitCode': 1, 'error': 'skipped after integrity failure'}
        else:
            trusted, stage = record('trusted-check', lambda: subprocess.run(
                [str(args.node), str(V1 / 'accept.mjs'), '--pair', PAIR, '--workspace', str(workspace), '--answer', str(answer)], text=True, capture_output=True))
        (root / 'trusted-check.json').write_text(trusted.stdout, encoding='utf8')
        (root / 'trusted-check.stderr').write_text(trusted.stderr, encoding='utf8')
        receipt['stages'].append({'name': 'trusted-check', **stage, 'checkerExitCode': trusted.returncode})
        after = check_host_snapshot(workspace, snapshot)
        write_json(root / 'integrity-after-checks.json', {'errors': after})
        if before or after:
            receipt['integrityErrors'] = before + after
            public.returncode = public.returncode or 1
        receipt['status'] = 'pending-review'
        receipt['elapsedSeconds'] = time.monotonic() - arm_clock
        write_json(root / 'receipt.json', receipt)
        review_ok = do_review(args, root, workspace, answer, receipt, public, trusted, snapshot)
        receipt['accepted'] = bool(receipt.get('accepted') and receipt['retrieval']['passed'])
        final_integrity = check_host_snapshot(workspace, snapshot)
        write_json(root / 'integrity-after-review.json', {'errors': final_integrity})
        if final_integrity:
            receipt.setdefault('integrityErrors', []).extend(final_integrity)
            receipt['accepted'] = False
    else:
        receipt['status'] = 'answer-unreadable'
    receipt['completedAt'] = utc()
    receipt['elapsedSeconds'] = time.monotonic() - arm_clock
    if answer:
        receipt['status'] = 'accepted' if receipt.get('accepted') else ('reviewer-abnormal' if receipt.get('reviewerAbnormal') else ('reviewer-output-invalid' if not receipt.get('reviewerOutputValid', True) else 'rejected'))
    finalize_receipt(root, receipt, arm_clock)
    return review_ok if answer else False


def do_review(args, root, workspace, answer, receipt, public, trusted, snapshot):
    review = root / 'review'; review.mkdir(mode=0o700)
    shutil.copy2(HERE / 'task.json', review / 'task.json')
    shutil.copy2(answer, review / 'answer.json')
    shutil.copy2(HERE / 'review-rubric.json', review / 'review-rubric.json')
    (review / 'public-check.json').write_text(public.stdout if public else '', encoding='utf8')
    (review / 'trusted-check.json').write_text(trusted.stdout, encoding='utf8')
    manifest = snapshot['sourceHashes']
    copied, invalid = [], []
    try: evidence = json.loads(answer.read_text(encoding='utf8')).get('evidence', [])
    except (json.JSONDecodeError, AttributeError): evidence = []
    for item in evidence:
        try:
            src = safe_source(workspace, item.get('path'), manifest, cited=True)
            dest = review / 'source' / item['path']; dest.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(src, dest); copied.append(item['path'])
        except Exception as exc: invalid.append({'path': item.get('path') if isinstance(item, dict) else None, 'error': str(exc)})
    write_json(root / 'review-source-receipt.json', {'copied': copied, 'invalidCitations': invalid})
    prompt = ('Independently review this one task result. Read task.json, answer.json, review-rubric.json, public-check.json, trusted-check.json and only supplied source/. '
              'Return strict JSON only: {"accepted":boolean,"findings":[{"id":string,"passed":boolean,"reason":string}],"materialIssues":[string]}. '
              'Use every required finding ID exactly once. No memory, network, MCP, sibling directories or workers. Do not modify files.')
    (root / 'review-prompt.txt').write_text(prompt, encoding='utf8')
    make_home(root / 'reviewer-home', args.auth_file, REVIEWER)
    env = os.environ.copy(); env['CODEX_HOME'] = str(root / 'reviewer-home')
    command = [str(args.codex), 'exec', '--sandbox', 'read-only', '--ephemeral', '--ignore-rules', '--skip-git-repo-check', '--json', '-m', REVIEWER['model'],
               '-c', 'model_reasoning_effort="high"', '-C', str(review), '-o', str(root / 'review-final.json'), prompt]
    started, clock = utc(), time.monotonic()
    code, abnormal = run_capture(command, review, env, root / 'reviewer-events.jsonl', root / 'reviewer.stderr')
    receipt['stages'].append({'name': 'reviewer', 'startedAt': started, 'completedAt': utc(), 'seconds': time.monotonic()-clock, 'exitCode': code, 'abnormal': abnormal})
    receipt['reviewer'] = usage_and_tools(root / 'reviewer-events.jsonl')
    receipt['reviewerAbnormal'] = bool(code or abnormal)
    accepted = False
    output_valid = False
    try:
        report = json.loads((root / 'review-final.json').read_text(encoding='utf8'))
        expected = set(json.loads((HERE / 'task.json').read_text())['requiredFindingIds'])
        findings = report['findings']
        valid = isinstance(report, dict) and set(report) == {'accepted', 'findings', 'materialIssues'} and isinstance(report.get('accepted'), bool) and isinstance(report.get('materialIssues'), list) and isinstance(findings, list)
        valid = valid and {x.get('id') for x in findings if isinstance(x, dict)} == expected and len(findings) == len(expected)
        valid = valid and all(isinstance(x, dict) and set(x) == {'id', 'passed', 'reason'} and isinstance(x.get('id'), str) and isinstance(x.get('passed'), bool) and isinstance(x.get('reason'), str) and x['reason'].strip() for x in findings)
        valid = valid and all(isinstance(issue, str) and issue.strip() for issue in report['materialIssues'])
        output_valid = valid
        accepted = bool(valid and report['accepted'] and not report['materialIssues'] and all(x['passed'] for x in findings) and public and public.returncode == 0 and trusted.returncode == 0 and not code and not abnormal)
    except Exception as exc:
        (root / 'review-parse-error.txt').write_text(str(exc) + '\n', encoding='utf8')
    receipt['accepted'] = accepted
    receipt['reviewerOutputValid'] = output_valid
    return not code and not abnormal and output_valid


def main():
    p = argparse.ArgumentParser(description='Run the locked D5 v3 baseline then assisted qualification pair.')
    p.add_argument('--output', required=True, type=pathlib.Path, help='new private absolute output directory')
    p.add_argument('--source-root', required=True, type=pathlib.Path)
    p.add_argument('--node', required=True, type=pathlib.Path)
    p.add_argument('--codex', required=True, type=pathlib.Path)
    p.add_argument('--navigation-cli', required=True, type=pathlib.Path)
    p.add_argument('--auth-file', required=True, type=pathlib.Path)
    args = p.parse_args()
    cache_root = (pathlib.Path.home() / '.cache' / 'z1p-delivery').resolve()
    if not args.output.is_absolute() or args.output.exists() or cache_root not in args.output.resolve().parents: p.error('--output must be a new private directory below ~/.cache/z1p-delivery')
    for field in ('source_root', 'node', 'codex', 'navigation_cli', 'auth_file'):
        path = getattr(args, field)
        if not path.is_absolute(): p.error(f'--{field.replace("_", "-")} must be absolute')
        setattr(args, field, path.resolve())
    if args.source_root != CONTEXT: p.error('--source-root must be the explicit Context root')
    for path in (args.node, args.codex, args.navigation_cli, args.auth_file): require_regular(path)
    validate_lock()  # Must complete before output creation, preparation or any model call.
    toolchain = validate_toolchain(args)
    started_clock = time.monotonic()
    args.output.mkdir(mode=0o700)
    write_json(args.output / 'pair-receipt.json', {'experimentId': 'd5-orientation-context-20260921-v3', 'pair': PAIR, 'startedAt': utc(), 'lock': 'verified', 'toolchain': toolchain, 'providerCacheState': 'unknown', 'billing': None})
    baseline = run_arm(args, args.output, 'baseline')
    assisted = run_arm(args, args.output, 'assisted') if baseline else False
    pair = json.loads((args.output / 'pair-receipt.json').read_text())
    accepted = []
    for arm in ('baseline', 'assisted'):
        receipt = args.output / arm / 'receipt.json'
        if receipt.exists() and json.loads(receipt.read_text()).get('accepted') is True: accepted.append(arm)
    pair.update({'completedAt': utc(), 'elapsedSeconds': time.monotonic() - started_clock, 'baselineProcessCompleted': baseline, 'assistedProcessCompleted': assisted,
                 'qualificationAccepted': len(accepted) == 2, 'acceptedArms': accepted,
                 'status': 'completed' if baseline and assisted else 'stopped-abnormal-or-prepare-failure'})
    save_start, save_clock = utc(), time.monotonic()
    write_json(args.output / 'pair-receipt.json', pair)
    pair['receiptCapture'] = {'startedAt': save_start, 'completedAt': utc(), 'seconds': time.monotonic()-save_clock}
    pair['elapsedSeconds'] = time.monotonic()-started_clock
    write_json(args.output / 'pair-receipt.json', pair)
    return 0 if len(accepted) == 2 else 1


if __name__ == '__main__':
    raise SystemExit(main())
