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
  it('lists the repository navigation and packet tools', async () => {
    const root = await makeRoot()
    const { client, serverClose } = await connect(root)
    try {
      const tools = await client.listTools()
      const names = tools.tools.map((t) => t.name).sort()
      expect(names).toEqual(['repository_packet', 'repository_refresh', 'repository_search', 'repository_status'])
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
        arguments: { term: 'alphaToken', maxBytes: 8192 },
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
        arguments: { term: 'alphaToken', maxResults: 1 },
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
        arguments: { term: 'alphaToken', maxResults: 1, cursor: firstParsed.nextCursor },
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
        arguments: { term: 'alphaToken', maxResults: 1 },
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
        arguments: { term: 'uniqueA' },
      })) as { content: Array<{ type: string; text: string }>; isError?: boolean }
      expect(inA.isError).not.toBe(true)
      const parsedA = JSON.parse(textOf(inA)) as {
        results: Array<{ path: string; text: string }>
      }
      expect(parsedA.results.length).toBe(1)
      expect(parsedA.results[0].text).toContain('uniqueA')
      const inB = (await b.client.callTool({
        name: 'repository_search',
        arguments: { term: 'uniqueA' },
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
