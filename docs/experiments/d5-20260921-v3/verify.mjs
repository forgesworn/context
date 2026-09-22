#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const sourceRoot = process.argv[2]
if (!sourceRoot) throw new Error('usage: node verify.mjs CONTEXT_ROOT [--locked]')
if (process.argv.includes('--locked')) {
  const lock = json(join(here, 'lock.json'))
  assert.equal(lock.experimentId, 'd5-orientation-context-20260921-v3')
  assert.equal(lock.reviewAccepted, true)
  assert.ok(Number.isFinite(Date.parse(lock.lockedAt)))
  const required = ['toolchain.json', 'REVIEW.md', 'README.md', 'task.json', 'review-rubric.json', 'prepare.mjs', 'public-check.mjs', 'public-check.test.mjs', 'run-pair.py', 'run-pair.test.py', 'verify.mjs', '../d5-20260921/prepare-arm.mjs', '../d5-20260921/accept.mjs', '../d5-20260921/tasks/orientation-context.json', '../d5-20260921/acceptance/orientation-context.json']
  assert.deepEqual(Object.keys(lock.files).sort(), required.sort())
  for (const [path, hash] of Object.entries(lock.files)) {
    const file = join(here, path)
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), path)
    assert.equal(sha(readFileSync(file)), hash, path)
  }
}
execFileSync(process.execPath, ['--test', join(here, 'public-check.test.mjs')], { stdio: 'pipe' })
execFileSync('python3', [join(here, 'run-pair.test.py')], { stdio: 'pipe' })
const scratch = mkdtempSync(join(tmpdir(), 'd5-v2-verify-'))
try {
  const task = json(join(here, 'task.json'))
  const rubric = json(join(here, 'review-rubric.json'))
  assert.deepEqual(Object.keys(task.publicDimensions).sort(), task.requiredFindingIds.toSorted())
  assert.deepEqual(Object.keys(rubric.dimensions).sort(), task.requiredFindingIds.toSorted())
  const acceptance = json(join(here, '../d5-20260921/acceptance/orientation-context.json'))
  for (const arm of ['baseline', 'assisted']) {
    const workspace = join(scratch, arm)
    execFileSync(process.execPath, [join(here, 'prepare.mjs'), '--source-root', resolve(sourceRoot), '--output', workspace, '--arm', arm])
    assert.deepEqual(json(join(workspace, '.d5-task.json')), task)
    assert.equal(sha(readFileSync(join(workspace, '.d5-public-check.mjs'))), sha(readFileSync(join(here, 'public-check.mjs'))))
    const answer = { summary: 'Deterministic fixture only; never an inference result.', findings: Object.entries(rubric.dimensions).map(([id, value]) => ({ id, value })), evidence: acceptance.requiredEvidence }
    const answerPath = join(workspace, 'answer.json')
    writeFileSync(answerPath, JSON.stringify(answer))
    execFileSync(process.execPath, [join(workspace, '.d5-public-check.mjs'), '--workspace', workspace, '--answer', answerPath])
    execFileSync(process.execPath, [join(here, '../d5-20260921/accept.mjs'), '--pair', task.id, '--workspace', workspace, '--answer', answerPath])
    // Different valid citations must pass; hidden example tokens are not requirements.
    answer.evidence = [
      { path: 'packages/context-tools/src/repository-navigation.ts', token: 'export class RepositoryNavigation' },
      { path: 'packages/context-tools/src/repository-navigation.test.ts', token: "from 'vitest'" },
    ]
    writeFileSync(answerPath, JSON.stringify(answer))
    execFileSync(process.execPath, [join(workspace, '.d5-public-check.mjs'), '--workspace', workspace, '--answer', answerPath])
    execFileSync(process.execPath, [join(here, '../d5-20260921/accept.mjs'), '--pair', task.id, '--workspace', workspace, '--answer', answerPath])
    answer.evidence[0].token = '__not_frozen_source__'
    writeFileSync(answerPath, JSON.stringify(answer))
    assert.throws(() => execFileSync(process.execPath, [join(workspace, '.d5-public-check.mjs'), '--workspace', workspace, '--answer', answerPath], { stdio: 'pipe' }))
  }
  console.log(JSON.stringify({ verified: true, preparedArms: 2, positiveAndNegativeCitationChecks: true, fullPublicTaskPreserved: true, locked: process.argv.includes('--locked') }))
} finally { rmSync(scratch, { recursive: true, force: true }) }
