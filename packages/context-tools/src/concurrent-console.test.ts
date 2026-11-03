import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentConsole } from './agent-console.js'
import type { HostFactory } from './agent-host.js'
import { discoverWorkspace, gitEnvironment } from './workspace-catalogue.js'
import { initialiseWorkspaceStore, WorkspaceStore } from './workspace-store.js'
import { RepositoryCoordination } from './repository-coordination.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture(maxActive = 3) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'z1p-concurrent-test-'))), workspace = join(temp, 'workspace'), root = join(workspace, 'project'), cache = join(temp, 'cache'), directory = join(temp, 'control')
  const git = (args: string[], cwd = root) => execFileSync('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', ...args], { env: gitEnvironment(), encoding: 'utf8', stdio: 'pipe' }).trim()
  await mkdir(root, { recursive: true }); await writeFile(join(root, 'source.ts'), "export const value = 'before'\n")
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  await initialiseWorkspaceStore(cache); await initialiseWorkspaceStore(directory)
  const shared = new WorkspaceStore(cache); await discoverWorkspace(workspace, shared)
  const handlers = new Map<string, Parameters<HostFactory>[1]>(), calls: { root: string; method: string; params: any }[] = [], responses: any[] = []
  let starts = 0
  const factory: HostFactory = async (cwd, callbacks) => { starts++; handlers.set(cwd, callbacks); return {
    request: async (method, params: any) => { calls.push({ root: cwd, method, params }); return method.startsWith('thread/') ? { cwd, thread: { id: 'thread-' + cwd, cwd, status: { type: 'idle' } }, model: 'fixture', modelProvider: 'fixture', approvalPolicy: 'on-request', sandbox: 'configured' } : { turn: { id: 'turn-' + calls.length } } },
    respond: (id, result) => { responses.push({ root: cwd, id, result }) }, reject: () => {}, close: async () => {},
  } }
  let controller: AgentConsole
  const open = async () => controller = await AgentConsole.open(workspace, cache, { directory, factory, allowedRoots: [root], maxActive })
  await open()
  cleanups.push(async () => {
    await controller.close(); shared.close()
    // Every repository/file here was generated solely by this fixture.
    for (const field of git(['worktree', 'list', '--porcelain', '-z']).split('\0')) if (field.startsWith('worktree ') && field.slice(9) !== root) {
      const path = field.slice(9), branch = git(['symbolic-ref', '--short', 'HEAD'], path)
      await writeFile(join(path, 'source.ts'), "export const value = 'before'\n")
      git(['worktree', 'remove', path]); git(['branch', '-d', branch])
    }
    await rm(temp, { recursive: true, force: true })
  })
  const create = (extra = {}) => controller.action({ action: 'create', requestId: randomUUID(), root, host: 'codex', title: 'Concurrent task', objective: 'Change the selected source and verify it.', paths: ['source.ts'], isolation: 'worktree', ...extra })
  const act = (id: string, action: string, extra = {}) => controller.action({ action, id, requestId: randomUUID(), expectedRevision: controller.task(id).revision, ...extra })
  const running = (id: string) => vi.waitFor(() => expect(controller.task(id).status).toBe('running'), { timeout: 5000 })
  const finish = async (id: string) => { const task = controller.task(id); handlers.get(task.executionRoot)!.event({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: task.turnId, status: 'completed' } } }); await vi.waitFor(() => expect(controller.task(id).review).toBeDefined()); return controller.task(id) }
  const worker = async (id: string) => { const task = controller.task(id), coordination = new RepositoryCoordination(shared); const row = await coordination.update({ expectedRoot: task.executionRoot, slot: 'worker-' + id, expectedRevision: 0, task: task.title, label: 'Fixture worker', paths: task.paths, state: 'working', ttlSeconds: 900 }); return { coordination, agentId: row.agent.agentId, slot: row.agent.slot, root: task.executionRoot } }
  return { root, temp, directory, shared, git, create, act, running, finish, worker, calls, handlers, responses, console: () => controller, starts: () => starts, reopen: async () => { await controller.close(); await open(); return controller } }
}

