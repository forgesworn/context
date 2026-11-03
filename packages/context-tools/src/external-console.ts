import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RepositoryCoordination } from './repository-coordination.js'
import { describeCheckout, git, type Checkout } from './workspace-catalogue.js'
import { WorkspaceStore, workspaceKey } from './workspace-store.js'
import type { ConsoleNote } from './console-inbox.js'
import type { WorkspaceActivityRow } from './workspace-activity-types.js'

const uuid = z.string().uuid(), text = (max: number) => z.string().min(1).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
const externalId = z.string().length(45).refine(value => value.startsWith('external-') && uuid.safeParse(value.slice(9)).success)
const base = { requestId: uuid, id: externalId, expectedRevision: z.number().int().nonnegative() }
export const externalActionSchemas = [
  z.object({ action: z.literal('external-link'), requestId: uuid, root: text(2048), agentId: text(130), expectedAgentRevision: z.number().int().positive() }).strict(),
  z.object({ ...base, action: z.literal('external-note'), text: text(1600) }).strict(),
  z.object({ ...base, action: z.literal('external-read'), messageId: uuid }).strict(),
  z.object({ ...base, action: z.literal('external-remove') }).strict(),
] as const
const actionSchema = z.discriminatedUnion('action', externalActionSchemas)
type Action = z.infer<typeof actionSchema>
export interface ExternalPeer {
  agentId: string; slot: string; label: string; task: string; paths: string[]
  state: 'working' | 'blocked' | 'reviewing' | 'done'; revision: number; updatedAt: number; expiresAt: number
  checkout: Checkout; active: boolean
}
type Peer = ExternalPeer
type Root = { identity: string; checkout: Checkout; groupId: string }
interface Link {
  version: 1; id: string; revision: number; root: string; identity: string; agentId: string; checkoutRoot: string; groupId: string
  coordId: string; createHash: string; createdAt: number; updatedAt: number; checkedAt: number
  peer?: Peer; error?: string; cursor: number; notes: ConsoleNote[]; receipts: { id: string; hash: string }[]
}
interface Index { version: 1; ids: string[]; removed: { id: string; linkId: string; hash: string; owner: string }[] }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const slot = (link: Link) => 'external-' + link.id
const address = (link: Link) => link.coordId + '/' + slot(link)
const alive = (peer?: Peer) => !!peer && peer.state !== 'done' && peer.expiresAt > Date.now()

