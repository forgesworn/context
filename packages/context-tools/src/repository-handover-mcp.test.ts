import { afterEach, expect, it, vi } from 'vitest'
import { constants, promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRepositoryNavigationServer } from './repository-navigation-mcp.js'
import { buildPacketFromSpec } from './source-packet.mjs'
import { saveHandoverRecord } from './task-handover.mjs'

const exec = promisify(execFile)
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'portable-handover-')))
  roots.push(base)
  const root = join(base, 'repository'), directory = join(base, 'private')
  await mkdir(root); await mkdir(directory, { mode: 0o700 })
  await exec('git', ['init', '-q', root])
  await writeFile(join(root, 'example.ts'), 'export const evidenceMarker = 1\n')
  await exec('git', ['-C', root, 'add', 'example.ts'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  const packet = await buildPacketFromSpec({ root, spec: {
    version: 1, task: 'Continue the selected task', acceptanceChecks: ['Review the source'],
    allowedFiles: ['example.ts'], sources: [{ path: 'example.ts', startLine: 1, endLine: 1 }],
    exclusions: [], unresolvedQuestions: [],
  } })
  const state = { version: 1, status: 'in_progress', completed: [], decisions: [],
    checks: [{ index: 0, outcome: 'not_run', evidence: null }], unresolvedQuestions: [],
    pendingEffects: ['Check the previous deployment before replay'], nextAction: 'Review example.ts' }
  return { root, directory, packet, state }
}

async function connect(root: string, handoverDirectory?: string) {
  const { server, navigation } = createRepositoryNavigationServer(root, { handoverDirectory })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'handover-test', version: '1' })
  await client.connect(clientSide)
  return { client, navigation, close: async () => { await client.close(); await server.close() } }
}
const text = (r: any): string => r.content[0].text
const json = (r: any): any => JSON.parse(text(r))

it('rejects a mismatched expectedRoot before every navigation operation or index build', async () => {
  const f = await fixture(), c = await connect(f.root)
  try {
    for (const [name, args] of [
      ['repository_status', {}], ['repository_refresh', {}],
      ['repository_search', { term: 'evidenceMarker' }], ['repository_explore', { symbol: 'evidenceMarker' }],
      ['repository_coverage', { symbols: ['evidenceMarker'], answer: 'example.ts' }],
      ['repository_packet', { mode: 'build', expectedGeneration: 'wrong', spec: f.packet.originalSpec }],
    ] as const) {
      const result = await c.client.callTool({ name, arguments: { ...args, expectedRoot: f.directory } })
      expect(result.isError).toBe(true)
      expect(text(result)).toMatch(/expectedRoot/)
    }
    expect(c.navigation.built).toBe(false)
    const status = await c.client.callTool({ name: 'repository_status', arguments: { expectedRoot: f.root } })
    expect(status.isError).not.toBe(true)
    expect(json(status).root).toBe(f.root)
    expect((await c.client.listTools()).tools.some(t => t.name.startsWith('repository_handover'))).toBe(false)
  } finally { await c.close() }
})

it('saves privately and resumes in a fresh client with no source excerpts; rejects stale and cross-root evidence', async () => {
  const f = await fixture()
  let c = await connect(f.root, f.directory)
  const args = { expectedRoot: f.root, name: 'checkpoint.json', packet: f.packet, state: f.state }
  try {
    const saved = await c.client.callTool({ name: 'repository_handover_save', arguments: args })
    expect(saved.isError, text(saved)).not.toBe(true)
    expect((await stat(join(f.directory, args.name))).mode & 0o777).toBe(0o600)
    const bytes = await readFile(join(f.directory, args.name))
    expect((await c.client.callTool({ name: 'repository_handover_save', arguments: args })).isError).toBe(true)
    expect(await readFile(join(f.directory, args.name))).toEqual(bytes)
    await c.close(); c = await connect(f.root, f.directory)
    const resume = () => c.client.callTool({ name: 'repository_handover_resume', arguments: { expectedRoot: f.root, name: args.name } })
    const resumed = await resume()
    expect(resumed.isError, text(resumed)).not.toBe(true)
    expect(json(resumed).state).toMatchObject({ nextAction: f.state.nextAction, pendingEffects: f.state.pendingEffects })
    expect(text(resumed)).not.toContain('export const')
    expect(json(resumed).caveat).toMatch(/recorded assertions/)
    await writeFile(join(f.root, 'example.ts'), 'export const evidenceMarker = 2\n')
    expect((await resume()).isError).toBe(true)
    const other = await fixture(), wrong = await connect(other.root, f.directory)
    try { expect((await wrong.client.callTool({ name: 'repository_handover_resume', arguments: { expectedRoot: other.root, name: args.name } })).isError).toBe(true) }
    finally { await wrong.close() }
  } finally { await c.close() }
})

