import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorkflowCli } from './host-workflow-cli.js'

describe('private workflow CLI snapshots', () => {
  let directory: string, root: string, privateDir: string, spec: any, observed: any
  const json = async (name: string, value: unknown) => {
    const path = join(directory, name); await writeFile(path, JSON.stringify(value), { mode: 0o600 }); return path
  }
  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'z1p-workflow-test-')))
    root = join(directory, 'repo'); privateDir = join(directory, 'private')
    await mkdir(root); await mkdir(privateDir, { mode: 0o700 })
    execFileSync('git', ['init', '-q', root], { stdio: 'pipe', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) })
    spec = { version: 1, id: 'task', root, revision: 'a'.repeat(64), createdAt: 100,
      nodes: [{ id: 'one', task: 'Inspect selected source', paths: ['source.ts'], dependsOn: [], checks: ['test'], maxAttempts: 2, gate: null, effect: 'none', costLimitMicros: null }],
      budget: { maxConcurrent: 1, maxAttempts: 2, maxDurationMs: 1000, maxCostMicros: null } }
    observed = { root, revision: spec.revision, now: 200, approvals: [] }
  })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('creates, plans, appends and rereads exclusive private snapshots', async () => {
    const input = await json('spec.json', spec), out = join(privateDir, '001.json')
    await runWorkflowCli(['init', '--root', root, '--spec', input, '--out', out])
    if (process.platform !== 'win32') expect((await lstat(out)).mode & 0o777).toBe(0o600)
    const observation = await json('observation.json', observed)
    const plan = await runWorkflowCli(['plan', '--root', root, '--record', out, '--observation', observation])
    expect(plan).toMatchObject({ ready: ['one'] })
    const event = await json('event.json', { id: 'start', type: 'start', node: 'one', attempt: 'one-1', at: 110,
      actor: 'worker', packetSha256: spec.revision, approvalEvidence: null })
    const next = join(privateDir, '002.json')
    await runWorkflowCli(['append', '--root', root, '--record', out, '--event', event, '--observation', observation, '--sequence', '0', '--out', next])
    expect(JSON.parse(await readFile(out, 'utf8')).events).toHaveLength(0)
    expect(JSON.parse(await readFile(next, 'utf8')).events).toHaveLength(1)
    expect(await readdir(privateDir)).toEqual(['001.json', '002.json'])
    const before = await readFile(next)
    await expect(runWorkflowCli(['append', '--root', root, '--record', out, '--event', event, '--observation', observation, '--sequence', '0', '--out', next])).rejects.toThrow()
    expect(await readFile(next)).toEqual(before)
    expect((await readdir(privateDir)).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('rejects a parent workspace, wrong checkout record and extra CLI flags', async () => {
    const input = await json('spec.json', spec), out = join(privateDir, '001.json')
    await expect(runWorkflowCli(['init', '--root', directory, '--spec', input, '--out', out])).rejects.toThrow()
    await json('spec.json', { ...spec, root: directory })
    await expect(runWorkflowCli(['init', '--root', root, '--spec', input, '--out', out])).rejects.toThrow(/mismatch/)
    await expect(runWorkflowCli(['init', '--root', root, '--spec', input, '--out', out, '--trace', input])).rejects.toThrow()
    expect(await readdir(privateDir)).toEqual([])
  })

  it('refuses symlink inputs and outputs without modifying their targets', async () => {
    const input = await json('spec.json', spec), target = await json('target.json', { keep: true })
    const linked = join(directory, 'linked.json'); await symlink(input, linked)
    await expect(runWorkflowCli(['init', '--root', root, '--spec', linked, '--out', join(privateDir, '001.json')])).rejects.toThrow()
    const out = join(privateDir, 'out.json'); await symlink(target, out)
    await expect(runWorkflowCli(['init', '--root', root, '--spec', input, '--out', out])).rejects.toThrow()
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ keep: true })
  })

  it('requires a private output directory and rejects oversize inputs before JSON parsing', async () => {
    const input = await json('spec.json', spec)
    if (process.platform !== 'win32') {
      await chmod(privateDir, 0o755)
      await expect(runWorkflowCli(['init', '--root', root, '--spec', input, '--out', join(privateDir, '001.json')])).rejects.toThrow(/private/)
    }
    await writeFile(input, ' '.repeat(2 * 1024 * 1024 + 1))
    await expect(runWorkflowCli(['init', '--root', root, '--spec', input, '--out', join(privateDir, '001.json')])).rejects.toThrow(/bounded/)
  })
})
