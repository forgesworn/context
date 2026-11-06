#!/usr/bin/env node
// OS2 phase 0 blind checks. Model-free. Reads the private acceptance files and
// prints only counts and pass/fail, never paths, ranges, symbols or commands, so
// the tool side stays blind to the hidden answers. Details go to a private --out.
//
//   freeze   archive each base commit, run the checker from a clean install, and
//            confirm the change's tests fail at base and pass with the change.
//   packets  ask the Context CLI for one bounded build packet holding every
//            required-evidence range of each task, and record its bytes.
//
// Acceptance schema (from the author brief): sourceChange, requiredEvidence
// [{path,startLine,endLine}], dependencySet [{path,symbol}], checker {setup,
// command, testFiles}. A file that does not match is counted as a schema error.

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const OFFLINE_PROFILE = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (remote unix-socket))'
const INSTALL = { bray: 'npm ci && npm run build', h3: 'pnpm install --frozen-lockfile' }
const LOCKFILES = /^(package\.json|package-lock\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/

export function schemaErrors(task, acc) {
  const errors = []
  const range = r => r && typeof r.path === 'string' && Number.isInteger(r.startLine) && Number.isInteger(r.endLine) && r.startLine >= 1 && r.endLine >= r.startLine
  if (acc?.id !== task.id) errors.push('id')
  if (!Array.isArray(acc?.requiredEvidence) || !acc.requiredEvidence.every(range)) errors.push('requiredEvidence')
  if (!Array.isArray(acc?.dependencySet) || !acc.dependencySet.every(d => typeof d?.path === 'string')) errors.push('dependencySet')
  const runs = task.class === 'code-change' || task.class === 'diagnosis'
  if (runs) {
    if (typeof acc?.sourceChange !== 'string' || !/^[0-9a-f]{40}$/.test(acc.sourceChange)) errors.push('sourceChange')
    if (typeof acc?.checker?.command !== 'string' || !acc.checker.command.trim()) errors.push('checker.command')
    if (!Array.isArray(acc?.checker?.testFiles) || !acc.checker.testFiles.length || !acc.checker.testFiles.every(f => typeof f === 'string')) errors.push('checker.testFiles')
  }
  return errors
}

/** Protocol v2 scope: {"allowedPaths": [non-empty glob, ...]}. */
export const scopeValid = acc => !!acc && typeof acc.scope === 'object' && acc.scope !== null && !Array.isArray(acc.scope) &&
  Array.isArray(acc.scope.allowedPaths) && acc.scope.allowedPaths.every(g => typeof g === 'string' && g.length > 0)

/** Is every required range inside some returned source range? Ranges past end of
 * file count as covered up to the file's last line, reported separately. */
export function coverage(required, returned, fileLines = {}) {
  let covered = 0, pastEnd = 0
  for (const r of required) {
    const end = fileLines[r.path] ? Math.min(r.endLine, fileLines[r.path]) : r.endLine
    if (end < r.endLine) pastEnd++
    if (returned.some(s => s.path === r.path && s.startLine <= r.startLine && s.endLine >= end)) covered++
  }
  return { required: required.length, covered, pastEnd }
}

function load(tasksDir, accDir) {
  const out = []
  for (const name of readdirSync(tasksDir).filter(n => n.endsWith('.json') && n !== 'manifest.json').sort()) {
    const task = JSON.parse(readFileSync(join(tasksDir, name), 'utf8'))
    let acc = null
    try { acc = JSON.parse(readFileSync(join(accDir, name), 'utf8')) } catch { /* counted below */ }
    out.push({ task, acc, schema: schemaErrors(task, acc) })
  }
  return out
}

const sha = buf => createHash('sha256').update(buf).digest('hex')
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
function sh(command, cwd, { offline = false, seconds = 1200 } = {}) {
  const argv = offline ? ['sandbox-exec', '-p', OFFLINE_PROFILE, '/bin/zsh', '-c', command] : ['/bin/zsh', '-c', command]
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', timeout: seconds * 1000, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status ?? (r.signal ? `signal ${r.signal}` : 'error'), tail: `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split('\n').slice(-40).join('\n') }
}
const linesAt = (repo, commit, path) => { try { return git(repo, 'show', `${commit}:${path}`).split('\n').length - 1 } catch { return null } }

function freeze({ tasks, accDir, repos, out }) {
  const detail = [], summary = []
  mkdirSync(join(out, 'archives'), { recursive: true }); mkdirSync(join(out, 'work'), { recursive: true })
  for (const { task, acc, schema } of load(tasks, accDir)) {
    const repo = join(repos, task.repository)
    const row = { id: task.id, class: task.class, schemaErrors: schema.length, scopeValid: scopeValid(acc) }
    const d = { id: task.id, schema }
    detail.push(d); summary.push(row)
    const archive = join(out, 'archives', `${task.id}.tar`)
    git(repo, 'archive', '--format=tar', '-o', archive, task.baseCommit)
    row.archiveSha256 = sha(readFileSync(archive))
    if (schema.length) continue
    const ev = acc.requiredEvidence.filter(r => { const n = linesAt(repo, task.baseCommit, r.path); return n !== null && r.endLine <= n })
    row.evidenceValidAtBase = `${ev.length}/${acc.requiredEvidence.length}`
    const deps = acc.dependencySet.filter(x => linesAt(repo, task.baseCommit, x.path) !== null)
    row.dependencyPathsAtBase = `${deps.length}/${acc.dependencySet.length}`
    if (task.class !== 'code-change' && task.class !== 'diagnosis') continue
    const wt = join(out, 'work', task.id)
    git(repo, 'worktree', 'add', '--detach', wt, task.baseCommit)
    let setup = sh(acc.checker.setup || INSTALL[task.repository], wt)
    row.authorSetupExit = setup.code
    if (setup.code !== 0) { setup = sh(INSTALL[task.repository], wt); row.fallbackInstallExit = setup.code }
    d.setupTail = setup.tail
    if (setup.code !== 0) continue
    execFileSync('git', ['-C', wt, 'checkout', acc.sourceChange, '--', ...acc.checker.testFiles])
    const atBase = sh(acc.checker.command, wt, { offline: true, seconds: 900 })
    row.failsAtBase = atBase.code !== 0
    d.atBaseTail = atBase.tail
    execFileSync('git', ['-C', wt, 'reset', '-q', '--hard']); execFileSync('git', ['-C', wt, 'clean', '-fdq'])
    const changed = git(repo, 'diff', '--name-only', task.baseCommit, acc.sourceChange).split('\n').filter(Boolean)
    execFileSync('git', ['-C', wt, 'checkout', '-q', '--detach', acc.sourceChange])
    row.reinstalled = changed.some(f => LOCKFILES.test(f))
    if (row.reinstalled) { const re = sh(acc.checker.setup || INSTALL[task.repository], wt); if (re.code !== 0) sh(INSTALL[task.repository], wt) }
    const withChange = sh(acc.checker.command, wt, { offline: true, seconds: 900 })
    row.passesWithChange = withChange.code === 0
    d.withChangeTail = withChange.tail
    row.checkerDiscriminates = row.failsAtBase && row.passesWithChange
  }
  return { summary, detail }
}

function connect(node, cli, root) {
  const p = spawn(node, [cli, 'connect', root], { stdio: ['pipe', 'pipe', 'ignore'] })
  let buf = '', next = 1
  const waiting = new Map(), ready = []
  p.stdout.on('data', chunk => {
    buf += chunk
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1)
      const m = JSON.parse(line)
      if (m.event === 'ready' || (m.id === undefined && ready.length)) { ready.shift()?.(m); continue }
      waiting.get(m.id)?.({ ...m, bytes: Buffer.byteLength(line) }); waiting.delete(m.id)
    }
  })
  const call = (name, args) => new Promise(resolve => { const id = next++; waiting.set(id, resolve); p.stdin.write(JSON.stringify({ id, name, arguments: args }) + '\n') })
  const exited = new Promise(r => p.on('exit', code => {
    // Fail every waiter rather than hang if the connection ends early.
    for (const resolve of waiting.values()) resolve({ isError: true, result: `connection exited (${code})`, bytes: 0 })
    waiting.clear()
    ready.shift()?.({ event: 'exited', code })
    r(code)
  }))
  // close answers with a {"event":"closed"} line that carries no id.
  const close = async () => { p.stdin.write(JSON.stringify({ id: next++, name: 'close' }) + '\n'); p.stdin.end(); await exited }
  return { ready: new Promise(r => ready.push(r)), call, close }
}