it('refuses path escapes, symlinks, oversized records and false review readiness without changing storage', async () => {
  const f = await fixture(), c = await connect(f.root, f.directory)
  try {
    for (const name of ['../escape.json', '/tmp/escape.json', '.hidden.json', 'nested/file.json']) {
      expect((await c.client.callTool({ name: 'repository_handover_save', arguments: { expectedRoot: f.root, name, packet: f.packet, state: f.state } })).isError).toBe(true)
    }
    const save = (packet: any, state: any) => c.client.callTool({ name: 'repository_handover_save', arguments: { expectedRoot: f.root, name: 'invalid.json', packet, state } })
    expect((await save(f.packet, { ...f.state, status: 'ready_for_review' })).isError).toBe(true)
    expect((await save({ ...f.packet, padding: 'x'.repeat(65536) }, f.state)).isError).toBe(true)
    expect(await readdir(f.directory)).toEqual([])
    await writeFile(join(f.directory, 'target.json'), '{}')
    await symlink(join(f.directory, 'target.json'), join(f.directory, 'link.json'))
    expect((await c.client.callTool({ name: 'repository_handover_resume', arguments: { expectedRoot: f.root, name: 'link.json' } })).isError).toBe(true)
  } finally { await c.close() }
})

it('cancellation after opening a file prevents checkpoint publication and removes scratch', async () => {
  const f = await fixture(), controller = new AbortController()
  const open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args)
    if (String(args[0]).startsWith(f.directory + '/') && typeof args[1] === 'number' && (args[1] & constants.O_CREAT)) controller.abort()
    return handle
  })
  await expect(saveHandoverRecord({ root: f.root, packet: f.packet, state: f.state,
    out: join(f.directory, 'cancelled.json'), signal: controller.signal })).rejects.toThrow()
  expect(controller.signal.aborted).toBe(true)
  expect(await readdir(f.directory)).toEqual([])
})

it.each(['writeFile', 'sync', 'close'] as const)('%s failure never publishes a partial checkpoint', async method => {
  const f = await fixture(), open = fs.open.bind(fs)
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args)
    if (String(args[0]).startsWith(f.directory + '/') && typeof args[1] === 'number' && (args[1] & constants.O_CREAT)) {
      const write = handle.writeFile.bind(handle)
      const close = handle.close.bind(handle)
      vi.spyOn(handle, method).mockImplementationOnce(async () => {
        if (method === 'writeFile') await write('partial record')
        if (method === 'close') await close()
        throw new Error('injected storage failure')
      })
    }
    return handle
  })
  await expect(saveHandoverRecord({ root: f.root, packet: f.packet, state: f.state,
    out: join(f.directory, 'failed.json') })).rejects.toThrow('injected storage failure')
  expect(await readdir(f.directory)).toEqual([])
})

it('concurrent saves publish one complete checkpoint without overwriting or leaving scratch', async () => {
  const f = await fixture(), out = join(f.directory, 'concurrent.json')
  const results = await Promise.allSettled([1, 2].map(() => saveHandoverRecord({ root: f.root, packet: f.packet, state: f.state, out })))
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1)
  expect(await readdir(f.directory)).toEqual(['concurrent.json'])
  expect(JSON.parse(await readFile(out, 'utf8')).state).toEqual(f.state)
})

it('rejects missing, non-directory, symlinked and non-private handover storage at startup', async () => {
  const f = await fixture(), alias = join(f.root, 'alias')
  await symlink(f.directory, alias)
  for (const directory of [join(f.root, 'absent'), join(f.root, 'example.ts'), alias]) {
    expect(() => createRepositoryNavigationServer(f.root, { handoverDirectory: directory })).toThrow(/handover directory/)
  }
  if (process.platform !== 'win32') {
    await chmod(f.directory, 0o755)
    expect(() => createRepositoryNavigationServer(f.root, { handoverDirectory: f.directory })).toThrow(/handover directory/)
  }
})

it('saves the exact server-held packet by reference without copying source into the request', async () => {
  const f = await fixture(), c = await connect(f.root, f.directory)
  try {
    const status = json(await c.client.callTool({ name: 'repository_refresh', arguments: { expectedRoot: f.root } }))
    const built = json(await c.client.callTool({ name: 'repository_packet', arguments: {
      expectedRoot: f.root, expectedGeneration: status.generation, mode: 'build', format: 'json', spec: f.packet.originalSpec,
    } }))
    expect(built.packetId).toMatch(/^packet-/)
    const args = { expectedRoot: f.root, name: 'reference.json', packetId: built.packetId, state: f.state }
    const saved = await c.client.callTool({ name: 'repository_handover_save', arguments: args })
    expect(saved.isError, text(saved)).not.toBe(true)
    const record = JSON.parse(await readFile(join(f.directory, args.name), 'utf8'))
    expect(record.packet).toEqual(built.packet)
    expect((await c.client.callTool({ name: 'repository_handover_save', arguments: { ...args, name: 'ambiguous.json', packet: built.packet } })).isError).toBe(true)
  } finally { await c.close() }
})

