import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRepositoryNavigationServer } from './repository-navigation-mcp.js'

const exec = promisify(execFile)
const roots: string[] = []
const spec = (sources: unknown[]) => ({ version: 1, task: 'Packet test', acceptanceChecks: ['npm test'], allowedFiles: ['alpha.ts'], sources, exclusions: ['no network'], unresolvedQuestions: [] })

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'repository-packet-'))
  roots.push(value)
  await exec('git', ['init', '-q', value])
  await exec('git', ['-C', value, 'config', 'user.email', 'packet@example.test'])
  await exec('git', ['-C', value, 'config', 'user.name', 'Packet'])
  await writeFile(join(value, 'alpha.ts'), 'export function alpha() {\n  return 1\n}\n')
  await exec('git', ['-C', value, 'add', '.'])
  await exec('git', ['-C', value, 'commit', '-qm', 'fixture'])
  return value
}

async function connect(root: string) {
  const { server, navigation } = createRepositoryNavigationServer(root)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'packet-test', version: '0.0.0' })
  await client.connect(clientTransport)
  return { client, navigation, close: async () => { await client.close(); await server.close() } }
}
function text(result: { content?: unknown }): string { return ((result.content as Array<{ text: string }>)[0]).text }
function call(client: Client, arguments_: object) { return client.callTool({ name: 'repository_packet', arguments: arguments_ }) as Promise<{ isError?: boolean; content?: unknown }> }

afterEach(async () => { await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true }))) })

