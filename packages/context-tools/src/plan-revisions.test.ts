import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentConsole } from './agent-console.js'
import type { HostFactory } from './agent-host.js'
import { discoverWorkspace, gitEnvironment } from './workspace-catalogue.js'
import { initialiseWorkspaceStore, WorkspaceStore, workspaceKey } from './workspace-store.js'
import { RepositoryCoordination } from './repository-coordination.js'
import { workerSlot } from './console-inbox.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'z1p-revision-test-'))), workspace = join(temp, 'workspace'), root = join(workspace, 'project'), cache = join(temp, 'cache'), directory = join(temp, 'control')
  await mkdir(root, { recursive: true }); for (const name of ['one', 'two', 'three', 'four']) await writeFile(join(root, name + '.ts'), 'export const value = 1\n')
  const git = (args: string[], cwd = root) => execFileSync('git', ['-C', cwd, ...args], { env: gitEnvironment(), encoding: 'utf8', stdio: 'pipe' }).trim()
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  cleanup.push(async () => { for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) if (line.startsWith('worktree ') && line.slice(9) !== root) { const cwd = line.slice(9); expect(git(['status', '--porcelain'], cwd)).toBe(''); git(['merge-base', '--is-ancestor', git(['rev-parse', 'HEAD'], cwd), 'HEAD']); const branch = git(['branch', '--show-current'], cwd); git(['worktree', 'remove', cwd]); git(['branch', '-d', branch]) } await rm(temp, { recursive: true, force: true }) })
  await initialiseWorkspaceStore(cache); await initialiseWorkspaceStore(directory)
  const shared = new WorkspaceStore(cache); cleanup.push(async () => shared.close()); await discoverWorkspace(workspace, shared)
  const callbacks = new Map<string, Parameters<HostFactory>[1]>(), calls: { method: string; params: any }[] = [], responses: any[] = []
  let release: (() => void) | undefined, hold = false
  const factory: HostFactory = async (cwd, handlers) => { callbacks.set(cwd, handlers); return {
    request: async (method, params: any) => { calls.push({ method, params });
      if (method.startsWith('thread/')) { if (hold) await new Promise<void>(resolve => { release = resolve }); return { cwd, thread: { id: params.threadId ?? 'thread-' + randomUUID(), cwd, status: { type: 'idle' } }, model: 'fixture', modelProvider: 'fixture', approvalPolicy: 'on-request', sandbox: 'fixture' } }
      if (method === 'turn/start') return { turn: { id: randomUUID(), status: 'inProgress' } }; return {}
    }, respond: (id, result) => { responses.push({ id, result }) }, reject() {}, async close() {},
  } }
  let controller = await AgentConsole.open(workspace, cache, { directory, factory, allowedRoots: [root], maxRunSeconds: 30 }); cleanup.push(() => controller.close())
  const node = (index: number, dependsOn: number[] = []) => ({ title: 'Step ' + (index + 1), task: 'Inspect and verify source', host: 'codex', paths: [['one.ts', 'two.ts', 'three.ts', 'four.ts'][index]], checks: ['required check'], dependsOn })
  const input = (nodes = [node(0), node(1, [0])]) => ({ title: 'Requirements plan', root, maxConcurrent: 2, nodes })
  const create = (plan = input()) => controller.action({ action: 'plan-create', requestId: randomUUID(), plan }) as Promise<any>
  const revise = (plan: any, next = input(), extra = {}) => controller.action({ action: 'plan-revise', requestId: randomUUID(), id: plan.id, expectedRevision: plan.revision, reason: 'The requirements changed', plan: next, ...extra }) as Promise<any>
  const act = (id: string, action: string, extra = {}) => controller.action({ action, id, requestId: randomUUID(), expectedRevision: controller.task(id).revision, ...extra }) as Promise<any>
  const running = (id: string) => vi.waitFor(() => expect(controller.task(id).status).toBe('running'))
  const emit = (id: string, method: string, params: any) => { const task = controller.task(id); callbacks.get(task.executionRoot)!.event({ method, params: { threadId: task.threadId, turnId: task.turnId, ...params } }) }
  const finish = async (id: string) => { const task = controller.task(id); emit(id, 'item/completed', { item: { type: 'agentMessage', text: 'Historical result marker' } }); emit(id, 'turn/completed', { turn: { id: task.turnId, status: 'completed' } }); await vi.waitFor(() => expect(controller.task(id).review).toBeDefined()) }
  const request = (id: string) => { const task = controller.task(id); callbacks.get(task.executionRoot)!.request({ id: 'approval', method: 'item/commandExecution/requestApproval', params: { threadId: task.threadId, turnId: task.turnId, itemId: 'command', command: 'fixture check', cwd: task.executionRoot } }) }
  return { root, workspace, directory, shared, calls, responses, node, input, create, revise, act, running, emit, finish, request, get console() { return controller }, hold: () => { hold = true }, release: () => { hold = false; release?.() }, reopen: async () => { await controller.close(); controller = await AgentConsole.open(workspace, cache, { directory, factory, allowedRoots: [root], maxRunSeconds: 30 }) } }
}

