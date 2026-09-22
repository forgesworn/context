import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { checkAnswer } from './public-check.mjs'

const task = { id: 'd5', revision: 'r1', requiredFindingIds: ['orientation', 'diagnosis'], selectionPolicy: { include: ['src', 'test'], exclude: ['src/private'] } }
const sources = { 'src/example.ts': 'export const message = `first line\nsecond line`\n', 'test/example.test.ts': 'test(\'message\', () => {})\n' }
const good = () => ({ summary: 'Public provenance only.', findings: [{ id: 'orientation', value: 'one' }, { id: 'diagnosis', value: 'two' }], evidence: [{ path: 'src/example.ts', token: 'first line\nsecond line' }, { path: 'test/example.test.ts', token: "test('message'" }] })
const read = path => sources[path]

test('accepts exact multiline public tokens', () => { assert.ok(good().evidence[0].token.includes('\n')); assert.deepEqual(checkAnswer(good(), task, read), { deterministicAccepted: true, accepted: false, reviewerRequired: true }) })
test('rejects newline-collapsed tokens', () => { const answer = good(); answer.evidence[0].token = 'first line second line'; assert.throws(() => checkAnswer(answer, task, read)) })
test('rejects missing and duplicate findings', () => { const missing = good(); missing.findings.pop(); assert.throws(() => checkAnswer(missing, task, read)); const duplicate = good(); duplicate.findings[1].id = 'orientation'; assert.throws(() => checkAnswer(duplicate, task, read)) })
test('requires implementation and focused test citations', () => { const answer = good(); answer.evidence = [answer.evidence[0]]; assert.throws(() => checkAnswer(answer, task, read)); answer.evidence = [good().evidence[1]]; assert.throws(() => checkAnswer(answer, task, read)) })
test('rejects traversal, backslash and excluded paths', () => { const answer = good(); answer.evidence[0].path = '../src/example.ts'; assert.throws(() => checkAnswer(answer, task, read)); answer.evidence[0].path = 'src\\example.ts'; assert.throws(() => checkAnswer(answer, task, read)); answer.evidence[0].path = 'src/private/secret.ts'; assert.throws(() => checkAnswer(answer, task, read)) })

function digest(text) { return createHash('sha256').update(text).digest('hex') }
function fixture({ badHash = false, symlink = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'd5-public-check-'))
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'test'))
  for (const [path, content] of Object.entries(sources)) writeFileSync(join(root, path), content)
  if (symlink) { writeFileSync(join(root, 'outside.ts'), sources['src/example.ts']); rmSync(join(root, 'src/example.ts')); symlinkSync(join(root, 'outside.ts'), join(root, 'src/example.ts')) }
  writeFileSync(join(root, '.d5-task.json'), JSON.stringify(task))
  writeFileSync(join(root, '.d5-prepared.json'), JSON.stringify({ pair: 'd5', sourceRevision: 'r1', sourceHashes: Object.fromEntries(Object.entries(sources).map(([path, content]) => [path, badHash ? '0'.repeat(64) : digest(content)])) }))
  writeFileSync(join(root, 'answer.json'), JSON.stringify(good()))
  copyFileSync(join(here, 'public-check.mjs'), join(root, '.d5-public-check.mjs'))
  return root
}
const here = dirname(fileURLToPath(import.meta.url))
test('CLI resolves copied and symlinked entries and rejects failures as JSON', t => {
  const valid = fixture(); t.after(() => rmSync(valid, { recursive: true, force: true }))
  const copied = join(valid, '.d5-public-check.mjs')
  const successful = spawnSync(process.execPath, [copied, '--workspace', valid, '--answer', join(valid, 'answer.json')], { cwd: here, encoding: 'utf8' })
  assert.equal(successful.status, 0)
  assert.deepEqual(JSON.parse(successful.stdout), { deterministicAccepted: true, accepted: false, reviewerRequired: true })
  symlinkSync(copied, join(valid, 'entry-link.mjs'))
  const linked = spawnSync(process.execPath, [join(valid, 'entry-link.mjs'), '--workspace', valid, '--answer', join(valid, 'answer.json')], { cwd: here, encoding: 'utf8' })
  assert.equal(linked.status, 0)
  assert.deepEqual(JSON.parse(linked.stdout), { deterministicAccepted: true, accepted: false, reviewerRequired: true })
  const invalid = good(); invalid.evidence[0].token = 'first line second line'; writeFileSync(join(valid, 'answer.json'), JSON.stringify(invalid))
  const rejected = spawnSync(process.execPath, [copied, '--workspace', valid, '--answer', join(valid, 'answer.json')], { cwd: here, encoding: 'utf8' })
  assert.equal(rejected.status, 1)
  assert.equal(JSON.parse(rejected.stdout).deterministicAccepted, false)
 for (const options of [{ badHash: true }, { symlink: true }]) {
   const root = fixture(options); t.after(() => rmSync(root, { recursive: true, force: true }))
    const run = spawnSync(process.execPath, [join(root, '.d5-public-check.mjs'), '--workspace', root, '--answer', join(root, 'answer.json')], { cwd: here, encoding: 'utf8' })
    const result = JSON.parse(run.stdout); assert.equal(run.status, 1); assert.equal(result.deterministicAccepted, false); assert.equal(result.accepted, false); assert.equal(result.reviewerRequired, true)
  }
})
