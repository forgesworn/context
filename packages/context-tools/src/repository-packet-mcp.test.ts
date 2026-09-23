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
function call(client: Client, arguments_: object) { return client.callTool({ name: 'repository_packet', arguments: { format: 'json', ...arguments_ } }) as Promise<{ isError?: boolean; content?: unknown }> }

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
      const result = await connection.client.callTool({ name: 'repository_search', arguments: { term, format: 'json' } })
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
      const found = await connection.client.callTool({ name: 'repository_search', arguments: { format: 'json', term: 'DartMarker' } })
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
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(['repository_coverage', 'repository_explore', 'repository_packet', 'repository_refresh', 'repository_search', 'repository_status'])
      const packetTool = tools.tools.find((tool) => tool.name === 'repository_packet')
      expect(packetTool?.inputSchema.type).toBe('object')
      expect(packetTool?.inputSchema.additionalProperties).toBe(false)
      expect(Object.keys(packetTool?.inputSchema.properties ?? {}).sort()).toEqual(['expectedGeneration', 'format', 'maxBytes', 'mode', 'spec'])
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

  it('queues a concurrent packet until the running one finishes, including after cancellation', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const originalStatus = connection.navigation.status.bind(connection.navigation)
      let entered!: () => void; let release!: () => void
      const started = new Promise<void>((resolve) => { entered = resolve })
      const gate = new Promise<void>((resolve) => { release = resolve })
      let calls = 0
      connection.navigation.status = async (signal?: AbortSignal) => {
        calls += 1
        if (calls === 1) {
          entered()
          await gate
          if (signal?.aborted) throw new Error('repository packet aborted')
        }
        return originalStatus(signal)
      }
      const controller = new AbortController()
      const first = connection.client.callTool({ name: 'repository_packet', arguments: { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation } }, undefined, { signal: controller.signal })
      await started
      let secondSettled = false
      const second = call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation }).finally(() => { secondSettled = true })
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(secondSettled).toBe(false)
      expect(calls).toBe(1)
      controller.abort()
      release()
      await first.catch(() => undefined)
      const queued = await second
      expect(queued.isError).not.toBe(true)
      connection.navigation.status = originalStatus
    } finally { await connection.close() }
  })

  it('reads to the end of the file when a range runs past it, and verification rebuilds the clamped range', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const past = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 2, endLine: 40 }]), expectedGeneration: generation })
      expect(past.isError).not.toBe(true)
      const packet = JSON.parse(text(past)).packet
      expect(packet.sources[0]).toMatchObject({ path: 'alpha.ts', startLine: 2, endLine: 3 })
      expect(packet.sources[0].lines.map((line: { line: number }) => line.line)).toEqual([2, 3])
      expect(packet.originalSpec.sources[0]).toEqual({ path: 'alpha.ts', startLine: 2, endLine: 3 })
      const { verifyPacket, serializePacket } = await import('./source-packet.mjs') as unknown as { verifyPacket: (input: { root: string; packet: string }) => Promise<{ status: string }>; serializePacket: (value: unknown) => string }
      const saved = join(value, 'packet.json')
      await writeFile(saved, serializePacket(packet))
      expect(await verifyPacket({ root: await realpath(value), packet: saved })).toEqual({ status: 'current' })
      const beyond = await call(connection.client, { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 9, endLine: 40 }]), expectedGeneration: generation })
      expect(beyond.isError).toBe(true)
      expect(text(beyond)).toMatch(/line range exceeds source length: alpha\.ts has 3 lines; request endLine 3 or less/)
    } finally { await connection.close() }
  })

  it('accepts a spec with only sources and fills neutral handoff metadata', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const bare = await call(connection.client, { mode: 'build', spec: { sources: [{ path: 'alpha.ts', startLine: 1, endLine: 1 }] }, expectedGeneration: generation })
      expect(bare.isError).not.toBe(true)
      expect(JSON.parse(text(bare)).packet.originalSpec).toMatchObject({ version: 1, task: 'read exact source', acceptanceChecks: ['cite exact source lines'], allowedFiles: [], exclusions: [], unresolvedQuestions: [] })
      const empty = await call(connection.client, { mode: 'plan', spec: { version: 1, task: '', acceptanceChecks: [], allowedFiles: [], exclusions: [''], unresolvedQuestions: [], sources: [{ path: 'alpha.ts', line: 2 }] }, expectedGeneration: generation })
      expect(empty.isError).not.toBe(true)
    } finally { await connection.close() }
  })

  it('reads a whole file from a path alone and merges overlapping ranges', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const whole = await call(connection.client, { mode: 'build', spec: { sources: [{ path: 'alpha.ts' }] }, expectedGeneration: generation })
      expect(whole.isError).not.toBe(true)
      expect(JSON.parse(text(whole)).packet.sources).toMatchObject([{ path: 'alpha.ts', startLine: 1, endLine: 3 }])
      const overlapping = await call(connection.client, { mode: 'build', spec: { sources: [{ path: 'alpha.ts', startLine: 2, endLine: 3 }, { path: 'alpha.ts', startLine: 1, endLine: 2 }] }, expectedGeneration: generation })
      expect(overlapping.isError).not.toBe(true)
      const packet = JSON.parse(text(overlapping)).packet
      expect(packet.sources).toMatchObject([{ path: 'alpha.ts', startLine: 1, endLine: 3 }])
      expect(packet.originalSpec.sources).toEqual([{ path: 'alpha.ts', startLine: 1, endLine: 3 }])
    } finally { await connection.close() }
  })

  it('points a plan anchor outside any block at an exact build range', async () => {
    const value = await root()
    await writeFile(join(value, 'beta.ts'), "import { alpha } from './alpha'\nexport function beta() {\n  return alpha()\n}\n")
    const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const outside = await call(connection.client, { mode: 'plan', spec: { sources: [{ path: 'beta.ts', line: 1 }] }, expectedGeneration: generation })
      expect(outside.isError).toBe(true)
      expect(text(outside)).toMatch(/no supported syntax block contains beta\.ts:1; request an exact range with mode build instead/)
    } finally { await connection.close() }
  })
})

