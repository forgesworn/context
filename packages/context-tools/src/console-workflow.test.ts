import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AgentConsole } from './agent-console.js'
import type { HostFactory } from './agent-host.js'
import { discoverWorkspace, gitEnvironment } from './workspace-catalogue.js'
import { initialiseWorkspaceStore, WorkspaceStore } from './workspace-store.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'z1p-plan-test-'))), workspace = join(temp, 'workspace'), root = join(workspace, 'project'), cache = join(temp, 'cache'), directory = join(temp, 'control')
  await mkdir(root, { recursive: true }); await writeFile(join(root, 'one.ts'), 'export const one = 1\n'); await writeFile(join(root, 'two.ts'), 'export const two = 2\n')
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { env: gitEnvironment(), stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  cleanup.push(async () => {
    const worktrees = git(['worktree', 'list', '--porcelain']).toString().split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9)).filter(path => path !== root)
    for (const path of worktrees) {
      expect(execFileSync('git', ['-C', path, 'status', '--porcelain'], { stdio: 'pipe' }).toString()).toBe('')
      const head = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      git(['merge', '--ff-only', head]); git(['merge-base', '--is-ancestor', head, 'HEAD']); git(['worktree', 'remove', path])
    }
    await rm(temp, { recursive: true, force: true })
  })
  await initialiseWorkspaceStore(cache); await initialiseWorkspaceStore(directory)
  const store = new WorkspaceStore(cache); try { await discoverWorkspace(workspace, store) } finally { store.close() }
  const callbacks = new Map<string, Parameters<HostFactory>[1]>(), calls: { root: string; method: string; params: any }[] = []
  let turns = 0, mutateBeforeTurn = false
  const factory: HostFactory = async (cwd, handlers) => {
    callbacks.set(cwd, handlers)
    return { request: async (method, params: any) => {
      calls.push({ root: cwd, method, params })
      if (method.startsWith('thread/')) {
        if (mutateBeforeTurn) { await writeFile(join(cwd, 'one.ts'), 'export const changed = 3\n'); git(['-C', cwd, 'add', '.']); git(['-C', cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture source change']) }
        return { cwd, thread: { id: params.threadId ?? 'thread-' + randomUUID(), cwd, status: { type: 'idle' } }, model: 'fixture', modelProvider: 'fixture', approvalPolicy: 'on-request', sandbox: 'fixture' }
      }
      if (method === 'turn/start') return { turn: { id: 'turn-' + (++turns), status: 'inProgress' } }
      return {}
    }, respond() {}, reject() {}, async close() {} }
  }
  let controller = await AgentConsole.open(workspace, cache, { directory, factory, allowedRoots: [root], maxRunSeconds: 30, maxActive: 3 })
  cleanup.push(() => controller.close())
  const node = (i: number, dependsOn: number[] = []) => ({ title: 'Step ' + (i + 1), task: 'Inspect source and report exact evidence', host: 'codex', paths: [i ? 'two.ts' : 'one.ts'], checks: ['source check'], dependsOn })
  const create = (nodes = [node(0), node(1, [0])], extra = {}) => controller.action({ action: 'plan-create', requestId: randomUUID(), plan: { title: 'PRIVATE task plan marker', root, maxConcurrent: 2, nodes }, ...extra }) as Promise<any>
  const act = (id: string, action: string, extra = {}) => controller.action({ action, id, requestId: randomUUID(), expectedRevision: controller.task(id).revision, ...extra }) as Promise<any>
  const running = (id: string) => vi.waitFor(() => expect(controller.task(id).status).toBe('running'))
  const finish = async (id: string, status = 'completed') => {
    const task = controller.task(id), handler = callbacks.get(task.executionRoot)!
    handler.event({ method: 'item/completed', params: { threadId: task.threadId, turnId: task.turnId, item: { type: 'agentMessage', text: 'Reported result; check evidence still required.' } } })
    handler.event({ method: 'turn/completed', params: { threadId: task.threadId, turn: { id: task.turnId, status } } })
    await vi.waitFor(() => expect(controller.task(id).status).toBe(status === 'completed' ? 'review' : 'failed'))
    if (status === 'completed') await vi.waitFor(() => expect(controller.task(id).review).toBeDefined())
  }
  const review = (id: string, outcome = 'passed', decision = 'accept') => act(id, 'review', { decision, reviewHash: controller.task(id).review!.hash, planReview: { evidence: 'Owner inspected exact fixture result', checks: [{ check: 'source check', outcome, evidence: 'Fixture check receipt inspected' }] } })
  const changeAccepted = async (id: string) => { const cwd = controller.task(id).executionRoot; await writeFile(join(cwd, 'one.ts'), 'export const changed = 5\n'); git(['-C', cwd, 'add', '.']); git(['-C', cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture changed after review']) }
  return { root, directory, calls, node, create, act, running, finish, review, changeAccepted, get console() { return controller }, mutate: () => { mutateBeforeTurn = true }, reopen: async () => { await controller.close(); controller = await AgentConsole.open(workspace, cache, { directory, factory, allowedRoots: [root], maxRunSeconds: 30 }); return controller } }
}

it('creates encrypted draft plans atomically, reconciles duplicate saves and rejects changed request content', async () => {
  const f = await fixture(), requestId = randomUUID(), plan = await f.create(undefined, { requestId })
  expect(f.console.snapshot().tasks).toHaveLength(2); expect(f.calls).toHaveLength(0); expect(plan.ready).toEqual(['step-1'])
  expect((await f.create(undefined, { requestId })).id).toBe(plan.id)
  await expect(f.create([f.node(0)], { requestId })).rejects.toThrow('different content')
  expect((await readFile(join(f.directory, 'workspace.sqlite'))).includes(Buffer.from('PRIVATE task plan marker'))).toBe(false)
  await f.reopen(); expect(f.console.plan(plan.id).nodes).toHaveLength(2); expect(f.calls).toHaveLength(0)
})

it('rejects cycles, unknown dependencies and unconfigured hosts without leaving orphan tasks', async () => {
  const f = await fixture()
  for (const nodes of [[f.node(0, [1]), f.node(1, [0])], [f.node(0, [7])], [{ ...f.node(0), host: 'kimi' }]]) await expect(f.create(nodes)).rejects.toThrow()
  expect(f.console.snapshot().tasks).toHaveLength(0); expect(f.console.snapshot().plans).toHaveLength(0)
})

it('blocks dependent execution until exact owner review with passing named checks; completion never auto-starts the next step', async () => {
  const f = await fixture(), plan = await f.create(), [one, two] = plan.nodes.map((node: any) => node.taskId)
  await expect(f.act(two, 'run')).rejects.toThrow('blocked'); expect(f.calls).toHaveLength(0)
  await f.act(one, 'run'); await f.running(one)
  expect(f.calls.find(call => call.method === 'turn/start')!.params.input[0].text).toContain('Fresh source packet:')
  await f.finish(one)
  await expect(f.act(two, 'run')).rejects.toThrow('blocked')
  await expect(f.act(one, 'review', { decision: 'accept', reviewHash: f.console.task(one).review!.hash })).rejects.toThrow('every plan check')
  await expect(f.review(one, 'unknown')).rejects.toThrow('passing checks')
  expect(f.console.plan(plan.id).nodes[0].state).toBe('running')
  await f.review(one)
  expect(f.console.plan(plan.id).ready).toEqual(['step-2']); expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(1)
  await f.act(two, 'run'); await f.running(two)
  const prompt = f.calls.filter(call => call.method === 'turn/start').at(-1)!.params.input[0].text
  expect(prompt).toContain('Dependency results:'); expect(prompt).toContain('reviewedHash'); expect(prompt).toContain('not automatically merged')
  await f.finish(two); await f.review(two)
  expect(f.console.plan(plan.id).reportedComplete).toBe(true); expect(f.console.plan(plan.id).metrics.wholeTaskCost).toBeNull()
}, 15000)

it('permits independent worktrees concurrently and retains overlap as a scheduling constraint', async () => {
  const f = await fixture(), plan = await f.create([f.node(0), f.node(1)])
  await f.act(plan.nodes[0].taskId, 'run'); await f.running(plan.nodes[0].taskId)
  await f.act(plan.nodes[1].taskId, 'run'); await f.running(plan.nodes[1].taskId)
  expect(f.console.snapshot().active).toBe(2)
  const overlap = await f.create([f.node(0), { ...f.node(1), paths: ['one.ts'] }])
  expect(f.console.plan(overlap.id).ready).toEqual(['step-1'])
})

it('records interrupted outcomes across restart and requires explicit reconciliation before retry', async () => {
  const f = await fixture(), plan = await f.create(), id = plan.nodes[0].taskId
  await f.act(id, 'run'); await f.running(id); await f.reopen()
  expect(f.console.task(id).status).toBe('unknown'); expect(f.console.plan(plan.id).nodes[0].state).toBe('reconcile')
  await expect(f.act(id, 'run', { message: 'Retry' })).rejects.toThrow('Reconcile')
  await f.act(id, 'plan-reconcile', { evidence: 'Inspected host and branch: no unresolved external effect; safe to retry' })
  await f.act(id, 'run', { message: 'Continue only the unfinished step' }); await f.running(id)
  expect(f.console.plan(plan.id).metrics.retries).toBe(1)
})

it('keeps a rejected result retryable and prevents changing check identities to manufacture acceptance', async () => {
  const f = await fixture(), plan = await f.create(), id = plan.nodes[0].taskId
  await f.act(id, 'run'); await f.running(id); await f.finish(id)
  await expect(f.act(id, 'review', { decision: 'accept', reviewHash: f.console.task(id).review!.hash, planReview: { evidence: 'No', checks: [{ check: 'different check', outcome: 'passed', evidence: 'Unsupported' }] } })).rejects.toThrow('unknown or duplicate check')
  await f.review(id, 'failed', 'changes')
  expect(f.console.plan(plan.id).nodes[0].state).toBe('retryable'); expect(f.console.plan(plan.id).ready).toEqual(['step-1'])
})

it('refuses a source packet that changes while the native host starts, without sending a turn', async () => {
  const f = await fixture(), plan = await f.create(), id = plan.nodes[0].taskId
  f.mutate(); await f.act(id, 'run')
  await vi.waitFor(() => expect(f.console.task(id).status).toBe('unknown'))
  expect(f.calls.some(call => call.method === 'turn/start')).toBe(false)
  expect(f.console.plan(plan.id).nodes[0].state).toBe('reconcile')
})

it('refuses a prerequisite that changes after review instead of dispatching stale accepted output', async () => {
  const f = await fixture(), plan = await f.create(), [first, second] = plan.nodes.map((node: any) => node.taskId)
  await f.act(first, 'run'); await f.running(first); await f.finish(first); await f.review(first)
  await f.changeAccepted(first)
  const turns = f.calls.filter(call => call.method === 'turn/start').length
  await expect(f.act(second, 'run')).rejects.toThrow('prerequisite checkout changed')
  expect(f.calls.filter(call => call.method === 'turn/start')).toHaveLength(turns)
}, 15000)

it('refuses an unsaved checkout and stops new work at the plan deadline without starting a host', async () => {
  const f = await fixture(), wrong = { title: 'Wrong checkout', root: join(f.root, 'nested'), maxConcurrent: 1, nodes: [f.node(0)] }
  await expect(f.create(undefined, { plan: wrong })).rejects.toThrow('exact checkout')
  const plan = await f.create(), clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86400001)
  try { expect(f.console.plan(plan.id).stopReasons).toContain('duration_limit'); await expect(f.act(plan.nodes[0].taskId, 'run')).rejects.toThrow('blocked'); expect(f.calls).toHaveLength(0) } finally { clock.mockRestore() }
})

it('does not advertise readiness after source preparation fails before a model attempt exists', async () => {
  const f = await fixture(), plan = await f.create([{ ...f.node(0), paths: ['not-created.ts'] }]), id = plan.nodes[0].taskId
  await f.act(id, 'run')
  expect(f.console.task(id).status).toBe('unknown'); expect(f.console.plan(plan.id).ready).toEqual([])
  expect(f.console.plan(plan.id).nodes[0].blockers).toContain('Previous preparation or run needs explicit reconciliation')
  expect(f.console.plan(plan.id).metrics.attempts).toBe(0); expect(f.calls).toHaveLength(0)
  await expect(f.act(id, 'run')).rejects.toThrow('Reconcile')
})
