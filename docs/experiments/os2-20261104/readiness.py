#!/usr/bin/env python3
"""OS2 v2 readiness check, model-free: stage each prepared template as execute
would (fresh root outside the home, copied tree, offline relink with the
toolchain, isolation probe with loopback, readiness probe under the executor
profile) and report the exit codes. No model starts.

    python3 readiness.py --tasks DIR --templates DIR --codex ABS --toolchain ABS --out NEW_DIR_IN_HOME
"""
import argparse
import importlib.util
import json
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harness', HERE / 'harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for k in ('tasks', 'templates', 'codex', 'toolchain', 'out'):
        p.add_argument(f'--{k}', required=True, type=pathlib.Path)
    p.add_argument('--active-base', default=str(h.ACTIVE_BASE), type=pathlib.Path)
    a = p.parse_args(argv)
    if not a.out.is_absolute() or a.out.exists() or pathlib.Path.home() not in a.out.parents:
        raise SystemExit('--out must be a new absolute directory inside the home')
    codex = h.resolve_codex(a.codex)
    a.out.mkdir(mode=0o700)
    ok = True
    for _, task in h.load_tasks(a.tasks):
        h.verify_template(task, a.templates)
        cell = a.out / task['id']; cell.mkdir(mode=0o700)
        root = h.make_root(a.active_base / f"os2-readiness-{task['id']}", 'workspace')
        ws = root / 'workspace'
        shutil.rmtree(ws); h.clone_tree(a.templates / task['id'], ws)
        cfg = h.codex_config('plain', h.SETTINGS, root=root, toolchain=a.toolchain)
        try:
            env = h.ready_environment(codex, cell, root, ws, task['repository'], cfg, a.toolchain)
            row = {k: (v or {}).get('exitCode') for k, v in env.items()}
        except SystemExit:
            env = json.loads((cell / 'environment.json').read_text())
            row = {k: (v or {}).get('exitCode') for k, v in env.items()}
            ok = False
        finally:
            shutil.rmtree(root, ignore_errors=True)
        print(json.dumps({'task': task['id'], **row}))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
