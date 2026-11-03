import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RepositoryCoordination } from './repository-coordination.js'
import { initialiseWorkspaceStore, WorkspaceStore } from './workspace-store.js'
import { discoverWorkspace, gitEnvironment } from './workspace-catalogue.js'
import { AgentConsole } from './agent-console.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.restoreAllMocks(); const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) try { await cleanup() } catch (error) { errors.push(error) }
  if (errors.length) throw new AggregateError(errors, 'External fixture cleanup failed')
})

async function fixture() {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'z1p-external-test-')))
  const workspace = join(temp, 'workspace'), root = join(workspace, 'project'), side = join(workspace, 'side'), cache = join(temp, 'cache')
  const git = (args: string[], cwd = root) => execFileSync('git', ['-C', cwd, ...args], { env: gitEnvironment(), encoding: 'utf8', stdio: 'pipe' }).trim()
  await mkdir(root, { recursive: true }); await writeFile(join(root, 'source.ts'), 'export const value = 1\n')
  git(['init', '-q']); git(['add', 'source.ts']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  git(['worktree', 'add', '-b', 'side', side])
  await initialiseWorkspaceStore(cache)
  const shared = new WorkspaceStore(cache); await discoverWorkspace(workspace, shared)
  cleanups.push(async () => {
    shared.close()
    for (const field of git(['worktree', 'list', '--porcelain', '-z']).split('\0')) if (field.startsWith('worktree ') && field.slice(9) !== root) {
      const path = field.slice(9); expect(path.startsWith(temp + '/')).toBe(true); expect(git(['status', '--porcelain'], path)).toBe('')
      expect(git(['rev-parse', 'HEAD'], path)).toBe(git(['rev-parse', 'HEAD']))
      const branch = git(['symbolic-ref', '--short', 'HEAD'], path)
      git(['worktree', 'remove', path]); git(['branch', '-d', branch])
    }
    git(['worktree', 'prune'])
    await rm(temp, { recursive: true, force: true })
  })
  const publish = (coordination: RepositoryCoordination, checkout = root, revision = 0, slot = 'work') => coordination.update({ expectedRoot: checkout, slot, label: 'External fixture', task: 'Inspect source.ts', paths: ['source.ts'], state: 'working', expectedRevision: revision, ttlSeconds: 900 })
  return { temp, workspace, root, side, cache, shared, git, publish }
}

async function consoleFixture() {
  const f = await fixture(), directory = join(f.temp, 'control')
  await initialiseWorkspaceStore(directory)
  let starts = 0, controller: AgentConsole
  const open = async () => controller = await AgentConsole.open(f.workspace, f.cache, { directory, allowedRoots: [f.root], factory: async () => { starts++; throw new Error('An external link must never start a native process') } })
  await open(); cleanups.push(() => controller.close())
  const link = (peer: { agent: { agentId: string; revision: number } }, extra = {}) => controller.action({ action: 'external-link', requestId: randomUUID(), root: f.root, agentId: peer.agent.agentId, expectedAgentRevision: peer.agent.revision, ...extra }) as Promise<any>
  const act = (id: string, action: string, extra = {}) => controller.action({ action, id, requestId: randomUUID(), expectedRevision: controller.externalTask(id).revision, ...extra }) as Promise<any>
  return { ...f, directory, console: () => controller, starts: () => starts, link, act, reopen: async () => { await controller.close(); await open(); return controller } }
}

it('refuses a first pinned delivery if the same agent moves to another checkout, but reconciles an already committed UUID', async () => {
  const f = await fixture(), sender = new RepositoryCoordination(f.shared), peer = new RepositoryCoordination(f.shared)
  await f.publish(sender); const activity = await f.publish(peer)
  const note = { expectedRoot: f.root, slot: 'work', recipientAgentId: activity.agent.agentId, messageId: randomUUID(), text: 'Keep this note with the selected checkout.' }
  await sender.send(note, f.root)
  await f.publish(peer, f.side, activity.agent.revision)
  expect((await sender.send(note, f.root)).duplicate).toBe(true)
  await expect(sender.send({ ...note, messageId: randomUUID() }, f.root)).rejects.toThrow('checkout changed')
})

