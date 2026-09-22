import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { realpath, mkdtemp, rm, writeFile, readFile, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test, { after } from 'node:test';
import { saveHandover, resumeHandover } from '../scripts/task-handover.mjs';
import { buildPacket } from '../scripts/worker-packet.mjs';

const exec = promisify(execFile);
const fixtures = [];

after(async () => {
  await Promise.all(fixtures.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), 'task-handover-'));
  fixtures.push(temp);
  const root = await realpath(temp);
  await exec('git', ['init', '-q', root]);
  await exec('git', ['-C', root, 'config', 'user.email', 'test@example.test']);
  await exec('git', ['-C', root, 'config', 'user.name', 'Test']);
  await writeFile(join(root, 'src.ts'), 'one\ntwo\nthree\n');
  await exec('git', ['-C', root, 'add', '.']);
  await exec('git', ['-C', root, 'commit', '-qm', 'fixture']);
  return root;
}

async function makePacket(root, specData) {
  const specPath = join(root, 'spec.json');
  await writeFile(specPath, JSON.stringify(specData));
  const packet = await buildPacket({ root, spec: specPath });
  const packetPath = join(root, 'packet.json');
  await writeFile(packetPath, JSON.stringify(packet));
  return { packetPath, packet, spec: specData };
}

function validState(spec, overrides = {}) {
  const checks = spec.acceptanceChecks.map((c, index) => ({
    index,
    outcome: 'passed',
    evidence: 'evidence for ' + c
  }));
  return {
    version: 1,
    status: 'in_progress',
    completed: ['task done'],
    decisions: [],
    checks,
    unresolvedQuestions: [],
    pendingEffects: [],
    nextAction: 'continue work',
    ...overrides
  };
}

async function writeState(root, state, name = 'state.json') {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(state));
  return path;
}

