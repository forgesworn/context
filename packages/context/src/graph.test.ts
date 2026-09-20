import { describe, expect, it } from 'vitest'
import { ContextVault } from './index.js'
import { createNostrIdentity } from './nostr.js'

const now = 1800000000
const identity = createNostrIdentity(new Uint8Array(32).fill(23))
async function fixture() {
  const vault = new ContextVault({ identity, now: () => now })
  let view = await vault.create({ title: 'Portable ecosystem graph', scope: 'personal' })
  async function add(text: string, relations?: { to: string; kind: 'depends-on' | 'implements' | 'calls' }[], source = `fixture://${text.split(' ')[0].toLowerCase()}`) {
    view = await vault.append(view.id, view.head, { kind: 'evidence', text, source, observedAt: now, relations })
    return view.records.at(-1)!
  }
  return { vault, add, view: () => view }
}

describe('bounded authorised context graph', () => {
  it('atomically signs forward links and cycles without exposing a partial snapshot', async () => {
    const f = await fixture()
    const first = '01'.repeat(32), second = '02'.repeat(32)
    const before = f.view()
    const view = await f.vault.appendBatch(before.id, before.head, [
      { id: first, kind: 'evidence', text: 'Package alpha imports package beta', source: 'repo://alpha/package.json', observedAt: now,
        relations: [{ to: second, kind: 'imports' }] },
      { id: second, kind: 'evidence', text: 'Package beta imports package alpha', source: 'repo://beta/package.json', observedAt: now,
        relations: [{ to: first, kind: 'imports' }] },
    ])
    expect(view.revision).toBe(before.revision + 1)
    expect(f.vault.graphPath(view.id, { from: first, to: second })).toMatchObject({ found: true,
      edges: [{ from: first, to: second, kind: 'imports' }] })
    await expect(f.vault.appendBatch(view.id, view.head, [
      { id: '03'.repeat(32), kind: 'evidence', text: 'Broken batch', source: 'repo://broken', observedAt: now,
        relations: [{ to: 'ff'.repeat(32), kind: 'imports' }] },
    ])).rejects.toThrow('unknown record')
    expect(f.vault.read(view.id).head).toBe(view.head)
    expect(f.vault.read(view.id).records).toHaveLength(2)
  })

  it('queries and traverses explicit signed relations without fetching or crossing collections', async () => {
    const f = await fixture()
    const storage = await f.add('Storage envelope encrypts project evidence')
    const context = await f.add('Context vault depends on encrypted storage', [{ to: storage.id, kind: 'depends-on' }])
    const adapter = await f.add('Repository adapter calls the context vault', [{ to: context.id, kind: 'calls' }])
    const graph = f.vault.graph(f.view().id, { query: 'repository adapter', maxDepth: 2 })
    expect(graph.nodes.map(node => node.id)).toEqual([adapter.id, context.id, storage.id])
    expect(graph.edges).toEqual(expect.arrayContaining([
      { from: adapter.id, to: context.id, kind: 'calls' },
      { from: context.id, to: storage.id, kind: 'depends-on' },
    ]))
    expect(graph).toMatchObject({ collection: f.view().id, derivedOnly: true, cachedRevision: true, omitted: 0 })
    expect(new TextEncoder().encode(JSON.stringify(graph))).toHaveLength(graph.bytesUsed)

    const path = f.vault.graphPath(f.view().id, { from: storage.id, to: adapter.id })
    expect(path.found).toBe(true)
    expect(path.nodes.map(node => node.id)).toEqual([storage.id, context.id, adapter.id])
    expect(path.edges).toHaveLength(2)
  })

  it('validates signed links and hides absent or corrected endpoints', async () => {
    const f = await fixture()
    const first = await f.add('First component')
    await expect(f.add('Broken component', [{ to: 'ff'.repeat(32), kind: 'calls' }])).rejects.toThrow('unknown record')
    await expect(f.add('Self-like invalid target', [{ to: f.view().id, kind: 'calls' }])).rejects.toThrow('unknown record')
    const missing = f.vault.graphPath(f.view().id, { from: first.id, to: 'ee'.repeat(32) })
    expect(missing).toMatchObject({ found: false, nodes: [], edges: [] })
  })

  it('keeps complete nodes inside exact byte and depth limits', async () => {
    const f = await fixture()
    const root = await f.add('Root ' + '界'.repeat(1200))
    await f.add('Small dependent component', [{ to: root.id, kind: 'depends-on' }])
    const graph = f.vault.graph(f.view().id, { query: 'component', maxBytes: 1024, maxDepth: 0 })
    expect(graph.nodes).toHaveLength(1)
    expect(graph.edges).toEqual([])
    expect(graph.bytesUsed).toBeLessThanOrEqual(1024)
    expect([...graph.nodes[0].label].length).toBeLessThanOrEqual(160)
    expect(() => f.vault.graph(f.view().id, { query: '', maxDepth: 9 })).toThrow()
  })

  it('reports nodes omitted by the node cap as well as the byte budget', async () => {
    const f = await fixture()
    await f.add('Shared component one')
    await f.add('Shared component two')
    await f.add('Shared component three')
    const graph = f.vault.graph(f.view().id, { query: 'shared component', maxNodes: 1 })
    expect(graph).toMatchObject({ availableNodes: 3, omitted: 2 })
    expect(graph.nodes).toHaveLength(1)
  })

  it('drops stale topology when a related record is corrected', async () => {
    const f = await fixture()
    const target = await f.add('Shared storage component')
    const stale = await f.add('Old adapter depends on storage', [{ to: target.id, kind: 'depends-on' }])
    let view = f.view()
    view = await f.vault.append(view.id, view.head, { kind: 'evidence', text: 'Corrected adapter has no dependency',
      source: 'fixture://adapter-v2', observedAt: now, supersedes: stale.id })
    const graph = f.vault.graph(view.id, { query: 'storage', maxDepth: 4 })
    expect(graph.nodes.map(node => node.id)).toEqual([target.id])
    expect(graph.edges).toEqual([])
    expect(f.vault.graphPath(view.id, { from: target.id, to: stale.id })).toMatchObject({ found: false, nodes: [], edges: [] })
  })

  it('chooses a deterministic shortest path and refuses to truncate it', async () => {
    const f = await fixture()
    const root = await f.add('Root system', undefined, `fixture://${'r'.repeat(980)}`)
    const left = await f.add('Left bridge', [{ to: root.id, kind: 'depends-on' }])
    const right = await f.add('Right bridge', [{ to: root.id, kind: 'depends-on' }])
    const end = await f.add('End system', [
      { to: left.id, kind: 'calls' }, { to: right.id, kind: 'calls' },
    ], `fixture://${'e'.repeat(980)}`)
    const expectedMiddle = [left.id, right.id].sort()[0]
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(f.vault.graphPath(f.view().id, { from: root.id, to: end.id }).nodes.map(node => node.id)).toEqual([root.id, expectedMiddle, end.id])
    }
    expect(() => f.vault.graphPath(f.view().id, { from: root.id, to: end.id, maxBytes: 1024 })).toThrow('exceeds')
  })
})
