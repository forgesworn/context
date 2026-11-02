import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentConsole } from './agent-console.js'
import type { HostFactory } from './codex-host.js'
import { discoverWorkspace, gitEnvironment } from './workspace-catalogue.js'
import { initialiseWorkspaceStore, WorkspaceStore } from './workspace-store.js'
import { RepositoryCoordination } from './repository-coordination.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'z1p-console-test-')))
  cleanup.push(() => rm(temp, { recursive: true, force: true }))
  const workspace = join(temp, 'workspace'), root = join(workspace, 'project'), cache = join(temp, 'cache'), directory = join(temp, 'control')
  await mkdir(root, { recursive: true }); await writeFile(join(root, 'source.ts'), 'export const original = 1\n')
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { env: gitEnvironment(), stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  await initialiseWorkspaceStore(cache); await initialiseWorkspaceStore(directory)
  const store = new WorkspaceStore(cache); try { await discoverWorkspace(workspace, store) } finally { store.close() }
  let callbacks: Parameters<HostFactory>[1]
  const calls: { method: string; params: any }[] = [], responses: unknown[] = [], rejected: unknown[] = []
  let turns = 0, starts = 0, closes = 0, model = 'configured-model', provider = 'configured-provider'
  const factory: HostFactory = async (cwd, handlers) => {
    starts++; callbacks = handlers
    return {
      request: async (method, params: any) => {
        calls.push({ method, params })
        if (method === 'thread/start' || method === 'thread/resume') return { cwd, thread: { id: 'owned-thread', cwd, status: { type: 'idle' } }, model, modelProvider: provider, approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } }
        if (method === 'turn/start') return { turn: { id: 'turn-' + (++turns), status: 'inProgress' } }
        if (method === 'turn/interrupt') return {}
        throw new Error('Unexpected request ' + method)
      },
      respond: (id, result) => { responses.push({ id, result }) }, reject: id => { rejected.push(id) }, close: async () => { closes++ },
    }
  }
  let controller: AgentConsole | undefined
  const open = async () => { controller = await AgentConsole.open(workspace, cache, { directory, codexExecutable: '/fixture/codex', factory, allowedRoots: [root], maxRunSeconds: 30 }); cleanup.push(async () => { if (controller) { await controller.close(); controller = undefined } }); return controller }
  const console = await open()
  const create = (extra = {}) => console.action({ action: 'create', requestId: randomUUID(), root, host: 'codex', title: 'Fix queue behaviour', objective: 'Private objective marker: fix source.ts and verify the result.', paths: ['source.ts'], ...extra })
  const act = (id: string, action: string, extra = {}) => console.action({ action, id, requestId: randomUUID(), expectedRevision: console.task(id).revision, ...extra })
  const running = async (id: string) => { await vi.waitFor(() => expect(console.task(id).status).toBe('running')); return console.task(id) }
  const finish = async (id: string, status = 'completed') => {
    const task = console.task(id)
    callbacks.event({ method: 'item/completed', params: { threadId: task.threadId, turnId: task.turnId, item: { type: 'agentMessage', text: 'Verified the scoped change.' } } })
    callbacks.event({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: task.turnId, status } } })
    await vi.waitFor(() => expect(console.snapshot().active).toBe(0))
    if (status === 'completed') await vi.waitFor(() => expect(console.task(id).review).toBeDefined())
    return console.task(id)
  }
  return { temp, root, workspace, cache, directory, console, factory, calls, responses, rejected, create, act, running, finish, emit: (method: string, params: any) => callbacks.event({ method, params }), request: (method: string, params: any, id: string | number = 'server-request') => callbacks.request({ method, params, id }), lost: () => callbacks.lost('Transport disconnected'), counts: () => ({ turns, starts, closes }), changeModel: () => { model = 'different-model' }, reopen: async () => { await console.close(); controller = undefined; return open() } }
}

it('durably saves encrypted tasks and deduplicates create and run requests without replaying execution', async () => {
  const f = await fixture(), requestId = randomUUID()
  const task = await f.create({ requestId })
  expect((await f.create({ requestId })).id).toBe(task.id)
  await expect(f.create({ requestId, objective: 'Changed' })).rejects.toThrow('different content')
  expect((await readFile(join(f.directory, 'workspace.sqlite'))).includes(Buffer.from('Private objective marker'))).toBe(false)
  const run = { action: 'run', id: task.id, requestId: randomUUID(), expectedRevision: task.revision }
  await f.console.action(run); await f.running(task.id); await f.console.action(run)
  expect(f.counts().turns).toBe(1)
  expect(f.calls[0]).toEqual({ method: 'thread/start', params: { cwd: f.root } })
  expect(Object.keys(f.calls.find(call => call.method === 'turn/start')!.params).sort()).toEqual(['input', 'threadId'])
  f.emit('item/agentMessage/delta', { threadId: 'owned-thread', turnId: 'turn-1', delta: 'Live scoped response' })
  await vi.waitFor(() => expect(f.console.task(task.id).liveOutput).toBe('Live scoped response'))
  await writeFile(join(f.root, 'source.ts'), 'export const corrected = 2\n')
  const finished = await f.finish(task.id)
  expect(finished.status).toBe('review'); expect(finished.review!.diff).toContain('corrected')
  expect(finished.accepted).toBeUndefined()
  await f.act(task.id, 'review', { decision: 'accept', reviewHash: finished.review!.hash })
  expect(f.console.task(task.id).status).toBe('accepted')
})

