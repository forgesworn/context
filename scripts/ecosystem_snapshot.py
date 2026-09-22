#!/usr/bin/env python3
"""Capture/query explicitly selected dependency evidence without running projects."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import tomllib

import ecosystem_resolution
from ecosystem_resolution import resolve_dependencies, bounded, redact

MAX_FILE = 4 * 1024 * 1024
MAX_TOTAL = 16 * 1024 * 1024
MAX_REPORT = 16 * 1024 * 1024
FORBIDDEN = {'node_modules', 'vendor', 'target', 'dist', 'build', 'coverage'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else canonical(value).encode()).hexdigest()


def path_parts(value):
    require(isinstance(value, str) and 0 < len(value) <= 500, 'Invalid relative path')
    require(not re.search(r'[\x00-\x1f\x7f\\:*?\[\]]', value), 'Invalid relative path')
    parts = value.split('/')
    require(all(p and not p.startswith('.') and p not in FORBIDDEN for p in parts), 'Forbidden path component')
    return parts


def identity(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode), 'Root must be a non-symlink directory')
    return {'device': info.st_dev, 'inode': info.st_ino}


def selected_path(root, relative, optional=False):
    path = root
    for index, part in enumerate(path_parts(relative)):
        path = path / part
        try:
            info = path.lstat()
        except FileNotFoundError:
            if optional:
                return None
            raise ValueError('Selected path is missing') from None
        require(not stat.S_ISLNK(info.st_mode), 'Symlink selection is forbidden')
        if index < len(path_parts(relative)) - 1:
            require(stat.S_ISDIR(info.st_mode), 'Path parent is not a directory')
    return path


def read_regular(path, limit=MAX_FILE):
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_size <= limit, 'Input is not a bounded regular file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        require((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino), 'Input changed before read')
        with os.fdopen(fd, 'rb', closefd=False) as handle:
            raw = handle.read(limit + 1)
        after = os.fstat(fd)
        require(len(raw) <= limit and len(raw) == opened.st_size, 'Input exceeds limit or changed')
        require((opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Input changed during read')
        current = path.lstat()
        require((current.st_dev, current.st_ino) == (opened.st_dev, opened.st_ino), 'Input was replaced')
        return raw
    finally:
        os.close(fd)


def read_selected(root, relative, budget):
    """Hold every parent fd; never reopen a previously checked parent by path."""
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in root.parts[1:]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
    except BaseException:
        os.close(fd)
        raise
    descriptors = [fd]
    try:
        parts = path_parts(relative)
        for part in parts[:-1]:
            descriptors.append(os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptors[-1]))
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=descriptors[-1])
        descriptors.append(fd)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= MAX_FILE, 'Invalid working input')
        budget[0] += before.st_size
        require(budget[0] <= MAX_TOTAL, 'Aggregate working input exceeds limit')
        with os.fdopen(fd, 'rb', closefd=False) as handle:
            raw = handle.read(MAX_FILE + 1)
        after = os.fstat(fd)
        require(len(raw) == before.st_size and
                (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'Working input changed')
        # Detect replacement of any held directory or leaf, including a rename.
        for index, part in enumerate(parts):
            observed = os.stat(part, dir_fd=descriptors[index], follow_symlinks=False)
            opened = os.fstat(descriptors[index + 1])
            require((observed.st_dev, observed.st_ino, observed.st_mode) ==
                    (opened.st_dev, opened.st_ino, opened.st_mode), 'Selected path changed')
        return digest(raw)
    except FileNotFoundError:
        return None
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def git(root, *args, limit=MAX_FILE):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_OPTIONAL_LOCKS='0', GIT_LITERAL_PATHSPECS='1', GIT_NO_REPLACE_OBJECTS='1',
               GIT_NO_LAZY_FETCH='1', GIT_TERMINAL_PROMPT='0', GIT_ALLOW_PROTOCOL='')
    with tempfile.TemporaryFile() as output:
        run = subprocess.run(['git', '--no-pager', '-c', 'core.fsmonitor=false', '-C', str(root), *args],
                             stdout=output, stderr=subprocess.DEVNULL, env=env, timeout=20)
        require(run.returncode == 0, 'Git read failed')
        require(output.tell() <= limit, 'Git result exceeds limit')
        output.seek(0)
        return output.read(limit + 1)


def head(root):
    value = git(root, 'rev-parse', '--verify', 'HEAD', limit=200).decode().strip()
    require(re.fullmatch(r'(?:[0-9a-f]{40}|[0-9a-f]{64})', value), 'Invalid commit identity')
    return value


def admin_identity(root):
    values = []
    for flag in ['--absolute-git-dir', '--git-common-dir']:
        path = Path(git(root, 'rev-parse', flag, limit=4096).decode().strip())
        path = (root / path).resolve(strict=True) if not path.is_absolute() else path.resolve(strict=True)
        values.append({'path': str(path), **identity(path)})
    return digest(values)


def tooling_identity():
    return {'contract': 'dependency-snapshot-v1', 'sha256': digest([
        digest(read_regular(Path(__file__).resolve())),
        digest(read_regular(Path(ecosystem_resolution.__file__).resolve()))])}


def committed_file(root, commit, path, optional=False):
    listing = git(root, 'ls-tree', '-z', commit, '--', path, limit=2048)
    if not listing:
        require(optional, 'Selected manifest is not present at commit')
        return None
    items = listing.rstrip(b'\0').split(b'\0')
    require(len(items) == 1, 'Ambiguous committed path')
    meta, name = items[0].split(b'\t', 1)
    mode, kind, object_id = meta.split()
    require(name.decode('utf-8') == path and mode in (b'100644', b'100755') and kind == b'blob', 'Committed selection is not a regular file')
    size = int(git(root, 'cat-file', '-s', object_id.decode(), limit=100))
    require(size <= MAX_FILE, 'Committed input exceeds limit')
    raw = git(root, 'cat-file', 'blob', object_id.decode(), limit=MAX_FILE)
    require(len(raw) == size, 'Committed input size changed')
    return raw


def parse_document(path, raw):
    try:
        text = raw.decode('utf-8')
        value = tomllib.loads(text) if path.endswith('Cargo.toml') else json.loads(text)
        require(isinstance(value, dict), 'Manifest must be an object')
        return value
    except (ValueError, UnicodeError):
        raise ValueError('Malformed manifest or lockfile') from None


def read_spec(path):
    raw = read_regular(path, 65536)
    try:
        spec = json.loads(raw)
    except (ValueError, UnicodeError):
        raise ValueError('Malformed selection file') from None
    require(isinstance(spec, dict) and set(spec) == {'version', 'repositories'} and spec['version'] == 1, 'Unsupported selection schema')
    repos = spec['repositories']
    require(isinstance(repos, list) and 1 <= len(repos) <= 32, 'Select 1 to 32 repositories')
    ids, paths = set(), set()
    count = 0
    for r in repos:
        require(isinstance(r, dict) and {'id', 'path', 'manifests'} <= set(r) <= {'id', 'path', 'manifests', 'repository'}, 'Invalid repository selection')
        require(isinstance(r['id'], str) and re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,63}', r['id']), 'Invalid repository id')
        path_parts(r['path'])
        require(r['id'] not in ids and r['path'] not in paths, 'Duplicate repository selection')
        require(not any(r['path'].startswith(p + '/') or p.startswith(r['path'] + '/') for p in paths), 'Overlapping repository selections')
        ids.add(r['id']); paths.add(r['path'])
        manifests = r['manifests']
        require(isinstance(manifests, list) and 1 <= len(manifests) <= 32, 'Select 1 to 32 manifests per repository')
        require(all(isinstance(m, str) for m in manifests) and len(set(manifests)) == len(manifests), 'Duplicate or malformed manifest paths')
        for m in manifests:
            path_parts(m)
            require(PurePosixPath(m).name in {'package.json', 'Cargo.toml'}, 'Only package.json and Cargo.toml may be selected')
        count += len(manifests)
        label = r.get('repository', r['id'])
        require(isinstance(label, str) and 0 < len(label) <= 200 and not re.search(r'[\x00-\x1f\x7f]', label), 'Invalid repository identity label')
    require(count <= 64, 'At most 64 selected manifests')
    return spec, digest(raw)


def working_hash(root, path, budget):
    return read_selected(root, path, budget)


def make_graph(repositories, rows):
    nodes = {}
    edges = []
    def manifest_node(ref):
        key = 'manifest:' + digest(ref)
        nodes[key] = {'id': key, 'kind': 'manifest-snapshot', **ref}
        return key
    for row in rows:
        origin = manifest_node(row['consumer'])
        if row['source'] is not None:
            target = manifest_node(row['source'])
            relation = 'declares-local-source-reference'
        elif row['resolution'] == 'locked-artifact':
            target = 'artifact:' + row['locked']['artifactId']
            nodes[target] = {'id': target, 'kind': 'lockfile-artifact-assertion',
                             **{k: v for k, v in row['locked'].items() if k not in ['lockfile', 'location']}}
            relation = 'lockfile-records'
        else:
            target = 'unresolved:' + digest(row)
            nodes[target] = {'id': target, 'kind': 'unresolved', 'name': row['name'], 'reason': row['reason']}
            relation = 'declares-unresolved'
        edges.append({'from': origin, 'to': target, 'relation': relation, 'dependency': row['name'], 'scope': row['scope']})
    return {'nodes': sorted(nodes.values(), key=lambda n: n['id']), 'edges': edges}


def capture(root, spec_path):
    require(root.is_absolute() and spec_path.is_absolute(), 'Root and selection file must be absolute paths')
    workspace_identity = identity(root)
    root = root.resolve(strict=True)
    spec, spec_hash = read_spec(spec_path)
    tooling = tooling_identity()
    repositories = []
    total = 0
    count = 0
    working_budget, verification_budget = [0], [0]
    for entry in sorted(spec['repositories'], key=lambda r: r['id']):
        repo_root = selected_path(root, entry['path'])
        repo_identity = identity(repo_root)
        top = Path(git(repo_root, 'rev-parse', '--show-toplevel', limit=4096).decode().strip()).resolve()
        require(top == repo_root, 'Selection must be an exact Git worktree root')
        commit = head(repo_root)
        admin = admin_identity(repo_root)
        branch = git(repo_root, 'rev-parse', '--abbrev-ref', 'HEAD', limit=4096).decode().strip()
        dirty = bool(git(repo_root, 'status', '--porcelain=v1', '--untracked-files=no', limit=1024 * 1024))
        selected = set(entry['manifests'])
        paths = set(selected)
        for manifest in selected:
            if not manifest.endswith('package.json'):
                continue
            directory = PurePosixPath(manifest).parent
            while True:
                paths.update(str(directory / name) for name in ['package-lock.json', 'npm-shrinkwrap.json'])
                if str(directory) == '.':
                    break
                directory = directory.parent
        require(count + len(paths) <= 192, 'Selected input count exceeds limit')
        documents, observations = [], []
        for path in sorted(paths):
            count += 1
            raw = committed_file(repo_root, commit, path, optional=path not in selected)
            live_hash = working_hash(repo_root, path, working_budget)
            observations.append({'path': path, 'committedSha256': digest(raw) if raw is not None else None, 'workingSha256': live_hash})
            if raw is None:
                continue
            total += len(raw)
            require(total <= MAX_TOTAL, 'Aggregate committed input exceeds limit')
            documents.append({'path': path, 'sha256': digest(raw), 'bytes': len(raw), 'data': parse_document(path, raw)})
        require(identity(repo_root) == repo_identity and head(repo_root) == commit, 'Worktree changed during capture')
        repositories.append({'id': entry['id'], 'repository': entry.get('repository', entry['id']), 'path': entry['path'],
                             'commit': commit, 'branchAtCapture': branch, 'documents': documents,
                             'worktree': {'identity': digest({'root': str(repo_root), **repo_identity}), 'trackedDirtyAtCapture': dirty,
                                          'gitAdminIdentity': admin,
                                          'untracked': 'not generally inventoried; selected inputs inspected', 'inputs': observations}})
    require(identity(root) == workspace_identity and read_spec(spec_path)[1] == spec_hash, 'Selection changed during capture')
    # Check every root again after the entire capture, not just its own scan.
    for repo in repositories:
        repo_root = selected_path(root, repo['path'])
        require(digest({'root': str(repo_root), **identity(repo_root)}) == repo['worktree']['identity'] and head(repo_root) == repo['commit'], 'Worktree changed during capture')
        require(admin_identity(repo_root) == repo['worktree']['gitAdminIdentity'], 'Git administration changed')
        for item in repo['worktree']['inputs']:
            require(working_hash(repo_root, item['path'], verification_budget) == item['workingSha256'], 'Selected working input changed during capture')
    dependencies = redact(resolve_dependencies(repositories))
    for repo in repositories:
        repo['documents'] = [{k: v for k, v in d.items() if k != 'data'} for d in repo['documents']]
    binding = {'workspaceIdentity': digest({'root': str(root), **workspace_identity}), 'selectionSha256': spec_hash,
               'repositories': [{k: r[k] for k in ['id', 'repository', 'path', 'commit', 'documents']} |
                                {'worktreeIdentity': r['worktree']['identity'], 'gitAdminIdentity': r['worktree']['gitAdminIdentity'],
                                 'workingInputs': r['worktree']['inputs']} for r in repositories]}
    require(tooling == tooling_identity(), 'Tooling changed during capture')
    body = {'version': 1, 'trust': 'local-source-unsigned', 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'tooling': tooling,
            'sourceMode': 'committed manifests; working input hashes are separate observations', 'binding': binding,
            'bindingSha256': digest(binding), 'repositories': repositories, 'dependencies': dependencies,
            'graph': make_graph(repositories, dependencies), 'installedVerified': False,
            'limitations': ['No registry fetch, installation verification, release attestation or semantic compatibility proof',
                            'Only selected manifests; no code graph or general working-tree overlay',
                            'Cargo lock resolution and workspace inheritance unsupported',
                            'npm lock v2/v3 observations are not semver or install validation',
                            'Capture checks detect observed changes, but are not an atomic filesystem snapshot']}
    return validate_snapshot({**body, 'sha256': digest(body)})


def validate_snapshot(data):
    bounded(data)
    require(isinstance(data, dict) and data.get('version') == 1 and data.get('trust') == 'local-source-unsigned', 'Unsupported snapshot')
    require(data.get('sha256') == digest({k: v for k, v in data.items() if k != 'sha256'}), 'Snapshot checksum mismatch')
    require(isinstance(data.get('binding'), dict) and data.get('bindingSha256') == digest(data['binding']), 'Binding checksum mismatch')
    require(isinstance(data.get('tooling'), dict), 'Missing tooling identity')
    require(isinstance(data.get('capturedAt'), str) and len(data['capturedAt']) <= 64 and
            isinstance(data.get('sourceMode'), str) and len(data['sourceMode']) <= 200, 'Invalid metadata')
    require(isinstance(data.get('repositories'), list) and 1 <= len(data['repositories']) <= 32, 'Invalid repositories')
    require(all(isinstance(r, dict) and isinstance(r.get('id'), str) and len(r['id']) <= 64 for r in data['repositories']), 'Invalid repository identity')
    require(isinstance(data.get('dependencies'), list) and len(data['dependencies']) <= 4096, 'Invalid snapshot dependencies')
    for row in data['dependencies']:
        require(isinstance(row, dict) and isinstance(row.get('consumer'), dict) and
                all(isinstance(row.get(k), str) for k in ['name', 'packageName', 'scope']) and
                row.get('resolution') in ['locked-artifact', 'local-source-reference', 'unresolved'] and
                'source' in row and 'locked' in row, 'Invalid dependency row')
    require(data.get('graph') == make_graph(data['repositories'], data['dependencies']), 'Graph mismatch')
    return data


def load_snapshot(path):
    try:
        return validate_snapshot(json.loads(read_regular(path, MAX_REPORT)))
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError('Malformed snapshot') from None


def write_snapshot(path, value):
    validate_snapshot(value)
    raw = (json.dumps(value, indent=2, ensure_ascii=True) + '\n').encode()
    require(len(raw) <= MAX_REPORT, 'Snapshot exceeds output limit')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(raw)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for action in ['build', 'verify']:
        command = commands.add_parser(action)
        command.add_argument('--root', type=Path, required=True)
        command.add_argument('--spec', type=Path, required=True)
        command.add_argument('--out' if action == 'build' else '--snapshot', type=Path, required=True)
    query = commands.add_parser('query')
    query.add_argument('--snapshot', type=Path, required=True)
    query.add_argument('--repo', required=True)
    query.add_argument('--package')
    query.add_argument('--max-results', type=int, default=8)
    query.add_argument('--max-bytes', type=int, default=16384)
    args = parser.parse_args()
    try:
        if args.command == 'build':
            value = capture(args.root, args.spec)
            write_snapshot(args.out, value)
            print(json.dumps({'status': 'captured', 'repositories': len(value['repositories']), 'dependencies': len(value['dependencies']), 'sha256': value['sha256']}))
        elif args.command == 'verify':
            old = load_snapshot(args.snapshot)
            new = capture(args.root, args.spec)
            current = (old['bindingSha256'] == new['bindingSha256'] and old['tooling'] == new['tooling'] and
                       old['dependencies'] == new['dependencies'] and old['graph'] == new['graph'])
            status = 'current' if current else 'stale'
            print(json.dumps({'status': status, 'scope': 'selected dependency inputs, worktree bindings and tooling; branch/dirty values are capture-time observations'}))
            return 0 if status == 'current' else 1
        else:
            require(1 <= args.max_results <= 32 and 1024 <= args.max_bytes <= 65536, 'Query bounds out of range')
            value = load_snapshot(args.snapshot)
            require(any(r['id'] == args.repo for r in value['repositories']), 'Repository not in snapshot')
            rows = [r for r in value['dependencies'] if r['consumer']['repo'] == args.repo and
                    (not args.package or args.package in [r['name'], r['packageName']])]
            result = {'trust': 'local-source-unsigned', 'sourceMode': value['sourceMode'], 'snapshotSha256': value['sha256'],
                      'capturedAt': value['capturedAt'], 'freshness': 'not checked; use verify with explicit root and spec',
                      'matches': len(rows), 'complete': True, 'results': []}
            require(len(canonical(result).encode()) <= args.max_bytes - 2, 'Query metadata exceeds byte limit')
            for row in rows:
                candidate = {**result, 'results': result['results'] + [row]}
                if len(result['results']) >= args.max_results or len(canonical(candidate).encode()) > args.max_bytes - 2:
                    result['complete'] = False
                    break
                result['results'].append(row)
            encoded = canonical(result)
            require(len(encoded.encode()) + 1 <= args.max_bytes, 'Query exceeds byte limit')
            print(encoded)
    except (ValueError, OSError, subprocess.SubprocessError, KeyError, TypeError, RecursionError):
        # Do not echo private paths, URLs, manifest contents or Git stderr.
        print('ecosystem-snapshot: input invalid, changed, unavailable or outside supported bounds', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
