#!/usr/bin/env node
/** Deterministic, source-only handoff packets for the D4 worker workflow. */
import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { NavigationPolicy } from './repository-navigation-policy.js';

const execFileAsync = promisify(execFile);
const MAX_SPEC_BYTES = 64 * 1024;
const MAX_PACKET_BYTES = 64 * 1024;
const MAX_FILES = 32;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'md']);
const PLANNABLE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs']);
const GENERATED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', 'vendor', 'target']);

function assert(ok, message) { if (!ok) throw new Error(`worker-packet: ${message}`); }
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, stable(value[key])]));
  return value;
}
export function serializePacket(value) { return JSON.stringify(stable(value)); }
const serialize = serializePacket;
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

export async function buildPacketInline({ root: rootInput, spec: specInput }) {
  const bytes = Buffer.from(serialize(specInput), 'utf8');
  assert(bytes.byteLength <= MAX_SPEC_BYTES, `spec exceeds ${MAX_SPEC_BYTES} bytes`);
  return buildPacketFromSpec({ root: rootInput, spec: parseSpec(strictText(bytes, 'spec')) });
}

function scriptKind(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX, mts: ts.ScriptKind.TS, cts: ts.ScriptKind.TS, mjs: ts.ScriptKind.JS, cjs: ts.ScriptKind.JS };
  assert(PLANNABLE_EXTENSIONS.has(ext), `planner source extension is unsupported: ${path}`);
  return kinds[ext];
}

function parsePlanSpec(text) {
  let spec;
  try { spec = JSON.parse(text); } catch { throw new Error('worker-packet: spec is not valid JSON'); }
  assert(spec && typeof spec === 'object' && !Array.isArray(spec), 'spec must be an object');
  const expected = ['acceptanceChecks', 'allowedFiles', 'exclusions', 'sources', 'task', 'unresolvedQuestions', 'version'];
  assert(Object.keys(spec).sort(compare).every((key, index) => key === expected[index]) && Object.keys(spec).length === expected.length, 'spec has unknown or missing fields');
  assert(Array.isArray(spec.sources) && spec.sources.length <= MAX_FILES, `sources are limited to ${MAX_FILES}`);
  const paths = new Set();
  for (const source of spec.sources) {
    assert(source && typeof source === 'object' && !Array.isArray(source), 'source must be an object');
    assert(Object.keys(source).sort(compare).join(',') === 'line,path', 'planner source has unknown or missing fields');
    const path = validRelativePath(source.path, 'source path');
    scriptKind(path);
    assert(Number.isSafeInteger(source.line) && source.line >= 1, `invalid anchor line for ${path}`);
    paths.add(path);
  }
  // Keep v1 metadata validation authoritative while allowing repeated anchors.
  parseSpec(serialize({ ...spec, sources: [...paths].map((path) => ({ path, startLine: 1, endLine: 1 })) }));
  return spec;
}