it('binds acceptance to current tracked and untracked content rather than the agent completion label', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id)
  await writeFile(join(f.root, 'new-test.ts'), 'assert(cancelledJobDidNotRun)\n')
  const finished = await f.finish(task.id)
  expect(finished.review!.untracked[0].text).toContain('cancelledJobDidNotRun')
  await writeFile(join(f.root, 'new-test.ts'), 'changed without changing its filename\n')
  await expect(f.act(task.id, 'review', { decision: 'accept', reviewHash: finished.review!.hash })).rejects.toThrow('Checkout or result changed')
  expect(f.console.task(task.id).status).toBe('review')
  expect(f.console.task(task.id).accepted).toBeUndefined()
})

it('does not execute a repository clean filter while gathering the owner review', async () => {
  const f = await fixture(), task = await f.create(), marker = join(f.temp, 'filter-executed')
  const quoted = "'" + marker.replace(/'/g, "'\\''") + "'"
  execFileSync('git', ['-C', f.root, 'config', 'filter.tripwire.clean', 'touch ' + quoted + ' && cat'], { env: gitEnvironment(), stdio: 'pipe' })
  await writeFile(join(f.root, '.gitattributes'), 'source.ts filter=tripwire\n')
  await f.act(task.id, 'run'); await f.running(task.id)
  await writeFile(join(f.root, 'source.ts'), 'export const corrected = 2\n')
  const running = f.console.task(task.id)
  f.emit('turn/completed', { threadId: running.threadId, turn: { id: running.turnId, status: 'completed' } })
  await vi.waitFor(() => expect(f.console.task(task.id).review ?? f.console.task(task.id).reviewError).toBeDefined(), { timeout: 7000 })
  expect(await access(marker).then(() => true, () => false)).toBe(false)
  expect(f.console.task(task.id).review).toBeDefined()
}, 15000)

it('continues only its saved thread with explicit follow-up and unchanged host settings', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id); const finished = await f.finish(task.id)
  await f.act(task.id, 'review', { decision: 'changes', reviewHash: finished.review!.hash })
  await expect(f.act(task.id, 'run')).rejects.toThrow('follow-up')
  await f.act(task.id, 'run', { message: 'Add the missing regression.' }); await f.running(task.id)
  expect(f.calls.find(call => call.method === 'thread/resume')!.params).toEqual({ threadId: 'owned-thread', cwd: f.root, excludeTurns: true })
  expect(f.counts().turns).toBe(2)
  await f.finish(task.id)
})

it('shows exact pending approvals, rejects stale/wrong answers and never grants session-wide permission', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id)
  f.request('item/commandExecution/requestApproval', { threadId: 'owned-thread', turnId: 'turn-1', itemId: 'command', command: 'npm test', cwd: f.root })
  await vi.waitFor(() => expect(f.console.task(task.id).status).toBe('waiting'))
  const pending = f.console.task(task.id).pending[0]
  await expect(f.act(task.id, 'answer', { pendingId: randomUUID(), decision: 'accept' })).rejects.toThrow('no longer pending')
  await expect(f.act(task.id, 'answer', { pendingId: pending.id, decision: 'acceptForSession' })).rejects.toThrow()
  await expect(f.console.action({ action: 'answer', requestId: randomUUID(), id: task.id, expectedRevision: 0, pendingId: pending.id, decision: 'accept' })).rejects.toThrow('Task changed')
  await f.act(task.id, 'answer', { pendingId: pending.id, decision: 'accept' })
  expect(f.responses).toEqual([{ id: 'server-request', result: { decision: 'accept' } }])
  expect(f.console.task(task.id).status).toBe('running')
  const shared = new WorkspaceStore(f.cache)
  try { const board = await new RepositoryCoordination(shared).read({ expectedRoot: f.root, offset: 0, afterMessage: 0, maxBytes: 65536 }); expect(board.agents.find(agent => agent.slot === 'console-' + task.id)!.state).toBe('working') } finally { shared.close() }
})

it('routes non-secret questions by exact pending request and question IDs', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id)
  f.request('item/tool/requestUserInput', { threadId: 'owned-thread', turnId: 'turn-1', questions: [{ id: 'scope', question: 'Which regression?', isSecret: false }], isBlocking: true })
  await vi.waitFor(() => expect(f.console.task(task.id).pending).toHaveLength(1))
  const pending = f.console.task(task.id).pending[0]
  await expect(f.act(task.id, 'answer', { pendingId: pending.id, answers: { other: 'wrong' } })).rejects.toThrow('Answer every')
  await f.act(task.id, 'answer', { pendingId: pending.id, answers: { scope: 'Test cancelled jobs and FIFO.' } })
  expect(f.responses).toEqual([{ id: 'server-request', result: { answers: { scope: { answers: ['Test cancelled jobs and FIFO.'] } } } }])
})