it.each(['Codex', 'Claude', 'Kimi', 'Ollama host'])('links registered %s work and exchanges private acknowledged notes without owning its process', async label => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared)
  const activity = await peer.update({ expectedRoot: f.side, slot: 'native-work', label, task: 'Inspect the selected branch', paths: ['source.ts'], state: 'working', expectedRevision: 0, ttlSeconds: 900 })
  const linked = await f.link(activity), before = (await peer.read({ expectedRoot: f.root, maxBytes: 65536 })).agents.find(agent => agent.agentId === activity.agent.agentId)
  expect(linked.agentId).toBe(activity.agent.agentId); expect(linked.checkoutRoot).toBe(f.side)
  expect(f.console().observationProjects()).toContainEqual({ sourceRoot: f.root, checkoutRoot: f.side, agentId: linked.agentId })
  expect((await f.console().externalCandidates(f.root)).map(agent => agent.agentId)).toEqual([linked.agentId])
  const id = randomUUID(), text = 'Private owner note: keep the selected branch and review separate.'
  await f.act(linked.id, 'external-note', { requestId: id, text }); await f.console().poll()
  const delivered = await peer.read({ expectedRoot: f.side, maxBytes: 65536 })
  expect(delivered.messages.filter(note => note.messageId === id)).toHaveLength(1)
  expect(delivered.messages.find(note => note.messageId === id)?.text).toBe(text)
  await peer.send({ expectedRoot: f.side, slot: 'native-work', recipientAgentId: linked.address, messageId: randomUUID(), text: 'ACK ' + id })
  const replyId = randomUUID()
  await peer.send({ expectedRoot: f.side, slot: 'native-work', recipientAgentId: linked.address, messageId: replyId, text: 'Private peer reply: which regression is required?' })
  await f.console().poll()
  const received = f.console().externalTask(linked.id)
  expect(received.notes.find(note => note.id === id)?.acknowledgedAt).toBeTypeOf('number'); expect(received.unread).toBe(1)
  expect(JSON.stringify(f.console().snapshot())).not.toContain('Private owner note')
  expect(JSON.stringify(f.console().snapshot())).not.toContain('Private peer reply')
  await f.act(linked.id, 'external-read', { messageId: replyId }); expect(f.console().externalTask(linked.id).unread).toBe(0)
  for (const action of ['run', 'stop', 'answer', 'review']) await expect(f.console().action({ action, id: linked.id, requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow()
  expect(f.console().snapshot().active).toBe(0); expect(f.console().snapshot().tasks).toHaveLength(0); expect(f.starts()).toBe(0)
  await f.console().close()
  const after = (await peer.read({ expectedRoot: f.root, maxBytes: 65536 })).agents.find(agent => agent.agentId === activity.agent.agentId)
  expect(after).toEqual(before); expect(f.git(['status', '--porcelain'])).toBe(''); expect(f.git(['status', '--porcelain'], f.side)).toBe('')
}, 20000)

it('reconciles a committed note after a lost send receipt and dashboard restart without replaying it', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), activity = await f.publish(peer), linked = await f.link(activity)
  const id = randomUUID(), request = { action: 'external-note', id: linked.id, requestId: id, expectedRevision: f.console().externalTask(linked.id).revision, text: 'Keep this exact message identity after restart.' }
  await f.console().action(request)
  const send = RepositoryCoordination.prototype.send
  const spy = vi.spyOn(RepositoryCoordination.prototype, 'send').mockImplementation(async function (input, checkout) {
    const receipt = await send.call(this, input, checkout)
    if (input.messageId === id) throw new Error('Transport receipt lost after commit')
    return receipt
  })
  await f.console().poll(); expect(f.console().externalTask(linked.id).error).toContain('receipt lost')
  spy.mockRestore(); await f.reopen(); await f.console().poll()
  expect(f.console().externalTask(linked.id).notes.find(note => note.id === id)?.deliveredAt).toBeTypeOf('number')
  expect((await peer.read({ expectedRoot: f.root, maxBytes: 65536 })).messages.filter(note => note.messageId === id)).toHaveLength(1)
  await f.console().action(request)
  expect(f.console().externalTask(linked.id).notes.filter(note => note.id === id)).toHaveLength(1); expect(f.starts()).toBe(0)
}, 20000)