async function packets({ tasks, accDir, repos, out, node, cli, maxBytes }) {
  const summary = [], detail = []
  mkdirSync(join(out, 'work'), { recursive: true })
  for (const { task, acc, schema } of load(tasks, accDir)) {
    const row = { id: task.id, class: task.class, schemaErrors: schema.length, scopeValid: scopeValid(acc) }
    summary.push(row)
    if (schema.length) continue
    const repo = join(repos, task.repository)
    const wt = join(out, 'work', task.id)
    if (!existsSync(wt)) git(repo, 'worktree', 'add', '--detach', wt, task.baseCommit)
    const fileLines = Object.fromEntries(acc.requiredEvidence.map(r => [r.path, linesAt(repo, task.baseCommit, r.path)]))
    const c = connect(node, cli, realpathSync(wt))
    const hello = await c.ready
    if (hello.event !== 'ready') { row.failure = 'connection'; detail.push({ id: task.id, error: JSON.stringify(hello) }); continue }
    const gen = (await c.call('repository_refresh')).result.generation
    const required = acc.requiredEvidence.map(({ path, startLine, endLine }) => ({ path, startLine, endLine }))
    const returned = []
    let bytes = 0, failure = null
    for (let i = 0; i < required.length; i += 32) {
      const r = await c.call('repository_packet', { mode: 'build', expectedGeneration: gen, format: 'json', maxBytes, spec: { version: 1, sources: required.slice(i, i + 32) } })
      bytes += r.bytes
      if (r.isError) { const text = String(typeof r.result === 'string' ? r.result : JSON.stringify(r.result)); failure = /exceeds \d+ bytes/.test(text) ? 'oversize' : /ENOENT|cannot inspect/.test(text) ? 'missing-source' : /unsupported/.test(text) ? 'unsupported-source' : 'other'; detail.push({ id: task.id, error: text.slice(0, 2000) }); break }
      for (const s of r.result.packet.sources) returned.push({ path: s.path, startLine: s.startLine, endLine: s.endLine })
    }
    let singles = null
    if (failure) {
      singles = { covered: 0, oversize: 0, missing: 0, unsupported: 0, other: 0 }
      for (const src of required) {
        const r = await c.call('repository_packet', { mode: 'build', expectedGeneration: gen, format: 'json', maxBytes, spec: { version: 1, sources: [src] } })
        if (!r.isError) { singles.covered++; continue }
        const text = String(typeof r.result === 'string' ? r.result : JSON.stringify(r.result))
        singles[/exceeds \d+ bytes/.test(text) ? 'oversize' : /ENOENT|cannot inspect/.test(text) ? 'missing' : /unsupported/.test(text) ? 'unsupported' : 'other']++
      }
    }
    await c.close()
    const cov = coverage(required, returned, fileLines)
    Object.assign(row, { ranges: cov.required, covered: failure ? 0 : cov.covered, pastEnd: cov.pastEnd, packetBytes: bytes, failure, singles,
      sufficient: !failure && cov.covered === cov.required })
  }
  return { summary, detail }
}

async function main(argv) {
  const [cmd, ...rest] = argv
  const get = f => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : undefined }
  const opts = { tasks: get('--tasks'), accDir: get('--acceptance'), repos: get('--repos'), out: get('--out'), node: get('--node') ?? process.execPath, cli: get('--cli'), maxBytes: Number(get('--max-bytes') ?? 65536) }
  if (!['freeze', 'packets'].includes(cmd) || !opts.tasks || !opts.accDir || !opts.repos || !opts.out || !isAbsolute(opts.out) || existsSync(opts.out) || (cmd === 'packets' && !opts.cli)) {
    console.error('usage: blind-check.mjs freeze|packets --tasks DIR --acceptance DIR --repos DIR --out NEW_ABS_DIR [--cli ABS --node ABS --max-bytes N]')
    return 2
  }
  mkdirSync(opts.out, { recursive: true, mode: 0o700 })
  const { summary, detail } = cmd === 'freeze' ? freeze(opts) : await packets(opts)
  writeFileSync(join(opts.out, 'detail.json'), JSON.stringify(detail, null, 2) + '\n', { mode: 0o600 })
  writeFileSync(join(opts.out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
  for (const row of summary) console.log(JSON.stringify(row))
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2))
