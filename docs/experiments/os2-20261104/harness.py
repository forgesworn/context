#!/usr/bin/env python3
"""OS2 runner, phase 0 part: schedule, arm setup, commands, usage and the cost gate.

`plan` writes every cell's Codex home config, prompt and argument list to a new
directory and never starts Codex. `prepare` and `assess --checker-only` start no
model either; `execute` and `assess` do, and each run needs its own approval.

Protocol v2 (2026-11-05), after the independent review:
  - Read isolation is enforced by Codex 0.166 permission profiles, not by
    prompts: model tool calls cannot read the user's home (plans, sibling
    cells, hidden acceptance, transcripts), /private/tmp or per-user temp. Deny
    rules beat allow rules, so each session runs in a fresh root outside the
    home with its own temp and HOME, and a copied toolchain. A readiness probe
    proves a canary in the cell directory is unreadable before any model starts.
  - The legacy --sandbox flag is never passed: it overrides the profile.
  - Usage fails closed (A1-A4 below are checked, not assumed).
  - plan records hashes of every input; execute refuses on any mismatch.
  - Scope is enforced from the acceptance file; reviewer evidence is bounded
    excerpts; `analyse` computes the declared gates.

Usage checks on every `codex exec --json` stream; a failure makes the cell
incomplete, never zero:
  A1 cached_input_tokens <= input_tokens;
  A2 reasoning_output_tokens <= output_tokens;
  A3 exactly one turn.completed per exec (0.166 aggregates the whole exec), and
     its input/output equal the sums of the per-call session log;
  A4 cache_write_input_tokens is 0 (non-zero accounting is unsettled).
"""
import argparse
import fnmatch
import json
import os
import pathlib
import random
import statistics
import sys
import uuid

HERE = pathlib.Path(__file__).resolve().parent

SETTINGS = {'model': 'gpt-5.6-sol', 'effort': 'high'}
ARM_NAMES = ('plain', 'context', 'graphify')
CONTEXT_TOOLS = ['repository_status', 'repository_refresh', 'repository_search', 'repository_explore',
                 'repository_packet', 'repository_coverage', 'repository_graph']
