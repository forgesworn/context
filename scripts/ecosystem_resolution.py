"""Original, pure resolution of selected npm/Cargo manifest observations.

A lock assertion is not installed-state evidence. A selected local source pointer
is not proof that a consumer used that commit. No filesystem or network access.
"""
import hashlib
import json
import math
import posixpath
import re

MAX_REPOSITORIES, MAX_DOCUMENTS, MAX_ROWS = 32, 128, 4096
MAX_NODES, MAX_DEPTH, MAX_STRING, MAX_TEXT = 300000, 32, 65536, 16 * 1024 * 1024
MAX_OUTPUT = 4 * 1024 * 1024
FORBIDDEN = {'node_modules', 'vendor', 'target', 'dist', 'build', 'coverage'}
NPM_GROUPS = ('dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies')
CARGO_GROUPS = ('dependencies', 'dev-dependencies', 'build-dependencies')
NAME = re.compile(r'(?:@[A-Za-z0-9._-]+/)?[A-Za-z0-9._-]+')


def require(ok):
    if not ok:
        raise ValueError('Malformed or out-of-bounds dependency evidence')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)


def sha(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def bounded(value):
    nodes, size = 0, 0
    def visit(item, depth):
        nonlocal nodes, size
        nodes += 1
        require(depth <= MAX_DEPTH and nodes <= MAX_NODES)
        if isinstance(item, str):
            require(len(item) <= MAX_STRING)
            try:
                size += len(item.encode('utf-8'))
            except UnicodeError:
                require(False)
            require(size <= MAX_TEXT)
        elif type(item) is dict:
            for key, val in item.items():
                require(isinstance(key, str))
                visit(key, depth + 1)
                visit(val, depth + 1)
        elif type(item) is list:
            for val in item:
                visit(val, depth + 1)
        else:
            require(item is None or type(item) in (bool, int, float))
            require(not isinstance(item, float) or math.isfinite(item))
    visit(value, 0)


def text(value, limit=1024):
    return isinstance(value, str) and 0 < len(value) <= limit and not re.search(r'[\x00-\x1f\x7f]', value)


def canonical_path(path):
    require(text(path, 500) and not re.search(r'[\\%:*?\[\]]', path))
    require(all(part and not part.startswith(('.', '~')) and part not in FORBIDDEN for part in path.split('/')))
    return path


def local_path(base, ref):
    require(text(ref, 500) and not ref.startswith(('/', '~')) and not re.search(r'[\\%:*?\[\]]', ref))
    parts = base.rstrip('/').split('/') if base else []
    for part in ref.split('/'):
        if part in ('', '.'):
            continue
        if part == '..':
            require(bool(parts))
            parts.pop()
        else:
            require(not part.startswith(('.', '~')) and part not in FORBIDDEN)
            parts.append(part)
    return '/'.join(parts)


def redact(value):
    if isinstance(value, dict):
        return {k: redact(v) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, str):
        if re.search(r'[a-z][a-z0-9+.-]*://', value, re.I) and re.search(r'\s', value):
            return '<redacted invalid URI>'
        value = re.sub(r'([a-z][a-z0-9+.-]*://[^\s?#]+)[?#][^\s]*', r'\1', value, flags=re.I)
        return re.sub(r'([a-z][a-z0-9+.-]*://)([^/\s]+)', lambda m: m[1] + m[2].rsplit('@', 1)[-1], value, flags=re.I)
    return value


def ref(repo, doc):
    return {'repo': repo['id'], 'commit': repo['commit'], 'manifest': doc['path']}


def evidence(repo, doc):
    return {'repo': repo['id'], 'commit': repo['commit'], 'path': doc['path'], 'sha256': doc['sha256']}


def package_name(doc, ecosystem):
    data = doc['data']
    value = data.get('name') if ecosystem == 'npm' else data.get('package', {}).get('name') if isinstance(data.get('package'), dict) else None
    return value if text(value, 214) and NAME.fullmatch(value) else None


def indexes(repositories):
    bounded(repositories)
    require(isinstance(repositories, list) and 1 <= len(repositories) <= MAX_REPOSITORIES)
    ids, roots, documents, global_docs = set(), set(), {}, {}
    for repo in repositories:
        require(isinstance(repo, dict))
        require(text(repo.get('id'), 64) and re.fullmatch(r'[a-z0-9][a-z0-9._-]*', repo['id']))
        root = canonical_path(repo.get('path'))
        require(repo['id'] not in ids and root not in roots)
        require(not any(root.startswith(r + '/') or r.startswith(root + '/') for r in roots))
        require(isinstance(repo.get('commit'), str) and re.fullmatch(r'(?:[0-9a-f]{40}|[0-9a-f]{64})', repo['commit']))
        require(isinstance(repo.get('documents'), list))
        ids.add(repo['id']); roots.add(root)
        for doc in repo['documents']:
            require(isinstance(doc, dict) and isinstance(doc.get('data'), dict))
            path = canonical_path(doc.get('path'))
            require(posixpath.basename(path) in ('package.json', 'Cargo.toml', 'package-lock.json', 'npm-shrinkwrap.json'))
            require(isinstance(doc.get('sha256'), str) and re.fullmatch(r'[0-9a-f]{64}', doc['sha256']))
            key = (repo['id'], path)
            global_path = root + '/' + path
            require(key not in documents and global_path not in global_docs)
            documents[key] = doc
            global_docs[global_path] = (repo, doc)
            require(len(documents) <= MAX_DOCUMENTS)
    return documents, global_docs


def declarations(data, ecosystem):
    out = []
    def group(field, scope, container):
        values = container.get(field, {})
        require(isinstance(values, dict))
        for name, requested in sorted(values.items()):
            require(text(name, 214) and NAME.fullmatch(name))
            if ecosystem == 'npm':
                if field == 'dependencies' and name in data.get('optionalDependencies', {}):
                    continue
                require(text(requested))
            else:
                require(text(requested) or isinstance(requested, dict))
                if isinstance(requested, dict):
                    string_keys = ('package', 'path', 'version', 'git', 'registry', 'branch', 'tag', 'rev', 'registry-index')
                    bool_keys = ('workspace', 'default-features', 'default_features', 'optional', 'public')
                    require(set(requested) <= set(string_keys + bool_keys + ('features',)))
                    for key in string_keys:
                        require(key not in requested or text(requested[key]))
                    for key in bool_keys:
                        require(key not in requested or type(requested[key]) is bool)
                    require('features' not in requested or (isinstance(requested['features'], list) and
                            all(text(feature) for feature in requested['features'])))
            out.append((name, requested, scope, field))
            require(len(out) <= MAX_ROWS)
    fields = NPM_GROUPS if ecosystem == 'npm' else CARGO_GROUPS
    if ecosystem == 'npm':
        require(isinstance(data.get('optionalDependencies', {}), dict))
    for field in fields:
        group(field, field, data)
    if ecosystem == 'cargo':
        targets = data.get('target', {})
        require(isinstance(targets, dict))
        for target, container in sorted(targets.items()):
            require(text(target) and isinstance(container, dict))
            for field in fields:
                group(field, 'target:' + target + ':' + field, container)
    return out


def ancestors(path):
    while True:
        yield path
        if not path:
            return
        path = posixpath.dirname(path)


def select_lock(repo, doc, documents):
    for directory in ancestors(posixpath.dirname(doc['path'])):
        for name in ('npm-shrinkwrap.json', 'package-lock.json'):
            found = documents.get((repo['id'], posixpath.join(directory, name)))
            if found is not None:
                return directory, found
    return '', None


def locked_entry(packages, consumer_location, name):
    for directory in ancestors(consumer_location):
        location = posixpath.join(directory, 'node_modules', name)
        if location in packages:
            return location, packages[location]
    return None, None


def set_local(row, path, global_docs):
    target = global_docs.get(path)
    if target is None:
        return 'local-target-not-selected'
    repo, doc = target
    row['evidence'].append(evidence(repo, doc))
    if package_name(doc, row['ecosystem']) != row['packageName']:
        return 'local-target-name-mismatch'
    row['source'] = ref(repo, doc)
    row['resolution'] = 'local-source-reference'
    return None


def npm_resolution(row, repo, doc, field, documents, global_docs):
    requested, name = row['requested'], row['name']
    alias = requested.startswith('npm:')
    if alias:
        body = requested[4:]
        actual, separator, version = body.rpartition('@')
        if not separator or not version or not NAME.fullmatch(actual):
            return 'alias-spec-unsupported'
        row['packageName'] = actual
    lock_root, lock = select_lock(repo, doc, documents)
    packages = None
    manifest_dir = posixpath.dirname(doc['path'])
    if lock is not None:
        row['evidence'].append(evidence(repo, lock))
        data = lock['data']
        if type(data.get('lockfileVersion')) is not int or data['lockfileVersion'] not in (2, 3) or not isinstance(data.get('packages'), dict):
            return 'missing-or-unsupported-lockfile'
        packages = data['packages']
        consumer_loc = posixpath.relpath(manifest_dir or '.', lock_root or '.')
        consumer_loc = '' if consumer_loc == '.' else consumer_loc
        metadata = packages.get(consumer_loc)
        group = metadata.get(field) if isinstance(metadata, dict) else None
        if not isinstance(group, dict) or group.get(name) != requested:
            return 'lock-declaration-mismatch'
        location, entry = locked_entry(packages, consumer_loc, name)
        if location is not None and not isinstance(entry, dict):
            return 'locked-entry-shape'
    else:
        location, entry = None, None
    local = requested.startswith(('file:', 'link:'))
    workspace = requested.startswith('workspace:')
    base = posixpath.join(repo['path'], manifest_dir)
    if local:
        local_ref = requested.split(':', 1)[1]
        if local_ref.endswith(('.tgz', '.tar.gz', '.tar')):
            return 'local-tarball-unsupported'
        try:
            target = local_path(base, local_ref)
        except ValueError:
            return 'local-path-escape'
        if entry is not None:
            if entry.get('link') is not True or ('name' in entry and entry['name'] != row['packageName']):
                return 'local-lock-mismatch'
            try:
                locked_target = local_path(posixpath.join(repo['path'], lock_root), entry.get('resolved'))
            except ValueError:
                return 'local-lock-mismatch'
            if locked_target != target:
                return 'local-lock-mismatch'
        return set_local(row, posixpath.join(target, 'package.json'), global_docs)
    if packages is None:
        return 'missing-or-unsupported-lockfile'
    if entry is None:
        return 'no-locked-entry'
    if entry.get('link') is True:
        if not workspace:
            return 'unexpected-link-for-nonlocal-declaration'
        if 'name' in entry and entry['name'] != row['packageName']:
            return 'locked-name-mismatch'
        try:
            target = local_path(posixpath.join(repo['path'], lock_root), entry.get('resolved'))
        except ValueError:
            return 'local-lock-mismatch'
        if alias and entry.get('name') != row['packageName']:
            return 'alias-package-identity-unverified' if 'name' not in entry else 'locked-name-mismatch'
        return set_local(row, posixpath.join(target, 'package.json'), global_docs)
    if workspace:
        return 'workspace-lock-not-link'
    if alias and 'name' not in entry:
        return 'alias-package-identity-unverified'
    if 'name' in entry and entry['name'] != row['packageName']:
        return 'locked-name-mismatch'
    if not text(entry.get('version'), 256) or ('link' in entry and type(entry['link']) is not bool):
        return 'locked-entry-shape'
    source = entry.get('resolved')
    integrity = entry.get('integrity')
    source_hash = sha(source) if text(source, MAX_STRING) else None
    integrity = integrity if text(integrity, MAX_STRING) else None
    artifact = {'name': row['packageName'], 'version': entry['version'], 'resolvedSha256': source_hash, 'integrity': integrity}
    row['locked'] = {'lockfile': lock['path'], 'location': location, **artifact,
                     'resolved': redact(source) if source_hash else None,
                     'artifactId': sha(canonical(artifact)) if source_hash and integrity else None}
    if row['locked']['artifactId'] is None:
        return 'artifact-identity-incomplete'
    row['resolution'] = 'locked-artifact'
    return None


def cargo_resolution(row, repo, doc, global_docs):
    requested = row['requested']
    if not isinstance(requested, dict):
        return 'cargo-lock-resolution-unsupported'
    row['packageName'] = requested.get('package', row['name'])
    require(NAME.fullmatch(row['packageName']))
    if requested.get('workspace') is True:
        return 'workspace-inheritance-unsupported'
    if 'path' not in requested:
        return 'cargo-lock-resolution-unsupported'
    if any(k in requested for k in ['git', 'registry', 'registry-index', 'branch', 'tag', 'rev']):
        return 'cargo-multiple-source-unsupported'
    try:
        target = local_path(posixpath.join(repo['path'], posixpath.dirname(doc['path'])), requested['path'])
    except ValueError:
        return 'cargo-path-escape'
    return set_local(row, posixpath.join(target, 'Cargo.toml'), global_docs)


def resolve_dependencies(repositories):
    """Return bounded rows; source pointers only target explicit selected manifests."""
    documents, global_docs = indexes(repositories)
    rows = []
    output_bytes = 2
    producers = {}
    for repo, doc in global_docs.values():
        ecosystem = {'package.json': 'npm', 'Cargo.toml': 'cargo'}.get(posixpath.basename(doc['path']))
        if ecosystem:
            name = package_name(doc, ecosystem)
            if name:
                producers.setdefault((ecosystem, name), []).append(ref(repo, doc))
    for repo in sorted(repositories, key=lambda r: r['id']):
        for doc in sorted(repo['documents'], key=lambda d: d['path']):
            ecosystem = {'package.json': 'npm', 'Cargo.toml': 'cargo'}.get(posixpath.basename(doc['path']))
            if ecosystem is None:
                continue
            for name, requested, scope, field in declarations(doc['data'], ecosystem):
                row = {'consumer': ref(repo, doc), 'ecosystem': ecosystem, 'name': name, 'packageName': name,
                       'requested': requested, 'scope': scope, 'resolution': 'unresolved', 'reason': None,
                       'locked': None, 'source': None, 'producerCandidates': [], 'evidence': [evidence(repo, doc)],
                       'installedVerified': False, 'sourceProvenance': 'unverified'}
                if ecosystem == 'npm':
                    row['reason'] = npm_resolution(row, repo, doc, field, documents, global_docs)
                else:
                    row['reason'] = cargo_resolution(row, repo, doc, global_docs)
                row['producerCandidates'] = sorted(producers.get((ecosystem, row['packageName']), []), key=canonical)
                row['evidence'] = sorted({canonical(e): e for e in row['evidence']}.values(), key=canonical)
                row['requestedSha256'] = sha(canonical(requested))
                displayed = redact(row)
                output_bytes += len(canonical(displayed).encode('utf-8')) + 1
                require(output_bytes <= MAX_OUTPUT)
                rows.append(displayed)
                require(len(rows) <= MAX_ROWS)
    return sorted(rows, key=lambda r: (r['consumer']['repo'], r['consumer']['manifest'], r['ecosystem'], r['scope'], r['name']))
