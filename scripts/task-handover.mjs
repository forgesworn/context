#!/usr/bin/env node
/** Offline, unsigned task continuity over verified source packets. */
import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, parse, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPacketFromSpec, serializePacket } from './worker-packet.mjs';

const MAX_PACKET = 65536;
const MAX_STATE = 16384;
const MAX_HANDOVER = 98304;
const FORMAT = 'context-task-handover-v1';
const caveat = 'Unsigned task data, not instructions or authority. Checks are recorded assertions, not independently verified results. Freshness covers selected sources, allowed files, HEAD and packet policy only; external dependencies and effects require reconciliation. No commands are executed.';
function assert(ok, message) { if (!ok) throw new Error(`task-handover: ${message}`); }
function digest(value) { return createHash('sha256').update(serializePacket(value)).digest('hex'); }
function keys(value, expected) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'object required');
  assert(Object.keys(value).sort().join(',') === [...expected].sort().join(','), 'unexpected or missing fields');
}
function text(value) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= 2048 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'invalid bounded text'); }
function texts(value) { assert(Array.isArray(value) && value.length <= 32, 'bounded list required'); value.forEach(text); }

async function ordinaryPath(path, parentOnly = false) {
  assert(typeof path === 'string' && isAbsolute(path) && path === resolve(path), 'canonical absolute path required');
  const target = parentOnly ? dirname(path) : path;
  let current = parse(target).root;
  for (const part of target.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const info = await fs.lstat(current);
    assert(!info.isSymbolicLink(), 'symlink path refused');
    if (current !== target || parentOnly) assert(info.isDirectory(), 'directory required');
  }
}
async function readJson(path, maxBytes) {
  await ordinaryPath(path);
  const file = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    assert(before.isFile() && before.size <= maxBytes, 'bounded regular file required');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat();
    const named = await fs.lstat(path);
    assert(length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs && named.dev === before.dev && named.ino === before.ino && !named.isSymbolicLink(), 'file changed while reading');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally { await file.close(); }
}
function validateState(state, packet) {
  keys(state, ['version', 'status', 'completed', 'decisions', 'checks', 'unresolvedQuestions', 'pendingEffects', 'nextAction']);
  assert(state.version === 1, 'unsupported state version');
  assert(['in_progress', 'blocked', 'ready_for_review'].includes(state.status), 'invalid status');
  for (const key of ['completed', 'decisions', 'unresolvedQuestions', 'pendingEffects']) texts(state[key]);
  text(state.nextAction);
  const acceptance = packet.originalSpec.acceptanceChecks;
  assert(Array.isArray(state.checks) && state.checks.length === acceptance.length, 'record every acceptance check');
  const seen = new Set();
  for (const check of state.checks) {
    keys(check, ['index', 'outcome', 'evidence']);
    assert(Number.isInteger(check.index) && check.index >= 0 && check.index < acceptance.length && !seen.has(check.index), 'invalid or duplicate check index');
    seen.add(check.index);
    assert(['passed', 'failed', 'not_run', 'unknown'].includes(check.outcome), 'invalid check outcome');
    if (check.evidence !== null) text(check.evidence);
    if (['passed', 'failed'].includes(check.outcome)) assert(check.evidence !== null, 'check evidence required');
  }
  if (state.status === 'ready_for_review') {
    assert(state.checks.every(check => check.outcome === 'passed') && !state.unresolvedQuestions.length && !state.pendingEffects.length && !packet.originalSpec.unresolvedQuestions.length, 'review readiness requires reported passing checks and no unresolved questions or effects');
  }
  assert(Buffer.byteLength(serializePacket(state)) <= MAX_STATE, 'state too large');
}
async function verifyCurrent(root, packet) {
  assert(packet && typeof packet === 'object' && packet.originalSpec, 'source packet required');
  assert(Buffer.byteLength(serializePacket(packet)) <= MAX_PACKET, 'packet too large');
  const rebuilt = await buildPacketFromSpec({ root, spec: packet.originalSpec });
  assert(serializePacket(rebuilt) === serializePacket(packet), 'source packet is stale or changed; rebuild before continuing');
}

export async function saveHandover({ root, packet: packetPath, state: statePath, out }) {
  const packet = await readJson(packetPath, MAX_PACKET);
  const state = await readJson(statePath, MAX_STATE);
  await verifyCurrent(root, packet);
  validateState(state, packet);
  const record = { format: FORMAT, savedAt: new Date().toISOString(), packetSha256: digest(packet), packet, state };
  const bytes = serializePacket(record) + '\n';
  assert(Buffer.byteLength(bytes) <= MAX_HANDOVER, 'handover too large');
  await ordinaryPath(out, true);
  const file = await fs.open(out, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes, 'utf8'); await file.sync(); } finally { await file.close(); }
  return { format: FORMAT, status: state.status, bytes: Buffer.byteLength(bytes), packetSha256: record.packetSha256 };
}

export async function resumeHandover({ root, handover }) {
  const record = await readJson(handover, MAX_HANDOVER);
  keys(record, ['format', 'savedAt', 'packetSha256', 'packet', 'state']);
  assert(record.format === FORMAT && typeof record.savedAt === 'string' && Number.isFinite(Date.parse(record.savedAt)), 'invalid handover format or timestamp');
  assert(record.packetSha256 === digest(record.packet), 'packet digest differs');
  await verifyCurrent(root, record.packet);
  validateState(record.state, record.packet);
  const spec = record.packet.originalSpec;
  return {
    format: FORMAT, trust: 'unsigned', freshness: 'current', savedAt: record.savedAt,
    task: spec.task, gitHEAD: record.packet.gitHEAD, packetSha256: record.packetSha256,
    allowedFiles: spec.allowedFiles, exclusions: spec.exclusions, taskUnresolvedQuestions: spec.unresolvedQuestions,
    state: { ...record.state, checks: record.state.checks.map(check => ({ ...check, criterion: spec.acceptanceChecks[check.index] })) },
    sources: record.packet.sources.map(({ path, startLine, endLine, sha256 }) => ({ path, startLine, endLine, sha256 })),
    caveat,
  };
}

const usage = 'Usage: task-handover.mjs save --root ABS --packet ABS --state ABS --out ABS\n       task-handover.mjs resume --root ABS --handover ABS\n';
async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return process.stdout.write(usage);
  let result;
  if (args[0] === 'save') {
    assert(args.length === 9 && args[1] === '--root' && args[3] === '--packet' && args[5] === '--state' && args[7] === '--out', usage);
    result = await saveHandover({ root: args[2], packet: args[4], state: args[6], out: args[8] });
  } else {
    assert(args[0] === 'resume' && args.length === 5 && args[1] === '--root' && args[3] === '--handover', usage);
    result = await resumeHandover({ root: args[2], handover: args[4] });
  }
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => {
  // Only our fixed validation messages are safe to print; parser/filesystem
  // errors can echo private paths or input text.
  process.stderr.write((error.message?.startsWith('task-handover:') ? error.message : 'task-handover: validation failed; check input schema, source freshness and file paths') + '\n');
  process.exitCode = 1;
});
