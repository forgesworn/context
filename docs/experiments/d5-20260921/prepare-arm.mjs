#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const expectedArchives = {
  context: '6e93afe49b6124f65f11afc848bf9c79c0e1eebd83457af27547c19de13657f3',
  kithmoot: '3c0f1dd0637c6f0a53a187e05808ff407dec72d60acf92b70aa8bafe7377a24d',
}
const pairIds = new Set([
  'orientation-context', 'diagnosis-context', 'impact-context', 'code-change-context',
  'orientation-kithmoot', 'diagnosis-kithmoot', 'impact-kithmoot', 'code-change-kithmoot',
])
function args() {
  const out = {}
  for (let i = 2; i < process.argv.length; i += 2) out[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
  return out
}
function run(command, values, cwd) { return execFileSync(command, values, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function isInside(root, candidate) {
  const rel = relative(root, candidate)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${String.fromCharCode(47)}`) && !rel.startsWith(`..${String.fromCharCode(92)}`)
}
function archiveHashes(root) {
  const hashes = {}
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      const rel = relative(root, full)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) hashes[rel] = sha(readFileSync(full))
      else throw new Error(`archive contains unsupported entry: ${rel}`)
    }
  }
  walk(root)
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)))
}

const a = args()
if (!a.pair || !['baseline', 'assisted'].includes(a.arm) || !a['source-root'] || !a.output) throw new Error('usage: --pair ID --arm baseline|assisted --source-root PATH --output NEW_PATH')
if (!pairIds.has(a.pair)) throw new Error(`unknown locked pair: ${a.pair}`)
const taskPath = join(here, 'tasks', `${a.pair}.json`)
const task = JSON.parse(readFileSync(taskPath, 'utf8'))
if (task.id !== a.pair || !expectedArchives[task.repository]) throw new Error('locked task definition mismatch')
const source = resolve(a['source-root']), output = resolve(a.output)
if (existsSync(output)) throw new Error(`output already exists: ${output}`)
if (isInside(source, output)) throw new Error('output must be outside the live source root')
if (run('git', ['rev-parse', `${task.revision}^{commit}`], source) !== task.revision) throw new Error('source root does not contain the locked revision')
const scratch = mkdtempSync(join(tmpdir(), 'd5-prepare-'))
let createdOutput = false
try {
  const archive = join(scratch, 'source.tar')
  execFileSync('git', ['archive', '--format=tar', '--output', archive, task.revision], { cwd: source, stdio: 'pipe' })
  const archiveSha256 = sha(readFileSync(archive))
  if (archiveSha256 !== expectedArchives[task.repository]) throw new Error(`archive hash mismatch: ${archiveSha256}`)
  mkdirSync(output, { recursive: false })
  createdOutput = true
  execFileSync('tar', ['-xf', archive, '-C', output], { stdio: 'pipe' })
  const archiveSourceHashes = archiveHashes(output)
  run('git', ['init', '-q'], output)
  const setupPatch = task.setupPatch ? join(here, task.setupPatch) : undefined
  if ((task.setupPatch ?? null) === null ? task.setupPatchSha256 !== null : typeof task.setupPatchSha256 !== 'string') throw new Error('locked task setup patch metadata mismatch')
  if (setupPatch && sha(readFileSync(setupPatch)) !== task.setupPatchSha256) throw new Error('setup patch hash mismatch')
  if (setupPatch) execFileSync('git', ['apply', '--check', setupPatch], { cwd: output, stdio: 'pipe' })
  if (setupPatch) execFileSync('git', ['apply', setupPatch], { cwd: output, stdio: 'pipe' })
  const sourceHashes = archiveHashes(output)
  writeFileSync(join(output, '.z1p-navigation.json'), JSON.stringify({ version: 1, ...task.selectionPolicy }, null, 2) + '\n')
  writeFileSync(join(output, '.d5-task.json'), JSON.stringify({ version: 1, id: task.id, category: task.category, repository: task.repository, revision: task.revision, prompt: task.prompt, ...(task.answerSchema ? { answerSchema: task.answerSchema } : {}) }, null, 2) + '\n')
  writeFileSync(join(output, '.d5-prepared.json'), JSON.stringify({ version: 1, pair: task.id, arm: a.arm, repository: task.repository, sourceRevision: task.revision, archiveSha256, archiveSourceHashes, sourceHashes, ...(setupPatch ? { setupPatch: task.setupPatch, setupPatchSha256: sha(readFileSync(setupPatch)) } : {}) }, null, 2) + '\n')
  run('git', ['add', '.'], output)
  execFileSync('git', ['-c', 'user.name=D5 Protocol', '-c', 'user.email=d5@invalid', 'commit', '--no-verify', '-q', '-m', `D5 frozen ${task.id}`], {
    cwd: output,
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-09-21T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-21T00:00:00Z' },
    stdio: 'pipe',
  })
  const tree = run('git', ['rev-parse', 'HEAD^{tree}'], output)
  process.stdout.write(JSON.stringify({ pair: task.id, arm: a.arm, sourceRevision: task.revision, archiveSha256, sourceFiles: Object.keys(sourceHashes).length, preparedTree: tree, output }, null, 2) + '\n')
} catch (error) {
  if (createdOutput && existsSync(output)) rmSync(output, { recursive: true, force: true })
  throw error
} finally { rmSync(scratch, { recursive: true, force: true }) }