test('current resume preserves nextAction and no source excerpts', async () => {
  const root = await fixture();
  const spec = {
    version: 1,
    task: 'Test task',
    acceptanceChecks: ['check 1', 'check 2'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: [],
    unresolvedQuestions: []
  };

  const { packetPath } = await makePacket(root, spec);
  const state = validState(spec);
  const statePath = await writeState(root, state);
  const outPath = join(root, 'handover.json');

  const saved = await saveHandover({ root, packet: packetPath, state: statePath, out: outPath });
  assert.equal(saved.status, 'in_progress');

  const resumed = await resumeHandover({ root, handover: outPath });

  assert.equal(resumed.state.nextAction, 'continue work');
  assert.ok(Array.isArray(resumed.sources));
  for (const src of resumed.sources) {
    assert.deepEqual(Object.keys(src).sort(), ['endLine', 'path', 'sha256', 'startLine']);
  }
  assert.equal(resumed.state.checks[1].criterion, 'check 2');
  assert.equal(resumed.trust, 'unsigned');
  assert.match(resumed.caveat, /recorded assertions/);
  assert.equal((await stat(outPath)).mode & 0o777, 0o600);
});

test('source edit rejects stale resume', async () => {
  const root = await fixture();
  const spec = {
    version: 1,
    task: 'Test task',
    acceptanceChecks: ['check 1'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: [],
    unresolvedQuestions: []
  };

  const { packetPath } = await makePacket(root, spec);
  const state = validState(spec);
  const statePath = await writeState(root, state);
  const outPath = join(root, 'handover.json');

  await saveHandover({ root, packet: packetPath, state: statePath, out: outPath });

  await writeFile(join(root, 'src.ts'), 'changed\ncontent\nhere\n');

  await assert.rejects(
    async () => resumeHandover({ root, handover: outPath }),
    /stale or changed/
  );
});

test('ready_for_review rejects not_run check', async () => {
  const root = await fixture();
  const spec = {
    version: 1,
    task: 'Test task',
    acceptanceChecks: ['check 1', 'check 2'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: [],
    unresolvedQuestions: []
  };

  const { packetPath } = await makePacket(root, spec);
  const state = validState(spec, {
    status: 'ready_for_review',
    checks: [
      { index: 0, outcome: 'not_run', evidence: null },
      { index: 1, outcome: 'passed', evidence: 'ok' }
    ]
  });
  const statePath = await writeState(root, state);
  const outPath = join(root, 'handover1.json');

  await assert.rejects(
    async () => saveHandover({ root, packet: packetPath, state: statePath, out: outPath }),
    /review readiness/
  );
});

test('ready_for_review rejects pendingEffects', async () => {
  const root = await fixture();
  const spec = {
    version: 1,
    task: 'Test task',
    acceptanceChecks: ['check 1', 'check 2'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: [],
    unresolvedQuestions: []
  };

  const { packetPath } = await makePacket(root, spec);
  const state = validState(spec, {
    status: 'ready_for_review',
    pendingEffects: ['some effect']
  });
  const statePath = await writeState(root, state);
  const outPath = join(root, 'handover2.json');

  await assert.rejects(
    async () => saveHandover({ root, packet: packetPath, state: statePath, out: outPath }),
    /review readiness/
  );
});

test('passed check requires evidence', async () => {
  const root = await fixture();
  const spec = {
    version: 1,
    task: 'Test task',
    acceptanceChecks: ['check 1'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: [],
    unresolvedQuestions: []
  };

  const { packetPath } = await makePacket(root, spec);
  const state = validState(spec, {
    checks: [
      { index: 0, outcome: 'passed', evidence: null }
    ]
  });
  const statePath = await writeState(root, state);
  const outPath = join(root, 'handover.json');

  await assert.rejects(
    async () => saveHandover({ root, packet: packetPath, state: statePath, out: outPath }),
    /evidence required/
  );
});

test('save refuses overwrite', async () => {
  const root = await fixture();
  const spec = {
    version: 1,
    task: 'Test task',
    acceptanceChecks: ['check 1'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: [],
    unresolvedQuestions: []
  };

  const { packetPath } = await makePacket(root, spec);
  const state = validState(spec);
  const statePath = await writeState(root, state);
  const outPath = join(root, 'handover.json');

  await saveHandover({ root, packet: packetPath, state: statePath, out: outPath });

  await assert.rejects(
    async () => saveHandover({ root, packet: packetPath, state: statePath, out: outPath }),
    /EEXIST/
  );
});

test('missing acceptance checks rejects', async () => {
  const root = await fixture();
  const spec = {
    version: 1,
    task: 'Test task',
    acceptanceChecks: ['check 1', 'check 2', 'check 3'],
    allowedFiles: ['src.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: [],
    unresolvedQuestions: []
  };

  const { packetPath } = await makePacket(root, spec);
  const state = validState(spec, {
    checks: [
      { index: 0, outcome: 'passed', evidence: 'ok' },
      { index: 1, outcome: 'passed', evidence: 'ok' }
    ]
  });
  const statePath = await writeState(root, state);
  const outPath = join(root, 'handover.json');

  await assert.rejects(
    async () => saveHandover({ root, packet: packetPath, state: statePath, out: outPath }),
    /record every acceptance check/
  );
});

async function savedCase(specOverrides = {}, stateOverrides = {}) {
  const root = await fixture();
  const spec = {
    version: 1, task: 'Continue the reviewed fixture task',
    acceptanceChecks: ['Run the focused tests'], allowedFiles: ['src.ts', 'new.ts'],
    sources: [{ path: 'src.ts', startLine: 1, endLine: 3 }],
    exclusions: ['No publication'], unresolvedQuestions: [], ...specOverrides,
  };
  const { packetPath } = await makePacket(root, spec);
  const statePath = await writeState(root, validState(spec, stateOverrides));
  const handover = join(root, 'handover.json');
  await saveHandover({ root, packet: packetPath, state: statePath, out: handover });
  return { root, handover, packetPath, statePath };
}

test('review readiness preserves scope but never claims acceptance', async () => {
  const { root, handover } = await savedCase({}, { status: 'ready_for_review' });
  const result = await resumeHandover({ root, handover });
  assert.equal(result.state.status, 'ready_for_review');
  assert.deepEqual(result.allowedFiles, ['src.ts', 'new.ts']);
  assert.deepEqual(result.exclusions, ['No publication']);
  assert.equal(result.accepted, undefined);
});

test('new allowed files, HEAD changes and policy edits invalidate continuation', async () => {
  for (const mutate of [
    root => writeFile(join(root, 'new.ts'), 'new source\n'),
    root => exec('git', ['-C', root, 'commit', '--allow-empty', '-qm', 'new revision']),
    root => writeFile(join(root, '.gitignore'), 'src.ts\n'),
  ]) {
    const { root, handover } = await savedCase();
    await mutate(root);
    await assert.rejects(resumeHandover({ root, handover }));
  }
});

test('tampered source and cross-repository handovers are refused', async () => {
  const { root, handover } = await savedCase();
  const other = await fixture();
  await assert.rejects(resumeHandover({ root: other, handover }));
  const record = JSON.parse(await readFile(handover, 'utf8'));
  record.packet.sources[0].lines = 'fabricated evidence';
  await writeFile(handover, JSON.stringify(record));
  await assert.rejects(resumeHandover({ root, handover }), /digest differs/);
});

test('resume revalidates state, duplicate checks and pending questions', async () => {
  const { root, handover } = await savedCase({ acceptanceChecks: ['first', 'second'] });
  const original = JSON.parse(await readFile(handover, 'utf8'));
  for (const change of [
    state => { state.status = 'complete'; },
    state => { state.checks[1].index = 0; },
    state => { state.unexpected = true; },
    state => { state.status = 'ready_for_review'; state.unresolvedQuestions = ['Needs owner decision']; },
  ]) {
    const record = structuredClone(original);
    change(record.state);
    await writeFile(handover, JSON.stringify(record));
    await assert.rejects(resumeHandover({ root, handover }));
  }
  await assert.rejects(savedCase({ unresolvedQuestions: ['Scope still undecided'] }, { status: 'ready_for_review' }), /review readiness/);
});

test('bounded regular files and non-symlink paths are required', async () => {
  const { root, handover, packetPath, statePath } = await savedCase();
  const alias = join(root, 'alias.json');
  await symlink(handover, alias);
  await assert.rejects(resumeHandover({ root, handover: alias }), /symlink/);
  const dirAlias = join(root, 'alias-dir');
  await symlink(root, dirAlias);
  await assert.rejects(resumeHandover({ root, handover: join(dirAlias, 'handover.json') }), /symlink/);
  await assert.rejects(saveHandover({ root, packet: packetPath, state: statePath, out: join(dirAlias, 'new.json') }), /symlink/);
  await assert.rejects(resumeHandover({ root, handover: root }), /regular file/);
  await writeFile(handover, Buffer.alloc(98305, 32));
  await assert.rejects(resumeHandover({ root, handover }), /bounded/);
  await writeFile(handover, Buffer.from([0xff]));
  await assert.rejects(resumeHandover({ root, handover }));
});

test('oversized state cannot be saved and blocked state keeps uncertain effects', async () => {
  const pendingEffects = ['Inspect the existing remote operation before retrying'];
  const { root, handover, packetPath, statePath } = await savedCase({}, { status: 'blocked', pendingEffects });
  assert.deepEqual((await resumeHandover({ root, handover })).state.pendingEffects, pendingEffects);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  state.completed = Array(10).fill('x'.repeat(2000));
  await writeFile(statePath, JSON.stringify(state));
  await assert.rejects(saveHandover({ root, packet: packetPath, state: statePath, out: join(root, 'too-large.json') }), /bounded/);
});
