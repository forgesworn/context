import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { buildPacket, planPacket, verifyPacket } from '../scripts/worker-packet.mjs';

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

function planBase(overrides = {}) {
  return {
    version: 1,
    task: 'Plan fixture blocks.',
    acceptanceChecks: ['node --test'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', line: 1 }],
    exclusions: ['No network.'],
    unresolvedQuestions: [],
    ...overrides,
  };
}

test('plans complete nested callback and function units, then merges adjacent selections', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), `describe('suite', () => {\n  it.each([1])('case', (value) => {\n    const helper = () => {\n      return value;\n    };\n    expect(helper()).toBe(1);\n  });\n});\n\nfunction outside() {\n  return 2;\n}\n`);
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [
    { path: 'src.ts', line: 4 }, { path: 'src.ts', line: 6 }, { path: 'src.ts', line: 10 },
  ] })) });
  assert.deepEqual(result.coverage.resolutions.map(({ kind, startLine, endLine }) => ({ kind, startLine, endLine })), [
    { kind: 'variable', startLine: 3, endLine: 5 }, { kind: 'callbackCall', startLine: 2, endLine: 7 }, { kind: 'function', startLine: 10, endLine: 12 },
  ]);
  assert.deepEqual(result.coverage.mergedSources, [{ path: 'src.ts', startLine: 2, endLine: 7 }, { path: 'src.ts', startLine: 10, endLine: 12 }]);
  assert.match(result.coverage.packetSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await verifyPacket({ root, packet: await (async () => { const path = join(root, 'planned.json'); await writeFile(path, JSON.stringify(result.packet)); return path; })() }), { status: 'current' });
});

test('planner rejects unsupported, malformed, signature-only and ambiguous same-line anchors', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), 'function a() {} function b() {}\ndeclare function absent(): void;\n');
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 1 }] })) }), /ambiguous/);
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 2 }] })) }), /no supported/);
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.py', line: 1 }] })) }), /unsupported/);
  await writeFile(join(root, 'bad.ts'), 'function broken( {\n');
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'bad.ts', line: 1 }] })) }), /parse errors/);
});

test('plan CLI writes the v1 packet and reports coverage', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), 'const named = () => {\n  return 1;\n};\n');
  const input = await spec(root, planBase());
  const out = join(root, 'planned-out.json');
  const { stdout } = await exec(process.execPath, [SCRIPT, 'plan', '--root', root, '--spec', input, '--out', out]);
  const summary = JSON.parse(stdout);
  assert.equal(summary.coverage.resolutions[0].kind, 'variable');
  assert.equal(JSON.parse(await readFile(out, 'utf8')).version, 1);
  assert.equal((await stat(out)).mode & 0o777, 0o600);
});

test('planner retains decorators, JSDoc, async generic methods and every branch', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), `class Service {\n  /** Returns the selected value. */\n  @logged\n  async choose<T>(value: T, ok: boolean): Promise<T> {\n    if (ok) {\n      return value;\n    } else {\n      return await Promise.resolve(value);\n    }\n  }\n}\n`);
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 8 }] })) });
  assert.deepEqual(result.coverage.resolutions[0], { requestIndex: 0, path: 'src.ts', line: 8, kind: 'method', startLine: 2, endLine: 10 });
  assert.deepEqual(result.packet.sources[0].lines.map((entry) => entry.line), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('planner supports property owners, duplicate anchors and adjacent blocks', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), `const handlers = {\n  run: async () => {\n    return '£';\n  },\n};\nconst next = () => {\n  return 'ok';\n};\nconst final = () => {\n  return 'done';\n};\n`);
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [
    { path: 'src.ts', line: 3 }, { path: 'src.ts', line: 3 }, { path: 'src.ts', line: 7 }, { path: 'src.ts', line: 10 },
  ] })) });
  assert.deepEqual(result.coverage.mergedSources, [{ path: 'src.ts', startLine: 2, endLine: 4 }, { path: 'src.ts', startLine: 6, endLine: 11 }]);
  assert.equal(result.coverage.resolutions[0].kind, 'property');
});

test('planner chooses a nested helper callback over its enclosing test callback', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), `describe('suite', () => {\n  it('case', () => {\n    helper(() => {\n      expect(true).toBe(true);\n    });\n  });\n});\n`);
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 4 }] })) });
  assert.deepEqual(result.coverage.resolutions[0], { requestIndex: 0, path: 'src.ts', line: 4, kind: 'callbackCall', startLine: 3, endLine: 5 });
});

test('planner includes a named class-field callback owner', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), 'class Service {\n  handler = () => {\n    return 1;\n  };\n}\n');
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 3 }] })) });
  assert.deepEqual(result.coverage.mergedSources, [{ path: 'src.ts', startLine: 2, endLine: 4 }]);
  assert.equal(result.coverage.resolutions[0].kind, 'property');
  assert.equal(result.packet.sources[0].lines[0].content, '  handler = () => {');
});

test('planner retains object methods and accessors with their trailing commas', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), 'const handlers = {\n  run() {\n    return 1;\n  },\n  get value() {\n    return 2;\n  },\n  set value(next: number) {\n    this.current = next;\n  },\n};\n');
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [3, 6, 9].map((line) => ({ path: 'src.ts', line })) })) });
  assert.deepEqual(result.coverage.resolutions.map(({ startLine, endLine }) => [startLine, endLine]), [[2, 4], [5, 7], [8, 10]]);
  assert.deepEqual(result.coverage.mergedSources, [{ path: 'src.ts', startLine: 2, endLine: 10 }]);
  assert.equal(result.packet.sources[0].lines.filter((line) => line.content === '  },').length, 3);
});

