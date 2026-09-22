import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { buildPacket, verifyPacket } from '../scripts/worker-packet.mjs';

import { fixtureExec as exec } from './git-fixture.mjs';
const fixtures = [];
const SCRIPT = fileURLToPath(new URL('../scripts/worker-packet.mjs', import.meta.url));

after(async () => {
  await Promise.all(fixtures.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'worker-packet-'));
  fixtures.push(root);
  await exec('git', ['init', '-q', root]);
  await exec('git', ['-C', root, 'config', 'user.email', 'test@example.test']);
  await exec('git', ['-C', root, 'config', 'user.name', 'Test']);
  await writeFile(join(root, 'src.ts'), 'one\ntwo\nthree\n');
  await exec('git', ['-C', root, 'add', '.']);
  await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
  return root;
}

async function spec(root, value) {
  const path = join(root, 'packet.json');
  await writeFile(path, JSON.stringify(value));
  return path;
}

async function savedPacket(root) {
  const input = await spec(root, base());
  const packet = await buildPacket({ root, spec: input });
  const path = join(root, 'saved-packet.json');
  await writeFile(path, JSON.stringify(packet));
  return path;
}

function base(overrides = {}) {
  return {
    version: 1,
    task: 'Change the fixture.',
    acceptanceChecks: ['node --test'],
    allowedFiles: ['src.ts', 'new.ts'],
    sources: [{ path: 'src.ts', startLine: 2, endLine: 3 }],
    exclusions: ['No network.'],
    unresolvedQuestions: [],
    ...overrides,
  };
}

test('builds deterministic exact excerpts and absent allowed state', async () => {
  const root = await fixture();
  const path = await spec(root, base());
  const one = await buildPacket({ root, spec: path });
  const two = await buildPacket({ root, spec: path });
  assert.deepEqual(one, two);
  assert.deepEqual(one.sources[0].lines, [{ line: 2, content: 'two' }, { line: 3, content: 'three' }]);
  assert.equal(one.sources[0].sha256, createHash('sha256').update('one\ntwo\nthree\n').digest('hex'));
  assert.deepEqual(one.allowedFiles.find((entry) => entry.path === 'new.ts'), { path: 'new.ts', state: 'absent' });
  assert.equal(one.allowedFiles.find((entry) => entry.path === 'src.ts').state, 'present');
  assert.match(one.policy.policyDigest, /^[0-9a-f]{64}$/);
});

test('rejects a symlink root before canonicalisation', async () => {
  const root = await fixture();
  const linked = `${root}-linked`;
  await symlink(root, linked);
  fixtures.push(linked);
  await assert.rejects(buildPacket({ root: linked, spec: await spec(root, base()) }), /non-symlink directory/);
});