describe('repository packet compact rendering', () => {
  it('returns numbered source lines with a provenance header by default', async () => {
    const value = await root(); const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const built = await connection.client.callTool({ name: 'repository_packet', arguments: { mode: 'build', spec: spec([{ path: 'alpha.ts', startLine: 1, endLine: 3 }]), expectedGeneration: generation } }) as { isError?: boolean; content?: unknown }
      expect(built.isError).not.toBe(true)
      const lines = text(built).split('\n')
      expect(lines[0]).toMatch(new RegExp(`^packet build  generation ${generation}  revision [a-f0-9]{16}  gitHEAD [a-f0-9]{12}  trust unsigned  policy current$`))
      expect(lines[1]).toBe('task: Packet test')
      expect(lines[2]).toMatch(/^source alpha\.ts:1-3  sha256 [a-f0-9]{16}  3 lines$/)
      expect(lines.slice(3, 6)).toEqual(['1: export function alpha() {', '2:   return 1', '3: }'])
      expect(lines[6]).toMatch(/^allowed: alpha\.ts \(present, [a-f0-9]{16}\)$/)
      expect(lines.at(-1)).toMatch(/^caveat: /)
      const planned = await connection.client.callTool({ name: 'repository_packet', arguments: { mode: 'plan', spec: spec([{ path: 'alpha.ts', line: 2 }]), expectedGeneration: generation } }) as { isError?: boolean; content?: unknown }
      expect(planned.isError).not.toBe(true)
      expect(text(planned)).toContain('resolved: alpha.ts:2 -> 1-3 (function)\nmerged: alpha.ts:1-3\ncoverage: ')
      expect(text(planned).split('\n').at(-1)).toBe('caveat: as on the first packet this session')
    } finally { await connection.close() }
  })

  it('answers an oversized whole-file build with a declaration outline and no source text', async () => {
    const value = await root()
    const body = Array.from({ length: 400 }, (_, index) => `export function helper${index}() {\n  return '${'x'.repeat(120)}'\n}\n`).join('')
    await writeFile(join(value, 'large.ts'), `export interface Shape {\n  size: number\n}\nexport class Store {\n  get(key: string) {\n    return key\n  }\n}\n${body}`)
    const connection = await connect(value)
    try {
      const refreshed = await connection.client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown }
      const generation = (JSON.parse(text(refreshed)) as { generation: string }).generation
      const built = await connection.client.callTool({ name: 'repository_packet', arguments: { mode: 'build', spec: { sources: [{ path: 'large.ts' }] }, expectedGeneration: generation } }) as { isError?: boolean; content?: unknown }
      expect(built.isError).toBe(true)
      const lines = text(built).split('\n')
      expect(lines[0]).toMatch(/exceed.* bytes\. Nothing was fetched\. Request the ranges you need below, or call repository_explore for a symbol\.$/)
      expect(lines[1]).toMatch(/^outline large\.ts  1208 lines  \d+ bytes  sha256 [a-f0-9]{16}$/)
      expect(lines.slice(2, 6)).toEqual(['  1-3 interface Shape', '  4-8 class Store', '  5-7 method Store.get', '  9-11 function helper0'])
      expect(lines).toHaveLength(2 + 200 + 1)
      expect(lines.at(-1)).toBe('  203 more declarations omitted')
      expect(text(built)).not.toContain('xxxxxxxx')
      const block = await connection.client.callTool({ name: 'repository_packet', arguments: { mode: 'build', spec: { sources: [{ path: 'large.ts', startLine: 5, endLine: 7 }] }, expectedGeneration: generation } }) as { isError?: boolean; content?: unknown }
      expect(block.isError).not.toBe(true)
      expect(text(block)).toContain('5:   get(key: string) {')
    } finally { await connection.close() }
  })
})

describe('fixture repository isolation', () => {
  it('runs without inherited Git hook variables', () => {
    expect(Object.keys(process.env).filter((key) => key.startsWith('GIT_'))).toEqual([])
  })
})
