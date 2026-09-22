#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

function fail(message) { throw new Error(message) }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex') }

function literalRepositoryPath(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.includes('\\')) return false
  const parts = path.split('/')
  return parts.every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'))
}

function inside(root, target) {
  const rel = relative(root, target)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function regularFileWithoutSymlinks(root, path) {
  const rel = relative(root, path)
  if (!inside(root, path) || !literalRepositoryPath(rel)) fail('file must be inside workspace without symlinks')
  let current = root
  for (const part of rel.split('/')) {
    current = join(current, part)
    if (lstatSync(current).isSymbolicLink()) fail('file path contains a symlink')
  }
  if (!lstatSync(path).isFile()) fail('file must be a regular file')
}

function selected(path, policy) {
  const include = policy?.include
  const exclude = policy?.exclude ?? []
  if (!Array.isArray(include) || !Array.isArray(exclude)) fail('task selection policy mismatch')
  const matches = entry => typeof entry === 'string' && literalRepositoryPath(entry) && (path === entry || path.startsWith(`${entry}/`))
  return include.some(matches) && !exclude.some(matches)
}

export function checkAnswer(answer, task, readSource) {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer) || Object.keys(answer).sort().join() !== 'evidence,findings,summary') fail('answer schema mismatch')
  if (typeof answer.summary !== 'string' || !answer.summary.trim() || answer.summary.length > 8_000 || !Array.isArray(answer.findings) || !Array.isArray(answer.evidence)) fail('answer schema mismatch')
  if (answer.findings.length === 0 || answer.evidence.length === 0) fail('answer must include findings and evidence')
  const findingIds = new Set()
  for (const finding of answer.findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding) || Object.keys(finding).sort().join() !== 'id,value' || typeof finding.id !== 'string' || !finding.id.trim() || finding.id.length > 128 || typeof finding.value !== 'string' || !finding.value.trim() || finding.value.length > 4_000 || findingIds.has(finding.id)) fail('findings must have unique nonblank IDs and values')
    findingIds.add(finding.id)
  }
  const requiredIds = task?.requiredFindingIds
  if (requiredIds && (!Array.isArray(requiredIds) || requiredIds.length === 0 || requiredIds.some(id => typeof id !== 'string') || [...findingIds].sort().join() !== [...requiredIds].sort().join())) fail('finding IDs must match the public task dimensions')
  let implementation = false
  let focusedTest = false
  for (const evidence of answer.evidence) {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || Object.keys(evidence).sort().join() !== 'path,token' || typeof evidence.path !== 'string' || !evidence.path.trim() || typeof evidence.token !== 'string' || !evidence.token.trim() || evidence.path.length > 1_024 || evidence.token.length > 1_024) fail('evidence must contain a nonblank path and token')
    if (!literalRepositoryPath(evidence.path) || !selected(evidence.path, task?.selectionPolicy)) fail(`evidence path is outside public selection: ${evidence.path}`)
    let source
    try { source = readSource(evidence.path) } catch { fail(`evidence source unreadable: ${evidence.path}`) }
    if (typeof source !== 'string' || !source.includes(evidence.token)) fail(`evidence token not found in frozen source: ${evidence.path}`)
    implementation ||= evidence.path.endsWith('.ts') && !evidence.path.endsWith('.test.ts')
    focusedTest ||= evidence.path.endsWith('.test.ts')
  }
  if (!implementation || !focusedTest) fail('evidence must cite an implementation and focused test')
  return { deterministicAccepted: true, accepted: false, reviewerRequired: true }
}

function args(values) {
  const out = {}
  for (let index = 2; index < values.length; index += 2) out[values[index]?.replace(/^--/, '')] = values[index + 1]
  return out
}

function checkWorkspace(workspace, task) {
  const marker = JSON.parse(readFileSync(join(workspace, '.d5-task.json'), 'utf8'))
  if (marker.id !== task.id || marker.revision !== task.revision) fail('workspace task marker mismatch')
}

export function checkWorkspaceAnswer(workspace, answerPath) {
  if (!isAbsolute(workspace) || !isAbsolute(answerPath)) fail('workspace and answer must be absolute paths')
  const root = resolve(workspace)
  if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) fail('workspace must be a real directory')
  const answer = resolve(answerPath)
  regularFileWithoutSymlinks(root, answer)
  const task = JSON.parse(readFileSync(join(root, '.d5-task.json'), 'utf8'))
  const prepared = JSON.parse(readFileSync(join(root, '.d5-prepared.json'), 'utf8'))
  checkWorkspace(root, task)
  if (prepared.pair !== task.id || prepared.sourceRevision !== task.revision || !prepared.sourceHashes || typeof prepared.sourceHashes !== 'object') fail('workspace preparation manifest mismatch')
  const result = checkAnswer(JSON.parse(readFileSync(answer, 'utf8')), task, path => {
    if (!Object.hasOwn(prepared.sourceHashes, path)) fail(`evidence path is not frozen source: ${path}`)
    const source = resolve(root, path)
    regularFileWithoutSymlinks(root, source)
    const bytes = readFileSync(source)
    if (sha(bytes) !== prepared.sourceHashes[path]) fail(`frozen source hash mismatch: ${path}`)
    return bytes.toString('utf8')
  })
  return result
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    const values = args(process.argv)
    process.stdout.write(`${JSON.stringify(checkWorkspaceAnswer(values.workspace, values.answer))}\n`)
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ deterministicAccepted: false, accepted: false, reviewerRequired: true, error: error.message })}\n`)
    process.exitCode = 1
  }
}