/** Explicit observation and local notes. Never owns or invokes a native host. */
export class ExternalConsole {
  private readonly key: string
  constructor(private store: WorkspaceStore, private shared: WorkspaceStore, workspace: string,
    private root: (root: string, identity?: string) => Promise<Root>, private owned: (peer: Peer) => boolean) {
    this.key = workspaceKey('external-console', workspace)
  }
  private index(): Index {
    const value = this.store.get<Index>(this.key) ?? { version: 1, ids: [], removed: [] }
    if (value.version !== 1 || !Array.isArray(value.ids) || value.ids.length > 32 || value.ids.some(id => !externalId.safeParse(id).success) || !Array.isArray(value.removed) || value.removed.length > 128) throw new Error('Invalid external inbox index')
    return value
  }
  private linkKey(id: string) { return workspaceKey('external-inbox', this.key + '\0' + id) }
  private get(id: string): Link {
    externalId.parse(id)
    if (!this.index().ids.includes(id)) throw new Error('External link not found')
    const value = this.store.get<Link>(this.linkKey(id))
    if (!value || value.version !== 1 || value.id !== id || !Array.isArray(value.notes) || value.notes.length > 128 || !Array.isArray(value.receipts) || value.receipts.length > 128) throw new Error('Invalid external inbox journal')
    return value
  }
  private change<T>(id: string, fn: (link: Link) => T): T {
    return this.store.transaction(() => { const link = this.get(id), result = fn(link); this.store.put(this.linkKey(id), 'console', link); return result })
  }
  private recent(link: Link) { return !link.error && Date.now() - link.checkedAt < 15000 }
  detail(id: string) {
    const link = this.get(id), fresh = this.recent(link)
    return { ...link, address: address(link), fresh, active: fresh && alive(link.peer), unread: link.notes.filter(note => note.from !== 'owner' && !note.ownerAcknowledgedAt).length }
  }
  snapshot() {
    return this.index().ids.map(id => { const link = this.detail(id); return { id, revision: link.revision, root: link.root, agentId: link.agentId, checkoutRoot: link.checkoutRoot, label: link.peer?.label ?? link.agentId, task: link.peer?.task ?? '', state: link.peer?.state, checkedAt: link.checkedAt, fresh: link.fresh, active: link.active, unread: link.unread, error: link.error } })
  }
  ownerAddresses() { const index = this.index(); return [...index.ids.map(id => address(this.get(id))), ...index.removed.map(item => item.owner)] }
  observations(sourceRoot?: string): WorkspaceActivityRow[] {
    return this.index().ids.map(id => this.detail(id)).filter(link => link.fresh && link.peer && (!sourceRoot || link.root === sourceRoot)).map(link => {
      const peer = link.peer!
      return { groupId: link.groupId, agentId: peer.agentId, label: peer.label, task: peer.task, paths: peer.paths, state: peer.state, revision: peer.revision, checkoutRoot: peer.checkout.root, branch: peer.checkout.branch, head: peer.checkout.head, updatedAt: peer.updatedAt, expiresAt: peer.expiresAt, active: alive(peer) }
    })
  }
  projects(sourceRoot?: string) {
    return this.index().ids.map(id => this.detail(id)).filter(link => link.fresh && link.peer && (!sourceRoot || link.root === sourceRoot))
      .map(link => ({ sourceRoot: link.root, checkoutRoot: link.checkoutRoot, agentId: link.agentId }))
  }
  private async board(coordination: RepositoryCoordination, root: string, groupId: string, cursor = 0) {
    const agents = new Map<string, Peer>(), messages: Awaited<ReturnType<RepositoryCoordination['read']>>['messages'] = []
    let offset = 0
    for (let page = 0; page < 384; page++) {
      const result = await coordination.read({ expectedRoot: root, offset, afterMessage: cursor, maxBytes: 65536 }, groupId)
      for (const peer of result.agents) if ((agents.get(peer.agentId)?.revision ?? -1) <= peer.revision) agents.set(peer.agentId, peer)
      messages.push(...result.messages)
      if (result.agentsComplete && result.messagesComplete) return { agents: [...agents.values()], messages, cursor: result.nextMessage }
      if (result.nextOffset === offset && result.nextMessage === cursor) throw new Error('External coordination page could not advance')
      offset = result.nextOffset; cursor = result.nextMessage
    }
    throw new Error('External coordination pagination bound reached')
  }
  async candidates(root: string) {
    const selected = await this.root(root)
    const own = new Set(this.ownerAddresses()), board = await this.board(new RepositoryCoordination(this.shared), root, selected.groupId)
    return board.agents.filter(peer => alive(peer) && !own.has(peer.agentId) && !this.owned(peer))
  }
  private async pin(root: Root, peer: Peer, expectedCheckout = peer.checkout.root) {
    if (peer.checkout.root !== expectedCheckout || peer.checkout.commonDirectory !== root.checkout.commonDirectory) throw new Error('External agent checkout changed; remove the link and select the intended checkout again')
    // Validate a registered worktree before following a reported filesystem path.
    const worktrees = await git(root.checkout.root, ['worktree', 'list', '--porcelain', '-z'])
    if (!worktrees.split('\0').includes('worktree ' + expectedCheckout)) throw new Error('External agent checkout is no longer registered in this repository')
    const actual = await describeCheckout(expectedCheckout)
    if (actual.commonDirectory !== root.checkout.commonDirectory) throw new Error('External agent checkout identity changed')
  }
  async action(raw: unknown) {
    const action = actionSchema.parse(raw), digest = hash(action)
    if (action.action === 'external-link') {
      const old = this.index(), id = 'external-' + action.requestId
      if (old.removed.some(item => item.linkId === id)) throw new Error('That link was removed; use a new request ID')
      if (old.ids.includes(id)) { const link = this.get(id); if (link.createHash !== digest) throw new Error('Request ID reused with different content'); return this.detail(link.id) }
      const root = await this.root(action.root), peer = (await this.candidates(action.root)).find(peer => peer.agentId === action.agentId)
      if (!peer || peer.revision !== action.expectedAgentRevision) throw new Error('Selected agent changed or its lease is inactive; refresh before linking')
      await this.pin(root, peer)
      const existing = old.ids.map(id => this.get(id)).find(link => link.root === action.root && link.agentId === action.agentId)
      if (existing) { await this.refresh(existing.id); return this.detail(existing.id) }
      const link: Link = { version: 1, id, revision: 1, root: action.root, identity: root.identity, agentId: peer.agentId, checkoutRoot: peer.checkout.root, groupId: root.groupId, coordId: randomUUID(), createHash: digest, createdAt: Date.now(), updatedAt: Date.now(), checkedAt: 0, peer, cursor: 0, notes: [], receipts: [] }
      this.store.transaction(() => { const index = this.index(); if (index.ids.length >= 32) throw new Error('At most 32 external links are retained; remove an old link first'); index.ids.push(link.id); this.store.put(this.linkKey(link.id), 'console', link); this.store.put(this.key, 'console', index) })
      await this.refresh(link.id); return this.detail(link.id)
    }
    const removed = this.index().removed.find(item => item.id === action.requestId)
    if (removed) { if (removed.hash !== digest || removed.linkId !== action.id) throw new Error('Request ID reused with different content'); return { id: action.id, removed: true } }
    let link = this.get(action.id)
    const receipt = link.receipts.find(item => item.id === action.requestId)
    if (receipt) { if (receipt.hash !== digest) throw new Error('Request ID reused with different content'); return this.detail(link.id) }
    if (action.action === 'external-note') { await this.refresh(link.id); link = this.get(link.id) }
    if (link.revision !== action.expectedRevision) throw new Error('External inbox changed; refresh and review before retrying')
    if (action.action === 'external-remove') {
      // Local removal never stops or changes the peer. An unavailable sender
      // lease expires normally; already shared notes cannot be recalled.
      await this.release(link).catch(() => {})
      this.store.transaction(() => { const index = this.index(); index.ids = index.ids.filter(id => id !== link.id); index.removed.push({ id: action.requestId, linkId: link.id, hash: digest, owner: address(link) }); index.removed = index.removed.slice(-128); this.store.remove(this.linkKey(link.id)); this.store.put(this.key, 'console', index) })
      return { id: link.id, removed: true }
    }
    if (link.receipts.length >= 128) throw new Error('External inbox receipt limit reached; preserve notes and remove the link before starting a new one')
    if (action.action === 'external-note' && (!this.recent(link) || !alive(link.peer))) throw new Error('External agent is unavailable or its lease is inactive; note was not queued')
    return this.change(link.id, current => {
      if (action.action === 'external-note') {
        if (current.notes.length >= 128) throw new Error('External inbox is full; retained notes cannot be overwritten')
        current.notes.push({ id: action.requestId, from: 'owner', text: action.text, at: Date.now() })
      } else {
        const note = current.notes.find(note => note.id === action.messageId)
        if (!note) throw new Error('External inbox note not found')
        note.ownerAcknowledgedAt = Date.now()
      }
      current.receipts.push({ id: action.requestId, hash: digest }); current.revision++; current.updatedAt = Date.now()
      return { ...current, address: address(current), fresh: this.recent(current), active: alive(current.peer) }
    })
  }
  private async refresh(id: string) {
    try {
      let link = this.get(id)
      const root = await this.root(link.root, link.identity), coordination = new RepositoryCoordination(this.shared, link.coordId as ReturnType<typeof randomUUID>)
      const board = await this.board(coordination, link.root, link.groupId, link.cursor), peer = board.agents.find(peer => peer.agentId === link.agentId)
      if (!peer) throw new Error('Linked agent has no retained activity; select its new registration explicitly')
      await this.pin(root, peer, link.checkoutRoot)
      const own = board.agents.find(peer => peer.agentId === address(link))
      if (!own || own.expiresAt - Date.now() < 600000 || own.state === 'done') await coordination.update({ expectedRoot: link.root, slot: slot(link), label: 'Z1P owner inbox', task: 'Owner inbox for ' + link.agentId, paths: [], state: 'reviewing', expectedRevision: own?.revision ?? 0, ttlSeconds: 900 }, link.groupId)
      this.change(id, current => {
        const before = hash([current.peer, current.error, current.notes])
        current.peer = { ...peer, active: alive(peer) }; current.error = undefined; current.checkedAt = Date.now()
        for (const message of board.messages) {
          if (message.to !== address(current) || message.from !== current.agentId) continue
          const ack = /^ACK ([0-9a-f-]{36})$/.exec(message.text.trim()), sent = ack && current.notes.find(note => note.id === ack[1] && note.deliveredTo === current.agentId)
          if (sent) sent.acknowledgedAt ??= message.sentAt
          else {
            const old = current.notes.find(note => note.id === message.messageId)
            if (old) { if (old.from !== message.from || old.text !== message.text) throw new Error('External inbox message UUID collision; preserve receipts and reconcile') }
            else { if (current.notes.length >= 128) throw new Error('External inbox is full; coordination cursor retained'); current.notes.push({ id: message.messageId, from: message.from, text: message.text, at: message.sentAt, deliveredTo: 'owner', deliveredAt: message.sentAt }) }
          }
        }
        current.cursor = board.cursor
        if (before !== hash([current.peer, current.error, current.notes])) { current.revision++; current.updatedAt = Date.now() }
      })
      link = this.get(id)
      if (alive(peer)) for (const note of link.notes) if (note.from === 'owner' && !note.deliveredAt) {
        await coordination.send({ expectedRoot: link.root, slot: slot(link), recipientAgentId: link.agentId, messageId: note.id, text: note.text }, link.checkoutRoot, link.groupId)
        this.change(id, current => { const saved = current.notes.find(item => item.id === note.id)!; saved.deliveredAt = Date.now(); saved.deliveredTo = current.agentId; current.revision++; current.updatedAt = Date.now() })
      }
    } catch (error) {
      this.change(id, current => { const message = String(error).slice(0, 500); if (current.error !== message) { current.error = message; current.revision++; current.updatedAt = Date.now() } })
    }
  }
  async poll() { for (const id of this.index().ids) await this.refresh(id) }
  private async release(link: Link) {
    await this.root(link.root, link.identity)
    const coordination = new RepositoryCoordination(this.shared, link.coordId as ReturnType<typeof randomUUID>), board = await this.board(coordination, link.root, link.groupId)
    const own = board.agents.find(peer => peer.agentId === address(link))
    if (own && own.state !== 'done') await coordination.update({ expectedRoot: link.root, slot: slot(link), label: 'Z1P owner inbox', task: 'Owner inbox closed; external agent retains its own session', paths: [], state: 'done', expectedRevision: own.revision, ttlSeconds: 900 }, link.groupId)
  }
  async close() { for (const id of this.index().ids) await this.release(this.get(id)).catch(() => {}) }
}