SHELLS = {'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'env'}
FORBIDDEN = ('--dangerously-bypass-approvals-and-sandbox', '--yolo', '--full-auto', 'danger-full-access',
             '--sandbox', '-s', '--profile', '-p')
PROFILES = {'executor': ':workspace', 'reviewer': ':read-only'}
# Trees no model tool call may read. The user's home is added at run time.
DENY_READ = ('/private/tmp', '/private/var/folders')
ACTIVE_BASE = pathlib.Path('/Users/Shared')
SEED = 20261105
# Protocol v2 reviewer (owner decision 2026-11-05): a different model family from the
# executor, with a second blinded Codex review on a seeded sample to measure agreement.
REVIEWER = {'family': 'claude', 'model': 'claude-opus-5-5', 'effort': 'high'}
AGREEMENT_PER_ARM = 6        # phase 2: 12 of 48 cells, 6 per arm; plans of <= 12 cells review every cell twice
AGREEMENT_THRESHOLD = 0.8    # raw agreement on `accepted`; below it the quality guard is unreliable, not passed
REVIEW_DIFF_BYTES = 262_144  # executor.diff inlined in the Claude prompt is capped here; truncation is recorded

# One retrieval instruction per arm, of similar length and force (protocol retrievalInstructionRule).
INSTRUCTIONS = {
    'plain': ('Discover source with bounded rg searches and exact file reads inside this workspace. '
              'Read the implementation and tests you rely on before answering. No navigation service is available.'),
    'context': ('Discover source with the z1p-repository tools: search or explore, then read the exact '
                'implementation and tests you rely on with repository_packet before answering.'),
    'graphify': ('Discover source with the prebuilt Graphify graph in graphify-out/ and the graphify CLI, '
                 'then read the exact implementation and tests it points to before answering.'),
}
COMMON = ('Do not use network search, memory, sibling directories, another arm, acceptance files or workers. '
          'You may run the compiler and focused tests.\n\n')


def schedule(task_ids, arms, repetitions, seed=None):
    """Cells in run order. Repetition r (1-based) of task i (1-based) uses `arms`
    rotated left by (i + r - 1) mod n. With a seed, the (task, repetition) blocks
    run in a seeded random order, so arm order is not tied to time of day."""
    if len(set(arms)) != len(arms) or not set(arms) <= set(ARM_NAMES) or 'plain' not in arms or 'context' not in arms:
        raise ValueError(f'arms must be distinct, include plain and context, and come from {ARM_NAMES}')
    n, blocks = len(arms), []
    for r in range(1, repetitions + 1):
        for i, task in enumerate(task_ids, 1):
            k = (i + r - 1) % n
            blocks.append([{'task': task, 'taskIndex': i, 'repetition': r, 'arm': arm, 'position': position}
                           for position, arm in enumerate(list(arms[k:]) + list(arms[:k]), 1)])
    if seed is not None:
        random.Random(seed).shuffle(blocks)
    return [c for b in blocks for c in b]


def toml_string(value):
    return json.dumps(str(value))


def isolation(role, root, toolchain, home=None):
    """Permission profile and tool environment for one session rooted at `root`
    (workspace/ or review/, tmp/, home/). Model tool calls cannot read the user's
    home or shared temp; they write only inside `root`."""
    root, toolchain = pathlib.Path(root), pathlib.Path(toolchain)
    home = pathlib.Path(home or pathlib.Path.home())
    for p in (root, toolchain):
        if not p.is_absolute() or p == home or home in p.parents or any(p.is_relative_to(d) for d in DENY_READ):
            raise ValueError(f'{p} must be absolute and outside every denied tree')
    rules = [(str(home), 'deny')] + [(d, 'deny') for d in DENY_READ]
    rules += [(str(root / ('workspace' if role == 'executor' else 'review')), 'write' if role == 'executor' else 'read'),
              (str(root / 'tmp'), 'write'), (str(root / 'home'), 'write'), (str(toolchain), 'read')]
    env = {'PATH': f'{toolchain}/bin:/Library/Developer/CommandLineTools/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin',
           'HOME': str(root / 'home'), 'TMPDIR': str(root / 'tmp'), 'COREPACK_HOME': str(toolchain / 'corepack'),
           'COREPACK_ENABLE_DOWNLOAD_PROMPT': '0', 'LANG': 'en_GB.UTF-8'}
    # Executors get loopback only (h3's socket tests): Codex's network proxy with an
    # empty domain list refuses every outside host, and local binding opens localhost.
    network = '[permissions.os2.network]\nenabled = true\nallow_local_binding = true\n' if role == 'executor' else ''
    return ('default_permissions = "os2"\n'
            '[permissions.os2]\nextends = ' + toml_string(PROFILES[role]) + '\n'
            '[permissions.os2.filesystem]\n' + ''.join(f'{toml_string(p)} = {toml_string(m)}\n' for p, m in rules) +
            network + '[shell_environment_policy]\ninherit = "none"\nset = { ' +
            ', '.join(f'{k} = {toml_string(v)}' for k, v in env.items()) + ' }\n')


def codex_config(arm, settings, workspace=None, node=None, navigation_cli=None, root=None, toolchain=None, home=None):
    """config.toml text for one fresh CODEX_HOME. Only the context arm gets an MCP
    server. With root and toolchain, the session is read-isolated (see isolation)."""
    if arm not in ARM_NAMES and arm != 'reviewer':
        raise ValueError(f'unknown arm {arm!r}')
    text = ('model = ' + toml_string(settings['model']) + '\n'
            'model_reasoning_effort = ' + toml_string(settings['effort']) + '\n'
            'project_doc_max_bytes = 0\nweb_search = "disabled"\n')
    if root is not None:
        text += isolation('reviewer' if arm == 'reviewer' else 'executor', root, toolchain, home)
    text += '[features]\napps = false\nmemories = false\nmulti_agent = false\n'
    if root is not None and arm != 'reviewer':
        text += 'network_proxy = true\n'
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
    # No --sandbox: it would override the config's permission profile (see isolation).
    argv = [str(codex), 'exec', '--ignore-rules']
    if role == 'reviewer':
        argv.append('--skip-git-repo-check')
    argv += ['--json', '-m', settings['model'], '-c', 'model_reasoning_effort=' + toml_string(settings['effort']),
             '-C', str(cwd), '-o', str(final), '-' if role == 'executor' else prompt_text]
    validate_command(argv)
    return argv


V1_SANDBOXES = {'executor': 'workspace-write', 'reviewer': 'read-only'}


def command_v1(codex, role, settings, cwd, final, prompt_text=None):
    """The version 1 argument list (legacy --sandbox, no permission profile), kept
    so write-probe.py and protocol-review.py rerun exactly as recorded. Never used
    for version 2 cells."""
    if role == 'reviewer' and not prompt_text:
        raise ValueError('reviewer needs its prompt')
    argv = [str(codex), 'exec', '--sandbox', V1_SANDBOXES[role], '--ignore-rules']
    if role == 'reviewer':
        argv.append('--skip-git-repo-check')
    argv += ['--json', '-m', settings['model'], '-c', 'model_reasoning_effort=' + toml_string(settings['effort']),
             '-C', str(cwd), '-o', str(final), '-' if role == 'executor' else prompt_text]
    rest = [a for a in argv if a not in ('--sandbox', V1_SANDBOXES[role])]
    validate_command(rest)
    return argv


def validate_command(argv):
    if not isinstance(argv, list) or not all(isinstance(a, str) for a in argv):
        raise ValueError('command must be a list of strings, never a shell string')
    if not pathlib.Path(argv[0]).is_absolute() or pathlib.Path(argv[0]).name in SHELLS:
        raise ValueError('command must start with the absolute Codex binary')
    if any(a == f or a.startswith(f + '=') for a in argv for f in FORBIDDEN):
        raise ValueError('command contains a sandbox bypass, sandbox mode or profile flag')
    if any(argv[j - 1] == '-c' and any(k in argv[j] for k in ('sandbox', 'permissions', 'shell_environment'))
           for j in range(1, len(argv))):
        raise ValueError('command overrides the sandbox, permissions or tool environment through -c')
    return argv


def usage(events, exit_code=0, session=None):
    """Token usage from one recorded `codex exec --json` stream (raw or {"event": ...} lines).
    Totals only when the stream passes A1-A4 (module docstring), the process exited 0
    and, when given, the session log's per-call sums agree; otherwise complete=False
    with reasons, and totals are None, never zero."""
    turns, raw, abnormal, malformed = 0, [], False, 0
    for line in events.splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except ValueError:
            malformed += 1
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
    reasons = []
    if malformed:
        reasons.append('malformed-lines')
    if abnormal:
        reasons.append('turn-failed')
    if exit_code != 0:
        reasons.append('exit-nonzero')
    if turns == 0:
        reasons.append('no-usage')
    elif turns > 1:
        reasons.append('A3-multiple-usage-events')
    for u in raw:
        if not (isinstance(u, dict) and all(isinstance(u.get(f), int) and u[f] >= 0 for f in fields)):
            reasons.append('missing-usage-field')
            continue
        if u['cached_input_tokens'] > u['input_tokens']:
            reasons.append('A1-cached-exceeds-input')
        if u['reasoning_output_tokens'] > u['output_tokens']:
            reasons.append('A2-reasoning-exceeds-output')
        if u['cache_write_input_tokens'] != 0:
            reasons.append('A4-cache-write-unsettled')
        if session is not None:
            calls = (session or {}).get('calls') or []
            if (sum(c.get('input') or 0 for c in calls), sum(c.get('output') or 0 for c in calls)) != (u['input_tokens'], u['output_tokens']):
                reasons.append('A3-session-stream-mismatch')
    complete = not reasons
    result = {'turns': turns, 'raw': raw, 'abnormal': abnormal, 'malformedLines': malformed, 'complete': complete,
              'incompleteReasons': sorted(set(reasons)),
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


def per_task_medians(cells, arm, tasks, repetitions):
    """Median of each task's cells for one arm; exactly `repetitions` complete rows each."""
    per = {}
    for t in tasks:
        rows = [c for c in cells if c['task'] == t and c['arm'] == arm]
        if len(rows) != repetitions:
            raise ValueError(f'task {t} arm {arm}: {len(rows)} cells, expected {repetitions}')
        per[t] = statistics.median(c['totalTokens'] for c in rows)
    return per


def bootstrap_ratio(ctx, other, draws=10_000, seed=SEED, level=0.90):
    """Percentile interval of sum(ctx)/sum(other) over tasks resampled with
    replacement, and of the geometric mean of per-task ratios. Tasks are the unit."""
    import math
    tasks = sorted(ctx)
    rng = random.Random(seed)
    sums, geos = [], []
    for _ in range(draws):
        pick = [rng.choice(tasks) for _ in tasks]
        sums.append(sum(ctx[t] for t in pick) / sum(other[t] for t in pick))
        geos.append(math.exp(statistics.fmean(math.log(ctx[t] / other[t]) for t in pick)))
    lo, hi = (1 - level) / 2, 1 - (1 - level) / 2
    q = lambda xs: [sorted(xs)[int(lo * (len(xs) - 1))], sorted(xs)[int(hi * (len(xs) - 1))]]
    return {'sumRatioInterval': q(sums), 'geometricMean': math.exp(statistics.fmean(math.log(ctx[t] / other[t]) for t in tasks)),
            'geometricMeanInterval': q(geos), 'draws': draws, 'seed': seed, 'level': level}


def cost_gate(cells, comparators, repetitions, threshold=0.8, upper=1.0):
    """cells: [{task, arm, totalTokens (None when incomplete), reviewerSeconds}].
    Statistic: sum over tasks of per-task median total tokens, per arm. Context passes
    a comparator only if no compared cell is incomplete, every task has exactly
    `repetitions` cells per arm, the point ratio is at most `threshold` and the upper
    end of its 90% task-bootstrap interval is below `upper`. Reviewer seconds are
    reported, not gated (protocol v2)."""
    tasks = sorted({c['task'] for c in cells})
    arms = ['context'] + list(comparators)
    incomplete = sorted({c['task'] for c in cells if c['arm'] in arms and c['totalTokens'] is None})
    report = {'incompleteTasks': incomplete, 'arms': {}, 'comparisons': {}, 'passed': False}
    if incomplete:
        return report
    medians = {arm: per_task_medians(cells, arm, tasks, repetitions) for arm in arms}
    for arm in arms:
        secs = {t: statistics.median(c['reviewerSeconds'] for c in cells if c['task'] == t and c['arm'] == arm) for t in tasks}
        report['arms'][arm] = {'perTask': medians[arm], 'tokens': sum(medians[arm].values()), 'reviewerSeconds': sum(secs.values())}
    passed = True
    for arm in comparators:
        other = report['arms'][arm]['tokens']
        ratio = report['arms']['context']['tokens'] / other if other else None
        boot = bootstrap_ratio(medians['context'], medians[arm]) if other and all(medians[arm].values()) else None
        ok = ratio is not None and boot is not None and ratio <= threshold and boot['sumRatioInterval'][1] < upper
        report['comparisons'][arm] = {'tokenRatio': ratio, 'bootstrap': boot, 'passed': ok}
        passed = passed and ok
    report['passed'] = passed
    return report


QUALITY_CLASSES = ('impact', 'code-change')


def quality_guard(cells, comparators):
    """cells: [{task, class, arm, accepted, dependencies}]. Context passes a comparator
    if it has no fewer accepted outcomes in total, and on no impact or code-change task
    is its median dependency total (missed + incorrect) higher. "Better" (lower on at
    least two such tasks) is reported, not required; all-zero is inconclusive."""
    report = {'comparisons': {}, 'passed': True}
    tasks = sorted({c['task'] for c in cells if c.get('class') in QUALITY_CLASSES})
    med = lambda arm, t: statistics.median((c['dependencies'] or {}).get('total', 0) for c in cells if c['task'] == t and c['arm'] == arm)
    for arm in comparators:
        acc = {a: sum(1 for c in cells if c['arm'] == a and c['accepted']) for a in ('context', arm)}
        per = {t: {'context': med('context', t), arm: med(arm, t)} for t in tasks}
        worse = [t for t, v in per.items() if v['context'] > v[arm]]
        better = [t for t, v in per.items() if v['context'] < v[arm]]
        ok = acc['context'] >= acc[arm] and not worse
        report['comparisons'][arm] = {'accepted': acc, 'dependencyMedians': per, 'worseTasks': worse, 'betterTasks': better,
                                      'better': len(better) >= 2 and not worse,
                                      'inconclusive': all(v['context'] == 0 and v[arm] == 0 for v in per.values()), 'passed': ok}
        report['passed'] = report['passed'] and ok
    return report


def sensitivity(parts, weights=(0.0, 0.1, 1.0)):
    """uncached + output + w x cached for frozen weights; w = 1 is the total."""
    if any(not p.get('complete') for p in parts):
        return None
    return {str(w): sum(p['uncached'] + p['output'] + w * p['cached'] for p in parts) for w in weights}


def load_tasks(directory):
    """Public task files; manifest.json is the pack index, not a task."""
    tasks = []
    for path in sorted(pathlib.Path(directory).glob('*.json')):
        if path.name == 'manifest.json':
            continue
        value = json.loads(path.read_text(encoding='utf8'))
        if not isinstance(value.get('id'), str) or not isinstance(value.get('statement'), str):
            raise SystemExit(f'task {path.name} needs string id and statement')
        tasks.append((path, value))
    if not tasks:
        raise SystemExit('no task files')
    return tasks


def tree_digest(root, exclude=('manifest.json',)):
    """sha256 over sorted relative paths, link targets and file contents."""
    root = pathlib.Path(root)
    h = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        rel = str(path.relative_to(root))
        if rel in exclude:
            continue
        if path.is_symlink():
            h.update(f'L {rel} {os.readlink(path)}\n'.encode())
        elif path.is_file():
            h.update(f'F {rel} {sha256_file(path)}\n'.encode())
    return h.hexdigest()


def sha_or_none(path):
    return sha256_file(path) if pathlib.Path(path).is_file() else None


def lock_record(args, codex, tasks):
    """Hashes execute re-checks before any model starts."""
    cli = pathlib.Path(args.navigation_cli)
    return {'codex': str(codex), 'codexSha256': sha256_file(codex), 'node': str(args.node), 'nodeSha256': sha_or_none(args.node),
            'navigationCli': str(cli), 'navigationPackageSha256': sha_or_none(cli.parent.parent / 'package.json'),
            'navigationCliSha256': sha_or_none(cli),
            'toolchain': str(args.toolchain), 'toolchainManifestSha256': sha256_file(pathlib.Path(args.toolchain) / 'manifest.json'),
            'taskSha256': {t['id']: sha256_file(path) for path, t in tasks},
            'harnessSha256': sha256_file(HERE / 'harness.py'), 'metricsSha256': sha256_file(HERE / 'metrics.mjs'),
            'reviewer': REVIEWER, 'claude': str(args.claude), 'claudeSha256': sha_or_none(args.claude)}


def agreement_sample(cells, seed, per_arm=AGREEMENT_PER_ARM):
    """Cells that also get the second (Codex) review: every cell in a small plan,
    otherwise `per_arm` per arm drawn with the plan seed."""
    if len(cells) <= 2 * per_arm:
        return sorted(c['directory'] for c in cells)
    rng = random.Random(seed)
    pick = []
    for arm in sorted({c['arm'] for c in cells}):
        pick += rng.sample(sorted(c['directory'] for c in cells if c['arm'] == arm), per_arm)
    return sorted(pick)


def active_root(plan_doc, cell_name, kind='cell'):
    return pathlib.Path(plan_doc['activeBase']) / f"os2-{plan_doc['planId']}-{cell_name}-{kind}"


def plan(args):
    out = args.out
    if not out.is_absolute() or out.exists():
        raise SystemExit('--out must be a new absolute directory')
    codex = resolve_codex(args.codex)
    args.claude = resolve_codex(args.claude)
    arms = tuple(args.arms.split(','))
    tasks = load_tasks(args.tasks)
    base = pathlib.Path(args.active_base)
    home = pathlib.Path.home()
    if not base.is_absolute() or base == home or home in base.parents:
        raise SystemExit('--active-base must be absolute and outside the home directory')
    out.mkdir(mode=0o700)
    cells = schedule([t['id'] for _, t in tasks], arms, args.repetitions, args.seed)
    by_id = {t['id']: t for _, t in tasks}
    plan_doc = {'settings': SETTINGS, 'arms': arms, 'repetitions': args.repetitions, 'seed': args.seed, 'protocol': 2,
                'planId': uuid.uuid4().hex[:12], 'activeBase': str(base), 'codex': str(codex),
                'lock': lock_record(args, codex, tasks), 'cells': cells}
    for n, cell in enumerate(cells, 1):
        # Opaque names; the reviewer never runs inside the cell directory (protocol v2).
        name = f"cell-{n:03d}"
        d = out / name
        d.mkdir(mode=0o700)
        root = active_root(plan_doc, name)
        workspace = root / 'workspace'
        (d / 'executor-config.toml').write_text(
            codex_config(cell['arm'], SETTINGS, workspace, args.node, args.navigation_cli, root, args.toolchain), encoding='utf8')
        (d / 'executor-prompt.txt').write_text(executor_prompt(cell['arm'], by_id[cell['task']]), encoding='utf8')
        (d / 'executor-command.json').write_text(json.dumps(command(codex, 'executor', SETTINGS, workspace, d / 'executor-final.txt'), indent=2) + '\n', encoding='utf8')
        cell['directory'] = name
    plan_doc['reviewer'] = REVIEWER
    plan_doc['agreementSample'] = agreement_sample(cells, args.seed)
    plan_doc['agreementThreshold'] = AGREEMENT_THRESHOLD
    (out / 'schedule.json').write_text(json.dumps(plan_doc, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'cells': len(cells), 'out': str(out), 'agreementSample': len(plan_doc['agreementSample'])}))
    return 0


# ---------------------------------------------------------------------------
# Execution path. Stages, run separately:
#   toolchain  once: copy node, corepack's pinned pnpm and rg outside the home.
#   prepare    per task: extract the frozen base archive, install, commit the tree.
#   execute    per cell: stage the template in a fresh root outside the home,
#              prove isolation and readiness, run one executor session, bring the
#              workspace back. --forbid paths must still be absent (defence in depth).
#   assess     after every executor: checker, scope, dependency count, reviewer.
#   analyse    model-free: cost gate, bootstrap interval, quality guard.
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
# outside the sandbox, and READY is then run under the session's own profile before
# any model starts.
RELINK = {'h3': 'pnpm install --frozen-lockfile --offline'}
# Tracked files a repository's own build regenerates; left out of the recorded change like
# answer.json, so running the build is never a scope violation.
BUILD_OUTPUTS = {'bray': ('site/tools-manifest.json',)}
READY = {'h3': 'pnpm vitest --version', 'bray': './node_modules/.bin/vitest --version && node -e "require(\'./package.json\')"'}
OFFLINE = ('(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
           '(allow network-outbound (remote unix-socket))')
SYSTEM_PREFIXES = ('/bin/', '/usr/', '/opt/homebrew/', '/Library/Developer/CommandLineTools/', '/dev/null', '/dev/stdin',
                   '/dev/stdout', '/dev/stderr')
CANARY = 'isolation-canary.txt'
# Run inside the session's sandbox before any model starts: no outside host may be
# reachable (by IP or through the proxy), and an executor must reach localhost.
OUTSIDE_PROBE = '/usr/bin/nc -z -G 3 1.1.1.1 443 || /usr/bin/curl -sS -m 5 -o /dev/null https://example.com'
LOOPBACK_PROBE = ("/usr/bin/python3 -c 'import socket; s = socket.socket(); s.bind((\"127.0.0.1\", 0)); s.listen(); "
                  "c = socket.create_connection(s.getsockname(), 3); a, _ = s.accept(); c.sendall(b\"ok\"); "
                  "assert a.recv(2) == b\"ok\"'")
EXCERPT_CONTEXT, EXCERPT_LINES, EXCERPT_BYTES = 20, 400, 262_144


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


def tool_env(toolchain):
    """Host environment with the copied toolchain first, so the relink and the checker
    use the same node and pinned pnpm versions as the model (protocol v2)."""
    if toolchain is None:
        return None
    tc = pathlib.Path(toolchain)
    return {**os.environ, 'PATH': f'{tc}/bin:' + os.environ.get('PATH', '/usr/bin:/bin'), 'COREPACK_HOME': str(tc / 'corepack'),
            'COREPACK_ENABLE_DOWNLOAD_PROMPT': '0'}


def shell(command, cwd, offline=False, timeout=1200, env=None):
    argv = ['/bin/zsh', '-c', command]
    if offline:
        argv = ['sandbox-exec', '-p', OFFLINE] + argv
    started = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=cwd, text=True, capture_output=True, timeout=timeout, env=env)
        code, out = p.returncode, (p.stdout + p.stderr)
    except subprocess.TimeoutExpired as exc:
        code, out = 'timeout', str(exc)
    return {'exitCode': code, 'seconds': round(time.monotonic() - started, 1), 'tail': out[-4000:]}