it('rejects scope changes, stale lease choices and accidental replacement by a same-named agent', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), activity = await f.publish(peer)
  await expect(f.link(activity, { expectedAgentRevision: 42 })).rejects.toThrow('changed')
  const linked = await f.link(activity)
  await f.publish(peer, f.side, activity.agent.revision)
  const other = new RepositoryCoordination(f.shared); await f.publish(other)
  await f.console().poll(); const current = f.console().externalTask(linked.id)
  expect(current.error).toContain('checkout changed'); expect(current.active).toBe(false); expect(current.agentId).toBe(activity.agent.agentId)
  await expect(f.act(linked.id, 'external-note', { text: 'Must not be rerouted.' })).rejects.toThrow('unavailable')
  expect((await other.read({ expectedRoot: f.root, maxBytes: 65536 })).messages).toHaveLength(0)
  expect(f.console().observationProjects()).not.toContainEqual({ sourceRoot: f.root, checkoutRoot: f.root, agentId: current.agentId }); expect(f.starts()).toBe(0)
}, 20000)

it('does not treat foreign ACKs or notes as replies from the pinned agent', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), other = new RepositoryCoordination(f.shared)
  const linked = await f.link(await f.publish(peer)); await f.publish(other)
  const id = randomUUID(); await f.act(linked.id, 'external-note', { requestId: id, text: 'Only the pinned peer can acknowledge this.' }); await f.console().poll()
  await other.send({ expectedRoot: f.root, slot: 'work', recipientAgentId: linked.address, messageId: randomUUID(), text: 'ACK ' + id })
  await other.send({ expectedRoot: f.root, slot: 'work', recipientAgentId: linked.address, messageId: randomUUID(), text: 'Foreign reply marker' })
  await f.console().poll(); const current = f.console().externalTask(linked.id)
  expect(current.notes.find(note => note.id === id)?.acknowledgedAt).toBeUndefined(); expect(JSON.stringify(current)).not.toContain('Foreign reply marker')
}, 20000)

it('shows expired and removed checkouts as unavailable and never queues a new note there', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), linked = await f.link(await f.publish(peer, f.side))
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 1000000)
  await f.console().poll(); expect(f.console().externalTask(linked.id).active).toBe(false)
  await expect(f.act(linked.id, 'external-note', { text: 'Expired target' })).rejects.toThrow('inactive')
  vi.restoreAllMocks()
  f.git(['worktree', 'move', f.side, join(f.workspace, 'moved')]); await f.console().poll()
  expect(f.console().externalTask(linked.id).error).toContain('no longer registered'); expect(f.starts()).toBe(0)
}, 20000)

it('refuses a replaced saved-project identity before publishing or routing into its new board', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), linked = await f.link(await f.publish(peer))
  const original = join(f.temp, 'original-git'), replacement = join(f.temp, 'replacement-git')
  await rename(join(f.root, '.git'), original)
  try {
    f.git(['init', '-q']); await f.console().poll()
    expect(f.console().externalTask(linked.id).error).toContain('identity changed')
    await expect(f.act(linked.id, 'external-note', { text: 'Wrong repository identity' })).rejects.toThrow('unavailable')
  } finally { await rename(join(f.root, '.git'), replacement); await rename(original, join(f.root, '.git')); await rm(replacement, { recursive: true, force: true }) }
}, 20000)

it('removes only its link and local inbox, preserves the peer, and reconciles an uncertain removal', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), activity = await f.publish(peer), linked = await f.link(activity)
  const before = (await peer.read({ expectedRoot: f.root, maxBytes: 65536 })).agents.find(agent => agent.agentId === activity.agent.agentId)
  const request = { action: 'external-remove', id: linked.id, requestId: randomUUID(), expectedRevision: linked.revision }
  await f.console().action(request); expect(await f.console().action(request)).toMatchObject({ removed: true })
  expect(f.console().snapshot().external).toHaveLength(0); expect(() => f.console().externalTask(linked.id)).toThrow('not found')
  expect((await peer.read({ expectedRoot: f.root, maxBytes: 65536 })).agents.find(agent => agent.agentId === activity.agent.agentId)).toEqual(before)
  expect((await f.console().externalCandidates(f.root)).map(agent => agent.agentId)).toEqual([activity.agent.agentId]); expect(f.starts()).toBe(0)
}, 20000)

