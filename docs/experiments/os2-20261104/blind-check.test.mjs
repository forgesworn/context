import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { coverage, schemaErrors } from './blind-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = process.env.OS2_CONTEXT_CLI

test('schema errors name the broken fields only', () => {
  const task = { id: 't', class: 'code-change' }
  const ok = { id: 't', sourceChange: 'a'.repeat(40), requiredEvidence: [{ path: 'a', startLine: 1, endLine: 2 }], dependencySet: [{ path: 'a' }], checker: { command: 'x', testFiles: ['t'] } }
  assert.deepEqual(schemaErrors(task, ok), [])
  assert.deepEqual(schemaErrors(task, { ...ok, requiredEvidence: [{ path: 'a', startLine: 3, endLine: 2 }] }), ['requiredEvidence'])
  assert.deepEqual(schemaErrors(task, { ...ok, checker: { command: ' ', testFiles: [] } }), ['checker.command', 'checker.testFiles'])
  assert.deepEqual(schemaErrors({ id: 't', class: 'orientation' }, { ...ok, sourceChange: null, checker: {} }), [])
  assert.equal(schemaErrors(task, null).length, 6)
})

test('coverage needs a returned range containing each required range, capped at end of file', () => {
  const req = [{ path: 'a', startLine: 5, endLine: 9 }, { path: 'b', startLine: 1, endLine: 50 }]
  assert.deepEqual(coverage(req, [{ path: 'a', startLine: 1, endLine: 9 }, { path: 'b', startLine: 1, endLine: 30 }], { b: 30 }), { required: 2, covered: 2, pastEnd: 1 })
  assert.deepEqual(coverage(req, [{ path: 'a', startLine: 6, endLine: 9 }]), { required: 2, covered: 0, pastEnd: 0 })
})

function fixture() {
  const d = mkdtempSync(join(tmpdir(), 'os2-blind-'))
  const repo = join(d, 'repos', 'r'); mkdirSync(repo, { recursive: true })
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).trim()
  git('init', '-q')
  writeFileSync(join(repo, 'src.ts'), 'line one\nbuggy\nline three\n')
  git('add', '.'); git('commit', '-qm', 'base')
  const base = git('rev-parse', 'HEAD')
  writeFileSync(join(repo, 'src.ts'), 'line one\nfixed\nline three\n'); writeFileSync(join(repo, 'check.test.txt'), 'expects fixed\n')
  git('add', '.'); git('commit', '-qm', 'fix')
  const change = git('rev-parse', 'HEAD')
  const tasks = join(d, 'tasks'), acc = join(d, 'acc'); mkdirSync(tasks); mkdirSync(acc)
  writeFileSync(join(tasks, 'r-diagnosis.json'), JSON.stringify({ id: 'r-diagnosis', repository: 'r', class: 'diagnosis', baseCommit: base }))
  writeFileSync(join(acc, 'r-diagnosis.json'), JSON.stringify({ id: 'r-diagnosis', sourceChange: change,
    requiredEvidence: [{ path: 'src.ts', startLine: 2, endLine: 2, why: 'SECRET-WHY' }], dependencySet: [{ path: 'src.ts', symbol: 'SECRET-SYMBOL' }],
    checker: { setup: 'true', command: 'test -f check.test.txt && grep -q fixed src.ts', testFiles: ['check.test.txt'] } }))
  return { d, tasks, acc, repos: join(d, 'repos') }
}

test('freeze: archives the base, and the checker fails at base and passes with the change; stdout stays blind', () => {
  const f = fixture()
  try {
    const out = join(f.d, 'out')
    const stdout = execFileSync(process.execPath, [join(HERE, 'blind-check.mjs'), 'freeze', '--tasks', f.tasks, '--acceptance', f.acc, '--repos', f.repos, '--out', out], { encoding: 'utf8' })
    const row = JSON.parse(stdout.trim())
    assert.equal(row.schemaErrors, 0)
    assert.equal(row.failsAtBase, true)
    assert.equal(row.passesWithChange, true)
    assert.equal(row.checkerDiscriminates, true)
    assert.equal(row.evidenceValidAtBase, '1/1')
    assert.match(row.archiveSha256, /^[0-9a-f]{64}$/)
    for (const secret of ['src.ts', 'SECRET', 'grep', 'check.test']) assert.ok(!stdout.includes(secret), secret)
    assert.ok(readFileSync(join(out, 'detail.json'), 'utf8').length > 0)
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})

test('packets: one bounded packet covers the required range; stdout stays blind', { skip: !CLI && 'set OS2_CONTEXT_CLI to the 0.26.0 encrypted-context.mjs' }, () => {
  const f = fixture()
  try {
    const out = join(f.d, 'out')
    const stdout = execFileSync(process.execPath, [join(HERE, 'blind-check.mjs'), 'packets', '--tasks', f.tasks, '--acceptance', f.acc, '--repos', f.repos, '--out', out, '--cli', CLI], { encoding: 'utf8' })
    const row = JSON.parse(stdout.trim())
    assert.equal(row.sufficient, true)
    assert.equal(row.covered, 1)
    assert.ok(row.packetBytes > 0)
    for (const secret of ['src.ts', 'SECRET']) assert.ok(!stdout.includes(secret), secret)
    assert.ok(existsSync(join(out, 'summary.json')))
  } finally { rmSync(f.d, { recursive: true, force: true }) }
})