def clone_tree(src, dst):
    """APFS copy-on-write clone where available, so per-cell copies are cheap."""
    r = subprocess.run(['cp', '-cR', str(src), str(dst)], capture_output=True, text=True)
    if r.returncode != 0:
        shutil.copytree(src, dst, symlinks=True)


def build_toolchain(args):
    """Copy the tools model sessions may run to a directory outside the home, which
    the permission profile makes readable. Writes manifest.json with a tree digest."""
    out = pathlib.Path(args.out)
    home = pathlib.Path.home()
    if not out.is_absolute() or out.exists() or home in out.parents:
        raise SystemExit('--out must be a new absolute directory outside the home')
    out.mkdir(mode=0o755, parents=True)
    clone_tree(args.node_prefix, out / 'node')
    # Every pnpm version a task pins (packageManager or devEngines); corepack picks by the
    # workspace's pin and cannot download inside the sandbox.
    versions = args.pnpm_version if isinstance(args.pnpm_version, list) else [args.pnpm_version]
    (out / 'corepack' / 'v1' / 'pnpm').mkdir(parents=True)
    for v in versions:
        pnpm = pathlib.Path(args.corepack_home) / 'v1' / 'pnpm' / v
        if not pnpm.is_dir():
            shutil.rmtree(out, ignore_errors=True)
            raise SystemExit(f'pnpm {v} is not in the corepack cache')
        clone_tree(pnpm, out / 'corepack' / 'v1' / 'pnpm' / v)
    (out / 'bin').mkdir()
    for name in ('node', 'npm', 'npx', 'corepack'):
        (out / 'bin' / name).symlink_to(f'../node/bin/{name}')
    (out / 'bin' / 'pnpm').symlink_to('../node/lib/node_modules/corepack/dist/pnpm.js')
    shutil.copy2(pathlib.Path(args.rg).resolve(), out / 'bin' / 'rg')
    manifest = {'pnpmVersion': versions[0], 'pnpmVersions': versions, 'nodeVersion': subprocess.run([str(out / 'bin' / 'node'), '--version'],
                capture_output=True, text=True).stdout.strip(), 'digest': tree_digest(out)}
    write_json(out / 'manifest.json', manifest)
    print(json.dumps(manifest))
    return 0


