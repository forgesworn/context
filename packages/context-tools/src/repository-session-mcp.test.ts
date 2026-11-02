import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRepositorySessionServer } from './repository-session-mcp.js'

const exec = promisify(execFile), roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const text = (r: any) => r.content[0].text as string
const value = (r: any) => { expect(r.isError, text(r)).not.toBe(true); return JSON.parse(text(r)) }
async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'z1p-any-session-'))); roots.push(parent)
  const storage = join(parent, 'private'); await mkdir(storage, { mode: 0o700 })
  const repositories: string[] = []
  for (const name of ['first', 'second']) {
    const root = join(parent, name); await mkdir(root)
    await writeFile(join(root, 'example.ts'), `export const sharedMarker = '${name}'\n`)
    await exec('git', ['init', '-q', root]); await exec('git', ['-C', root, 'add', 'example.ts'])
    await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
    repositories.push(root)
  }
  return { parent, storage, repositories }
}
async function connect(storage?: string) {
  const session = await createRepositorySessionServer({ handoverBase: storage })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await session.server.connect(serverSide)
  const client = new Client({ name: 'global-context-test', version: '1' }); await client.connect(clientSide)
  return { client, close: async () => { await client.close(); await session.close() } }
}

it('advertises context without a checkout and requires explicit canonical repository selection', async () => {
  const f = await fixture(), c = await connect(f.storage)
  try {
    const tools = (await c.client.listTools()).tools
    expect(tools).toHaveLength(9)
    expect(tools.every(t => t.inputSchema.required?.includes('expectedRoot'))).toBe(true)
    expect((await c.client.callTool({ name: 'repository_status', arguments: {} })).isError).toBe(true)
    expect(await readdir(f.storage)).toEqual([])
    await mkdir(join(f.repositories[0], 'child'))
    const alias = join(f.parent, 'alias'); await symlink(f.repositories[0], alias)
    for (const root of [f.parent, join(f.repositories[0], 'child'), alias]) {
      expect((await c.client.callTool({ name: 'repository_search', arguments: { expectedRoot: root, term: 'sharedMarker' } })).isError).toBe(true)
    }
    const status = value(await c.client.callTool({ name: 'repository_status', arguments: { expectedRoot: f.repositories[0] } }))
    expect(status.root).toBe(f.repositories[0]); expect(status.freshness).toBe('unavailable')
    expect(await readdir(f.storage)).toEqual([])
  } finally { await c.close() }
})

it('isolates concurrent repository requests and evicts the previous index on explicit switching', async () => {
  const f = await fixture(), c = await connect()
  try {
    const [a, b] = f.repositories
    const results = await Promise.all([a, b].map(expectedRoot => c.client.callTool({ name: 'repository_search', arguments: { expectedRoot, term: 'sharedMarker', format: 'json' } })))
    expect(value(results[0]).results[0].text).toContain("'first'")
    expect(value(results[1]).results[0].text).toContain("'second'")
    const status = value(await c.client.callTool({ name: 'repository_status', arguments: { expectedRoot: a } }))
    expect(status.root).toBe(a); expect(status.generation).toBe(null)
    expect((await c.client.listTools()).tools).toHaveLength(7)
  } finally { await c.close() }
})

it('isolates checkpoints by checkout and resumes across independent global connections', async () => {
  const f = await fixture(), [a, b] = f.repositories
  let c = await connect(f.storage)
  try {
    const status = value(await c.client.callTool({ name: 'repository_refresh', arguments: { expectedRoot: a } }))
    const spec = { version: 1, task: 'Continue selected repository', acceptanceChecks: ['Read source'], allowedFiles: ['example.ts'], sources: [{ path: 'example.ts', startLine: 1, endLine: 1 }], exclusions: [], unresolvedQuestions: [] }
    const built = value(await c.client.callTool({ name: 'repository_packet', arguments: { expectedRoot: a, expectedGeneration: status.generation, mode: 'build', format: 'json', spec } }))
    const packet = built.packet
    const state = { version: 1, status: 'in_progress', completed: [], decisions: [], checks: [{ index: 0, outcome: 'not_run', evidence: null }], unresolvedQuestions: [], pendingEffects: [], nextAction: 'Read the selected source' }
    value(await c.client.callTool({ name: 'repository_handover_save', arguments: { expectedRoot: a, name: 'checkpoint.json', packetId: built.packetId, state } }))
    const after = value(await c.client.callTool({ name: 'repository_status', arguments: { expectedRoot: a } }))
    expect(after.generation).toBe(status.generation)
    expect(await readdir(f.storage)).toEqual([createHash('sha256').update(a).digest('hex')])
    value(await c.client.callTool({ name: 'repository_search', arguments: { expectedRoot: b, term: 'sharedMarker', format: 'json' } }))
    expect((await c.client.callTool({ name: 'repository_handover_save', arguments: { expectedRoot: a, name: 'after-switch.json', packetId: built.packetId, state } })).isError).toBe(true)
    await c.close(); c = await connect(f.storage)
    const resumed = value(await c.client.callTool({ name: 'repository_handover_resume', arguments: { expectedRoot: a, name: 'checkpoint.json' } }))
    expect(resumed.state.nextAction).toBe(state.nextAction)
    expect((await c.client.callTool({ name: 'repository_handover_resume', arguments: { expectedRoot: b, name: 'checkpoint.json' } })).isError).toBe(true)
    expect(await readdir(f.storage)).toHaveLength(1)
    if (process.platform !== 'win32') {
      await chmod(f.storage, 0o755)
      expect((await c.client.callTool({ name: 'repository_handover_save', arguments: { expectedRoot: b, name: 'unsafe.json', packet, state } })).isError).toBe(true)
      expect(await readdir(f.storage)).toHaveLength(1)
      await chmod(f.storage, 0o700)
    }
    await writeFile(join(a, 'example.ts'), 'export const sharedMarker = 2\n')
    expect((await c.client.callTool({ name: 'repository_handover_resume', arguments: { expectedRoot: a, name: 'checkpoint.json' } })).isError).toBe(true)
  } finally { await c.close() }
})
