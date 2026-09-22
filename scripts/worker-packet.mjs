#!/usr/bin/env node
/** Deterministic, source-only handoff packets for the D4 worker workflow. */
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { NavigationPolicy } from '../packages/context-tools/dist/repository-navigation-policy.js';

const execFileAsync = promisify(execFile);
const MAX_SPEC_BYTES = 64 * 1024;
const MAX_PACKET_BYTES = 64 * 1024;
const MAX_FILES = 32;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'md']);
const GENERATED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', 'vendor', 'target']);

function assert(ok, message) { if (!ok) throw new Error(`worker-packet: ${message}`); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, stable(value[key])]));
  return value;
}
function serialize(value) { return JSON.stringify(stable(value)); }
export { serialize as serializePacket };
function strictText(bytes, label) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(`worker-packet: ${label} is not valid UTF-8`); }
}
function validRelativePath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty relative path`);
  assert(!/[\u0000-\u001f\u007f\\\\]/.test(value) && !value.startsWith('/') && !/^[A-Za-z]:/.test(value), `${label} is not a safe relative path`);
  const parts = value.split('/');
  assert(parts.every((part) => part !== '' && part !== '.' && part !== '..' && !part.startsWith('.')), `${label} contains a forbidden path component`);
  assert(!parts.some((part) => part === '.git' || GENERATED_DIRECTORIES.has(part)), `${label} is in a forbidden directory`);
  return value;
}
async function regularBytes(absolute, label, maxBytes = MAX_FILE_BYTES) {
  const expected = await fs.lstat(absolute).catch((error) => { throw new Error(`worker-packet: cannot inspect ${label}: ${error.code ?? error.message}`); });
  assert(expected.isFile() && !expected.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  assert(expected.size <= maxBytes, `${label} exceeds ${maxBytes} bytes`);
  const handle = await fs.open(absolute, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert(before.isFile() && before.dev === expected.dev && before.ino === expected.ino && before.size === expected.size, `${label} changed before read`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    assert(offset === before.size && after.dev === before.dev && after.ino === before.ino && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, `${label} changed during read`);
    return bytes;
  } finally { await handle.close(); }
}
async function rejectSymlinkComponents(root, absolute, label) {
  const rel = relative(root, absolute);
  assert(rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)), `${label} escapes root`);
  let current = root;
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component);
    const state = await fs.lstat(current).catch((error) => { throw new Error(`worker-packet: cannot inspect ${label}: ${error.code ?? error.message}`); });
    assert(!state.isSymbolicLink(), `${label} contains a symlink component`);
  }
}
async function canonicalRoot(input) {
  assert(typeof input === 'string' && isAbsolute(input), 'root must be an absolute path');
  const inputState = await fs.lstat(input).catch(() => { throw new Error('worker-packet: root does not exist'); });
  assert(inputState.isDirectory() && !inputState.isSymbolicLink(), 'root must be a non-symlink directory');
  const root = await fs.realpath(input).catch(() => { throw new Error('worker-packet: root does not exist'); });
  const canonicalState = await fs.lstat(root);
  assert(canonicalState.isDirectory() && !canonicalState.isSymbolicLink() && canonicalState.dev === inputState.dev && canonicalState.ino === inputState.ino, 'root changed during canonicalisation');
  return { root, identity: { dev: canonicalState.dev, ino: canonicalState.ino } };
}
function gitEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}
async function gitHead(root) {
  try {
    const options = { encoding: 'utf8', maxBuffer: 1024, env: gitEnvironment() };
    const [{ stdout }, top] = await Promise.all([
      execFileAsync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], options),
      execFileAsync('git', ['-C', root, 'rev-parse', '--show-toplevel'], options),
    ]);
    const value = stdout.trim();
    assert(/^[0-9a-f]{40}$/i.test(value), 'git HEAD is invalid');
    assert(await fs.realpath(top.stdout.trim()) === root, 'git repository root differs from explicit root');
    return value;
  } catch { throw new Error('worker-packet: root must be a git repository with HEAD'); }
}
function requireStrings(value, label, { nonempty = false } = {}) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(!nonempty || value.length > 0, `${label} must not be empty`);
  for (const item of value) assert(typeof item === 'string' && item.length > 0, `${label} must contain non-empty strings`);
  return value;
}
function parseSpec(text) {
  let spec;
  try { spec = JSON.parse(text); } catch { throw new Error('worker-packet: spec is not valid JSON'); }
  assert(spec && typeof spec === 'object' && !Array.isArray(spec), 'spec must be an object');
  const expectedKeys = ['acceptanceChecks', 'allowedFiles', 'exclusions', 'sources', 'task', 'unresolvedQuestions', 'version'];
  assert(Object.keys(spec).sort(compare).every((key, index) => key === expectedKeys[index]) && Object.keys(spec).length === expectedKeys.length, 'spec has unknown or missing fields');
  assert(spec.version === 1, 'spec version must be 1');
  assert(typeof spec.task === 'string' && spec.task.length > 0, 'task must be a non-empty string');
  requireStrings(spec.acceptanceChecks, 'acceptanceChecks', { nonempty: true });
  requireStrings(spec.allowedFiles, 'allowedFiles');
  requireStrings(spec.exclusions, 'exclusions');
  requireStrings(spec.unresolvedQuestions, 'unresolvedQuestions');
  assert(Array.isArray(spec.sources), 'sources must be an array');
  assert(spec.sources.length <= MAX_FILES && spec.allowedFiles.length <= MAX_FILES, `sources and allowedFiles are limited to ${MAX_FILES}`);
  const allowed = new Set();
  for (const file of spec.allowedFiles) { validRelativePath(file, 'allowedFiles entry'); assert(!allowed.has(file), 'allowedFiles must be unique'); allowed.add(file); }
  const ranges = new Map();
  for (const source of spec.sources) {
    assert(source && typeof source === 'object' && !Array.isArray(source), 'source must be an object');
    assert(Object.keys(source).sort(compare).join(',') === 'endLine,path,startLine', 'source has unknown or missing fields');
    const path = validRelativePath(source.path, 'source path');
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    assert(SOURCE_EXTENSIONS.has(ext), `source extension is unsupported: ${path}`);
    assert(Number.isSafeInteger(source.startLine) && Number.isSafeInteger(source.endLine) && source.startLine >= 1 && source.endLine >= source.startLine, `invalid line range for ${path}`);
    const prior = ranges.get(path) ?? [];
    assert(!prior.some((range) => source.startLine <= range.endLine && source.endLine >= range.startLine), `source ranges overlap: ${path}`);
    prior.push(source);
    ranges.set(path, prior);
  }
  for (const file of spec.allowedFiles) {
    const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
    assert(SOURCE_EXTENSIONS.has(ext), `allowed file extension is unsupported: ${file}`);
  }
  return spec;
}
async function validatePolicy(root, spec, policy) {
  const scopes = new Map([['', policy.rootDirectoryScope()]]);
  for (const source of spec.sources) {
    await rejectSymlinkComponents(root, resolve(root, source.path), `source ${source.path}`);
    assert(policy.allows(source.path, false, await scopeFor(root, policy, source.path, scopes)), `source is excluded by navigation policy: ${source.path}`);
  }
  for (const file of spec.allowedFiles) {
    await rejectSymlinkComponents(root, dirname(resolve(root, file)), `allowed file ${file}`);
    assert(policy.allows(file, false, await scopeFor(root, policy, file, scopes)), `allowed file is excluded by navigation policy: ${file}`);
  }
  return policy.manifest();
}
async function scopeFor(root, policy, path, cache) {
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  if (cache.has(directory)) return cache.get(directory);
  let scope = cache.get('');
  let current = '';
  for (const component of directory.split('/').filter(Boolean)) {
    current = current ? `${current}/${component}` : component;
    if (cache.has(current)) { scope = cache.get(current); continue; }
    await rejectSymlinkComponents(root, resolve(root, current), `directory ${current}`);
    assert(policy.allows(current, true, scope), `directory is excluded by navigation policy: ${current}`);
    scope = await policy.enterDirectory(current, scope);
    cache.set(current, scope);
  }
  return scope;
}
async function readSource(root, entry, policy, scopes, total) {
  const absolute = resolve(root, entry.path);
  await rejectSymlinkComponents(root, absolute, `source ${entry.path}`);
  const scope = await scopeFor(root, policy, entry.path, scopes);
  assert(policy.allows(entry.path, false, scope), `source is excluded by navigation policy: ${entry.path}`);
  const bytes = await regularBytes(absolute, `source ${entry.path}`);
  assert(total.value + bytes.byteLength <= MAX_TOTAL_BYTES, `source aggregate exceeds ${MAX_TOTAL_BYTES} bytes`);
  total.value += bytes.byteLength;
  const text = strictText(bytes, `source ${entry.path}`);
  const lines = text.split('\n');
  assert(entry.endLine <= lines.length, `line range exceeds source length: ${entry.path}`);
  const excerpt = [];
  for (let line = entry.startLine; line <= entry.endLine; line++) {
    const record = { line, content: lines[line - 1] };
    const recordBytes = Buffer.byteLength(JSON.stringify(record), 'utf8') + 1;
    assert(total.excerptBytes + recordBytes <= MAX_PACKET_BYTES, `source excerpts exceed ${MAX_PACKET_BYTES} bytes`);
    total.excerptBytes += recordBytes;
    excerpt.push(record);
  }
  return { path: entry.path, sha256: hash(bytes), bytes: bytes.byteLength, startLine: entry.startLine, endLine: entry.endLine, lines: excerpt };
}
async function allowedState(root, file, policy, scopes, total) {
  const absolute = resolve(root, file);
  const scope = await scopeFor(root, policy, file, scopes);
  assert(policy.allows(file, false, scope), `allowed file is excluded by navigation policy: ${file}`);
  const parent = dirname(absolute);
  await rejectSymlinkComponents(root, parent, `allowed file ${file}`);
  const state = await fs.lstat(absolute).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!state) return { path: file, state: 'absent' };
  await rejectSymlinkComponents(root, absolute, `allowed file ${file}`);
  const bytes = await regularBytes(absolute, `allowed file ${file}`);
  assert(total.value + bytes.byteLength <= MAX_TOTAL_BYTES, `file aggregate exceeds ${MAX_TOTAL_BYTES} bytes`);
  total.value += bytes.byteLength;
  return { path: file, state: 'present', sha256: hash(bytes), bytes: bytes.byteLength };
}
async function validateSourceSnapshots(root, sources) {
  for (const source of sources) {
    const bytes = await regularBytes(resolve(root, source.path), `source ${source.path}`);
    strictText(bytes, `source ${source.path}`);
    assert(bytes.byteLength === source.bytes && hash(bytes) === source.sha256, `source changed during packet build: ${source.path}`);
  }
}
async function validateAllowedSnapshots(root, allowedFiles) {
  for (const entry of allowedFiles) {
    const absolute = resolve(root, entry.path);
    const state = await fs.lstat(absolute).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (entry.state === 'absent') {
      assert(state === null, `allowed file changed during packet build: ${entry.path}`);
      continue;
    }
    assert(state !== null, `allowed file changed during packet build: ${entry.path}`);
    const bytes = await regularBytes(absolute, `allowed file ${entry.path}`);
    assert(bytes.byteLength === entry.bytes && hash(bytes) === entry.sha256, `allowed file changed during packet build: ${entry.path}`);
  }
}

export async function buildPacketFromSpec({ root: rootInput, spec: specInput }) {
  const rootInfo = await canonicalRoot(rootInput);
  const root = rootInfo.root;
  const spec = parseSpec(serialize(specInput));
  const head = await gitHead(root);
  const policy = await NavigationPolicy.load(root);
  const scopes = new Map([['', policy.rootDirectoryScope()]]);
  const total = { value: 0, excerptBytes: 0 };
  const sources = [];
  for (const entry of spec.sources) sources.push(await readSource(root, entry, policy, scopes, total));
  const allowedFiles = [];
  for (const file of spec.allowedFiles) allowedFiles.push(await allowedState(root, file, policy, scopes, total));
  const initialManifest = await validatePolicy(root, spec, policy);
  await validateSourceSnapshots(root, sources);
  await validateAllowedSnapshots(root, allowedFiles);
  const finalPolicy = await NavigationPolicy.load(root);
  const finalManifest = await validatePolicy(root, spec, finalPolicy);
  assert(serialize(initialManifest) === serialize(finalManifest), 'navigation policy changed during packet build');
  assert(await gitHead(root) === head, 'git HEAD changed during packet build');
  const finalRootInfo = await canonicalRoot(rootInput);
  assert(finalRootInfo.root === root && finalRootInfo.identity.dev === rootInfo.identity.dev && finalRootInfo.identity.ino === rootInfo.identity.ino, 'explicit root changed during packet build');
  const packet = {
    version: 1, canonicalRoot: root, rootIdentity: rootInfo.identity, gitHEAD: head, trust: 'unsigned',
    originalSpec: spec, policy: { manifest: finalManifest, policyDigest: hash(Buffer.from(serialize(finalManifest), 'utf8')), summary: finalPolicy.summary() },
    sources: sources.sort((a, b) => compare(a.path, b.path) || a.startLine - b.startLine || a.endLine - b.endLine), allowedFiles: allowedFiles.sort((a, b) => compare(a.path, b.path)),
    sufficiencyCaveat: 'This unsigned packet contains only requested excerpts. Rebuild it if relevant source or policy changes. gitHEAD records commit provenance only and does not prove a clean working tree. It does not authorise inference, network access, shell execution, or edits outside allowedFiles.'
  };
  const json = serialize(packet);
  assert(Buffer.byteLength(json, 'utf8') <= MAX_PACKET_BYTES, `packet exceeds ${MAX_PACKET_BYTES} bytes`);
  return packet;
}

export async function buildPacket({ root: rootInput, spec: specInput }) {
  assert(typeof specInput === 'string' && isAbsolute(specInput), 'spec must be an absolute path');
  const specBytes = await regularBytes(specInput, 'spec', MAX_SPEC_BYTES);
  return buildPacketFromSpec({ root: rootInput, spec: parseSpec(strictText(specBytes, 'spec')) });
}

function parsePacket(text) {
  let packet;
  try { packet = JSON.parse(text); } catch { throw new Error('worker-packet: packet is not valid JSON'); }
  assert(packet && typeof packet === 'object' && !Array.isArray(packet), 'packet must be an object');
  assert(Object.prototype.hasOwnProperty.call(packet, 'originalSpec'), 'packet has no originalSpec');
  return packet;
}

export async function verifyPacket({ root: rootInput, packet: packetInput }) {
  assert(typeof rootInput === 'string' && isAbsolute(rootInput), 'root must be an absolute path');
  assert(typeof packetInput === 'string' && isAbsolute(packetInput), 'packet must be an absolute path');
  const packetBytes = await regularBytes(packetInput, 'packet', MAX_PACKET_BYTES);
  const packet = parsePacket(strictText(packetBytes, 'packet'));
  const rebuilt = await buildPacketFromSpec({ root: rootInput, spec: packet.originalSpec });
  assert(serialize(packet) === serialize(rebuilt), 'packet is stale or has been tampered with');
  return { status: 'current' };
}

async function writePrivateExclusive(output, packet) {
  assert(typeof output === 'string' && isAbsolute(output), 'out must be an absolute path');
  const parent = dirname(output);
  const parentState = await fs.lstat(parent).catch(() => { throw new Error('worker-packet: output parent does not exist'); });
  assert(parentState.isDirectory() && !parentState.isSymbolicLink(), 'output parent must be a non-symlink directory');
  const handle = await fs.open(output, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW, 0o600).catch((error) => { throw new Error(`worker-packet: cannot create output exclusively: ${error.code ?? error.message}`); });
  try { await handle.writeFile(serialize(packet), 'utf8'); await handle.chmod(0o600); } finally { await handle.close(); }
}
function usage() { return `Usage: node scripts/worker-packet.mjs build --root ABS --spec ABS --out ABS\nUsage: node scripts/worker-packet.mjs verify --root ABS --packet ABS\n`; }
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return process.stdout.write(usage());
  if (args[0] === 'build') {
    assert(args.length === 7 && args[1] === '--root' && args[3] === '--spec' && args[5] === '--out', usage().trim());
    const values = Object.fromEntries([[args[1], args[2]], [args[3], args[4]], [args[5], args[6]]]);
    const packet = await buildPacket({ root: values['--root'], spec: values['--spec'] });
    await writePrivateExclusive(values['--out'], packet);
    process.stdout.write(JSON.stringify({ version: packet.version, gitHEAD: packet.gitHEAD, sources: packet.sources.length, allowedFiles: packet.allowedFiles.length, bytes: Buffer.byteLength(serialize(packet), 'utf8'), out: values['--out'] }) + '\n');
    return;
  }
  assert(args[0] === 'verify' && args.length === 5 && args[1] === '--root' && args[3] === '--packet', usage().trim());
  const result = await verifyPacket({ root: args[2], packet: args[4] });
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