it('requires the exact still-current proposed patch before granting a native file change', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id)
  f.request('item/fileChange/requestApproval', { threadId: 'owned-thread', turnId: 'turn-1', itemId: 'missing-preview', grantRoot: null }, 'missing')
  await vi.waitFor(() => expect(f.console.task(task.id).pending).toHaveLength(1))
  let pending = f.console.task(task.id).pending[0]
  await expect(f.act(task.id, 'answer', { pendingId: pending.id, decision: 'accept' })).rejects.toThrow('preview is required')
  await f.act(task.id, 'answer', { pendingId: pending.id, decision: 'decline' })
  f.emit('item/started', { threadId: 'owned-thread', turnId: 'turn-1', item: { id: 'file-edit', type: 'fileChange', changes: [{ path: 'source.ts', diff: '+fixed', kind: { type: 'update' } }] } })
  f.request('item/fileChange/requestApproval', { threadId: 'owned-thread', turnId: 'turn-1', itemId: 'file-edit', grantRoot: null }, 'with-preview')
  await vi.waitFor(() => expect(f.console.task(task.id).pending).toHaveLength(1))
  pending = f.console.task(task.id).pending[0]
  expect(pending.preview!.changes).toHaveLength(1)
  f.emit('item/started', { threadId: 'owned-thread', turnId: 'turn-1', item: { id: 'file-edit', type: 'fileChange', changes: [{ path: 'source.ts', diff: '+different', kind: { type: 'update' } }] } })
  await vi.waitFor(() => expect(f.console.task(task.id).pending[0].preview).toBeDefined())
  await expect(f.act(task.id, 'answer', { pendingId: pending.id, decision: 'accept' })).rejects.toThrow('preview is required')
  expect(f.responses.some((response: any) => response.id === 'with-preview')).toBe(false)
})

it('fails closed on unsupported permission interactions and secret requests', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id)
  f.request('item/permissions/requestApproval', { threadId: 'owned-thread', turnId: 'turn-1', permissions: { network: true } })
  await vi.waitFor(() => expect(f.console.task(task.id).status).toBe('unknown'))
  expect(f.rejected).toEqual(['server-request']); expect(f.responses).toEqual([])
  expect(f.console.snapshot().active).toBe(0)
})

it('waits for a terminal interruption receipt rather than treating a stop acknowledgement as completion', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id)
  await f.act(task.id, 'stop')
  expect(f.console.task(task.id).status).toBe('stopping')
  await f.finish(task.id, 'interrupted')
  expect(f.console.task(task.id).status).toBe('cancelled')
  expect(f.console.task(task.id).review).toBeUndefined()
})

it('persists an uncertain disconnect and never starts a replacement automatically after restart', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id); f.lost()
  await vi.waitFor(() => expect(f.console.task(task.id).status).toBe('unknown'))
  const restarted = await f.reopen()
  expect(restarted.task(task.id).status).toBe('unknown')
  expect(restarted.task(task.id).threadId).toBe('owned-thread')
  expect(f.counts().starts).toBe(1)
})

it('refuses a changed saved model/provider before sending another turn', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id); await f.finish(task.id)
  f.changeModel()
  await f.act(task.id, 'run', { message: 'Continue with the original configuration.' })
  await vi.waitFor(() => expect(f.console.task(task.id).status).toBe('unknown'))
  expect(f.counts().turns).toBe(1)
})

it('rejects unknown checkout roots, path traversal, command injection fields and concurrent runs', async () => {
  const f = await fixture()
  await expect(f.create({ root: f.root + '/child' })).rejects.toThrow('exact checkout')
  await expect(f.create({ paths: ['../outside'] })).rejects.toThrow('relative')
  await expect(f.create({ command: 'touch /outside' })).rejects.toThrow()
  const first = await f.create(), second = await f.create({ title: 'Another task' })
  await f.act(first.id, 'run'); await f.running(first.id)
  await expect(f.act(second.id, 'run')).rejects.toThrow('run is active')
  expect(f.counts().turns).toBe(1)
  await expect(AgentConsole.open(f.workspace, f.cache, { directory: f.directory, codexExecutable: '/fixture/codex', factory: f.factory })).rejects.toThrow('lock exists')
})

it('resumes a durable task after its expired advisory activity row has been pruned', async () => {
  const f = await fixture(), task = await f.create()
  await f.act(task.id, 'run'); await f.running(task.id); await f.finish(task.id)
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now + 3 * 86400000)
  try { await f.act(task.id, 'run', { message: 'Verify the previous result again.' }); await f.running(task.id); expect(f.counts().turns).toBe(2) }
  finally { clock.mockRestore() }
})