it('versions requirements atomically, computes old/new downstream impact, and deduplicates a lost committed revision save', async () => {
  const f = await fixture(), original = f.input([f.node(0), f.node(1, [0]), f.node(2, [1]), f.node(3)]), parent = await f.create(original)
  const next = structuredClone(original); next.nodes[0].checks = ['new check']
  const requestId = randomUUID(), child = await f.revise(parent, next, { requestId })
  expect(child.revisionNumber).toBe(2); expect(child.supersedes).toBe(parent.id); expect(child.change.changed).toEqual(['step-1']); expect(child.change.affected).toEqual(['step-1', 'step-2', 'step-3'])
  expect(f.console.plan(parent.id).ready).toEqual([]); expect(f.console.plan(parent.id).supersededBy).toBe(child.id)
  expect((await f.revise(parent, next, { requestId })).id).toBe(child.id); expect(f.console.snapshot().tasks).toHaveLength(8); expect(f.calls).toHaveLength(0)
  await expect(f.revise(parent, next, { requestId, reason: 'Changed same UUID' })).rejects.toThrow('different content')
  await expect(f.revise(parent, next)).rejects.toThrow('revision changed')
  expect((await readFile(join(f.directory, 'workspace.sqlite'))).includes(Buffer.from('The requirements changed'))).toBe(false)
  await f.reopen(); expect(f.console.plan(child.id).supersedes).toBe(parent.id); expect(f.console.plan(parent.id).ready).toEqual([])
})

it('rejects a no-op, wrong root and stale contract without invalidating the live plan', async () => {
  const f = await fixture(), parent = await f.create(), next = f.input(); next.nodes[0].task = 'New instructions'
  await expect(f.revise(parent)).rejects.toThrow('Change the plan requirements')
  await expect(f.revise(parent, { ...next, root: join(f.root, 'elsewhere') })).rejects.toThrow('same selected checkout')
  await expect(f.revise(parent, next, { expectedRevision: '0'.repeat(64) })).rejects.toThrow('revision changed')
  expect(f.console.plan(parent.id).supersededBy).toBeUndefined(); expect(f.console.snapshot().tasks).toHaveLength(2)
})

it('blocks old acceptance and continuation, retains old work as a reference and sends the current contract on an explicit new run', async () => {
  const f = await fixture(), parent = await f.create(), id = parent.nodes[0].taskId
  await f.act(id, 'run'); await f.running(id); await f.finish(id)
  const before = f.console.task(id), next = f.input(); next.nodes[0].task = 'NEW REQUIREMENTS marker'
  const child = await f.revise(parent, next)
  await expect(f.act(id, 'review', { decision: 'accept', reviewHash: before.review!.hash, planReview: { evidence: 'Old', checks: [{ check: 'required check', outcome: 'passed', evidence: 'Old receipt' }] } })).rejects.toThrow('superseded')
  await expect(f.act(id, 'run', { message: 'Continue old plan' })).rejects.toThrow('superseded')
  expect(f.console.task(id).worktree).toEqual(before.worktree); expect(f.console.task(id).result).toBe(before.result); expect(child.nodes[0].checks[0].outcome).toBe('unknown')
  const current = child.nodes[0].taskId; await f.act(current, 'run'); await f.running(current)
  const prompt = f.calls.filter(call => call.method === 'turn/start').at(-1)!.params.input[0].text
  expect(prompt).toContain('NEW REQUIREMENTS marker'); expect(prompt).toContain('Requirements revision 2'); expect(prompt).toContain(before.executionRoot); expect(prompt).toContain('do not reuse acceptance')
}, 15000)

it('refuses an old permission grant after revision while keeping decline and native stop available', async () => {
  const f = await fixture(), parent = await f.create(), id = parent.nodes[0].taskId
  await f.act(id, 'run'); await f.running(id); f.request(id); await vi.waitFor(() => expect(f.console.task(id).status).toBe('waiting'))
  const pending = f.console.task(id).pending[0].id, next = f.input(); next.nodes[0].task = 'Changed instructions'
  await f.revise(parent, next)
  await expect(f.act(id, 'answer', { pendingId: pending, decision: 'accept' })).rejects.toThrow('superseded'); expect(f.responses).toHaveLength(0)
  await f.act(id, 'answer', { pendingId: pending, decision: 'decline' }); expect(f.responses).toHaveLength(1)
  await f.act(id, 'stop'); expect(f.calls.some(call => call.method === 'turn/interrupt')).toBe(true)
})