def prepare_template(task, archive, expected_sha, out, install=None, toolchain=None):
    """Extract the frozen archive, install dependencies, then commit everything so
    the executor's later diff shows only its own changes. A failed install removes
    the copy and stops."""
    if sha256_file(archive) != expected_sha:
        raise ValueError(f'archive hash mismatch for {task["id"]}')
    ws = out / task['id']
    ws.mkdir(parents=True)
    with tarfile.open(archive) as tar:
        tar.extractall(ws, filter='data')
    setup = shell(install or INSTALL[task['repository']], ws, env=tool_env(toolchain))
    if setup['exitCode'] != 0:
        shutil.rmtree(ws, ignore_errors=True)
        raise SystemExit(f'{task["id"]}: setup failed (exit {setup["exitCode"]}); template removed')
    git(ws, 'init', '-q'); git(ws, 'add', '-A'); git(ws, 'commit', '-qm', f'base {task["baseCommit"]}')
    record = {'taskId': task['id'], 'baseCommit': task['baseCommit'], 'archiveSha256': expected_sha, 'setup': setup,
              'tree': git(ws, 'rev-parse', 'HEAD^{tree}').stdout.strip()}
    write_json(out / f'{task["id"]}.template.json', record)
    return record


def verify_template(task, templates):
    """An existing template must match its record and have no uncommitted change."""
    ws, rec = templates / task['id'], templates / f'{task["id"]}.template.json'
    if not rec.is_file():
        raise SystemExit(f'{task["id"]}: template has no record')
    record = json.loads(rec.read_text(encoding='utf8'))
    tree = git(ws, 'rev-parse', 'HEAD^{tree}', check=False).stdout.strip()
    dirty = git(ws, 'status', '--porcelain', check=False).stdout.strip()
    if tree != record['tree'] or dirty or record.get('setup', {}).get('exitCode') != 0:
        raise SystemExit(f'{task["id"]}: template differs from its record or its setup failed')
    return record


def executor_prompt(arm, task):
    body = task['statement'].rstrip()
    if task.get('answerFormat'):
        body += '\n\nAnswer format: ' + task['answerFormat'].rstrip()
    body += '\nWrite answer.json in the workspace root before you finish.'
    return prompt(arm, body)


def outside_references(events_text, root):
    """Absolute, home or parent-relative paths in executed commands outside the
    session root. An audit list: the permission profile is the boundary."""
    import re
    root = str(root)
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
            if token.startswith(root) or token.startswith(SYSTEM_PREFIXES) or token in ('/bin/zsh', '/bin/bash', '/bin/sh'):
                continue
            if token.startswith('/') and token.count('/') == 1 and len(token) < 3:
                continue
            hits.add(token[:200])
        hits.update(m[:200] for m in re.findall(r"(?:^|[\s'\"=])((?:\.\./)+[^\s'\";|&)]*)", cmd))
    return sorted(hits)


def denied_reads(home):
    """Tool outputs the model saw that report a denied access: attempts the profile
    stopped. Read from the session log, because Codex 0.166 leaves a command the
    sandbox denied out of the --json stream (isolation probe, 2026-11-05)."""
    logs = sorted(pathlib.Path(home).glob('sessions/**/rollout-*.jsonl'))
    n = 0
    for log in logs:
        for line in log.read_text(encoding='utf8').splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            payload = e.get('payload') or {}
            if (e.get('type') == 'response_item' and payload.get('type') in ('custom_tool_call_output', 'function_call_output')
                    and 'Operation not permitted' in json.dumps(payload.get('output'))):
                n += 1
    return n


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


def sandbox_probe(codex, home, cwd, command_text, config_text, timeout=300):
    """Run one command under the session's own permission profile and tool
    environment, with no model."""
    home.mkdir(mode=0o700, exist_ok=True)
    (home / 'config.toml').write_text(config_text, encoding='utf8')
    argv = [str(codex), 'sandbox', '/bin/zsh', '-lc', command_text]
    started = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=cwd, env={**os.environ, 'CODEX_HOME': str(home)}, stdin=subprocess.DEVNULL,
                           text=True, capture_output=True, timeout=timeout)
        code, out = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired as exc:
        code, out = 'timeout', str(exc)
    return {'exitCode': code, 'seconds': round(time.monotonic() - started, 1), 'tail': out[-2000:]}


def isolation_probe(codex, home, cwd, config_text, canary, writable, loopback=False):
    """Exit 0 only if the canary (in the cell directory, inside the home) is
    unreadable, no outside host is reachable (99), loopback works when required
    (98), and the session root is writable."""
    probe = (f'if cat {json.dumps(str(canary))} >/dev/null 2>&1; then echo canary-readable; exit 97; fi; '
             f'if {{ {OUTSIDE_PROBE}; }} >/dev/null 2>&1; then echo network-open; exit 99; fi; ' +
             (f'{LOOPBACK_PROBE} >/dev/null 2>&1 || {{ echo loopback-blocked; exit 98; }}; ' if loopback else '') +
             f'echo ok > {json.dumps(str(writable / ".os2-probe"))} && rm {json.dumps(str(writable / ".os2-probe"))}')
    return sandbox_probe(codex, home, cwd, probe, config_text)


def make_root(root, inner):
    """A fresh session root. Any other os2-* entry under the base is refused: only
    one session's material may sit outside the denied trees at a time."""
    base = root.parent
    others = [p.name for p in base.glob('os2-*') if p != root and not p.name.startswith('os2-toolchain')]
    if others or root.exists():
        raise SystemExit(f'refusing to stage: {base} already holds {others or [root.name]}')
    for d in (inner, 'tmp', 'home'):
        (root / d).mkdir(parents=True, mode=0o700)
    return root