test('planner rejects source or policy changes between selection and packet assembly without output', async () => {
  const realGit = (await exec('which', ['git'])).stdout.trim();
  for (const mutation of ['source', 'policy']) {
    const root = await fixture();
    await writeFile(join(root, 'src.ts'), 'function value() {\n  return 1;\n}\n');
    const input = await spec(root, planBase({ sources: [{ path: 'src.ts', line: 2 }] }));
    const shim = await mkdtemp(join(tmpdir(), 'packet-plan-race-'));
    fixtures.push(shim);
    const counter = join(shim, 'counter');
    const changedPath = join(root, mutation === 'source' ? 'src.ts' : '.gitignore');
    const changedText = mutation === 'source' ? 'function value() {\n  return 2;\n}\n' : '*.tmp\n';
    await writeFile(join(shim, 'git'), `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (process.argv.includes('--verify')) {
  let count = 0;
  try { count = Number(readFileSync(${JSON.stringify(counter)}, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  count++;
  writeFileSync(${JSON.stringify(counter)}, String(count));
  if (count === 2) writeFileSync(${JSON.stringify(changedPath)}, ${JSON.stringify(changedText)});
}
const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
`, { mode: 0o700 });
    const out = join(root, 'must-not-exist.json');
    await assert.rejects(exec(process.execPath, [SCRIPT, 'plan', '--root', root, '--spec', input, '--out', out], {
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    }), mutation === 'source' ? /source changed during packet planning/ : /navigation policy changed during packet planning/);
    await assert.rejects(stat(out), { code: 'ENOENT' });
    assert.equal(await readFile(changedPath, 'utf8'), changedText);
  }
});

test('planner preserves CRLF, EOF and multibyte source lines', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), 'const value = () => {\r\n  return "£😀";\r\n};');
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 2 }] })) });
  assert.deepEqual(result.packet.sources[0].lines, [
    { line: 1, content: 'const value = () => {\r' }, { line: 2, content: '  return "£😀";\r' }, { line: 3, content: '};' },
  ]);
});

test('planner rejects line separators that v1 packet excerpts cannot represent', async () => {
  const root = await fixture();
  for (const separator of ['\r', '\u2028', '\u2029']) {
    await writeFile(join(root, 'src.ts'), `const value = () => {${separator}  return 1;${separator}};`);
    await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 2 }] })) }), /line separators unsupported/);
  }
});

test('planner handles every supported TypeScript and JavaScript extension', async () => {
  const root = await fixture();
  const extensions = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'];
  const sources = [];
  for (const extension of extensions) {
    const path = `item.${extension}`;
    const body = extension === 'tsx' || extension === 'jsx' ? '  return <div />;' : '  return 1;';
    await writeFile(join(root, path), `const value = () => {\n${body}\n};\n`);
    sources.push({ path, line: 2 });
  }
  const result = await planPacket({ root, spec: await spec(root, planBase({ allowedFiles: extensions.map((extension) => `item.${extension}`), sources })) });
  assert.equal(result.coverage.resolutions.length, extensions.length);
  assert(result.coverage.resolutions.every((entry) => entry.kind === 'variable'));
});

test('planner rejects policy and symlink sources, stale packets and malformed anchor plans', async () => {
  const root = await fixture();
  await writeFile(join(root, '.gitignore'), 'src.ts\n');
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase()) }), /excluded/);
  await writeFile(join(root, '.gitignore'), '');
  await symlink(join(root, 'src.ts'), join(root, 'linked.ts'));
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ allowedFiles: ['linked.ts'], sources: [{ path: 'linked.ts', line: 1 }] })) }), /symlink/);
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 1, extra: true }] })) }), /unknown or missing/);
  assert.deepEqual((await planPacket({ root, spec: await spec(root, { ...planBase(), sources: [] }) })).coverage.mergedSources, []);
  await assert.rejects(planPacket({ root, spec: await spec(root, planBase({ sources: Array.from({ length: 33 }, () => ({ path: 'src.ts', line: 1 })) })) }), /limited/);
  await writeFile(join(root, 'src.ts'), 'const live = () => {\n return 1;\n};\n');
  const result = await planPacket({ root, spec: await spec(root, planBase({ sources: [{ path: 'src.ts', line: 2 }] })) });
  const packet = join(root, 'planned-stale.json');
  await writeFile(packet, JSON.stringify(result.packet));
  await writeFile(join(root, 'src.ts'), 'const live = () => {\n return 2;\n};\n');
  await assert.rejects(verifyPacket({ root, packet }), /stale or has been tampered/);
});

test('plan CLI reports exact coverage digest and leaves no output after invalid planning', async () => {
  const root = await fixture();
  await writeFile(join(root, 'src.ts'), 'const value = () => {\n  return 1;\n};\n');
  const input = await spec(root, planBase({ sources: [{ path: 'src.ts', line: 2 }] }));
  const out = join(root, 'digest.json');
  const { stdout } = await exec(process.execPath, [SCRIPT, 'plan', '--root', root, '--spec', input, '--out', out]);
  const summary = JSON.parse(stdout);
  assert.equal(summary.coverage.packetSha256, createHash('sha256').update(await readFile(out)).digest('hex'));
  await assert.rejects(exec(process.execPath, [SCRIPT, 'plan', '--root', root, '--spec', input, '--out', out]), /create output exclusively/);
  const invalid = await spec(root, planBase({ sources: [{ path: 'src.ts', line: 99 }] }));
  const absent = join(root, 'must-not-exist.json');
  await assert.rejects(exec(process.execPath, [SCRIPT, 'plan', '--root', root, '--spec', invalid, '--out', absent]), /no supported|anchor line/);
  await assert.rejects(stat(absent));
});

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
