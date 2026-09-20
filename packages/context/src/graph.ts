import type { ContextProvenance, ContextRecord, ContextRelationKind, ContextView } from './index.js'

export interface ContextGraphOptions {
  query: string
  maxBytes?: number
  maxNodes?: number
  maxDepth?: number
}
export interface ContextGraphPathOptions {
  from: string
  to: string
  maxBytes?: number
  maxDepth?: number
}
export interface ContextGraphNode {
  id: string
  kind: ContextRecord['kind']
  label: string
  source: string
  observedAt: number
  author: string
  event: string
  provenance?: ContextProvenance
  match: 'query' | 'related'
  depth: number
}
export interface ContextGraphEdge { from: string; to: string; kind: ContextRelationKind }
interface GraphProvenance {
  collection: string; head: string; revision: number; updatedAt: number
  scope: ContextView['scope']; room?: string
  derivedOnly: true; cachedRevision: true
}
export interface ContextGraph extends GraphProvenance {
  query: string
  nodes: ContextGraphNode[]
  edges: ContextGraphEdge[]
  availableNodes: number
  omitted: number
  maxBytes: number
  bytesUsed: number
}
export interface ContextGraphPath extends GraphProvenance {
  from: string
  to: string
  found: boolean
  nodes: Omit<ContextGraphNode, 'match' | 'depth'>[]
  edges: ContextGraphEdge[]
  maxBytes: number
  bytesUsed: number
}

type RecordView = ContextView['records'][number]
const encoder = new TextEncoder()
const hex = /^[0-9a-f]{64}$/
const stop = new Set('a an and are as at be by for from how i in is it of on or that the this to was we what which with'.split(' '))
function words(text: string): Set<string> {
  return new Set((text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !stop.has(word)))
}
function label(text: string): string {
  const points = [...text.replace(/\s+/gu, ' ').trim()]
  return points.length <= 160 ? points.join('') : `${points.slice(0, 157).join('')}...`
}
function compact(record: RecordView): Omit<ContextGraphNode, 'match' | 'depth'> {
  return { id: record.id, kind: record.kind, label: label(record.text), source: record.source,
    observedAt: record.observedAt, author: record.author, event: record.event,
    ...(record.provenance ? { provenance: structuredClone(record.provenance) } : {}) }
}
function settle<T extends { bytesUsed: number }>(result: T): number {
  let bytes = encoder.encode(JSON.stringify(result)).length
  while (result.bytesUsed !== bytes) {
    result.bytesUsed = bytes
    bytes = encoder.encode(JSON.stringify(result)).length
  }
  return bytes
}
function provenance(view: ContextView): GraphProvenance {
  return { collection: view.id, head: view.head, revision: view.revision, updatedAt: view.updatedAt,
    scope: view.scope, ...(view.room ? { room: view.room } : {}), derivedOnly: true, cachedRevision: true }
}
function edges(records: RecordView[]): ContextGraphEdge[] {
  const visible = new Set(records.map(record => record.id))
  return records.flatMap(record => (record.relations ?? [])
    .filter(link => visible.has(link.to)).map(link => ({ from: record.id, to: link.to, kind: link.kind })))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind))
}
function neighbours(id: string, allEdges: ContextGraphEdge[]): string[] {
  return [...new Set(allEdges.flatMap(edge => edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []))].sort()
}
function limits(maxBytes: number, maxDepth: number, depthLimit: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 32768) throw new Error('Context graph budget must be 1024 to 32768 bytes.')
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > depthLimit) throw new Error(`Context graph depth must be 0 to ${depthLimit}.`)
}