test('rejects a retargeted symlink ancestor after a stable source and HEAD read', async () => {
  const root = await fixture();
  const alternateParent = await mkdtemp(join(tmpdir(), 'worker-packet-alternate-'));
  fixtures.push(alternateParent);
  const alternate = join(alternateParent, basename(root));
  await exec('git', ['clone', '-q', root, alternate]);
  assert.equal((await exec('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout, (await exec('git', ['-C', alternate, 'rev-parse', 'HEAD'])).stdout);
  const alias = `${root}-alias`;
  await symlink(dirname(root), alias);
  fixtures.push(alias);
  const input = join(alias, basename(root));
  const shim = await mkdtemp(join(tmpdir(), 'worker-packet-git-shim-'));
  fixtures.push(shim);
  const realGit = (await exec('which', ['git'])).stdout.trim();
  const done = join(shim, 'retargeted');
  const shimGit = join(shim, 'git');
  await writeFile(shimGit, `#!/usr/bin/env node
import { rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
try { await writeFile(${JSON.stringify(done)}, '', { flag: 'wx' }); await rm(${JSON.stringify(alias)}); await symlink(${JSON.stringify(alternateParent)}, ${JSON.stringify(alias)}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${shim}:${previousPath}`;
  try {
    await assert.rejects(buildPacket({ root: input, spec: await spec(root, base()) }), /explicit root changed/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('rejects source boundaries, unsafe paths and policy exclusions', async () => {
  const root = await fixture();
  await assert.rejects(buildPacket({ root, spec: await spec(root, base({ sources: [{ path: 'src.ts', startLine: 1, endLine: 20 }] })) }), /line range/);
  await assert.rejects(buildPacket({ root, spec: await spec(root, base({ allowedFiles: ['../escape.ts'] })) }), /safe relative path|forbidden/);
  await writeFile(join(root, '.gitignore'), 'src.ts\n');
  await assert.rejects(buildPacket({ root, spec: await spec(root, base()) }), /excluded by navigation policy/);
});

test('walks nested policy scopes and honours a negated child rule', async () => {
  const root = await fixture();
  await mkdir(join(root, 'a', 'b'), { recursive: true });
  await writeFile(join(root, 'a', 'b', 'kept.ts'), 'kept\n');
  await writeFile(join(root, '.gitignore'), 'a/private/\n');
  await writeFile(join(root, 'a', '.gitignore'), 'b/drop.ts\n!b/kept.ts\n');
  const path = await spec(root, base({
    allowedFiles: ['a/b/kept.ts'],
    sources: [{ path: 'a/b/kept.ts', startLine: 1, endLine: 1 }],
  }));
  const packet = await buildPacket({ root, spec: path });
  assert.equal(packet.sources[0].path, 'a/b/kept.ts');
  await mkdir(join(root, 'a', 'private'), { recursive: true });
  await writeFile(join(root, 'a', 'private', 'no.ts'), 'no\n');
  await assert.rejects(buildPacket({
    root,
    spec: await spec(root, base({
      allowedFiles: ['a/private/no.ts'],
      sources: [{ path: 'a/private/no.ts', startLine: 1, endLine: 1 }],
    })),
  }), /directory is excluded/);
});

test('rejects symlinks, oversized files and invalid UTF-8', async () => {
  const root = await fixture();
  await symlink(join(root, 'src.ts'), join(root, 'link.ts'));
  await assert.rejects(buildPacket({ root, spec: await spec(root, base({ sources: [{ path: 'link.ts', startLine: 1, endLine: 1 }] })) }), /symlink/);
  await writeFile(join(root, 'bad.ts'), Buffer.from([0xff]));
  await assert.rejects(buildPacket({ root, spec: await spec(root, base({ sources: [{ path: 'bad.ts', startLine: 1, endLine: 1 }] })) }), /UTF-8/);
  await writeFile(join(root, 'large.ts'), 'x'.repeat(1024 * 1024 + 1));
  await assert.rejects(buildPacket({ root, spec: await spec(root, base({ sources: [{ path: 'large.ts', startLine: 1, endLine: 1 }] })) }), /exceeds/);
});

test('enforces source quota', async () => {
  const root = await fixture();
  const sources = [];
  for (let index = 0; index < 33; index++) sources.push({ path: 'src.ts', startLine: 1, endLine: 1 });
  await assert.rejects(buildPacket({ root, spec: await spec(root, base({ sources })) }), /limited/);
});

test('rejects duplicate and overlapping ranges in a source file', async () => {
  const root = await fixture();
  for (const sources of [
    [{ path: 'src.ts', startLine: 1, endLine: 2 }, { path: 'src.ts', startLine: 1, endLine: 2 }],
    [{ path: 'src.ts', startLine: 1, endLine: 2 }, { path: 'src.ts', startLine: 2, endLine: 3 }],
  ]) {
    await assert.rejects(buildPacket({ root, spec: await spec(root, base({ sources })) }), /ranges overlap/);
  }
});

test('rejects oversized specs and packets without truncation', async () => {
  const root = await fixture();
  const huge = join(root, 'huge.json');
  await writeFile(huge, 'x'.repeat(64 * 1024 + 1));
  await assert.rejects(buildPacket({ root, spec: huge }), /exceeds/);
  await assert.rejects(buildPacket({
    root,
    spec: await spec(root, base({ task: 'x'.repeat(64 * 1024 - 400) })),
  }), /packet exceeds/);
});

test('rejects a large line range before allocating an oversized packet excerpt', async () => {
  const root = await fixture();
  const lineCount = 40_000;
  await writeFile(join(root, 'many.ts'), 'x\n'.repeat(lineCount));
  await assert.rejects(buildPacket({
    root,
    spec: await spec(root, base({ sources: [{ path: 'many.ts', startLine: 1, endLine: lineCount }] })),
  }), /source excerpts exceed/);
});

test('CLI writes a private exclusive bounded packet', async () => {
  const root = await fixture();
  const input = await spec(root, base());
  const out = join(root, 'packet-out.json');
  const { stdout } = await exec(process.execPath, [SCRIPT, 'build', '--root', root, '--spec', input, '--out', out]);
  assert.match(stdout, /"sources":1/);
  assert.equal((await stat(out)).mode & 0o777, 0o600);
  await assert.rejects(exec(process.execPath, [SCRIPT, 'build', '--root', root, '--spec', input, '--out', out]), /create output exclusively/);
});

test('verifies a current packet through the API and compact CLI result', async () => {
  const root = await fixture();
  const packet = await savedPacket(root);
  assert.deepEqual(await verifyPacket({ root, packet }), { status: 'current' });
  const { stdout } = await exec(process.execPath, [SCRIPT, 'verify', '--root', root, '--packet', packet]);
  assert.equal(stdout, '{"status":"current"}\n');
});

test('rejects stale source, allowed-file, policy, HEAD and root identities', async () => {
  const sourceRoot = await fixture();
  const sourcePacket = await savedPacket(sourceRoot);
  await writeFile(join(sourceRoot, 'src.ts'), 'changed\ntwo\nthree\n');
  await assert.rejects(verifyPacket({ root: sourceRoot, packet: sourcePacket }), /stale or has been tampered/);

  const allowedRoot = await fixture();
  const allowedPacket = await savedPacket(allowedRoot);
  await writeFile(join(allowedRoot, 'new.ts'), 'new\n');
  await assert.rejects(verifyPacket({ root: allowedRoot, packet: allowedPacket }), /stale or has been tampered/);

  const presentAllowedRoot = await fixture();
  await writeFile(join(presentAllowedRoot, 'new.ts'), 'before\n');
  const presentAllowedPacket = await savedPacket(presentAllowedRoot);
  await writeFile(join(presentAllowedRoot, 'new.ts'), 'after\n');
  await assert.rejects(verifyPacket({ root: presentAllowedRoot, packet: presentAllowedPacket }), /stale or has been tampered/);

  const policyRoot = await fixture();
  const policyPacket = await savedPacket(policyRoot);
  await writeFile(join(policyRoot, '.gitignore'), '*.tmp\n');
  await assert.rejects(verifyPacket({ root: policyRoot, packet: policyPacket }), /stale or has been tampered/);

  const headRoot = await fixture();
  const headPacket = await savedPacket(headRoot);
  await writeFile(join(headRoot, 'unrelated.txt'), 'changed\n');
  await exec('git', ['-C', headRoot, 'add', 'unrelated.txt']);
  await exec('git', ['-C', headRoot, 'commit', '-qm', 'new HEAD']);
  await assert.rejects(verifyPacket({ root: headRoot, packet: headPacket }), /stale or has been tampered/);

  const otherRoot = await fixture();
  await assert.rejects(verifyPacket({ root: otherRoot, packet: await savedPacket(await fixture()) }), /stale or has been tampered/);
});

test('rejects tampered, invalid UTF-8 and oversized packets', async () => {
  const root = await fixture();
  const packet = await savedPacket(root);
  const tampered = join(root, 'tampered.json');
  await writeFile(tampered, JSON.stringify({ ...JSON.parse(await readFile(packet, 'utf8')), extra: true }));
  await assert.rejects(verifyPacket({ root, packet: tampered }), /stale or has been tampered/);
  const invalid = join(root, 'invalid.json');
  await writeFile(invalid, Buffer.from([0xff]));
  await assert.rejects(verifyPacket({ root, packet: invalid }), /UTF-8/);
  const oversized = join(root, 'oversized.json');
  await writeFile(oversized, 'x'.repeat(64 * 1024 + 1));
  await assert.rejects(verifyPacket({ root, packet: oversized }), /exceeds/);
});

test('fixture Git operations cannot inherit another repository from a hook', async () => {
  const root = await fixture();
  const decoy = await fixture();
  const head = async path => (await exec('git', ['-C', path, 'rev-parse', 'HEAD'])).stdout;
  const beforeRoot = await head(root);
  const beforeDecoy = await head(decoy);
  await exec('git', ['-C', root, 'commit', '--allow-empty', '-qm', 'fixture isolation'], {
    env: {
      ...process.env,
      GIT_DIR: join(decoy, '.git'), GIT_WORK_TREE: decoy,
      GIT_INDEX_FILE: join(decoy, '.git', 'index'), GIT_COMMON_DIR: join(decoy, '.git'),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'Wrong identity',
    },
  });
  assert.notEqual(await head(root), beforeRoot);
  assert.equal(await head(decoy), beforeDecoy);
  assert.equal((await exec('git', ['-C', root, 'show', '-s', '--format=%an'])).stdout.trim(), 'Test');
});
