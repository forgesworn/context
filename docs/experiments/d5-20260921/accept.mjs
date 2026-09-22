#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pairIds = new Set([
  'orientation-context', 'diagnosis-context', 'impact-context', 'code-change-context',
  'orientation-kithmoot', 'diagnosis-kithmoot', 'impact-kithmoot', 'code-change-kithmoot',
])
function args() { const out = {}; for (let i = 2; i < process.argv.length; i += 2) out[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]; return out }
function fail(message) { throw new Error(message) }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function inside(root, path) { const rel = relative(root, path); return rel !== '' && rel !== '..' && !rel.startsWith(`..${String.fromCharCode(47)}`) && !rel.startsWith(`..${String.fromCharCode(92)}`) && !isAbsolute(rel) }
function run(command, values, cwd) { const r = spawnSync(command, values, { cwd, encoding: 'utf8' }); if (r.status !== 0) fail(`${command} ${values.join(' ')} failed\n${r.stdout}\n${r.stderr}`); return r.stdout }
function checkWorkspace(workspace, task) {
  const local = JSON.parse(readFileSync(join(workspace, '.d5-task.json'), 'utf8'))
  if (local.id !== task.id || local.revision !== task.revision) fail('workspace task marker mismatch')
}
export function checkStructuredAnswer(answer, task, acceptance, readSource) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) || Object.keys(answer).sort().join() !== 'evidence,findings,summary') fail('answer schema mismatch')
  if (typeof answer.summary !== 'string' || !answer.summary.trim() || answer.summary.length > 8_000 || !Array.isArray(answer.findings) || !Array.isArray(answer.evidence)) fail('answer schema mismatch')
  if (answer.findings.length === 0 || answer.evidence.length === 0) fail('answer must include findings and evidence')
  const findingIds = new Set()
  for (const finding of answer.findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding) || Object.keys(finding).sort().join() !== 'id,value' || typeof finding.id !== 'string' || !finding.id.trim() || finding.id.length > 128 || typeof finding.value !== 'string' || !finding.value.trim() || finding.value.length > 4_000 || findingIds.has(finding.id)) fail('findings must have unique nonblank IDs and values')
    findingIds.add(finding.id)
  }
  const requiredIds = task?.requiredFindingIds ?? acceptance?.publicRequiredFindingIds
  if (requiredIds && (!Array.isArray(requiredIds) || requiredIds.length === 0 || requiredIds.some(id => typeof id !== 'string') || [...findingIds].sort().join() !== [...requiredIds].sort().join())) fail('finding IDs must match the public task dimensions')
  for (const evidence of answer.evidence) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || Object.keys(evidence).sort().join() !== 'path,token' || typeof evidence.path !== 'string' || !evidence.path.trim() || typeof evidence.token !== 'string' || !evidence.token.trim() || evidence.path.length > 1_024 || evidence.token.length > 1_024) fail('evidence must contain a nonblank path and token')
    let source
    try { source = readSource(evidence.path) } catch { fail(`evidence source unreadable: ${evidence.path}`) }
    if (typeof source !== 'string' || !source.includes(evidence.token)) fail(`evidence token not found in frozen source: ${evidence.path}`)
  }
}
function checkStructured(workspace, task, acceptance, answerPath) {
  if (!answerPath || !inside(workspace, answerPath)) fail('answer must be a file inside the arm workspace')
  if (!lstatSync(answerPath).isFile()) fail('answer must be a regular file inside the arm workspace')
  const answer = JSON.parse(readFileSync(answerPath, 'utf8'))
  const prepared = JSON.parse(readFileSync(join(workspace, '.d5-prepared.json'), 'utf8'))
  if (prepared.pair !== task.id || prepared.sourceRevision !== task.revision || !prepared.sourceHashes || typeof prepared.sourceHashes !== 'object') fail('workspace preparation manifest mismatch')
  checkStructuredAnswer(answer, task, acceptance, (path) => {
    if (!Object.hasOwn(prepared.sourceHashes, path)) fail(`evidence path is not frozen source: ${path}`)
    const source = resolve(workspace, path)
    if (!inside(workspace, source)) fail(`evidence path outside workspace: ${path}`)
    if (!lstatSync(source).isFile()) fail(`evidence source is not a regular file: ${path}`)
    const bytes = readFileSync(source)
    if (sha(bytes) !== prepared.sourceHashes[path]) fail(`frozen source hash mismatch: ${path}`)
    return bytes.toString('utf8')
  })
  for (const [path, hash] of Object.entries(prepared.sourceHashes)) {
    const source = resolve(workspace, path)
    if (!inside(workspace, source) || !lstatSync(source).isFile() || sha(readFileSync(source)) !== hash) fail(`frozen source hash mismatch: ${path}`)
  }
  run('git', ['diff', '--quiet'], workspace)
  run('git', ['diff', '--cached', '--quiet'], workspace)
  const changed = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], workspace).split('\0').filter(Boolean)
  const answerRel = relative(workspace, answerPath)
  if (changed.length !== 1 || changed[0] !== answerRel) fail(`read-only task changed frozen source: ${changed.join(', ')}`)
}
async function checkContextCode(workspace) {
  run('npm', ['run', 'build'], workspace)
  run('npm', ['test', '--workspace', '@forgesworn/context-tools', '--', '--run'], workspace)
  const fixture = mkdtempSync(join(tmpdir(), 'd5-context-check-'))
  try {
    const { RepositoryNavigation } = await import(pathToFileURL(join(workspace, 'packages/context-tools/dist/repository-navigation.js')).href + `?d5=${Date.now()}`)
    writeFileSync(join(fixture, 'a.ts'), `shared short\n${'x'.repeat(1_500)} shared\n`, 'utf8')
    const nav = new RepositoryNavigation(fixture)
    await nav.refresh()
    const first = await nav.search({ term: 'shared', maxResults: 1, maxBytes: 4096 })
    assert.ok(first.nextCursor)
    await assert.rejects(nav.search({ term: 'shared', cursor: first.nextCursor, maxBytes: 1024 }), /maxBytes/)
    const continued = await nav.search({ term: 'shared', cursor: first.nextCursor, maxBytes: 4096 })
    assert.ok(continued.results.length > 0)
    await assert.rejects(nav.search({ term: 'shared', cursor: first.nextCursor, maxBytes: 4096 }), /consumed|unknown or expired/)
  } finally { rmSync(fixture, { recursive: true, force: true }) }
}
async function checkKithmootCode(workspace) {
  run('npm', ['run', 'build:lib'], workspace)
  run('npx', ['vitest', 'run', 'src/log-redact.test.ts', 'test/log-redaction-scan.test.ts'], workspace)
  const { shortId } = await import(pathToFileURL(join(workspace, 'dist/src/log-redact.js')).href + `?d5=${Date.now()}`)
  const valid = 'ab'.repeat(32)
  if (shortId(valid) !== 'abababab') fail('valid canonical identifier was not abbreviated')
  for (const invalid of ['', 'abcd', valid + 'a', valid.toUpperCase(), valid + '\n', valid + '\r\n', 'g'.repeat(64), '💥'.repeat(32)]) {
    const result = shortId(invalid)
    if (result !== '[invalid-id]') fail('invalid identifier was not replaced by the fixed marker')
  }
  for (const [path, token] of [['server/forwarder.mjs', 'shortId(config.roomId)'], ['server/forwarder.mjs', 'shortId(config.pubkey)']]) if (!readFileSync(join(workspace, path), 'utf8').includes(token)) fail(`missing caller guard ${token}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const a = args(), workspace = resolve(a.workspace ?? '')
  if (!a.pair || !a.workspace) fail('usage: --pair ID --workspace PATH [--answer PATH]')
  if (!pairIds.has(a.pair)) fail(`unknown locked pair: ${a.pair}`)
  const task = JSON.parse(readFileSync(join(here, 'tasks', `${a.pair}.json`), 'utf8'))
  const acceptance = JSON.parse(readFileSync(join(here, 'acceptance', `${a.pair}.json`), 'utf8'))
  checkWorkspace(workspace, task)
  if (acceptance.kind === 'structured') checkStructured(workspace, task, acceptance, a.answer ? resolve(a.answer) : undefined)
  else if (a.pair === 'code-change-context') await checkContextCode(workspace)
  else if (a.pair === 'code-change-kithmoot') await checkKithmootCode(workspace)
  else fail('unknown code checker')
  process.stdout.write(JSON.stringify({ pair: a.pair, deterministicAccepted: true, accepted: false, reviewerRequired: true }) + '\n')
}