/** A disposable relationship view of one already-authorised corrected snapshot. */
export function graphView(view: ContextView, options: ContextGraphOptions): ContextGraph {
  const { query, maxBytes = 8192, maxNodes = 20, maxDepth = 2 } = options
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Provide a context graph query of 1 to 500 characters.')
  limits(maxBytes, maxDepth, 4)
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 40) throw new Error('Context graph allows 1 to 40 nodes.')
  const terms = words(query)
  const ranked = view.records.map(record => ({ record, score: [...terms].filter(term => words(`${record.text}\n${record.source}`).has(term)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.record.observedAt - a.record.observedAt || a.record.id.localeCompare(b.record.id))
  const allEdges = edges(view.records)
  const selected = new Map<string, { record: RecordView; depth: number; match: 'query' | 'related' }>()
  const queue: { id: string; depth: number }[] = []
  for (const { record } of ranked) if (!selected.has(record.id)) {
    selected.set(record.id, { record, depth: 0, match: 'query' }); queue.push({ id: record.id, depth: 0 })
  }
  const byId = new Map(view.records.map(record => [record.id, record]))
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]
    if (current.depth >= maxDepth) continue
    for (const id of neighbours(current.id, allEdges)) {
      if (selected.has(id)) continue
      const record = byId.get(id)
      if (!record) continue
      selected.set(id, { record, depth: current.depth + 1, match: 'related' })
      queue.push({ id, depth: current.depth + 1 })
    }
  }
  const candidates = [...selected.values()]
  const limited = candidates.slice(0, maxNodes)
  const result: ContextGraph = { ...provenance(view), query, nodes: [], edges: [], availableNodes: candidates.length,
    omitted: candidates.length, maxBytes, bytesUsed: 0 }
  if (settle(result) > maxBytes) throw new Error('Context graph budget is too small for query provenance.')
  for (const candidate of limited) {
    result.nodes.push({ ...compact(candidate.record), match: candidate.match, depth: candidate.depth })
    const ids = new Set(result.nodes.map(node => node.id))
    result.edges = allEdges.filter(edge => ids.has(edge.from) && ids.has(edge.to))
    result.omitted = candidates.length - result.nodes.length
    if (settle(result) > maxBytes) {
      result.nodes.pop()
      const kept = new Set(result.nodes.map(node => node.id))
      result.edges = allEdges.filter(edge => kept.has(edge.from) && kept.has(edge.to))
      result.omitted = candidates.length - result.nodes.length
      settle(result)
    }
  }
  return result
}

/** Shortest deterministic path over explicit signed links in one authorised view. */
export function graphPath(view: ContextView, options: ContextGraphPathOptions): ContextGraphPath {
  const { from, to, maxBytes = 8192, maxDepth = 6 } = options
  if (!hex.test(from) || !hex.test(to)) throw new Error('Context graph endpoints must be 64-character lowercase hexadecimal record IDs.')
  limits(maxBytes, maxDepth, 8)
  if (maxDepth < 1) throw new Error('Context graph path depth must be 1 to 8.')
  const byId = new Map(view.records.map(record => [record.id, record]))
  const base = { ...provenance(view), from, to, maxBytes, bytesUsed: 0 }
  if (!byId.has(from) || !byId.has(to)) {
    const result: ContextGraphPath = { ...base, found: false, nodes: [], edges: [] }
    if (settle(result) > maxBytes) throw new Error('Context graph budget is too small for path provenance.')
    return result
  }
  const allEdges = edges(view.records)
  const queue: { id: string; depth: number }[] = [{ id: from, depth: 0 }]
  const parent = new Map<string, string>()
  const visited = new Set([from])
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]
    if (current.id === to) break
    if (current.depth >= maxDepth) continue
    for (const next of neighbours(current.id, allEdges)) if (!visited.has(next)) {
      visited.add(next); parent.set(next, current.id); queue.push({ id: next, depth: current.depth + 1 })
    }
  }
  if (!visited.has(to)) {
    const result: ContextGraphPath = { ...base, found: false, nodes: [], edges: [] }
    if (settle(result) > maxBytes) throw new Error('Context graph budget is too small for path provenance.')
    return result
  }
  const ids = [to]
  while (ids[0] !== from) ids.unshift(parent.get(ids[0])!)
  const idSet = new Set(ids)
  const pathEdges: ContextGraphEdge[] = []
  for (let i = 1; i < ids.length; i++) {
    const edge = allEdges.find(candidate => candidate.from === ids[i - 1] && candidate.to === ids[i] || candidate.to === ids[i - 1] && candidate.from === ids[i])!
    pathEdges.push(edge)
  }
  const result: ContextGraphPath = { ...base, found: true, nodes: ids.map(id => compact(byId.get(id)!)), edges: pathEdges }
  if (settle(result) > maxBytes) throw new Error('Complete context graph path exceeds its byte budget.')
  return result
}
