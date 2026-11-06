import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classify } from './history-candidates.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const lines = n => Array.from({ length: n }, (_, i) => `export const v${i} = ${i}`).join('\n') + '\n'
const change = (subject, files) => ({ commit: 'c'.repeat(40), date: '2026-01-01', subject, files })

test('classification rules', () => {
  const good = [{ path: 'src/a.ts', lines: 30 }, { path: 'src/b.ts', lines: 10 }, { path: 'test/a.test.ts', lines: 20 }]
  assert.equal(classify(change('fix: handle empty body', good)), 'eligible')
  assert.equal(classify(change('chore(deps): bump x', good)), 'subject')
  assert.equal(classify(change('docs: explain', good)), 'subject')
  assert.equal(classify(change('fix: x', good.slice(1))), 'too-few-source-files')
  assert.equal(classify(change('fix: x', good.slice(0, 2))), 'no-tests')
  assert.equal(classify(change('fix: x', [{ path: 'src/a.ts', lines: 5 }, { path: 'src/b.ts', lines: 5 }, good[2]])), 'source-size')
  assert.equal(classify(change('fix: x', [{ path: 'src/a.ts', lines: 300 }, { path: 'src/b.ts', lines: 101 }, good[2]])), 'source-size')
  assert.equal(classify(change('fix: x', [good[0], { path: 'docs/a.ts', lines: 50 }, good[2]])), 'too-few-source-files')
  assert.equal(classify(change('fix: x', [good[0], { path: 'vitest.config.ts', lines: 9 }, good[2]])), 'too-few-source-files')
  assert.equal(classify(change('fix: x', [good[0], { path: 'src/a.test.ts', lines: 9 }, good[2]])), 'too-few-source-files')
  assert.equal(classify(change('fix: x', [...good, ...Array.from({ length: 18 }, (_, i) => ({ path: `x${i}.md`, lines: 1 }))])), 'too-many-files')
})

test('the CLI writes candidates privately and prints counts only, never commits or subjects', () => {
  const d = mkdtempSync(join(tmpdir(), 'os2-hist-'))
  try {
    const git = (...a) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' })
    git('init', '-q')
    mkdirSync(join(d, 'src')); mkdirSync(join(d, 'test'))
    writeFileSync(join(d, 'README.md'), 'x\n'); git('add', '.'); git('commit', '-qm', 'init')
    writeFileSync(join(d, 'src/a.ts'), lines(15)); writeFileSync(join(d, 'src/b.ts'), lines(10)); writeFileSync(join(d, 'test/a.test.ts'), lines(3))
    git('add', '.'); git('commit', '-qm', 'feat: secret-subject-one')
    writeFileSync(join(d, 'src/a.ts'), lines(40)); git('add', '.'); git('commit', '-qm', 'fix: only one file')
    const out = join(d, 'candidates.json')
    const stdout = execFileSync(process.execPath, [join(HERE, 'history-candidates.mjs'), '--repo', d, '--out', out, '--since', '2000-01-01'], { encoding: 'utf8' })
    const printed = JSON.parse(stdout)
    assert.equal(printed.scanned, 3)
    assert.equal(printed.eligible, 1)
    const secret = git('rev-parse', 'HEAD~1').trim()
    assert.ok(!stdout.includes('secret-subject'))
    for (const commit of git('rev-list', 'HEAD').trim().split('\n')) {
      if (commit !== printed.head) assert.ok(!stdout.includes(commit.slice(0, 7)), 'stdout must not name candidate commits')
    }
    const saved = JSON.parse(readFileSync(out, 'utf8'))
    assert.deepEqual(saved.eligible.map(e => e.commit), [secret])
    assert.throws(() => execFileSync(process.execPath, [join(HERE, 'history-candidates.mjs'), '--repo', d, '--out', out], { stdio: 'pipe' }))
  } finally { rmSync(d, { recursive: true, force: true }) }
})
