import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createRepositoryNavigationServer } from './repository-navigation-mcp.js'

const created: string[] = []

async function makeRoot(seed: { alpha?: string; beta?: string } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'repo-nav-mcp-'))
  created.push(root)
  await writeFile(join(root, 'alpha.ts'), seed.alpha ?? 'export const alphaToken = 1\n')
  await writeFile(join(root, 'beta.ts'), seed.beta ?? 'export const betaToken = 2\n')
  return root
}

interface Connected {
  client: Client
  serverClose: () => Promise<void>
}

async function connect(root: string): Promise<Connected> {
  const { server } = createRepositoryNavigationServer(root)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  return {
    client,
    serverClose: async () => {
      await client.close()
      await server.close()
    },
  }
}

function textOf(result: { content?: unknown }): string {
  const content = result.content
  if (!Array.isArray(content) || content.length === 0) throw new Error('no content')
  const first = content[0] as { type?: string; text?: string }
  if (first.type !== 'text' || typeof first.text !== 'string') throw new Error('bad content')
  return first.text
}

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('repository navigation MCP adapter', () => {
  it('keeps the per-session instructions and tool listing within a fixed byte budget', async () => {
    // Every client session carries this text before any work; it was 8207 bytes
    // before the trim recorded in docs/SAVINGS-PLAN.md.
    const root = await makeRoot()
    const { client, serverClose } = await connect(root)
    try {
      const { tools } = await client.listTools()
      const bytes = Buffer.byteLength(client.getInstructions() ?? '') +
        tools.reduce((sum, tool) => sum + Buffer.byteLength(JSON.stringify(tool)), 0)
      expect(bytes).toBeLessThanOrEqual(6200)
    } finally {
      await serverClose()
    }
  })

  it('lists the repository navigation and packet tools', async () => {
    const root = await makeRoot()
    const { client, serverClose } = await connect(root)
    try {
      const tools = await client.listTools()
      const names = tools.tools.map((t) => t.name).sort()
      expect(names).toEqual(['repository_coverage', 'repository_explore', 'repository_packet', 'repository_refresh', 'repository_search', 'repository_status'])
    } finally {
      await serverClose()
    }
  })

  it('reports null generation before refresh, errors on early search, then serves after refresh', async () => {
    const root = await makeRoot()
    const { client, serverClose } = await connect(root)
    try {
      const status = (await client.callTool({ name: 'repository_status', arguments: {} })) as {
        content: Array<{ type: string; text: string }>
        isError?: boolean
      }
      expect(status.isError).not.toBe(true)
      const parsedStatus = JSON.parse(textOf(status)) as {
        generation: string | null
        freshness: string
        revision: string | null
        policy: { freshness: string; digest: string | null }
      }
      expect(parsedStatus.generation).toBeNull()
      expect(parsedStatus.freshness).toBe('unavailable')
      expect(parsedStatus.revision).toBeNull()
      expect(parsedStatus.policy).toEqual({ freshness: 'unavailable', digest: null })

      const early = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'alphaToken' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(early.isError).toBe(true)

      const refreshed = (await client.callTool({
        name: 'repository_refresh',
        arguments: {},
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(refreshed.isError).not.toBe(true)
      const refreshedStatus = JSON.parse(textOf(refreshed)) as {
        generation: string | null
        freshness: string
        revision: string | null
        policy: { freshness: string; digest: string | null; summary?: unknown }
      }
      expect(typeof refreshedStatus.generation).toBe('string')
      expect(refreshedStatus.freshness).toBe('current')
      expect(refreshedStatus.revision).toMatch(/^[a-f0-9]{64}$/)
      expect(refreshedStatus.policy.freshness).toBe('current')
      expect(refreshedStatus.policy.digest).toMatch(/^[a-f0-9]{64}$/)
      expect(refreshedStatus.policy.summary).toBeTruthy()

      const afterRefresh = (await client.callTool({
        name: 'repository_status',
        arguments: {},
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(afterRefresh.isError).not.toBe(true)
      const afterStatus = JSON.parse(textOf(afterRefresh)) as {
        generation: string | null
        freshness: string
      }
      expect(afterStatus.generation).toBe(refreshedStatus.generation)
      expect(afterStatus.freshness).toBe('current')
    } finally {
      await serverClose()
    }
  })

  it('returns exact UTF8 byte count within budget for a precise search', async () => {
    const root = await makeRoot()
    const { client, serverClose } = await connect(root)
    try {
      await client.callTool({ name: 'repository_refresh', arguments: {} })
      const result = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'alphaToken', maxBytes: 8192, format: 'json' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(result.isError).not.toBe(true)
      const text = textOf(result)
      const parsed = JSON.parse(text) as {
        bytesUsed: number
        freshness: string
        results: Array<{ path: string; line: number; text: string }>
      }
      expect(parsed.bytesUsed).toBe(Buffer.byteLength(text, 'utf8'))
      expect(parsed.bytesUsed).toBeLessThanOrEqual(8192)
      expect(parsed.freshness).toBe('current')
      expect(parsed.results.length).toBeGreaterThanOrEqual(1)
      expect(parsed.results[0].path).toBe('alpha.ts')
      expect(parsed.results[0].text).toContain('alphaToken')
    } finally {
      await serverClose()
    }
  })

  it('supports paging via nextCursor with maxResults=1 and rejects bad arguments', async () => {
    const alpha = 'alphaToken\n'.repeat(4)
    const root = await makeRoot({ alpha })
    const { client, serverClose } = await connect(root)
    try {
      await client.callTool({ name: 'repository_refresh', arguments: {} })
      const first = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'alphaToken', maxResults: 1, format: 'json' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(first.isError).not.toBe(true)
      const firstParsed = JSON.parse(textOf(first)) as {
        results: Array<{ path: string; line: number; text: string }>
        nextCursor: string
      }
      expect(firstParsed.results.length).toBe(1)
      expect(firstParsed.results[0].path).toBe('alpha.ts')
      expect(firstParsed.results[0].line).toBe(1)
      expect(firstParsed.results[0].text).toContain('alphaToken')
      expect(typeof firstParsed.nextCursor).toBe('string')
      expect(firstParsed.nextCursor.length).toBeGreaterThan(0)

      const second = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'alphaToken', maxResults: 1, cursor: firstParsed.nextCursor, format: 'json' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(second.isError).not.toBe(true)
      const secondParsed = JSON.parse(textOf(second)) as {
        results: Array<{ path: string; line: number; text: string }>
      }
      expect(secondParsed.results.length).toBe(1)
      expect(secondParsed.results[0].path).toBe('alpha.ts')
      expect(secondParsed.results[0].line).toBe(2)
      expect(secondParsed.results[0].text).toContain('alphaToken')

      let badArgumentOutcome: unknown
      try {
        badArgumentOutcome = await client.callTool({
          name: 'repository_search',
          arguments: { term: 'not a valid identifier!' },
        })
      } catch (error) {
        badArgumentOutcome = error
      }
      const isStructuredRejection =
        (typeof badArgumentOutcome === 'object' &&
          badArgumentOutcome !== null &&
          ((badArgumentOutcome as { code?: number }).code === -32602 ||
            (badArgumentOutcome as { isError?: boolean }).isError === true)) ||
        false
      expect(isStructuredRejection).toBe(true)

      const valid = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'betaToken', maxResults: 1 },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(valid.isError).not.toBe(true)
    } finally {
      await serverClose()
    }
  })

  it('bumps generation after a refresh and rejects stale cursors', async () => {
    const alpha = 'alphaToken\n'.repeat(4)
    const root = await makeRoot({ alpha })
    const { client, serverClose } = await connect(root)
    try {
      const first = (await client.callTool({
        name: 'repository_refresh',
        arguments: {},
      })) as { content: Array<{ type: string; text: string }> }
      const firstGen = (JSON.parse(textOf(first)) as { generation: string }).generation

      const page = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'alphaToken', maxResults: 1, format: 'json' },
      })) as { content: Array<{ type: string; text: string }> }
      const pageBody = JSON.parse(textOf(page)) as { nextCursor: string }
      const staleCursor = pageBody.nextCursor
      expect(typeof staleCursor).toBe('string')
      expect(staleCursor.length).toBeGreaterThan(0)

      await writeFile(join(root, 'gamma.ts'), 'export const alphaToken = 3\n')
      const second = (await client.callTool({
        name: 'repository_refresh',
        arguments: {},
      })) as { content: Array<{ type: string; text: string }> }
      const secondGen = (JSON.parse(textOf(second)) as { generation: string }).generation
      expect(secondGen).not.toBe(firstGen)

      const stale = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'alphaToken', maxResults: 1, cursor: staleCursor },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(stale.isError).toBe(true)
    } finally {
      await serverClose()
    }
  })

  it('keeps two server roots isolated', async () => {
    const rootA = await makeRoot({ alpha: 'export const uniqueA = 1\n' })
    const rootB = await makeRoot({ alpha: 'export const uniqueB = 2\n' })
    const a = await connect(rootA)
    const b = await connect(rootB)
    try {
      await a.client.callTool({ name: 'repository_refresh', arguments: {} })
      await b.client.callTool({ name: 'repository_refresh', arguments: {} })
      const inA = (await a.client.callTool({
        name: 'repository_search',
        arguments: { term: 'uniqueA', format: 'json' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(inA.isError).not.toBe(true)
      const parsedA = JSON.parse(textOf(inA)) as {
        results: Array<{ path: string; text: string }>
      }
      expect(parsedA.results.length).toBe(1)
      expect(parsedA.results[0].text).toContain('uniqueA')
      const inB = (await b.client.callTool({
        name: 'repository_search',
        arguments: { term: 'uniqueA', format: 'json' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(inB.isError).not.toBe(true)
      const parsedB = JSON.parse(textOf(inB)) as { results?: unknown[] }
      expect(parsedB.results?.length ?? 0).toBe(0)
    } finally {
      await a.serverClose()
      await b.serverClose()
    }
  })

  it('rejects invalid input to every tool and keeps serving valid calls afterwards', async () => {
    const root = await makeRoot()
    const { client, serverClose } = await connect(root)
    try {
      await client.callTool({ name: 'repository_refresh', arguments: {} })

      const expectRejection = async (name: string, args: Record<string, unknown>) => {
        let outcome: unknown
        try {
          outcome = await client.callTool({ name, arguments: args })
        } catch (error) {
          outcome = error
        }
        const rejected =
          (typeof outcome === 'object' &&
            outcome !== null &&
            ((outcome as { code?: number }).code === -32602 ||
              (outcome as { isError?: boolean }).isError === true)) ||
          false
        expect(rejected).toBe(true)
      }

      await expectRejection('repository_status', { unexpected: 1 })
      await expectRejection('repository_refresh', { unexpected: 1 })
      await expectRejection('repository_search', { term: 'alphaToken', unexpected: 1 })
      await expectRejection('repository_search', { term: 'not a valid identifier!' })
      await expectRejection('repository_search', { term: 'alphaToken', cursor: 'x'.repeat(65) })

      const status = (await client.callTool({
        name: 'repository_status',
        arguments: {},
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(status.isError).not.toBe(true)
      const refreshed = (await client.callTool({
        name: 'repository_refresh',
        arguments: {},
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(refreshed.isError).not.toBe(true)
      const searched = (await client.callTool({
        name: 'repository_search',
        arguments: { term: 'alphaToken' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(searched.isError).not.toBe(true)
    } finally {
      await serverClose()
    }
  })
})

describe('repository navigation MCP compact rendering and explore', () => {
  const OWNERSHIP = [
    '/** Options bound to the owner. */',
    'export function ownerOptions(input: string): string {',
    '  return input',
    '}',
    'export class Store {',
    '  write(value: string): string { return ownerOptions(value) }',
    '}',
    '',
  ].join('\n')
  const SERVER = "import { ownerOptions, Store } from './ownership.js'\nexport const createServer = () => new Store().write(ownerOptions('root'))\n"
  const TEST = "import { it, expect } from 'vitest'\nimport { ownerOptions } from './ownership.js'\nit('returns its input', () => {\n  expect(ownerOptions('a')).toBe('a')\n})\n"

  async function symbolRoot(): Promise<string> {
    const root = await makeRoot({ alpha: OWNERSHIP, beta: SERVER })
    await writeFile(join(root, 'beta.test.ts'), TEST)
    return root
  }

  it('renders search pages as grouped text by default with a compact header and cursor hint', async () => {
    const root = await symbolRoot()
    const { client, serverClose } = await connect(root)
    try {
      const refreshed = JSON.parse(textOf(await client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown })) as { generation: string }
      const page = (await client.callTool({ name: 'repository_search', arguments: { term: 'ownerOptions', maxResults: 2 } })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(page.isError).not.toBe(true)
      const lines = textOf(page).split('\n')
      expect(lines[0]).toBe(`search owneroptions  2 lines in 1 files  stopped at max-results (visited 2)  generation ${refreshed.generation}  freshness current  policy current`)
      expect(lines[1]).toMatch(/^alpha\.ts  [a-f0-9]{16}$/)
      expect(lines[2]).toBe('  2: export function ownerOptions(input: string): string {')
      expect(lines[3]).toBe('  6:   write(value: string): string { return ownerOptions(value) }')
      expect(lines[4]).toMatch(/^next: cursor [a-f0-9]{32} with the same term; or narrow with pathPrefix/)
      expect(textOf(page)).not.toContain('sha256')
      const narrowed = (await client.callTool({ name: 'repository_search', arguments: { term: 'ownerOptions', pathPrefix: 'beta' } })) as { content: Array<{ type: string; text: string }> }
      const narrowedLines = textOf(narrowed).split('\n')
      expect(narrowedLines[0]).toMatch(/^search owneroptions  4 lines in 2 files  prefix beta  complete/)
      expect(narrowedLines.filter((line) => /^beta(\.test)?\.ts  [a-f0-9]{16}$/.test(line))).toHaveLength(2)
      expect(narrowedLines.some((line) => line.startsWith('alpha.ts'))).toBe(false)
    } finally {
      await serverClose()
    }
  })

  it('explores a symbol in one call, honours expectedGeneration and maxBytes, and rejects stale navigation', async () => {
    const root = await symbolRoot()
    const { client, serverClose } = await connect(root)
    try {
      const early = (await client.callTool({ name: 'repository_explore', arguments: { symbol: 'ownerOptions' } })) as { isError?: boolean }
      expect(early.isError).toBe(true)
      const refreshed = JSON.parse(textOf(await client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown })) as { generation: string }
      const explored = (await client.callTool({ name: 'repository_explore', arguments: { symbol: 'ownerOptions', expectedGeneration: refreshed.generation } })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(explored.isError).not.toBe(true)
      const text = textOf(explored)
      expect(text.split('\n')[0]).toMatch(new RegExp(`^explore ownerOptions  6 lines in 3 files  generation ${refreshed.generation}  revision [a-f0-9]{16}  freshness current$`))
      expect(text).toMatch(/^definition alpha\.ts:1-4  exported function ownerOptions  sha256 [a-f0-9]{16}$/m)
      expect(text).toContain('1: /** Options bound to the owner. */\n2: export function ownerOptions(input: string): string {\n3:   return input\n4: }')
      expect(text).toContain("tests 1 lines in 1 files\nbeta.test.ts\n  4 in it('returns its input'):   expect(ownerOptions('a')).toBe('a')")
      expect(text).toContain('references 2 lines in 2 files\nalpha.ts\n  6 in Store.write:   write(value: string): string { return ownerOptions(value) }\nbeta.ts\n  2 in createServer: export const createServer = () => new Store().write(ownerOptions(\'root\'))')
      expect(text).toContain('imports 2 files: beta.test.ts, beta.ts')

      const mismatch = (await client.callTool({ name: 'repository_explore', arguments: { symbol: 'ownerOptions', expectedGeneration: 'other' } })) as { isError?: boolean; content: Array<{ text: string }> }
      expect(mismatch.isError).toBe(true)
      expect(mismatch.content[0].text).toMatch(/expectedGeneration/)

      const json = (await client.callTool({ name: 'repository_explore', arguments: { symbol: 'Store.write', format: 'json' } })) as { content: Array<{ text: string }>; isError?: boolean }
      expect(json.isError).not.toBe(true)
      const parsed = JSON.parse(textOf(json)) as { definitions: Array<{ name: string; kind: string }>; references: Array<{ path: string; scope: string }>; generation: string }
      expect(parsed.generation).toBe(refreshed.generation)
      expect(parsed.definitions).toEqual([expect.objectContaining({ name: 'Store.write', kind: 'method' })])
      expect(parsed.references).toEqual([expect.objectContaining({ path: 'beta.ts', scope: 'in createServer' })])

      const tight = (await client.callTool({ name: 'repository_explore', arguments: { symbol: 'ownerOptions', maxBytes: 1024 } })) as { content: Array<{ text: string }>; isError?: boolean }
      expect(tight.isError).not.toBe(true)
      expect(Buffer.byteLength(textOf(tight), 'utf8')).toBeLessThanOrEqual(1024)

      let invalid: unknown
      try { invalid = await client.callTool({ name: 'repository_explore', arguments: { symbol: 'two words' } }) } catch (error) { invalid = error }
      expect((invalid as { code?: number }).code === -32602 || (invalid as { isError?: boolean }).isError === true).toBe(true)

      await writeFile(join(root, 'beta.ts'), SERVER + '// edited\n')
      const stale = (await client.callTool({ name: 'repository_explore', arguments: { symbol: 'ownerOptions' } })) as { isError?: boolean; content: Array<{ text: string }> }
      expect(stale.isError).toBe(true)
      expect(stale.content[0].text).toMatch(/requires current navigation/)
    } finally {
      await serverClose()
    }
  })

  it('reports which explored files a draft answer leaves uncited', async () => {
    const root = await symbolRoot()
    const { client, serverClose } = await connect(root)
    try {
      const refreshed = JSON.parse(textOf(await client.callTool({ name: 'repository_refresh', arguments: {} }) as { content: unknown })) as { generation: string }
      const draft = 'ownerOptions is defined in alpha.ts and called from beta.ts.'
      const checked = (await client.callTool({ name: 'repository_coverage', arguments: { symbols: ['ownerOptions'], answer: draft, expectedGeneration: refreshed.generation } })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(checked.isError).not.toBe(true)
      const lines = textOf(checked).split('\n')
      expect(lines[0]).toMatch(new RegExp(`^coverage ownerOptions  3 files: 1 missing, 0 named, 2 cited  generation ${refreshed.generation}  revision [a-f0-9]{16}  freshness current$`))
      expect(lines[1]).toBe("missing test beta.test.ts  [ownerOptions]  in it('returns its input')")
      expect(lines[2]).toBe('cited: alpha.ts, beta.ts')
      expect(lines[3]).toMatch(/^next: address each missing or named file/)

      const json = (await client.callTool({ name: 'repository_coverage', arguments: { symbols: ['ownerOptions', 'Store.write'], answer: `${draft} Tests: beta.test.ts.`, format: 'json' } })) as { content: Array<{ text: string }>; isError?: boolean }
      expect(json.isError).not.toBe(true)
      const parsed = JSON.parse(textOf(json)) as { counts: Record<string, number>; files: Array<{ path: string; role: string; status: string; symbols: string[] }> }
      expect(parsed.counts).toEqual({ missing: 0, named: 0, cited: 3 })
      expect(parsed.files.find((file) => file.path === 'alpha.ts')).toMatchObject({ role: 'definition', symbols: ['Store.write', 'ownerOptions'] })

      const mismatch = (await client.callTool({ name: 'repository_coverage', arguments: { symbols: ['ownerOptions'], answer: draft, expectedGeneration: 'other' } })) as { isError?: boolean; content: Array<{ text: string }> }
      expect(mismatch.isError).toBe(true)
      expect(mismatch.content[0].text).toMatch(/expectedGeneration/)

      const quoted = (await client.callTool({ name: 'repository_coverage', arguments: { answer: draft, evidence: [
        { path: 'alpha.ts', token: 'export function ownerOptions(input: string): string {' },
        { path: 'alpha.ts', token: 'export class Store { write(value: string)' },
        { path: 'alpha.ts', token: 'not in the file' },
        { path: 'missing.ts', token: 'x' },
      ], format: 'json' } })) as { content: Array<{ text: string }>; isError?: boolean }
      expect(quoted.isError).not.toBe(true)
      const quotes = (JSON.parse(textOf(quoted)) as { quotes: Array<{ status: string; line?: number; exact?: string }> }).quotes
      expect(quotes.map((quote) => quote.status)).toEqual(['verbatim', 'whitespace', 'not-found', 'unindexed'])
      expect(quotes[1]).toMatchObject({ line: 5, exact: 'export class Store {\n  write(value: string)' })
      const neither = (await client.callTool({ name: 'repository_coverage', arguments: { answer: draft } })) as { isError?: boolean; content: Array<{ text: string }> }
      expect(neither.isError).toBe(true)
      expect(neither.content[0].text).toMatch(/needs symbols, evidence or both/)

      let tooMany: unknown
      try { tooMany = await client.callTool({ name: 'repository_coverage', arguments: { symbols: Array.from({ length: 9 }, (_, i) => `s${i}`), answer: draft } }) } catch (error) { tooMany = error }
      expect((tooMany as { code?: number }).code === -32602 || (tooMany as { isError?: boolean }).isError === true).toBe(true)

      await writeFile(join(root, 'beta.ts'), SERVER + '// edited\n')
      const stale = (await client.callTool({ name: 'repository_coverage', arguments: { symbols: ['ownerOptions'], answer: draft } })) as { isError?: boolean; content: Array<{ text: string }> }
      expect(stale.isError).toBe(true)
      expect(stale.content[0].text).toMatch(/requires current navigation/)
    } finally {
      await serverClose()
    }
  })
})