function lineOf(source, position) { return source.getLineAndCharacterOfPosition(position).line + 1; }
function candidateRange(source, node, kind, end = node.end) {
  const start = node.getStart(source, true);
  return { node, kind, start, end, startLine: lineOf(source, start), endLine: lineOf(source, Math.max(start, end - 1)) };
}
function plannerCandidates(source) {
  const candidates = [];
  const add = (node, kind, end) => candidates.push(candidateRange(source, node, kind, end));
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && node.body) {
      const end = ts.isObjectLiteralExpression(node.parent) && source.text[node.end] === ',' ? node.end + 1 : node.end;
      add(node, ts.isFunctionDeclaration(node) ? 'function' : 'method', end);
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent)) {
      const declaration = node.parent;
      const statement = declaration.parent?.parent;
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) add(statement, 'variable');
    }
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && (ts.isPropertyAssignment(node.parent) || ts.isPropertyDeclaration(node.parent))) {
      const property = node.parent;
      add(property, 'property', source.text[property.end] === ',' ? property.end + 1 : property.end);
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.arguments.some((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) add(node, 'callbackCall');
    ts.forEachChild(node, visit);
  };
  visit(source);
  return candidates;
}
function resolveAnchor(source, path, line) {
  assert(line <= source.getLineAndCharacterOfPosition(source.end).line + 1, `anchor line exceeds source length: ${path}`);
  const containing = source.__packetCandidates.filter((candidate) => line >= candidate.startLine && line <= candidate.endLine);
  assert(containing.length > 0, `no supported syntax block contains ${path}:${line}`);
  containing.sort((a, b) => (a.end - a.start) - (b.end - b.start) || a.start - b.start || compare(a.kind, b.kind));
  const chosen = containing[0];
  const sameSpan = containing.filter((candidate) => candidate !== chosen && candidate.end - candidate.start === chosen.end - chosen.start);
  assert(sameSpan.length === 0, `ambiguous syntax block at ${path}:${line}`);
  const sameLineSibling = containing.some((candidate) => candidate !== chosen && candidate.startLine === chosen.startLine && candidate.endLine === chosen.endLine);
  assert(!sameLineSibling, `ambiguous same-line syntax blocks at ${path}:${line}`);
  const starts = source.getLineStarts();
  const lineStart = starts[chosen.startLine - 1];
  const endLineEnd = chosen.endLine < starts.length ? starts[chosen.endLine] : source.end;
  const before = source.text.slice(lineStart, chosen.start).replace(/[;\s]/g, '');
  const after = source.text.slice(chosen.end, endLineEnd).replace(/[;\s]/g, '');
  assert(!before && !after, `selected syntax block shares a boundary line with other code: ${path}:${line}`);
  return chosen;
}
function mergePlanned(resolutions) {
  const sorted = [...resolutions].sort((a, b) => compare(a.path, b.path) || a.startLine - b.startLine || a.endLine - b.endLine);
  const merged = [];
  for (const resolution of sorted) {
    const last = merged.at(-1);
    if (last && last.path === resolution.path && resolution.startLine <= last.endLine + 1) last.endLine = Math.max(last.endLine, resolution.endLine);
    else merged.push({ path: resolution.path, startLine: resolution.startLine, endLine: resolution.endLine });
  }
  return merged;
}

export async function planPacket({ root: rootInput, spec: specInput }) {
  assert(typeof specInput === 'string' && isAbsolute(specInput), 'spec must be an absolute path');
  const planBytes = await regularBytes(specInput, 'spec', MAX_SPEC_BYTES);
  return planPacketInline({ root: rootInput, spec: parsePlanSpec(strictText(planBytes, 'spec')) });
}

