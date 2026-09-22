import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { diagnoseRepository } from './repository-doctor.js'

const fake = vi.hoisted(() => ({
  root: '', head: '', failure: '', calls: [] as string[],
  transportOptions: {} as Record<string, unknown>, clientClosed: 0, transportClosed: 0,
}))
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    stderr = null
    constructor(options: Record<string, unknown>) { fake.transportOptions = options }
    async close() { fake.transportClosed++ }
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    async connect() { if (fake.failure === 'connect') throw new Error('fixture handshake failure') }
    async close() { fake.clientClosed++ }
    async listTools() {
      return { tools: ['repository_status', 'repository_refresh', 'repository_search', 'repository_explore', 'repository_coverage', 'repository_packet']
        .filter(name => !(fake.failure === 'missing' && name === 'repository_packet'))
        .map(name => ({ name, inputSchema: { type: 'object', properties: { mode: {}, spec: {}, expectedGeneration: {} } } })) }
    }
    async callTool({ name }: { name: string }) {
      fake.calls.push(name)
      const policy = { freshness: 'current' }
      const hit = { path: 'example.ts', line: 1, text: 'fixtureToken', sha256: 'a'.repeat(64) }
      const value = name === 'repository_packet'
        ? {
          packet: { canonicalRoot: fake.root, gitHEAD: fake.head, sources: [{
            path: hit.path, sha256: fake.failure === 'hash' ? 'b'.repeat(64) : hit.sha256,
            startLine: 1, endLine: 1, lines: [{ line: 1, content: hit.text }],
          }] }, navigation: { generation: 'generation', revision: 'revision', policy },
        }
        : name === 'repository_explore'
          ? { generation: 'generation', matchedLines: 1, definitions: [] }
          : name === 'repository_coverage'
          ? { generation: 'generation', files: [{ path: hit.path, status: fake.failure === 'coverage' ? 'missing' : 'cited' }] }
          : name === 'repository_search'
          ? { generation: fake.failure === 'generation' ? 'other' : 'generation', freshness: 'current', policy, results: [hit] }
          : { root: fake.failure === 'root' ? '/wrong/root' : fake.root, generation: 'generation',
            revision: 'revision', freshness: 'current', policy, counts: { files: 1 }, exclusions: { symlinks: 0 } }
      return { content: [{ type: 'text', text: JSON.stringify(value) }] }
    }
  },
}))

beforeAll(async () => {
  fake.root = await realpath(await mkdtemp(join(tmpdir(), 'context-doctor-contract-')))
  const exec = promisify(execFile)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]) => exec('git', ['-C', fake.root, ...args], { env })
  await git('init', '-q')
  await git('-c', 'user.name=Doctor fixture', '-c', 'user.email=doctor@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-qm', 'Fixture')
  fake.head = (await git('rev-parse', 'HEAD')).stdout.trim()
})
afterAll(async () => { await rm(fake.root, { recursive: true, force: true }) })
beforeEach(() => {
  fake.failure = ''; fake.calls = []; fake.clientClosed = 0; fake.transportClosed = 0
})

describe('doctor rejects incomplete or inconsistent server evidence', () => {
  it('runs the exact reported Node executable without inheriting the full environment', async () => {
    const result = await diagnoseRepository(fake.root, 'fixtureToken')
    expect(fake.transportOptions.command).toBe(result.binding.command)
    expect(fake.transportOptions.args).toEqual(result.binding.args)
    expect(fake.transportOptions.env).toBeUndefined()
    expect(fake.clientClosed).toBe(1)
    expect(fake.transportClosed).toBe(1)
  })
  it.each([
    ['missing', /required tool/, []],
    ['root', /root/, ['repository_status']],
    ['generation', /generation/, ['repository_status', 'repository_refresh', 'repository_search']],
    ['hash', /sha256/, ['repository_status', 'repository_refresh', 'repository_search', 'repository_packet']],
    ['coverage', /not report example\.ts as cited/, ['repository_status', 'repository_refresh', 'repository_search', 'repository_packet', 'repository_explore', 'repository_coverage']],
    ['connect', /handshake/, []],
  ] as const)('fails closed on %s and closes its owned transport', async (failure, error, calls) => {
    fake.failure = failure
    await expect(diagnoseRepository(fake.root, 'fixtureToken')).rejects.toThrow(error)
    expect(fake.calls).toEqual(calls)
    expect(fake.clientClosed).toBe(1)
    expect(fake.transportClosed).toBe(1)
  })
})
