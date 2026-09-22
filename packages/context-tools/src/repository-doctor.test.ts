import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { diagnoseRepository } from './repository-doctor.js'

const exec = promisify(execFile)
const roots: string[] = []
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
async function git(root: string, ...args: string[]) {
  return exec('git', ['-C', root, ...args], { env: gitEnv })
}
async function fixture(commit = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'context doctor space-')))
  roots.push(root)
  await git(root, 'init', '-q')
  await writeFile(join(root, 'example.ts'), 'export const doctorToken = "PRIVATE_SOURCE_SENTINEL"\n')
  if (commit) {
    await git(root, 'add', 'example.ts')
    await git(root, '-c', 'user.name=Doctor fixture', '-c', 'user.email=doctor@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Fixture')
  }
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('repository doctor using installed stdio entrypoint', () => {
  it('verifies all four tools and source provenance without writes or source text in its report', async () => {
    const root = await fixture()
    const before = await git(root, 'status', '--porcelain', '--untracked-files=all')
    const source = await readFile(join(root, 'example.ts'), 'utf8')
    const result = await diagnoseRepository(root, 'doctorToken')
    expect(result).toMatchObject({
      version: 1, ok: true, root, clientAcceptance: 'not-tested',
      gitHEAD: (await git(root, 'rev-parse', 'HEAD')).stdout.trim(),
      binding: { command: process.execPath, args: [expect.stringContaining('encrypted-context.mjs'), 'navigate', root] },
      evidence: { path: 'example.ts', line: 1, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
    expect([...result.tools].sort()).toEqual(['repository_packet', 'repository_refresh', 'repository_search', 'repository_status'])
    expect(result.exclusions).toMatchObject({ symlinks: expect.any(Number), unsupported: expect.any(Number) })
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SOURCE_SENTINEL')
    expect((await git(root, 'status', '--porcelain', '--untracked-files=all')).stdout).toBe(before.stdout)
    expect(await readFile(join(root, 'example.ts'), 'utf8')).toBe(source)
  }, 20000)

  it('keeps linked worktrees separate even when ambient Git variables point elsewhere', async () => {
    const root = await fixture()
    const linked = join(root, 'linked worktree')
    await git(root, 'worktree', 'add', '--detach', linked, 'HEAD')
    await writeFile(join(linked, 'example.ts'), 'export const worktreeToken = 2\n')
    const previous = process.env.GIT_WORK_TREE
    process.env.GIT_WORK_TREE = root
    try {
      const result = await diagnoseRepository(linked, 'worktreeToken')
      expect(result.root).toBe(await realpath(linked))
      expect(result.binding.args.at(-1)).toBe(await realpath(linked))
      expect(result.evidence.path).toBe('example.ts')
    } finally {
      if (previous === undefined) delete process.env.GIT_WORK_TREE
      else process.env.GIT_WORK_TREE = previous
    }
  }, 20000)

  it('rejects subdirectories without silently broadening the selected root', async () => {
    const root = await fixture()
    const child = join(root, 'child')
    await mkdir(child)
    await expect(diagnoseRepository(child, 'doctorToken')).rejects.toThrow(/root|top.level/i)
  })

  it('requires a committed repository and a valid explicit identifier', async () => {
    const root = await fixture(false)
    await expect(diagnoseRepository(root, 'doctorToken')).rejects.toThrow(/HEAD|commit/i)
    await expect(diagnoseRepository('/does/not/exist', 'two words')).rejects.toThrow(/identifier|term/i)
  })

  it('does not bypass selection exclusions to manufacture a passing search', async () => {
    const root = await fixture()
    await writeFile(join(root, '.gitignore'), 'example.ts\n')
    await expect(diagnoseRepository(root, 'doctorToken')).rejects.toThrow(/identifier|exclu|match/i)
  }, 20000)
})
