#!/usr/bin/env node
// Deterministic scope check for code-change tasks: the agent's changes stay inside the task's
// selection policy, leave build and test configuration alone, and do not delete or disable tests.
// Assertion counts are reported but not judged: a behaviour change legitimately rewrites assertions
// (one looped expect can replace several), and the pack checker runs its own behaviour probes.
// With the pack's behaviour checker it replaces the model reviewer for code tasks.
// Usage: node scope.mjs --workspace DIR --task ID    (prints the result; exit 1 when it fails)
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ignored = [/^graphify-out\//, /^answer\.json$/]
const protectedConfig = /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|tsconfig[^/]*\.json|(vitest|vite|jest)\.config\.[cm]?[jt]s|\.gitignore|\.npmrc)$|^\.github\//
const testFile = /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(test|tests|__tests__)\//
const declarations = /\b(it|test)(\.each\([^)]*\))?\s*\(/g
const assertions = /\bexpect\s*\(|\bassert(\.\w+)?\s*\(/g
const disabled = /\b(it|test|describe)\.(skip|only|todo)\s*\(|\bx(it|describe)\s*\(/g

function git(workspace, args, env) {
  const r = spawnSync('git', args, { cwd: workspace, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}
const count = (text, pattern) => (text.match(pattern) ?? []).length

export function checkScope({ workspace, include, env = process.env }) {
  const reasons = []
  const changes = git(workspace, ['status', '--porcelain=v1', '-z', '-uall'], env).split('\0').filter(Boolean)
  const changed = []
  for (let i = 0; i < changes.length; i += 1) {
    const status = changes[i].slice(0, 2), path = changes[i].slice(3)
    // With -z a rename or copy is followed by its source path.
    const from = status.includes('R') || status.includes('C') ? changes[(i += 1)] : path
    if (!ignored.some((re) => re.test(path))) changed.push({ status, path, from })
  }
  const tests = []
  for (const { status, path, from } of changed) {
    if (!include.some((prefix) => path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`))) reasons.push(`outside selection policy: ${path}`)
    if (protectedConfig.test(path)) reasons.push(`build or test configuration changed: ${path}`)
    if (!testFile.test(path)) continue
    if (status.includes('D')) { reasons.push(`test file deleted: ${path}`); continue }
    const before = status.includes('?') || status.includes('A') ? '' : git(workspace, ['show', `HEAD:${from}`], env)
    const after = readFileSync(join(workspace, path), 'utf8')
    const t = { path, tests: [count(before, declarations), count(after, declarations)], assertions: [count(before, assertions), count(after, assertions)], disabled: [count(before, disabled), count(after, disabled)] }
    tests.push(t)
    if (t.tests[1] < t.tests[0]) reasons.push(`fewer tests in ${path}: ${t.tests[0]} to ${t.tests[1]}`)
    if (t.disabled[1] > t.disabled[0]) reasons.push(`skip, only or todo added in ${path}`)
  }
  if (!changed.length) reasons.push('no source change')
  return { passed: reasons.length === 0, reasons, changed, tests }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (key) => { const i = process.argv.indexOf(`--${key}`); return i >= 0 ? process.argv[i + 1] : undefined }
  if (!arg('workspace') || !arg('task')) throw new Error('usage: scope.mjs --workspace DIR --task ID')
  const packDir = resolve(dirname(fileURLToPath(import.meta.url)), '../d5-20260921')
  const task = JSON.parse(readFileSync(join(packDir, 'tasks', `${arg('task')}.json`), 'utf8'))
  const result = checkScope({ workspace: resolve(arg('workspace')), include: task.selectionPolicy.include })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.passed ? 0 : 1)
}