export async function planPacketInline({ root: rootInput, spec: specInput }) {
  const specBytes = Buffer.from(serialize(specInput), 'utf8');
  assert(specBytes.byteLength <= MAX_SPEC_BYTES, `spec exceeds ${MAX_SPEC_BYTES} bytes`);
  const plan = parsePlanSpec(strictText(specBytes, 'spec'));
  const rootInfo = await canonicalRoot(rootInput);
  const root = rootInfo.root;
  const head = await gitHead(root);
  const policy = await NavigationPolicy.load(root);
  const planningSpec = { ...plan, sources: [...new Set(plan.sources.map((entry) => entry.path))].map((path) => ({ path, startLine: 1, endLine: 1 })) };
  const initialManifest = await validatePolicy(root, planningSpec, policy);
  const scopes = new Map([['', policy.rootDirectoryScope()]]);
  const total = { value: 0 };
  const files = new Map();
  for (const entry of plan.sources) {
    if (files.has(entry.path)) continue;
    const scope = await scopeFor(root, policy, entry.path, scopes);
    assert(policy.allows(entry.path, false, scope), `source is excluded by navigation policy: ${entry.path}`);
    const bytes = await regularBytes(resolve(root, entry.path), `source ${entry.path}`);
    assert(total.value + bytes.byteLength <= MAX_TOTAL_BYTES, `source aggregate exceeds ${MAX_TOTAL_BYTES} bytes`);
    total.value += bytes.byteLength;
    const text = strictText(bytes, `source ${entry.path}`);
    assert(!/\r(?!\n)|[\u2028\u2029]/.test(text), `planner source has line separators unsupported by v1 packet lines: ${entry.path}`);
    const source = ts.createSourceFile(entry.path, text, ts.ScriptTarget.Latest, true, scriptKind(entry.path));
    assert(source.parseDiagnostics.length === 0, `source has parse errors: ${entry.path}`);
    source.__packetCandidates = plannerCandidates(source);
    files.set(entry.path, { source, sha256: hash(bytes) });
  }
  const resolutions = plan.sources.map((entry, requestIndex) => {
    const file = files.get(entry.path);
    const selected = resolveAnchor(file.source, entry.path, entry.line);
    return { requestIndex, path: entry.path, line: entry.line, kind: selected.kind, startLine: selected.startLine, endLine: selected.endLine };
  });
  const mergedSources = mergePlanned(resolutions);
  const resolvedSpec = parseSpec(serialize({ ...plan, sources: mergedSources }));
  let packet;
  try { packet = await buildPacketFromSpec({ root, spec: resolvedSpec }); }
  catch (error) { throw new Error(`worker-packet: planner could not build selected syntax blocks: ${error.message.replace(/^worker-packet: /, '')}`); }
  for (const source of packet.sources) assert(files.get(source.path)?.sha256 === source.sha256, `source changed during packet planning: ${source.path}`);
  assert(packet.gitHEAD === head, 'git HEAD changed during packet planning');
  assert(packet.rootIdentity.dev === rootInfo.identity.dev && packet.rootIdentity.ino === rootInfo.identity.ino, 'explicit root changed during packet planning');
  assert(serialize(packet.policy.manifest) === serialize(initialManifest), 'navigation policy changed during packet planning');
  assert(await gitHead(root) === head, 'git HEAD changed during packet planning');
  const finalRoot = await canonicalRoot(rootInput);
  assert(finalRoot.root === root && finalRoot.identity.dev === rootInfo.identity.dev && finalRoot.identity.ino === rootInfo.identity.ino, 'explicit root changed during packet planning');
  const finalPolicy = await NavigationPolicy.load(root);
  const finalManifest = await validatePolicy(root, planningSpec, finalPolicy);
  assert(serialize(initialManifest) === serialize(finalManifest), 'navigation policy changed during packet planning');
  const coverage = { version: 1, trust: 'unsigned', packetSha256: hash(Buffer.from(serialize(packet), 'utf8')), requestedSources: plan.sources, resolutions, mergedSources, caveat: 'Selections are complete syntactic units only. They provide no dependency closure, semantic sufficiency, or authority; the caller explicitly selects tests and dependencies.' };
  return { packet, coverage };
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
function usage() { return `Usage: node scripts/worker-packet.mjs build --root ABS --spec ABS --out ABS\nUsage: node scripts/worker-packet.mjs plan --root ABS --spec ABS --out ABS\nUsage: node scripts/worker-packet.mjs verify --root ABS --packet ABS\n`; }
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
  if (args[0] === 'plan') {
    assert(args.length === 7 && args[1] === '--root' && args[3] === '--spec' && args[5] === '--out', usage().trim());
    const values = Object.fromEntries([[args[1], args[2]], [args[3], args[4]], [args[5], args[6]]]);
    const result = await planPacket({ root: values['--root'], spec: values['--spec'] });
    await writePrivateExclusive(values['--out'], result.packet);
    process.stdout.write(JSON.stringify({ version: result.packet.version, gitHEAD: result.packet.gitHEAD, sources: result.packet.sources.length, allowedFiles: result.packet.allowedFiles.length, bytes: Buffer.byteLength(serialize(result.packet), 'utf8'), out: values['--out'], coverage: result.coverage }) + '\n');
    return;
  }
  assert(args[0] === 'verify' && args.length === 5 && args[1] === '--root' && args[3] === '--packet', usage().trim());
  const result = await verifyPacket({ root: args[2], packet: args[4] });
  process.stdout.write(JSON.stringify(result) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