it('runs two isolated tasks from committed HEAD while preserving dirty owner work and separate reviews', async () => {
  const f = await fixture(); await writeFile(join(f.root, 'source.ts'), 'private owner work\n')
  const a = await f.create(), b = await f.create({ title: 'Second task' })
  await f.act(a.id, 'run'); await f.running(a.id); await f.act(b.id, 'run'); await f.running(b.id)
  const ar = f.console().task(a.id).executionRoot, br = f.console().task(b.id).executionRoot
  expect(ar).not.toBe(br); expect(f.console().snapshot().active).toBe(2)
  expect(await readFile(join(ar, 'source.ts'), 'utf8')).toContain('before')
  await writeFile(join(ar, 'source.ts'), 'task A\n'); await writeFile(join(br, 'source.ts'), 'task B\n')
  const aa = await f.finish(a.id), bb = await f.finish(b.id)
  expect(aa.review!.diff).toContain('task A'); expect(aa.review!.diff).not.toContain('task B')
  expect(bb.review!.diff).toContain('task B'); expect(await readFile(join(f.root, 'source.ts'), 'utf8')).toBe('private owner work\n')
  expect(f.console().snapshot().reviewCount).toBe(2)
  await f.act(a.id, 'review', { decision: 'accept', reviewHash: aa.review!.hash }); expect(f.console().task(b.id).status).toBe('review')
}, 15000)

it('bounds concurrency and stops only the selected task', async () => {
  const f = await fixture(2), a = await f.create(), b = await f.create(), c = await f.create()
  await f.act(a.id, 'run'); await f.running(a.id); await f.act(b.id, 'run'); await f.running(b.id)
  await expect(f.act(c.id, 'run')).rejects.toThrow('capacity')
  await f.act(a.id, 'stop'); expect(f.console().task(b.id).status).toBe('running')
  const task = f.console().task(a.id)
  f.handlers.get(task.executionRoot)!.event({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: task.turnId, status: 'interrupted' } } })
  await vi.waitFor(() => expect(f.console().snapshot().active).toBe(1))
  await f.act(c.id, 'run'); await f.running(c.id); expect(f.console().task(b.id).status).toBe('running')
}, 15000)

it('keeps selected-checkout runs exclusive within a shared Git repository', async () => {
  const f = await fixture(), a = await f.create({ isolation: 'checkout' }), b = await f.create()
  await f.act(a.id, 'run'); await f.running(a.id)
  await expect(f.act(b.id, 'run')).rejects.toThrow('separate managed worktrees'); expect(f.starts()).toBe(1)
})

it('preserves an uncertain allocation and never retries or deletes a pre-existing path', async () => {
  const f = await fixture(), a = await f.create(), path = join(f.directory, 'worktrees', a.id)
  await mkdir(path, { recursive: true, mode: 0o700 }); await writeFile(join(path, 'preserve'), 'unrelated occupant')
  await f.act(a.id, 'run'); expect(f.console().task(a.id).status).toBe('unknown')
  expect(f.starts()).toBe(0); expect(await readFile(join(path, 'preserve'), 'utf8')).toBe('unrelated occupant')
  await f.reopen(); await expect(f.act(a.id, 'run')).rejects.toThrow('uncertain'); expect(f.starts()).toBe(0)
})

it('refuses a symlink worktree parent without modifying its destination', async () => {
  const f = await fixture(), a = await f.create(), other = join(f.temp, 'other')
  await mkdir(other); await symlink(other, join(f.directory, 'worktrees'))
  await f.act(a.id, 'run'); expect(f.console().task(a.id).status).toBe('unknown'); expect(f.starts()).toBe(0)
  await unlink(join(f.directory, 'worktrees'))
})

it('rejects a changed worktree branch before resuming the host', async () => {
  const f = await fixture(), a = await f.create(); await f.act(a.id, 'run'); await f.running(a.id); await f.finish(a.id)
  const task = f.console().task(a.id); f.git(['switch', '-c', 'different-branch'], task.executionRoot)
  await expect(f.act(a.id, 'run', { message: 'Continue.' })).rejects.toThrow('identity or branch')
  f.git(['switch', task.worktree!.branch], task.executionRoot); f.git(['branch', '-d', 'different-branch']); expect(f.starts()).toBe(1)
})

it('deduplicates encrypted owner notes and distinguishes delivery, agent ACK and owner acknowledgement', async () => {
  const f = await fixture(), a = await f.create(); await f.act(a.id, 'run'); await f.running(a.id)
  const peer = await f.worker(a.id), request = { action: 'message', id: a.id, requestId: randomUUID(), expectedRevision: f.console().task(a.id).revision, text: 'Private note: verify cancellation.' }
  await f.console().action(request); await f.console().action(request)
  expect((await readFile(join(f.directory, 'workspace.sqlite'))).includes(Buffer.from(request.text))).toBe(false)
  await f.console().poll(); let note = f.console().task(a.id).inbox[0]
  expect(note.deliveredTo).toBe(peer.agentId); expect(note.acknowledgedAt).toBeUndefined(); expect(note.ownerAcknowledgedAt).toBeUndefined()
  const read = await peer.coordination.read({ expectedRoot: peer.root, maxBytes: 65536, afterMessage: 0, offset: 0 }); expect(read.messages[0].text).toBe(request.text)
  await peer.coordination.send({ expectedRoot: peer.root, slot: peer.slot, recipientAgentId: f.console().task(a.id).address, messageId: randomUUID(), text: 'ACK ' + request.requestId })
  await f.console().poll(); note = f.console().task(a.id).inbox[0]; expect(note.acknowledgedAt).toBeDefined(); expect(note.ownerAcknowledgedAt).toBeUndefined()
  await f.act(a.id, 'acknowledge', { messageId: note.id }); expect(f.console().task(a.id).inbox[0].ownerAcknowledgedAt).toBeDefined()
  await f.console().poll(); expect(f.console().task(a.id).inbox).toHaveLength(1)
})