it('keeps packet references local to the connection, root and current generation', async () => {
  const f = await fixture(), c = await connect(f.root, f.directory), other = await connect(f.root, f.directory)
  try {
    const status = json(await c.client.callTool({ name: 'repository_refresh', arguments: { expectedRoot: f.root } }))
    const built = json(await c.client.callTool({ name: 'repository_packet', arguments: {
      expectedRoot: f.root, expectedGeneration: status.generation, mode: 'build', format: 'json', spec: f.packet.originalSpec,
    } }))
    const args = { expectedRoot: f.root, name: 'unavailable.json', packetId: built.packetId, state: f.state }
    expect((await other.client.callTool({ name: 'repository_handover_save', arguments: args })).isError).toBe(true)
    expect((await c.client.callTool({ name: 'repository_handover_save', arguments: { ...args, expectedRoot: f.directory } })).isError).toBe(true)
    await c.client.callTool({ name: 'repository_refresh', arguments: { expectedRoot: f.root } })
    expect((await c.client.callTool({ name: 'repository_handover_save', arguments: args })).isError).toBe(true)
    expect(await readdir(f.directory)).toEqual([])
  } finally { await c.close(); await other.close() }
})

it('rejects stale selected source before saving a referenced packet', async () => {
  const f = await fixture(), c = await connect(f.root, f.directory)
  try {
    const status = json(await c.client.callTool({ name: 'repository_refresh', arguments: { expectedRoot: f.root } }))
    const built = json(await c.client.callTool({ name: 'repository_packet', arguments: {
      expectedRoot: f.root, expectedGeneration: status.generation, mode: 'build', format: 'json', spec: f.packet.originalSpec,
    } }))
    await writeFile(join(f.root, 'example.ts'), 'export const evidenceMarker = 99\n')
    const saved = await c.client.callTool({ name: 'repository_handover_save', arguments: {
      expectedRoot: f.root, name: 'stale-reference.json', packetId: built.packetId, state: f.state,
    } })
    expect(saved.isError).toBe(true); expect(await readdir(f.directory)).toEqual([])
  } finally { await c.close() }
})

it('advertises the actual checkpoint state contract instead of an arbitrary object', async () => {
  const f = await fixture(), c = await connect(f.root, f.directory)
  try {
    const schema: any = (await c.client.listTools()).tools.find(t => t.name === 'repository_handover_save')!.inputSchema
    expect(schema.properties.state.properties.status.enum).toEqual(['in_progress', 'blocked', 'ready_for_review'])
    expect(schema.properties.state.properties.checks.items.properties.outcome.enum).toEqual(['passed', 'failed', 'not_run', 'unknown'])
    const bad = await c.client.callTool({ name: 'repository_handover_save', arguments: {
      expectedRoot: f.root, name: 'bad-state.json', packet: f.packet, state: { status: 'complete', summary: 'Guessed state' },
    } })
    expect(bad.isError).toBe(true); expect(await readdir(f.directory)).toEqual([])
  } finally { await c.close() }
})

it('includes explicitly selected configuration evidence and rejects changed configuration on resume', async () => {
  const f = await fixture(), c = await connect(f.root, f.directory)
  try {
    await writeFile(join(f.root, 'package.json'), '{"private":true,"scripts":{"test":"node --test"}}\n')
    const status = json(await c.client.callTool({ name: 'repository_refresh', arguments: { expectedRoot: f.root } }))
    const response = await c.client.callTool({ name: 'repository_packet', arguments: {
      expectedRoot: f.root, expectedGeneration: status.generation, mode: 'build', format: 'json',
      spec: { ...f.packet.originalSpec, sources: [{ path: 'package.json' }], allowedFiles: ['package.json'] },
    } })
    expect(response.isError, text(response)).not.toBe(true)
    const built = json(response)
    const saved = await c.client.callTool({ name: 'repository_handover_save', arguments: {
      expectedRoot: f.root, name: 'config.json', packetId: built.packetId, state: f.state,
    } })
    expect(saved.isError, text(saved)).not.toBe(true)
    await writeFile(join(f.root, 'package.json'), '{"private":true,"scripts":{"test":"changed"}}\n')
    expect((await c.client.callTool({ name: 'repository_handover_resume', arguments: { expectedRoot: f.root, name: 'config.json' } })).isError).toBe(true)
  } finally { await c.close() }
})