it('follows complete coordination pages before deciding a selected agent or addressed reply is absent', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared)
  const paths = Array.from({ length: 32 }, (_, index) => 'src/' + index + '-' + 'p'.repeat(150))
  let target: Awaited<ReturnType<RepositoryCoordination['update']>>
  for (let index = 0; index < 18; index++) target = await peer.update({ expectedRoot: f.root, slot: 'work-' + String(index).padStart(2, '0'), label: 'Paged fixture', task: 't'.repeat(1000), paths, state: 'working', expectedRevision: 0, ttlSeconds: 900 })
  const first = await peer.read({ expectedRoot: f.root, maxBytes: 65536 })
  expect(first.agentsComplete).toBe(false); expect(first.agents.some(agent => agent.agentId === target!.agent.agentId)).toBe(false)
  expect(await f.console().externalCandidates(f.root)).toHaveLength(18)
  const linked = await f.link(target!)
  await peer.send({ expectedRoot: f.root, slot: 'work-17', recipientAgentId: linked.address, messageId: randomUUID(), text: 'Reply beyond a full activity page' })
  await f.console().poll(); expect(f.console().externalTask(linked.id).notes.some(note => note.text === 'Reply beyond a full activity page')).toBe(true)
}, 60000)

it('requires an exact allowed saved project and keeps link identity idempotent', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), activity = await f.publish(peer)
  await expect(f.console().externalCandidates(f.workspace)).rejects.toThrow('exact checkout')
  await expect(f.console().externalCandidates(f.side)).rejects.toThrow('exact checkout')
  const requestId = randomUUID(), linked = await f.link(activity, { requestId })
  expect((await f.link(activity, { requestId })).id).toBe(linked.id)
  expect((await f.link(activity)).id).toBe(linked.id); expect(f.console().snapshot().external).toHaveLength(1)
  await expect(f.link(activity, { requestId, agentId: 'another-agent' })).rejects.toThrow('different content')
  await expect(f.act(linked.id, 'external-note', { text: 'x'.repeat(1601) })).rejects.toThrow()
  expect(f.starts()).toBe(0)
}, 20000)

it('keeps external references outside the managed-task ID namespace even if request UUIDs coincide', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), activity = await f.publish(peer), id = randomUUID()
  const managed = await f.console().action({ action: 'create', requestId: id, root: f.root, host: 'codex', title: 'Owned draft', objective: 'Leave this draft unstarted.', paths: [] })
  const linked = await f.link(activity, { requestId: id })
  expect(managed.id).toBe(id); expect(linked.id).toBe('external-' + id)
  await expect(f.console().action({ action: 'run', id: linked.id, requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow()
  expect(f.console().snapshot().tasks[0].status).toBe('draft'); expect(f.starts()).toBe(0)
}, 20000)

it('rejects a Git identity replacement between root validation and coordination read before creating a sender in the new board', async () => {
  const f = await consoleFixture(), peer = new RepositoryCoordination(f.shared), linked = await f.link(await f.publish(peer))
  await f.act(linked.id, 'external-note', { text: 'Keep this queued note in the original repository only.' })
  const original = join(f.temp, 'original-race-git'), replacement = join(f.temp, 'replacement-race-git'), read = RepositoryCoordination.prototype.read
  let raced = false
  const spy = vi.spyOn(RepositoryCoordination.prototype, 'read').mockImplementation(async function (input, groupId) {
    if (!raced && input.expectedRoot === f.root) {
      raced = true; await rename(join(f.root, '.git'), original); f.git(['init', '-q']); await f.publish(peer)
    }
    return read.call(this, input, groupId)
  })
  try {
    await f.console().poll(); spy.mockRestore()
    const changed = await peer.read({ expectedRoot: f.root, maxBytes: 65536 })
    expect(changed.messages).toHaveLength(0)
    expect(changed.agents.some(agent => agent.agentId === linked.address)).toBe(false)
    expect(f.console().externalTask(linked.id).error).toContain('Git identity changed')
  } finally {
    spy.mockRestore()
    if (raced) { await rename(join(f.root, '.git'), replacement); await rename(original, join(f.root, '.git')); await rm(replacement, { recursive: true, force: true }) }
  }
}, 20000)
