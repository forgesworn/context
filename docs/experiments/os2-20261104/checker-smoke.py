#!/usr/bin/env python3
"""OS2 v2 checker smoke test, model-free: on this machine and with the session
toolchain, each checker must fail on the unchanged base copy and pass with the
merged change applied. Reads hidden acceptance files; prints booleans only.

    python3 checker-smoke.py --tasks DIR --acceptance DIR --templates DIR --repos DIR --toolchain ABS --out NEW_DIR
"""
import argparse
import importlib.util
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harness', HERE / 'harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def cell(out, name, template):
    d = out / name; d.mkdir(mode=0o700)
    h.clone_tree(template, d / 'workspace')
    h.write_json(d / 'executor.json', {'changedFiles': [], 'usage': {}})
    return d


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for k in ('tasks', 'acceptance', 'templates', 'repos', 'toolchain', 'out'):
        p.add_argument(f'--{k}', required=True, type=pathlib.Path)
    a = p.parse_args(argv)
    a.out.mkdir(mode=0o700)
    ok = True
    for _, task in h.load_tasks(a.tasks):
        if task['class'] not in ('code-change', 'diagnosis'):
            continue
        acc = json.loads((a.acceptance / f"{task['id']}.json").read_text(encoding='utf8'))
        repo = a.repos / task['repository']
        base = cell(a.out, f"{task['id']}-base", a.templates / task['id'])
        fixed = cell(a.out, f"{task['id']}-fixed", a.templates / task['id'])
        excl = [f':!{f}' for f in acc['checker']['testFiles']] + [f':!{f}' for f in h.BUILD_OUTPUTS.get(task['repository'], ())]
        diff = subprocess.run(['git', '-C', str(repo), 'diff', '--binary', task['baseCommit'], acc['sourceChange'], '--', '.', *excl],
                              capture_output=True, text=True, check=True).stdout
        applied = subprocess.run(['git', '-C', str(fixed / 'workspace'), 'apply', '--whitespace=nowarn', '-'], input=diff,
                                 capture_output=True, text=True).returncode == 0
        r_base = h.run_checker(base, task, acc, repo, strict_scope=False, toolchain=a.toolchain)[2]
        r_fix = h.run_checker(fixed, task, acc, repo, strict_scope=False, toolchain=a.toolchain)[2]
        row = {'task': task['id'], 'changeApplied': applied, 'relinkExit': r_fix.get('relinkExit'),
               'failsAtBase': r_base.get('passed') is False, 'passesWithChange': r_fix.get('passed') is True}
        ok = ok and applied and row['failsAtBase'] and row['passesWithChange']
        print(json.dumps(row))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