def ready_environment(codex, cell_dir, root, ws, repository, config_text, toolchain=None):
    """Relink the copied tree, prove isolation, then probe readiness under the
    session's profile. Raises before any model starts if any step fails, removing
    the staged root so the cell can be rerun."""
    env = {'relink': None, 'isolation': None, 'ready': None}
    canary = cell_dir / CANARY
    canary.write_text('not for model sessions\n', encoding='utf8')
    if RELINK.get(repository):
        env['relink'] = shell(RELINK[repository], ws, offline=True, env=tool_env(toolchain))
    if env['relink'] is None or env['relink']['exitCode'] == 0:
        env['isolation'] = isolation_probe(codex, cell_dir / 'probe-home', ws, config_text, canary, root / 'tmp', loopback=True)
    if READY.get(repository) and env['isolation'] and env['isolation']['exitCode'] == 0:
        env['ready'] = sandbox_probe(codex, cell_dir / 'probe-home', ws, READY[repository], config_text)
    write_json(cell_dir / 'environment.json', env)
    if any(v is not None and v['exitCode'] != 0 for v in env.values()) or env['isolation'] is None:
        shutil.rmtree(root, ignore_errors=True)
        raise SystemExit(f'{cell_dir.name}: environment not isolated or not ready, no model started (see environment.json)')
    return env


def change_pathspec(repository):
    return [':!answer.json', *(f':!{f}' for f in BUILD_OUTPUTS.get(repository, ()))]


def run_executor(codex, plan_doc, cell_dir, arm, task, template, auth, node, navigation_cli, toolchain, timeout):
    root = make_root(active_root(plan_doc, cell_dir.name), 'workspace')
    ws = root / 'workspace'
    shutil.rmtree(ws)
    clone_tree(template, ws)
    config_text = codex_config(arm, SETTINGS, ws, node, navigation_cli, root, toolchain)
    if config_text != (cell_dir / 'executor-config.toml').read_text(encoding='utf8'):
        shutil.rmtree(root, ignore_errors=True)
        raise SystemExit(f'{cell_dir.name}: executor config differs from the plan')
    environment = ready_environment(codex, cell_dir, root, ws, task['repository'], config_text, toolchain)
    home = cell_dir / 'executor-home'
    home.mkdir(mode=0o700)
    (home / 'auth.json').symlink_to(auth)
    (home / 'config.toml').write_text(config_text, encoding='utf8')
    text = executor_prompt(arm, task)
    if text != (cell_dir / 'executor-prompt.txt').read_text(encoding='utf8'):
        shutil.rmtree(root, ignore_errors=True)
        raise SystemExit(f'{cell_dir.name}: executor prompt differs from the plan')
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
    git(ws, 'add', '-A', '--', '.', *change_pathspec(task['repository']), check=False)  # the answer is not part of the change
    diff = git(ws, 'diff', '--cached', '--binary', check=False).stdout
    (cell_dir / 'executor.diff').write_text(diff, encoding='utf8')
    changed = [f for f in git(ws, 'diff', '--cached', '--name-only', check=False).stdout.splitlines() if f]
    metrics = subprocess.run([str(node), str(HERE / 'metrics.mjs'), str(cell_dir / 'executor-events.jsonl'), '--root', str(ws)],
                             capture_output=True, text=True)
    # After the diff is taken: does the tool chain still work, or did the run break it?
    after = sandbox_probe(codex, cell_dir / 'probe-home', ws, READY[task['repository']], config_text) if READY.get(task['repository']) else None
    environment['intactAfterRun'] = None if after is None else after['exitCode'] == 0
    session = session_calls(home)
    result = {'startedAt': started, 'seconds': seconds, 'exitCode': code, 'command': argv, 'environment': environment,
              'activeRoot': str(root), 'session': session,
              'usage': {k: v for k, v in usage(out, 0 if code == 0 else 1, session).items() if k != 'raw'}, 'changedFiles': changed,
              'answerPresent': (ws / 'answer.json').is_file(),
              'metrics': json.loads(metrics.stdout) if metrics.returncode == 0 else {'error': metrics.stderr[-500:]},
              'outsideReferences': outside_references(out, root), 'deniedAccesses': denied_reads(home)}
    shutil.move(str(ws), str(cell_dir / 'workspace'))
    shutil.rmtree(root, ignore_errors=True)
    return result


def answer_paths(task, answer, changed):
    """Paths an outcome covers: what an impact answer names, or what a code
    change actually changed (claims in answer.json do not count)."""
    if task['class'] == 'impact':
        return {x.get('path') for x in (answer or {}).get('mustChange', []) if isinstance(x, dict) and isinstance(x.get('path'), str)}
    if task['class'] == 'code-change':
        return set(changed)
    return set()


def dependency_count(task, acc, answer, changed, base_paths):
    """Impact and code-change tasks only. Missed: dependency-set paths not covered.
    Incorrect: impact paths that do not exist at base. Extra: covered paths outside
    the dependency set (reported as precision, not counted in total)."""
    if task['class'] not in QUALITY_CLASSES:
        return None
    covered = answer_paths(task, answer, changed)
    deps = {d['path'] for d in acc['dependencySet']}
    missed = sorted(deps - covered)
    incorrect = sorted(p for p in covered if task['class'] == 'impact' and p not in base_paths)
    extra = sorted(covered - deps)
    return {'missed': len(missed), 'incorrect': len(incorrect), 'extra': len(extra), 'total': len(missed) + len(incorrect),
            'recall': (len(deps & covered) / len(deps)) if deps else None,
            'precision': (len(deps & covered) / len(covered)) if covered else None}


def scope_check(acc, changed, strict=True):
    """Every changed file must match one of the acceptance file's allowedPaths globs."""
    scope = acc.get('scope')
    if not (isinstance(scope, dict) and isinstance(scope.get('allowedPaths'), list)
            and all(isinstance(g, str) and g for g in scope['allowedPaths'])):
        if strict:
            raise SystemExit(f"{acc.get('id')}: acceptance scope must be {{\"allowedPaths\": [glob, ...]}} (protocol v2)")
        return None
    outside = [f for f in changed if not any(fnmatch.fnmatchcase(f, g) for g in scope['allowedPaths'])]
    return {'passed': not outside, 'outside': outside}


REVIEW_PROMPT = ('Independently review one task outcome. Read task.json, answer.json, executor.diff (if present), '
                 'checker.json, rubric.json and only the supplied source/ excerpts. Judge each rubric item against the cited '
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


REVIEW_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['accepted', 'findings', 'materialIssues'],
                 'properties': {'accepted': {'type': 'boolean'},
                                'findings': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                                             'required': ['id', 'passed', 'reason'],
                                             'properties': {'id': {'type': 'string'}, 'passed': {'type': 'boolean'}, 'reason': {'type': 'string'}}}},
                                'materialIssues': {'type': 'array', 'items': {'type': 'string'}}}}
CLAUDE_REVIEW_INTRO = ('Independently review one task outcome. Everything you may use is below: the task, the answer, the '
                       'diff (if any), the checker result, the rubric and bounded source excerpts. Judge each rubric item against '
                       'the cited source and the diff. Use every rubric id exactly once in findings. Accept only if every rubric '
                       'item passes and there is no material issue. You have no tools; do not ask for more material.\n')


def claude_review_prompt(review):
    """The whole review, inlined: the Claude reviewer has no tools, so it can read
    nothing else. Returns (prompt, diffTruncated)."""
    parts, truncated = [CLAUDE_REVIEW_INTRO], False
    for name in ('task.json', 'answer.json', 'executor.diff', 'checker.json', 'rubric.json'):
        f = review / name
        if not f.is_file():
            continue
        text = f.read_text(encoding='utf8', errors='replace')
        if name == 'executor.diff' and len(text.encode('utf8')) > REVIEW_DIFF_BYTES:
            text = text.encode('utf8')[:REVIEW_DIFF_BYTES].decode('utf8', errors='ignore') + '\n[diff truncated]\n'
            truncated = True
        parts.append(f'\n===== {name} =====\n{text}')
    for f in sorted((review / 'source').rglob('*')) if (review / 'source').is_dir() else []:
        if f.is_file():
            parts.append(f'\n===== source/{f.relative_to(review / "source")} (line-numbered excerpt) =====\n'
                         + f.read_text(encoding='utf8', errors='replace'))
    return ''.join(parts), truncated