it('routes a handover between simultaneous agents and binds ACK to the delivered recipient', async () => {
  const f = await fixture(), a = await f.create(), b = await f.create(); await f.act(a.id, 'run'); await f.running(a.id); await f.act(b.id, 'run'); await f.running(b.id)
  const wa = await f.worker(a.id), wb = await f.worker(b.id), id = randomUUID(), address = f.console().task(b.id).address
  await wa.coordination.send({ expectedRoot: wa.root, slot: wa.slot, recipientAgentId: address, messageId: id, text: 'Handover: cancellation returns false for completed jobs.' })
  await f.console().poll(); expect(f.console().task(b.id).inbox[0].from).toBe(wa.agentId)
  const received = await wb.coordination.read({ expectedRoot: wb.root, maxBytes: 65536, afterMessage: 0, offset: 0 }); expect(received.messages[0].messageId).toBe(id)
  await wa.coordination.send({ expectedRoot: wa.root, slot: wa.slot, recipientAgentId: address, messageId: randomUUID(), text: 'ACK ' + id }); await f.console().poll()
  expect(f.console().task(b.id).inbox.find(note => note.id === id)!.acknowledgedAt).toBeUndefined()
  await wb.coordination.send({ expectedRoot: wb.root, slot: wb.slot, recipientAgentId: address, messageId: randomUUID(), text: 'ACK ' + id }); await f.console().poll()
  expect(f.console().task(b.id).inbox.find(note => note.id === id)!.acknowledgedAt).toBeDefined()
}, 15000)

it('includes queued notes in an explicit continuation without claiming acknowledgement', async () => {
  const f = await fixture(), a = await f.create(); await f.act(a.id, 'run'); await f.running(a.id); await f.finish(a.id)
  await f.act(a.id, 'message', { text: 'Add a cancellation regression.' }); await f.act(a.id, 'run', { message: 'Continue with the queued review.' }); await f.running(a.id)
  const text = f.calls.filter(call => call.method === 'turn/start').at(-1)!.params.input[0].text
  expect(text).toContain('Add a cancellation regression.'); expect(text).toContain('untrusted data')
  const note = f.console().task(a.id).inbox[0]; expect(note.submittedTurn).toBeDefined(); expect(note.acknowledgedAt).toBeUndefined()
})

it('retains worktrees, thread identities and inboxes after restart without replaying a run', async () => {
  const f = await fixture(), a = await f.create(), b = await f.create(); await f.act(a.id, 'run'); await f.running(a.id); await f.act(b.id, 'run'); await f.running(b.id)
  const ar = f.console().task(a.id).executionRoot, thread = f.console().task(a.id).threadId
  await writeFile(join(ar, 'source.ts'), 'in-flight work\n'); await f.act(a.id, 'message', { text: 'Wait for owner review.' })
  await f.reopen(); expect(f.starts()).toBe(2); expect(f.console().snapshot().active).toBe(0)
  for (const id of [a.id, b.id]) expect(f.console().task(id).status).toBe('unknown')
  expect(await readFile(join(ar, 'source.ts'), 'utf8')).toBe('in-flight work\n'); expect(f.console().task(a.id).inbox).toHaveLength(1)
  await f.act(a.id, 'run', { message: 'I reconciled the interrupted work; continue this task.' }); await f.running(a.id)
  expect(f.calls.find(call => call.method === 'thread/resume')!.params).toEqual({ threadId: thread, cwd: ar, excludeTurns: true }); expect(f.starts()).toBe(3)
}, 15000)