describe('repository packet MCP adapter', () => {
  it.each(['kts', 'cc', 'cxx', 'hh', 'hpp', 'hxx', 'HPP'])('retrieves .%s evidence, refreshes edits and retains policy and planner boundaries', async (extension) => {
    const value = await root()
    const file = `sample.${extension}`
    const content = '// fixture\nclass EvidenceMarker {}\n'
    await writeFile(join(value, file), content)
    const connection = await connect(value)
    const fixtureSpec = (sources: unknown[]) => ({ ...spec(sources), allowedFiles: [file] })
    const search = async (term: string) => {
      const result = await connection.client.callTool({ name: 'repository_search', arguments: { term } })
      expect(result.isError).not.toBe(true)
      return JSON.parse(text(result))
    }
    const refresh = async () => {
      const result = await connection.client.callTool({ name: 'repository_refresh', arguments: {} })
      expect(result.isError).not.toBe(true)
      return JSON.parse(text(result)).generation as string
    }
    const build = (expectedGeneration: string) => call(connection.client, {
      mode: 'build', expectedGeneration,
      spec: fixtureSpec([{ path: file, startLine: 2, endLine: 2 }]),
    })
    try {
      let generation = await refresh()
      const digest = createHash('sha256').update(content).digest('hex')
      expect((await search('EvidenceMarker')).results).toEqual([
        { path: file, line: 2, text: 'class EvidenceMarker {}', sha256: digest },
      ])
      const built = await build(generation)
      expect(built.isError).not.toBe(true)
      const packet = JSON.parse(text(built)).packet
      expect(packet.canonicalRoot).toBe(await realpath(value))
      expect(packet.gitHEAD).toBe((await exec('git', ['-C', value, 'rev-parse', 'HEAD'])).stdout.trim())
      expect(packet.sources[0]).toMatchObject({ path: file, sha256: digest, startLine: 2, endLine: 2, lines: [{ line: 2, content: 'class EvidenceMarker {}' }] })
      expect(packet.allowedFiles[0]).toMatchObject({ path: file, state: 'present', sha256: digest })
      const planned = await call(connection.client, { mode: 'plan', expectedGeneration: generation, spec: fixtureSpec([{ path: file, line: 2 }]) })
      expect(planned.isError).toBe(true)
      expect(text(planned)).toMatch(/planner source extension is unsupported/)

      const changed = '// fixture\nclass UpdatedEvidenceMarker {}\n'
      await writeFile(join(value, file), changed)
      const status = await connection.client.callTool({ name: 'repository_status', arguments: {} })
      expect(JSON.parse(text(status)).freshness).toBe('stale')
      const stale = await build(generation)
      expect(stale.isError).toBe(true)
      expect(text(stale)).toMatch(/requires current navigation/)
      const previous = generation
      generation = await refresh()
      expect(generation).not.toBe(previous)
      expect((await build(previous)).isError).toBe(true)
      expect((await search('EvidenceMarker')).results).toEqual([])
      expect((await search('UpdatedEvidenceMarker')).results[0].path).toBe(file)
      const updated = await build(generation)
      expect(updated.isError).not.toBe(true)
      expect(JSON.parse(text(updated)).packet.sources[0]).toMatchObject({
        sha256: createHash('sha256').update(changed).digest('hex'),
        lines: [{ line: 2, content: 'class UpdatedEvidenceMarker {}' }],
      })

      await writeFile(join(value, '.gitignore'), `${file}\n`)
      expect((await build(generation)).isError).toBe(true)
      generation = await refresh()
      expect((await search('UpdatedEvidenceMarker')).results).toEqual([])
      const excluded = await build(generation)
      expect(excluded.isError).toBe(true)
      expect(text(excluded)).toMatch(/excluded|policy/)
    } finally { await connection.close() }
  })

  it('continues to exclude Dart from navigation and reject its build and plan packets', async () => {
    const value = await root()
    await writeFile(join(value, 'sample.dart'), 'class DartMarker {}\n')
    const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} })
      const expectedGeneration = JSON.parse(text(refreshed)).generation
      const found = await connection.client.callTool({ name: 'repository_search', arguments: { term: 'DartMarker' } })
      expect(found.isError).not.toBe(true)
      expect(JSON.parse(text(found)).results).toEqual([])
      for (const mode of ['build', 'plan']) {
        const source = mode === 'build' ? { path: 'sample.dart', startLine: 1, endLine: 1 } : { path: 'sample.dart', line: 1 }
        const result = await call(connection.client, { mode, expectedGeneration, spec: { ...spec([source]), allowedFiles: ['sample.dart'] } })
        expect(result.isError).toBe(true)
        expect(text(result)).toMatch(/extension is unsupported/)
      }
    } finally { await connection.close() }
  })

  it('discovers inline-only packet input and requires a current matching generation', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const tools = await connection.client.listTools()
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['repository_packet', 'repository_refresh', 'repository_search', 'repository_status'])
      const packetTool = tools.tools.find((tool) => tool.name === 'repository_packet')
      expect(packetTool?.inputSchema.type).toBe('object')
      expect(packetTool?.inputSchema.additionalProperties).toBe(false)
      expect(Object.keys(packetTool?.inputSchema.properties ?? {}).sort()).toEqual(['expectedGeneration', 'maxBytes', 'mode', 'spec'])
      expect(packetTool?.inputSchema.required).toEqual(['mode', 'spec', 'expectedGeneration'])
      const early = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: 'missing' })
      expect(early.isError).toBe(true)
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const wrong = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: 'wrong' })
      expect(wrong.isError).toBe(true)
      const rejectedFields = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation, root: value, specPath: '/tmp/spec.json', output: '/tmp/out', command: 'git status' })
      expect(rejectedFields.isError).toBe(true)
      const mismatchedBuild = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', line: 1 }]), expectedGeneration: generation })
      expect(mismatchedBuild.isError).toBe(true)
      const mismatchedPlan = await call(connection.client, { mode: 'plan', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation })
      expect(mismatchedPlan.isError).toBe(true)
    } finally { await connection.close() }
  })

  it('builds exact packet ranges, plans complete blocks, and rejects stale policy until refresh', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      let generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const built = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 2, endLine: 2 }]), expectedGeneration: generation })
      expect(built.isError).not.toBe(true)
      expect((JSON.parse(text(built)) as { packet: { sources: Array<{ lines: Array<{ line: number }> }> } }).packet.sources[0].lines).toEqual([{ line: 2, content: '  return 1' }])
      const planned = await call(connection.client, { mode: 'plan', spec: spec([{ path: 'alpha.ts', line: 2 }]), expectedGeneration: generation })
      expect((JSON.parse(text(planned)) as { coverage: { mergedSources: unknown[] } }).coverage.mergedSources).toEqual([{ path: 'alpha.ts', startLine: 1, endLine: 3 }])
      await writeFile(join(value, '.gitignore'), 'alpha.ts\n')
      const stale = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation })
      expect(stale.isError).toBe(true)
      const recovery = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      generation = (JSON.parse(text(recovery)) as { generation: string }).generation
      const excluded = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation })
      expect(excluded.isError).toBe(true)
    } finally { await connection.close() }
  })

  it('rejects traversal and a packet envelope that exceeds its requested byte limit', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const traversal = await call(connection.client, { mode: 'build', spec: spec([{ path: '../alpha.ts', startLine: 1, endLine: 1 }]), expectedGeneration: generation })
      expect(traversal.isError).toBe(true)
      const capped = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation, maxBytes: 1024 })
      expect(capped.isError).toBe(true)
      expect(text(capped)).toMatch(/exceeds 1024 bytes/)
    } finally { await connection.close() }
  })

  it('rejects a concurrent packet before freshness scanning and releases the slot after cancellation', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const originalStatus = connection.navigation.status.bind(connection.navigation)
      let entered!: () => void; let release!: () => void
      const started = new Promise<void>((resolve) => { entered = resolve })
      const gate = new Promise<void>((resolve) => { release = resolve })
      connection.navigation.status = async (signal?: AbortSignal) => {
        entered()
        await gate
        if (signal?.aborted) throw new Error('repository packet aborted')
        return originalStatus(signal)
      }
      const controller = new AbortController()
      const first = connection.client.callTool({ name: 'repository_packet', arguments: { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation } }, undefined, { signal: controller.signal })
      await started
      const second = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation })
      expect(second.isError).toBe(true)
      expect(text(second)).toBe('repository packet already in progress')
      controller.abort()
      release()
      await first.catch(() => undefined)
      connection.navigation.status = originalStatus
      const recovered = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation })
      expect(recovered.isError).not.toBe(true)
    } finally { await connection.close() }
  })
})