def claude_command(claude, reviewer=REVIEWER):
    """Headless Claude with no tools, no project or user instructions, no MCP and no
    saved session. The prompt goes on stdin."""
    return [str(claude), '-p', '--model', reviewer['model'], '--effort', reviewer['effort'], '--tools', '',
            '--setting-sources', 'project', '--disable-slash-commands', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
            '--no-session-persistence', '--json-schema', json.dumps(REVIEW_SCHEMA, separators=(',', ':')), '--output-format', 'json']


CLAUDE_ENV = {'CLAUDE_CODE_DISABLE_CLAUDE_MDS': '1', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY': '1'}


def claude_usage(text, exit_code=0):
    """Usage from one `claude -p --output-format json` result. Complete only for a
    successful result with integer usage fields; otherwise incomplete, never zero."""
    reasons = []
    try:
        r = json.loads(text)
    except (TypeError, ValueError):
        r = None
    if not isinstance(r, dict) or r.get('type') != 'result':
        reasons.append('no result event')
        r = {}
    if exit_code != 0:
        reasons.append(f'exit {exit_code}')
    if r and (r.get('subtype') != 'success' or r.get('is_error') is not False):
        reasons.append('result not a success')
    u = r.get('usage') if isinstance(r.get('usage'), dict) else {}
    keys = ('input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens')
    if r and not all(isinstance(u.get(k), int) and not isinstance(u.get(k), bool) and u.get(k) >= 0 for k in keys):
        reasons.append('usage fields missing')
    if reasons:
        return {'complete': False, 'incompleteReasons': reasons, 'family': 'claude'}
    return {'complete': True, 'incompleteReasons': [], 'family': 'claude', 'uncached': u['input_tokens'],
            'cached': u['cache_read_input_tokens'], 'cacheWrite': u['cache_creation_input_tokens'], 'output': u['output_tokens'],
            'total': sum(u[k] for k in keys), 'turns': r.get('num_turns'), 'apiRateEquivalentUSD': r.get('total_cost_usd')}


def claude_report(text):
    """The structured review from a Claude result, or None."""
    try:
        r = json.loads(text)
    except (TypeError, ValueError):
        return None
    if not isinstance(r, dict):
        return None
    if isinstance(r.get('structured_output'), dict):
        return r['structured_output']
    try:
        return json.loads(r.get('result') or '')
    except (TypeError, ValueError):
        return None


def evidence_excerpts(ws, answer, dest):
    """Bounded excerpts of cited lines (plus context) from the frozen workspace. A
    path resolving outside the workspace, through any symlinked parent, is skipped."""
    real = ws.resolve()
    total, written = 0, []
    ranges = {}
    for item in (answer or {}).get('evidence', [])[:64]:
        rel = item.get('path') if isinstance(item, dict) else None
        if not isinstance(rel, str) or pathlib.PurePosixPath(rel).is_absolute() or 'node_modules' in pathlib.PurePosixPath(rel).parts:
            continue
        src = (ws / rel).resolve()
        if not src.is_relative_to(real) or not src.is_file():
            continue
        try:
            a, b = int(item.get('startLine') or 1), int(item.get('endLine') or item.get('startLine') or 1)
        except (TypeError, ValueError):
            continue
        ranges.setdefault(str(src.relative_to(real)), []).append((max(1, a - EXCERPT_CONTEXT), max(a, b) + EXCERPT_CONTEXT))
    for rel, spans in sorted(ranges.items()):
        lines = (real / rel).read_text(encoding='utf8', errors='replace').splitlines()
        keep = sorted({n for a, b in spans for n in range(a, min(b, len(lines)) + 1)})[:EXCERPT_LINES]
        text = ''.join(f'{n}: {lines[n - 1]}\n' for n in keep)
        if total + len(text) > EXCERPT_BYTES:
            break
        target = dest / 'source' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf8')
        total += len(text); written.append(rel)
    return written


def run_checker(cell_dir, task, acc, repo, strict_scope=True, toolchain=None):
    """Hidden checker, scope and dependency count for one cell, with no model."""
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
            checker['relinkExit'] = shell(RELINK[task['repository']], check_ws, offline=True, env=tool_env(toolchain))['exitCode']
        for rel in acc['checker']['testFiles']:
            content = git(repo, 'show', f"{acc['sourceChange']}:{rel}").stdout
            target = check_ws / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding='utf8')
        result = shell(acc['checker']['command'], check_ws, offline=True, timeout=900, env=tool_env(toolchain))
        checker = {**checker, 'ran': True, 'passed': result['exitCode'] == 0, **result}
        shutil.rmtree(check_ws, ignore_errors=True)
    base_paths = set(git(repo, 'ls-tree', '-r', '--name-only', task['baseCommit']).stdout.splitlines())
    deps = dependency_count(task, acc, answer, receipt.get('changedFiles', []), base_paths)
    scope = scope_check(acc, receipt.get('changedFiles', []), strict_scope)
    return receipt, answer, checker, deps, scope


def codex_review(codex, cell_dir, root, review, toolchain, auth, rubric_ids, timeout):
    """Second, blinded review by Codex under the read-only profile (agreement sample)."""
    config_text = codex_config('reviewer', SETTINGS, root=root, toolchain=toolchain)
    home = cell_dir / 'reviewer-home'
    home.mkdir(mode=0o700)
    (home / 'auth.json').symlink_to(auth)
    (home / 'config.toml').write_text(config_text, encoding='utf8')
    canary = cell_dir / CANARY
    canary.write_text('not for model sessions\n', encoding='utf8')
    probe = isolation_probe(codex, cell_dir / 'review-probe-home', review, config_text, canary, root / 'tmp')
    if probe['exitCode'] != 0:
        shutil.rmtree(root, ignore_errors=True)
        raise SystemExit(f'{cell_dir.name}: reviewer isolation not proven, no model started')
    argv = command(codex, 'reviewer', SETTINGS, review, cell_dir / 'review-final.json', REVIEW_PROMPT)
    clock = time.monotonic()
    try:
        # The prompt is an argument; codex exec appends piped stdin to it and waits for EOF.
        p = subprocess.run(argv, cwd=review, env={**os.environ, 'CODEX_HOME': str(home)}, stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=timeout)
        code, out = p.returncode, p.stdout
    except subprocess.TimeoutExpired as exc:
        code, out = 'timeout', exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or '')
    seconds = round(time.monotonic() - clock, 1)
    (cell_dir / 'reviewer-events.jsonl').write_text(out, encoding='utf8')
    try:
        report = json.loads((cell_dir / 'review-final.json').read_text(encoding='utf8'))
    except (OSError, ValueError):
        report = None
    session = session_calls(home)
    return {'family': 'codex', 'exitCode': code, 'seconds': seconds,
            'usage': {k: v for k, v in usage(out, 0 if code == 0 else 1, session).items() if k != 'raw'}, 'session': session,
            'isolation': True, 'outsideReferences': outside_references(out, root), 'deniedAccesses': denied_reads(home),
            'report': report, **review_outcome(report, rubric_ids)}


def claude_review(claude, cell_dir, review, rubric_ids, timeout):
    """Primary review by Claude with no tools; the material is inlined in the prompt."""
    text, truncated = claude_review_prompt(review)
    (cell_dir / 'claude-review-prompt.txt').write_text(text, encoding='utf8')
    argv = claude_command(claude)
    clock = time.monotonic()
    try:
        p = subprocess.run(argv, cwd=review, env={**os.environ, **CLAUDE_ENV}, input=text, capture_output=True, text=True, timeout=timeout)
        code, out = p.returncode, p.stdout
    except subprocess.TimeoutExpired as exc:
        code, out = 'timeout', exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or '')
    seconds = round(time.monotonic() - clock, 1)
    (cell_dir / 'claude-review.json').write_text(out, encoding='utf8')
    report = claude_report(out)
    return {'family': 'claude', 'model': REVIEWER['model'], 'effort': REVIEWER['effort'], 'exitCode': code, 'seconds': seconds,
            'usage': claude_usage(out, 0 if code == 0 else 1), 'diffTruncated': truncated, 'promptBytes': len(text.encode('utf8')),
            'report': report, **review_outcome(report, rubric_ids)}