it('fails closed on ambiguous worker claims without blocking delivery to another task', async () => {
  const f = await fixture(), a = await f.create(), b = await f.create(); await f.act(a.id, 'run'); await f.running(a.id); await f.act(b.id, 'run'); await f.running(b.id)
  await f.worker(a.id); await f.worker(a.id); const receiver = await f.worker(b.id)
  await f.act(a.id, 'message', { text: 'Do not guess the recipient.' }); await f.act(b.id, 'message', { text: 'This task still receives its note.' })
  await expect(f.console().poll()).rejects.toThrow('Multiple workers')
  expect(f.console().task(a.id).inbox[0].deliveredAt).toBeUndefined()
  expect(f.console().task(b.id).inbox[0].deliveredTo).toBe(receiver.agentId)
  expect(f.console().snapshot().inboxError).toContain('Multiple workers')
}, 15000)

it('does not grant a pending tool permission in another task when request IDs are identical', async () => {
  const f = await fixture(), a = await f.create(), b = await f.create(); await f.act(a.id, 'run'); await f.running(a.id); await f.act(b.id, 'run'); await f.running(b.id)
  for (const id of [a.id, b.id]) {
    const task = f.console().task(id); f.handlers.get(task.executionRoot)!.request({ id: 'shared-wire-id', method: 'item/commandExecution/requestApproval', params: { threadId: task.threadId, turnId: task.turnId, command: 'node --test', cwd: task.executionRoot } })
    await vi.waitFor(() => expect(f.console().task(id).pending).toHaveLength(1))
  }
  const pending = f.console().task(a.id).pending[0]
  await expect(f.act(b.id, 'answer', { pendingId: pending.id, decision: 'accept' })).rejects.toThrow('no longer pending')
  await f.act(a.id, 'answer', { pendingId: pending.id, decision: 'accept' })
  expect(f.responses).toEqual([{ root: f.console().task(a.id).executionRoot, id: 'shared-wire-id', result: { decision: 'accept' } }])
  expect(f.console().task(b.id).status).toBe('waiting')
}, 15000)

it('does not execute repository hooks or smudge filters when creating an isolated worktree', async () => {
  const f = await fixture(), marker = join(f.temp, 'executed'), hook = join(f.root, '.git', 'hooks', 'post-checkout')
  // Task-owned fixture command only; a marker must never appear.
  const quoted = "'" + marker.replace(/'/g, "'\\''") + "'"
  await writeFile(join(f.root, '.gitattributes'), 'source.ts filter=tripwire\n'); f.git(['add', '.gitattributes']); f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'attributes fixture'])
  f.git(['config', 'filter.tripwire.smudge', 'touch ' + quoted + ' && cat'])
  await writeFile(hook, '#!/bin/sh\ntouch ' + quoted + '\n', { mode: 0o700 })
  const task = await f.create(); await f.act(task.id, 'run'); await f.running(task.id)
  expect(await readFile(marker).then(() => true, () => false)).toBe(false)
  expect(await readFile(join(f.console().task(task.id).executionRoot, 'source.ts'), 'utf8')).toContain('before')
  // Preserve fixture-only cleanup's clean-filter behaviour too.
  f.git(['config', '--unset', 'filter.tripwire.smudge'])
}, 15000)

it('retains inbox capacity and rejects spoofed senders, oversized notes and unknown acknowledgements', async () => {
  const f = await fixture(), task = await f.create()
  await expect(f.act(task.id, 'message', { text: 'a'.repeat(1601) })).rejects.toThrow()
  await expect(f.act(task.id, 'message', { text: 'note', from: 'trusted-agent' })).rejects.toThrow()
  await expect(f.act(task.id, 'acknowledge', { messageId: randomUUID() })).rejects.toThrow('not found')
  for (let i = 0; i < 128; i++) await f.act(task.id, 'message', { text: 'Retained note ' + i })
  await expect(f.act(task.id, 'message', { text: 'Must not evict another note.' })).rejects.toThrow('full')
  expect(f.console().task(task.id).inbox[0].text).toBe('Retained note 0')
})

it('follows full coordination pages before concluding a worker or note is missing', async () => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); await f.running(task.id)
  const root = f.console().task(task.id).executionRoot
  for (let i = 0; i < 16; i++) await new RepositoryCoordination(f.shared).update({ expectedRoot: root, slot: 'busy-' + i, expectedRevision: 0, label: 'Busy peer ' + i, task: 'x'.repeat(900), paths: Array.from({ length: 32 }, (_, j) => 'other-' + j + '/' + 'p'.repeat(200)), state: 'working', ttlSeconds: 900 })
  const peer = await f.worker(task.id)
  await f.act(task.id, 'message', { text: 'Find this exact worker even on a busy board.' }); await f.console().poll()
  expect(f.console().task(task.id).inbox[0].deliveredTo).toBe(peer.agentId)
  const first = await peer.coordination.read({ expectedRoot: root, maxBytes: 65536, afterMessage: 0, offset: 0 })
  expect(first.agentsComplete).toBe(false)
}, 15000)