it('does not dispatch an old turn if its native thread startup finishes after the revision commits', async () => {
  const f = await fixture(), parent = await f.create(), id = parent.nodes[0].taskId
  f.hold(); await f.act(id, 'run'); await vi.waitFor(() => expect(f.calls.some(call => call.method === 'thread/start')).toBe(true))
  const next = f.input(); next.nodes[0].task = 'Changed while starting'; await f.revise(parent, next); f.release()
  await vi.waitFor(() => expect(f.console.task(id).status).toBe('unknown'))
  expect(f.calls.some(call => call.method === 'turn/start')).toBe(false)
})

it('keeps a previously accepted result historical rather than carrying its acceptance into the new revision', async () => {
  const f = await fixture(), initial = f.input([f.node(0)]), parent = await f.create(initial), id = parent.nodes[0].taskId
  await f.act(id, 'run'); await f.running(id); await f.finish(id)
  await f.act(id, 'review', { decision: 'accept', reviewHash: f.console.task(id).review!.hash, planReview: { evidence: 'Inspected', checks: [{ check: 'required check', outcome: 'passed', evidence: 'Fixture receipt' }] } })
  const next = structuredClone(initial); next.nodes[0].checks = ['Different check']; const child = await f.revise(parent, next)
  expect(f.console.plan(parent.id).reportedComplete).toBe(false); expect(f.console.plan(parent.id).historicallyComplete).toBe(true)
  expect(child.reportedComplete).toBe(false); expect(child.metrics.attempts).toBe(0); expect(child.nodes[0].checks).toEqual([{ check: 'Different check', outcome: 'unknown', evidence: 'No check receipt recorded' }])
}, 15000)

it.each(['Codex', 'Claude', 'Kimi', 'Ollama host'])('propagates one private revision note and exact ACK through a registered %s-labelled peer', async label => {
  const f = await fixture(), parent = await f.create(), id = parent.nodes[0].taskId
  await f.act(id, 'run'); await f.running(id)
  const peer = new RepositoryCoordination(f.shared), root = f.console.task(id).executionRoot
  await peer.update({ expectedRoot: root, slot: workerSlot(id), label, task: 'Protocol fixture, not a model identity', paths: ['one.ts'], state: 'working', expectedRevision: 0, ttlSeconds: 900 })
  const next = f.input(); next.nodes[0].task = 'Private updated requirements'; const requestId = randomUUID(), child = await f.revise(parent, next, { requestId })
  const noteId = child.notices[0].noteId; expect(noteId).toBeTruthy()
  await f.console.poll()
  const received = await peer.read({ expectedRoot: root, maxBytes: 65536 }), note = received.messages.find(note => note.messageId === noteId)!
  expect(note.text).toContain(child.revision); expect(note.text).toContain('Do not retarget'); expect(note.text).toContain('The requirements changed')
  await peer.send({ expectedRoot: root, slot: workerSlot(id), recipientAgentId: f.console.task(id).address, messageId: randomUUID(), text: 'ACK ' + noteId })
  await vi.waitFor(async () => { await f.console.poll(); expect(f.console.plan(child.id).notices[0].delivery).toBe('acknowledged') }, { timeout: 3000 })
  await f.revise(parent, next, { requestId }); await f.console.poll(); expect((await peer.read({ expectedRoot: root, maxBytes: 65536 })).messages.filter(note => note.messageId === noteId)).toHaveLength(1)
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
}, 15000)

it('reports a full task inbox without overwriting retained notes or permitting stale execution, and retains journal version3', async () => {
  const f = await fixture(), parent = await f.create(), id = parent.nodes[0].taskId
  await f.act(id, 'run'); await f.running(id)
  const store = new WorkspaceStore(f.directory)
  try { const key = workspaceKey('console', f.workspace), state = store.get<any>(key); state.tasks.find((task: any) => task.id === id).inbox = Array.from({ length: 128 }, () => ({ id: randomUUID(), from: 'owner', text: 'Retained note', at: Date.now() })); store.put(key, 'console', state) } finally { store.close() }
  const next = f.input(); next.nodes[0].task = 'Updated'; const child = await f.revise(parent, next)
  expect(child.notices[0].delivery).toBe('inbox_full'); expect(f.console.task(id).inbox).toHaveLength(128)
  await expect(f.act(id, 'run', { message: 'Old' })).rejects.toThrow('superseded')
  await f.create()
  const read = new WorkspaceStore(f.directory); try { expect(read.get<any>(workspaceKey('console', f.workspace)).version).toBe(3) } finally { read.close() }
})
