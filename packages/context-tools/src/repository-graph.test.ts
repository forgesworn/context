import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RepositoryNavigation } from './repository-navigation.js'
import { buildRepositoryGraph, queryRepositoryGraph } from './repository-graph.js'
import { renderGraphViewer } from './graph-viewer.js'
import { createRepositoryNavigationServer } from './repository-navigation-mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

const owned: string[] = []
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'context-graph-'))); owned.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":".","paths":{"@api/*":["src/*"]}}}')
  await writeFile(join(root, 'src/api.ts'), 'export function target() { return 1 }\n')
  await writeFile(join(root, 'src/index.ts'), "export { target as run } from './api.js'\n")
  await writeFile(join(root, 'consumer.ts'), "import { run } from '@api/index'\nexport function invoke() { return run() }\nexport function shadow(run: () => number) { return run() }\n")
  const navigation = new RepositoryNavigation(root); await navigation.refresh()
  return { root, navigation }
}

describe('derived repository graph and local exploration', () => {
  it('does not bind same-line parameters or locals to another declaration', async () => {
    const { root, navigation } = await fixture()
    await writeFile(join(root, 'scope.ts'), 'export function target() { return 1 }; export function shadow(target: () => number) {\n  return target()\n}\nexport function direct() { return target() }\n')
    await navigation.refresh()
    const graph = await buildRepositoryGraph(navigation)
    const target = graph.nodes.find(n => n.path === 'scope.ts' && n.name === 'target')!, shadow = graph.nodes.find(n => n.name === 'shadow' && n.path === 'scope.ts')!, direct = graph.nodes.find(n => n.name === 'direct')!
    expect(graph.edges.some(e => e.from === shadow.id && e.to === target.id && e.kind === 'calls')).toBe(false)
    expect(graph.edges.some(e => e.from === direct.id && e.to === target.id && e.kind === 'calls')).toBe(true)
  })
  it('does not establish calls through type-only barrel exports', async () => {
    const { root, navigation } = await fixture()
    await writeFile(join(root, 'type-barrel.ts'), "export type * from './src/api.js'\n")
    await writeFile(join(root, 'type-consumer.ts'), "import { target } from './type-barrel.js'\nexport function invalid() { target() }\n")
    await navigation.refresh()
    const graph = await buildRepositoryGraph(navigation)
    const invalid = graph.nodes.find(n => n.name === 'invalid')!
    expect(graph.edges.some(e => e.from === invalid.id && e.kind === 'calls')).toBe(false)
  })
  it('does not attribute an unindexed callback call to the enclosing factory', async () => {
    const { root, navigation } = await fixture()
    await writeFile(join(root, 'callbacks.ts'), 'export function target() {}\nexport function factory() { return () => target() }\n')
    await navigation.refresh()
    const graph = await buildRepositoryGraph(navigation)
    const factory = graph.nodes.find(n => n.name === 'factory')!
    expect(graph.edges.some(e => e.from === factory.id && e.kind === 'calls')).toBe(false)
  })
  it('follows aliases, excludes shadowed calls and reports reverse impact/path candidates', async () => {
    const { navigation } = await fixture()
    const graph = await buildRepositoryGraph(navigation, { project: 'tsconfig.json' })
    const target = graph.nodes.find(n => n.name === 'target')!, invoke = graph.nodes.find(n => n.name === 'invoke')!, shadow = graph.nodes.find(n => n.name === 'shadow')!
    expect(graph.edges).toContainEqual({ from: invoke.id, to: target.id, kind: 'calls', method: 'typescript-binding', path: 'consumer.ts', line: 2 })
    expect(graph.edges.some(e => e.from === shadow.id && e.to === target.id)).toBe(false)
    expect(queryRepositoryGraph(graph, { action: 'impact', from: target.id }).nodes).toContainEqual(invoke)
    expect(queryRepositoryGraph(graph, { action: 'path', from: invoke.id, to: target.id }).found).toBe(true)
    expect(queryRepositoryGraph(graph, { action: 'path', from: shadow.id, to: target.id }).found).toBe(false)
    expect(() => queryRepositoryGraph(graph, { action: 'neighbours', from: 'missing' })).toThrow(/unambiguous/)
  })
  it('returns Rust/Kotlin spans and labels their references as uncertain candidates', async () => {
    const { root, navigation } = await fixture()
    await writeFile(join(root, 'lib.rs'), 'pub fn target() {}\npub fn invoke() { target(); }\n')
    await writeFile(join(root, 'Api.kt'), 'package demo\n\nfun decorate(x: String): String {\n    return x\n}\n')
    await navigation.refresh()
    const graph = await buildRepositoryGraph(navigation)
    expect(graph.nodes.find(n => n.language === 'kotlin' && n.name === 'decorate')).toMatchObject({ startLine: 3, endLine: 5 })
    const rustIds = new Set(graph.nodes.filter(n => n.language === 'rust').map(n => n.id))
    expect(graph.edges.filter(e => rustIds.has(e.from) && e.kind === 'references')).toMatchObject([{ method: 'name-candidate' }])
    const explored = await navigation.explore({ symbol: 'decorate' })
    expect(explored.definitions[0]).toMatchObject({ path: 'Api.kt', startLine: 3, endLine: 5 })
  })
  it('rejects stale source and excludes ignored or symlinked evidence', async () => {
    const { root, navigation } = await fixture()
    await writeFile(join(root, '.gitignore'), 'ignored.ts\n')
    await writeFile(join(root, 'ignored.ts'), 'export function secret() {}')
    await symlink(join(root, 'ignored.ts'), join(root, 'alias.ts'))
    await navigation.refresh()
    const graph = await buildRepositoryGraph(navigation)
    expect(graph.sources.some(s => /ignored|alias/.test(s.path))).toBe(false)
    await writeFile(join(root, 'src/api.ts'), 'export const changed = true\n')
    await expect(buildRepositoryGraph(navigation)).rejects.toThrow(/current|changed/)
  })
  it('exports hostile source as data with a restrictive offline CSP', async () => {
    const { root, navigation } = await fixture()
    await writeFile(join(root, 'hostile.ts'), 'export const label = "</script><img src=https://attacker.invalid/x onerror=alert(1)>"\n')
    await navigation.refresh()
    const html = renderGraphViewer(await buildRepositoryGraph(navigation))
    expect(html).toContain("connect-src 'none'")
    expect(html).not.toContain('</script><img')
    expect(html).toContain('\\u003c/script\\u003e')
    expect(html).not.toContain('innerHTML')
    expect(html).not.toContain('file://')
  })
  it('exposes bounded MCP queries and rejects wrong roots and stale generations', async () => {
    const { root } = await fixture(), bound = createRepositoryNavigationServer(root)
    const [a, b] = InMemoryTransport.createLinkedPair(); await bound.server.connect(b)
    const client = new Client({ name: 'graph-test', version: '1' }); await client.connect(a)
    try {
      const call = (args: any) => client.callTool({ name: 'repository_graph', arguments: args })
      expect((await call({ expectedRoot: root + '/wrong' })).isError).toBe(true)
      const result: any = await call({ expectedRoot: root, query: { action: 'symbol', symbol: 'target', maxBytes: 2048 } })
      expect(result.isError).not.toBe(true)
      expect(Buffer.byteLength(result.content[0].text)).toBeLessThanOrEqual(2048)
      const data = JSON.parse(result.content[0].text)
      expect(data.nodes[0].name).toBe('target')
      expect(data.sources).toBeUndefined()
      expect((await call({ expectedGeneration: 'wrong' })).isError).toBe(true)
    } finally { await client.close(); await bound.server.close() }
  })
  it('rejects a refresh that lands after the expected generation precheck', async () => {
    const { root } = await fixture(), bound = createRepositoryNavigationServer(root)
    const initial = await bound.navigation.refresh()
    const read = bound.navigation.graphFiles.bind(bound.navigation)
    vi.spyOn(bound.navigation, 'graphFiles').mockImplementationOnce(async (...args) => {
      // A concurrent refresh can publish between the handler precheck and read.
      await bound.navigation.refresh()
      return read(...args)
    })
    const [a, b] = InMemoryTransport.createLinkedPair(); await bound.server.connect(b)
    const client = new Client({ name: 'graph-race-test', version: '1' }); await client.connect(a)
    try {
      const result = await client.callTool({ name: 'repository_graph', arguments: { expectedRoot: root, expectedGeneration: initial.generation } })
      expect(result.isError).toBe(true)
      expect(result.content).toMatchObject([{ text: expect.stringMatching(/generation mismatch/) }])
    } finally { await client.close(); await bound.server.close() }
  })
})