def assess_cell(codex, claude, plan_doc, cell_dir, task, acc, repo, auth, toolchain, timeout):
    receipt, answer, checker, deps, scope = run_checker(cell_dir, task, acc, repo, toolchain=toolchain)
    ws = cell_dir / 'workspace'
    root = make_root(active_root(plan_doc, cell_dir.name, 'review'), 'review')
    review = root / 'review'
    write_json(review / 'task.json', {k: task[k] for k in ('id', 'repository', 'class', 'statement', 'answerFormat')})
    write_json(review / 'answer.json', answer if answer is not None else {'error': 'answer.json missing or invalid'})
    if (cell_dir / 'executor.diff').read_text(encoding='utf8'):
        shutil.copy2(cell_dir / 'executor.diff', review / 'executor.diff')
    write_json(review / 'checker.json', {k: checker.get(k) for k in ('ran', 'passed', 'exitCode', 'tail')})
    write_json(review / 'rubric.json', {k: acc.get(k) for k in ('rubric', 'requiredEvidence', 'scope', 'notes')})
    excerpts = evidence_excerpts(ws, answer, review)
    rubric_ids = [r['id'] for r in acc.get('rubric', [])]
    primary = claude_review(claude, cell_dir, review, rubric_ids, timeout)
    second = None
    if cell_dir.name in (plan_doc.get('agreementSample') or []):
        second = codex_review(codex, cell_dir, root, review, toolchain, auth, rubric_ids, timeout)
    accepted = bool(primary['accepted'] and answer is not None and primary['exitCode'] == 0 and scope['passed']
                    and (not checker['ran'] or checker['passed']))
    # Gate on executor tokens only; reviewers are identical across arms and of two token families (protocol v2).
    result = {'checker': {k: checker.get(k) for k in ('ran', 'passed', 'exitCode', 'seconds', 'relinkExit')}, 'dependencies': deps,
              'scope': scope, 'excerpts': excerpts, 'reviewer': primary, 'secondReviewer': second,
              'accepted': accepted,
              'totalTokens': cell_total([receipt['usage']]),
              'reviewerTokens': {'claude': primary['usage'].get('total') if primary['usage']['complete'] else None,
                                 'codex': (second['usage'].get('total') if second and second['usage'].get('complete') else None)},
              'sensitivity': sensitivity([receipt['usage']]),
              'reviewerSeconds': primary['seconds'] + (second['seconds'] if second else 0)}
    shutil.move(str(review), str(cell_dir / 'review'))
    shutil.rmtree(root, ignore_errors=True)
    write_json(cell_dir / 'assessment.json', result)
    return result


def reviewer_agreement(assessments, sample, threshold=AGREEMENT_THRESHOLD):
    """Raw agreement between the two reviewers on `accepted` and on each rubric item.
    Missing or invalid second reviews make it unreliable. Kappa on a dozen cells is
    noise, so only counts are reported."""
    pairs = [(a['reviewer'], a.get('secondReviewer')) for d, a in sorted(assessments.items()) if d in sample]
    usable = [(p, s) for p, s in pairs if s and p.get('valid') and s.get('valid')]
    agree = sum(p['accepted'] == s['accepted'] for p, s in usable)
    items = agree_items = 0
    for p, s in usable:
        sf = {f['id']: f['passed'] for f in s['report']['findings']}
        for f in p['report']['findings']:
            items += 1; agree_items += sf.get(f['id']) == f['passed']
    rate = agree / len(usable) if usable else None
    reliable = len(usable) == len(sample) and len(sample) > 0 and rate is not None and rate >= threshold
    return {'sample': len(sample), 'usable': len(usable), 'acceptedAgree': agree, 'acceptedRate': rate,
            'rubricItems': items, 'rubricAgree': agree_items, 'threshold': threshold, 'reliable': reliable}


def check_claude(plan_doc, claude):
    lock = plan_doc.get('lock') or {}
    if lock.get('claude') != str(claude) or lock.get('claudeSha256') != sha_or_none(claude) or plan_doc.get('reviewer') != REVIEWER:
        raise SystemExit('refusing to assess: the Claude reviewer differs from the plan')


def check_lock(plan_doc, args, codex):
    """Every input execute uses must match the hashes plan recorded."""
    lock = plan_doc.get('lock') or {}
    now = {'codex': str(codex), 'codexSha256': sha256_file(codex), 'node': str(args.node), 'nodeSha256': sha_or_none(args.node),
           'navigationCli': str(args.navigation_cli), 'toolchain': str(args.toolchain),
           'toolchainManifestSha256': sha256_file(pathlib.Path(args.toolchain) / 'manifest.json'),
           'harnessSha256': sha256_file(HERE / 'harness.py'), 'metricsSha256': sha256_file(HERE / 'metrics.mjs')}
    cli = pathlib.Path(args.navigation_cli)
    now['navigationCliSha256'] = sha_or_none(cli)
    now['navigationPackageSha256'] = sha_or_none(cli.parent.parent / 'package.json')
    bad = sorted(k for k, v in now.items() if lock.get(k) != v)
    manifest = json.loads((pathlib.Path(args.toolchain) / 'manifest.json').read_text(encoding='utf8'))
    if manifest.get('digest') != tree_digest(args.toolchain):
        bad.append('toolchainTree')
    if bad:
        raise SystemExit(f'refusing to execute: {", ".join(bad)} differ from the plan')


def checked_tasks(plan_doc, directory):
    tasks = {t['id']: (path, t) for path, t in load_tasks(directory)}
    want = (plan_doc.get('lock') or {}).get('taskSha256') or {}
    bad = sorted(i for i, (path, _) in tasks.items() if want.get(i) != sha256_file(path)) + sorted(set(want) - set(tasks))
    if bad:
        raise SystemExit(f'refusing: task files differ from the plan: {bad}')
    return {i: t for i, (_, t) in tasks.items()}


CELL_OUTPUTS = ('executor.json', 'executor-events.jsonl', 'executor.stderr', 'executor.diff', 'executor-final.txt',
                'executor-home', 'probe-home', 'environment.json', 'workspace', CANARY)


def provider_failure(cell_dir):
    """A cell may be rerun once only if its executor exited non-zero and produced no
    model output at all (no turn.completed and no completed item in the stream)."""
    rec = json.loads((cell_dir / 'executor.json').read_text(encoding='utf8'))
    events = (cell_dir / 'executor-events.jsonl').read_text(encoding='utf8') if (cell_dir / 'executor-events.jsonl').exists() else ''
    output = any(t in events for t in ('"turn.completed"', '"item.completed"'))
    return rec.get('exitCode') != 0 and not output and not (cell_dir / 'repair-1').exists()


def set_aside_provider_failure(cell_dir):
    """Keep the failed attempt in repair-1/ (recorded, never deleted) so execute reruns the cell."""
    if not provider_failure(cell_dir):
        return False
    keep = cell_dir / 'repair-1'
    keep.mkdir(mode=0o700)
    for name in CELL_OUTPUTS:
        if (cell_dir / name).exists():
            shutil.move(str(cell_dir / name), str(keep / name))
    write_json(keep / 'repair.json', {'at': utc(), 'rule': 'provider failure with no model output; one rerun allowed'})
    return True


def execute(args):
    for path in args.forbid:
        if pathlib.Path(path).exists():
            raise SystemExit(f'refusing to execute: {path} exists on this machine')
    codex = resolve_codex(args.codex)
    plan_doc = json.loads((args.plan / 'schedule.json').read_text(encoding='utf8'))
    check_lock(plan_doc, args, codex)
    tasks = checked_tasks(plan_doc, args.tasks)
    for cell in plan_doc['cells']:
        if args.only and cell['directory'] not in args.only:
            continue
        cell_dir = args.plan / cell['directory']
        if args.rerun_provider_failures and (cell_dir / 'executor.json').exists():
            set_aside_provider_failure(cell_dir)
        if (cell_dir / 'executor.json').exists():
            continue
        verify_template(tasks[cell['task']], args.templates)
        result = run_executor(codex, plan_doc, cell_dir, cell['arm'], tasks[cell['task']], args.templates / cell['task'],
                              args.auth_file, args.node, args.navigation_cli, args.toolchain, args.timeout)
        write_json(cell_dir / 'executor.json', result)
        print(json.dumps({'cell': cell['directory'], 'exit': result['exitCode'], 'seconds': result['seconds'],
                          'complete': result['usage']['complete'], 'outside': len(result['outsideReferences']),
                          'denied': result['deniedAccesses']}))
    return 0


