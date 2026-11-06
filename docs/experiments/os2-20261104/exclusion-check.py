#!/usr/bin/env python3
"""OS2 v2 blind exclusion check for custodian replacement tasks. Model-free.
Reads private acceptance and task files and prints only counts and booleans,
never paths, symbols or commits.

    python3 exclusion-check.py --existing DIR --kept ID,ID,... --new ACC_DIR:TASK_DIR [...]
"""
import argparse
import json
import pathlib
import sys

KEPT_DEFAULT = 'bray-orientation,bray-code-change,h3-orientation,h3-impact'


def load(d):
    return {p.stem: json.loads(p.read_text(encoding='utf8')) for p in sorted(pathlib.Path(d).glob('*.json')) if p.name != 'manifest.json'}


def paths(acc, repo, *keys):
    """(repository, path) pairs, so the same relative path in two repositories is not an overlap."""
    return {(repo, x.get('path')) for k in keys for x in (acc.get(k) or []) if isinstance(x, dict) and x.get('path')}


def scope_valid(acc):
    s = acc.get('scope')
    return isinstance(s, dict) and isinstance(s.get('allowedPaths'), list) and all(isinstance(g, str) and g for g in s['allowedPaths'])


def check(existing, existing_tasks, kept, new):
    """existing/new: {id: acceptance}; existing_tasks/new tasks: {id: task}. Returns counts only."""
    old_changes = {a.get('sourceChange') for a in existing.values()} - {None}
    old_bases = {t.get('baseCommit') for t in existing_tasks.values()}
    repo = lambda tasks, i: (tasks.get(i) or {}).get('repository')
    old_deps = set().union(*(paths(a, repo(existing_tasks, i), 'dependencySet') for i, a in existing.items())) if existing else set()
    kept_evidence = set().union(*(paths(existing[k], repo(existing_tasks, k), 'requiredEvidence') for k in kept if k in existing)) if kept else set()
    rows, seen = [], {}
    for i, (acc, task) in sorted(new.items()):
        mine = paths(acc, task.get('repository'), 'dependencySet', 'requiredEvidence')
        deps = paths(acc, task.get('repository'), 'dependencySet')
        rows.append({'id': i, 'class': task.get('class'), 'idMatches': acc.get('id') == task.get('id') == i,
                     'sourceChangeReused': acc.get('sourceChange') in old_changes,
                     'baseCommitReused': task.get('baseCommit') in old_bases,
                     'pathsInExistingDependencySets': len(mine & old_deps),
                     'pathsInKeptRequiredEvidence': len(mine & kept_evidence),
                     'dependencyPathsSharedWithOtherNewTasks': len(deps & set().union(*(seen.values()))) if seen else 0,
                     'scopeValid': scope_valid(acc)})
        seen[i] = deps
    clean = all(not r['sourceChangeReused'] and not r['baseCommitReused'] and r['pathsInExistingDependencySets'] == 0
                and r['pathsInKeptRequiredEvidence'] == 0 and r['dependencyPathsSharedWithOtherNewTasks'] == 0
                and r['scopeValid'] and r['idMatches'] for r in rows)
    return {'newTasks': len(rows), 'existing': len(existing), 'keptFound': sum(k in existing for k in kept), 'allClean': clean, 'rows': rows}


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('--existing', required=True)
    p.add_argument('--existing-tasks', required=True)
    p.add_argument('--kept', default=KEPT_DEFAULT)
    p.add_argument('--new', required=True, action='append', help='ACC_DIR:TASK_DIR')
    a = p.parse_args(argv)
    new = {}
    for pair in a.new:
        acc_dir, task_dir = pair.split(':', 1)
        accs, tasks = load(acc_dir), load(task_dir)
        for i in set(accs) | set(tasks):
            new[i] = (accs.get(i, {}), tasks.get(i, {}))
    out = check(load(a.existing), load(a.existing_tasks), [k for k in a.kept.split(',') if k], new)
    for r in out.pop('rows'):
        print(json.dumps(r))
    print(json.dumps(out))
    return 0 if out['allClean'] else 1


if __name__ == '__main__':
    sys.exit(main())