def assess(args):
    codex = resolve_codex(args.codex)
    plan_doc = json.loads((args.plan / 'schedule.json').read_text(encoding='utf8'))
    claude = None
    if not args.checker_only:
        claude = resolve_codex(args.claude) if args.claude else None
        if claude is None:
            raise SystemExit('assess needs --claude (the primary reviewer)')
        check_claude(plan_doc, claude)
    tasks = checked_tasks(plan_doc, args.tasks)
    missing = [c['directory'] for c in plan_doc['cells'] if not (args.plan / c['directory'] / 'executor.json').exists()]
    if missing and not args.checker_only:
        raise SystemExit(f'refusing to assess: executors not finished for {missing}')
    for cell in plan_doc['cells']:
        cell_dir = args.plan / cell['directory']
        done = cell_dir / ('checker-only.json' if args.checker_only else 'assessment.json')
        if (args.only and cell['directory'] not in args.only) or not (cell_dir / 'executor.json').exists() or done.exists():
            continue
        task = tasks[cell['task']]
        acc = json.loads((args.acceptance / f"{task['id']}.json").read_text(encoding='utf8'))
        if args.checker_only:
            # No reviewer: checker pass/fail, scope and dependency counts only, never the checker output.
            _, answer, checker, deps, scope = run_checker(cell_dir, task, acc, args.repos / task['repository'], strict_scope=False,
                                                          toolchain=args.toolchain)
            rec = {'cell': cell['directory'], 'answerPresent': answer is not None, 'checkerRan': checker['ran'],
                   'checkerPassed': checker.get('passed'), 'relinkExit': checker.get('relinkExit'), 'dependencies': deps,
                   'scope': scope}
            write_json(cell_dir / 'checker-only.json', rec)
            print(json.dumps(rec))
            continue
        result = assess_cell(codex, claude, plan_doc, cell_dir, task, acc, args.repos / task['repository'], args.auth_file,
                             args.toolchain, args.timeout)
        print(json.dumps({'cell': cell['directory'], 'accepted': result['accepted'], 'totalTokens': result['totalTokens'],
                          'dependencies': result['dependencies']}))
    return 0


def analyse(args):
    """Model-free gate calculation over a finished plan."""
    plan_doc = json.loads((args.plan / 'schedule.json').read_text(encoding='utf8'))
    tasks = checked_tasks(plan_doc, args.tasks)
    rows = []
    for cell in plan_doc['cells']:
        d = args.plan / cell['directory']
        if not (d / 'assessment.json').exists():
            raise SystemExit(f'{cell["directory"]}: no assessment')
        a = json.loads((d / 'assessment.json').read_text(encoding='utf8'))
        rows.append({'task': cell['task'], 'class': tasks[cell['task']]['class'], 'arm': cell['arm'], 'accepted': a['accepted'],
                     'dependencies': a['dependencies'], 'totalTokens': a['totalTokens'], 'reviewerSeconds': a['reviewerSeconds']})
    comparators = [a for a in plan_doc['arms'] if a != 'context']
    cost = cost_gate(rows, comparators, plan_doc['repetitions'])
    quality = quality_guard(rows, comparators)
    assessments = {c['directory']: json.loads((args.plan / c['directory'] / 'assessment.json').read_text(encoding='utf8'))
                   for c in plan_doc['cells']}
    quality['reviewerAgreement'] = reviewer_agreement(assessments, plan_doc.get('agreementSample') or [],
                                                      plan_doc.get('agreementThreshold', AGREEMENT_THRESHOLD))
    quality['reliable'] = quality['reviewerAgreement']['reliable']
    report = {'cost': cost, 'quality': quality, 'passed': cost['passed'] and quality['passed'] and quality['reliable'],
              'tokensGated': 'executor only (protocol v2 reviewer design)',
              'reviewerTokens': {fam: sum(a['reviewerTokens'][fam] or 0 for a in assessments.values()) for fam in ('claude', 'codex')},
              'firstPassAccepted': 'not measured (protocol v2)'}
    write_json(args.plan / 'analysis.json', report)
    print(json.dumps({'passed': report['passed'], 'cost': cost['passed'], 'quality': quality['passed']}))
    return 0


def prepare(args):
    archives = json.loads(args.archives.read_text(encoding='utf8'))
    args.templates.mkdir(parents=True, exist_ok=True)
    for _, task in load_tasks(args.tasks):
        if (args.templates / task['id']).exists():
            verify_template(task, args.templates)
            continue
        rec = prepare_template(task, args.archive_dir / f"{task['id']}.tar", archives[task['id']], args.templates,
                               toolchain=args.toolchain)
        print(json.dumps({'task': task['id'], 'setupExit': rec['setup']['exitCode'], 'seconds': rec['setup']['seconds']}))
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description='OS2 runner. toolchain, plan, prepare and analyse start no model; execute and assess do.')
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('execute', 'assess'):
        q = sub.add_parser(name)
        q.add_argument('--plan', required=True, type=pathlib.Path)
        q.add_argument('--tasks', required=True, type=pathlib.Path)
        q.add_argument('--codex', required=True, type=pathlib.Path)
        q.add_argument('--auth-file', required=True, type=pathlib.Path)
        q.add_argument('--toolchain', required=True, type=pathlib.Path)
        q.add_argument('--timeout', type=int, default=1800)
        q.add_argument('--only', nargs='*', default=None, help='cell directory names to run')
        if name == 'execute':
            q.add_argument('--rerun-provider-failures', action='store_true',
                           help='set aside cells whose executor failed with no model output (once each) and rerun them')
            q.add_argument('--templates', required=True, type=pathlib.Path)
            q.add_argument('--node', required=True, type=pathlib.Path)
            q.add_argument('--navigation-cli', required=True, type=pathlib.Path)
            q.add_argument('--forbid', nargs='*', default=[], help='paths that must not exist while executors run')
        else:
            q.add_argument('--acceptance', required=True, type=pathlib.Path)
            q.add_argument('--repos', required=True, type=pathlib.Path)
            q.add_argument('--checker-only', action='store_true', help='run the hidden checker, scope and dependency count only; no reviewer, no model')
            q.add_argument('--claude', type=pathlib.Path, help='absolute path of the Claude Code binary (primary reviewer)')
    q = sub.add_parser('prepare')
    q.add_argument('--tasks', required=True, type=pathlib.Path)
    q.add_argument('--archives', required=True, type=pathlib.Path, help='JSON map task id -> archive sha256')
    q.add_argument('--archive-dir', required=True, type=pathlib.Path)
    q.add_argument('--templates', required=True, type=pathlib.Path)
    q.add_argument('--toolchain', type=pathlib.Path, help='install with the copied toolchain (the same node and pnpm as the sessions)')
    q = sub.add_parser('toolchain')
    q.add_argument('--node-prefix', required=True, type=pathlib.Path)
    q.add_argument('--corepack-home', required=True, type=pathlib.Path)
    q.add_argument('--pnpm-version', required=True, nargs='+', help='every pnpm version a task pins')
    q.add_argument('--rg', required=True, type=pathlib.Path)
    q.add_argument('--out', required=True, type=pathlib.Path)
    q = sub.add_parser('analyse')
    q.add_argument('--plan', required=True, type=pathlib.Path)
    q.add_argument('--tasks', required=True, type=pathlib.Path)
    q = sub.add_parser('plan')
    q.add_argument('--tasks', required=True, type=pathlib.Path, help='directory of public task JSON files')
    q.add_argument('--arms', default='plain,context')
    q.add_argument('--repetitions', type=int, default=3)
    q.add_argument('--seed', type=int, default=SEED)
    q.add_argument('--codex', required=True, type=pathlib.Path)
    q.add_argument('--claude', required=True, type=pathlib.Path, help='absolute path of the Claude Code binary (primary reviewer)')
    q.add_argument('--node', required=True, type=pathlib.Path)
    q.add_argument('--navigation-cli', required=True, type=pathlib.Path)
    q.add_argument('--toolchain', required=True, type=pathlib.Path)
    q.add_argument('--active-base', default=str(ACTIVE_BASE), type=pathlib.Path)
    q.add_argument('--out', required=True, type=pathlib.Path)
    args = p.parse_args(argv)
    return {'plan': plan, 'prepare': prepare, 'execute': execute, 'assess': assess, 'analyse': analyse,
            'toolchain': build_toolchain}[args.cmd](args)


if __name__ == '__main__':
    sys.exit(main())
