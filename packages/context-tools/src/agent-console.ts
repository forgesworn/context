import { createHash, randomUUID } from 'node:crypto'
import { lstat, open, readFile, realpath, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { hostname } from 'node:os'
import { isAbsolute, join, relative, posix } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { WorkspaceStore, workspaceKey } from './workspace-store.js'
import { describeCheckout, gitEnvironment, type WorkspaceCatalogue } from './workspace-catalogue.js'
import { RepositoryCoordination } from './repository-coordination.js'
import { codexHost } from './codex-host.js'
import { claudeHost } from './claude-host.js'
import type { AgentHost, HostFactory, HostRequest, HostEvent } from './agent-host.js'

const exec = promisify(execFile)
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const uuid = z.string().uuid(), bounded = (max: number) => z.string().min(1).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
const base = { requestId: uuid, id: uuid, expectedRevision: z.number().int().nonnegative() }
export const consoleActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), requestId: uuid, root: bounded(2048), title: bounded(160), objective: bounded(8000), host: z.enum(['codex', 'claude']), paths: z.array(bounded(512)).max(32).default([]) }).strict(),
  z.object({ ...base, action: z.literal('run'), message: z.string().max(8000).optional() }).strict(),
  z.object({ ...base, action: z.literal('stop') }).strict(),
  z.object({ ...base, action: z.literal('answer'), pendingId: uuid, decision: z.enum(['accept', 'decline', 'cancel']).optional(), answers: z.record(z.string(), z.string().max(4000)).optional() }).strict(),
  z.object({ ...base, action: z.literal('review'), decision: z.enum(['accept', 'changes']), reviewHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
])
type Action = z.infer<typeof consoleActionSchema>
type Status = 'draft' | 'starting' | 'running' | 'waiting' | 'stopping' | 'review' | 'accepted' | 'cancelled' | 'failed' | 'unknown'
type Pending = { id: string; wireId: string | number; method: string; params: any; preview?: { changes: unknown[]; hash: string } }
interface Task {
  id: string; revision: number; eventSequence: number; createdAt: number; updatedAt: number
  root: string; identity: string; host: 'codex' | 'claude'; title: string; objective: string; paths: string[]; status: Status
  createHash: string; receipts: { id: string; hash: string }[]; threadId?: string; turnId?: string
  settings?: { model: string; provider: string; approvalPolicy: unknown; sandbox: unknown }
  pending: Pending[]; events: { sequence: number; text: string }[]; eventsTruncated: boolean
  result: string; diff: string; review?: { hash: string; head: string | null; status: string; diff: string; untracked: { name: string; hash: string; text: string }[] }; reviewError?: string
  accepted?: { at: number; hash: string }; coordId: string; coordRevision: number
}
interface State { version: 1; tasks: Task[] }
interface Live { host?: AgentHost; finishing: boolean; output: string; outputSequence: number; proposals: Map<string, unknown[]>; stopTimer?: ReturnType<typeof setTimeout> }
export interface ConsoleOptions { directory: string; codexExecutable?: string; claudeExecutable?: string; maxRunSeconds?: number; factory?: HostFactory; allowedRoots?: string[] }

/** Optional local owner controller. The selected external harness owns execution. */
export class AgentConsole {
  private readonly store: WorkspaceStore
  private readonly shared: WorkspaceStore
  private readonly key: string
  private readonly live = new Map<string, Live>()
  private serial: Promise<unknown> = Promise.resolve()
  private closing = false
  private lock?: { path: string; bytes: string }
  private factories: Partial<Record<Task['host'], HostFactory>>
  private constructor(readonly workspace: string, cache: string, private options: ConsoleOptions) {
    this.store = new WorkspaceStore(options.directory)
    try { this.shared = new WorkspaceStore(cache) } catch (error) { this.store.close(); throw error }
    this.key = workspaceKey('console', workspace)
    this.factories = { codex: options.factory ?? (options.codexExecutable ? codexHost(options.codexExecutable, options.maxRunSeconds ?? 600) : undefined), claude: options.claudeExecutable ? claudeHost(options.claudeExecutable, options.maxRunSeconds ?? 600) : undefined }
  }
  static async open(workspace: string, cache: string, options: ConsoleOptions) {
    const max = options.maxRunSeconds ?? 600
    if (!Number.isInteger(max) || max < 10 || max > 900) throw new Error('console max run must be 10–900 seconds')
    if (process.platform === 'win32' && !options.factory) throw new Error('This host adapter currently requires macOS or Linux')
    const controller = new AgentConsole(workspace, cache, options)
    try {
      await controller.acquire()
      controller.change(state => {
        for (const task of state.tasks) if (['starting', 'running', 'waiting', 'stopping'].includes(task.status)) {
          task.status = 'unknown'; task.pending = []; task.revision++
          controller.log(task, 'Previous console ended without a terminal receipt. Reconcile the saved host thread before continuing.')
        }
      })
      return controller
    } catch (error) { controller.store.close(); controller.shared.close(); throw error }
  }
  private async acquire() {
    const path = join(this.options.directory, 'console.lock')
    const bytes = JSON.stringify({ pid: process.pid, host: hostname(), nonce: randomUUID() })
    try {
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
      try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('A console lock exists. Stop its owner, or reconcile a crashed console before removing its private lock. No automatic takeover.')
      throw error
    }
    this.lock = { path, bytes }
  }
  private state(): State {
    const state = this.store.get<State>(this.key) ?? { version: 1, tasks: [] }
    if (state.version !== 1 || !Array.isArray(state.tasks) || state.tasks.length > 64) throw new Error('Invalid console journal')
    return state
  }
  private change<T>(fn: (state: State) => T): T {
    return this.store.transaction(() => { const state = this.state(); const result = fn(state); this.store.put(this.key, 'console', state); return result })
  }
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.serial.then(fn, fn); this.serial = next.catch(() => {}); return next
  }
  private log(task: Task, text: string) {
    task.updatedAt = Date.now(); task.events.push({ sequence: ++task.eventSequence, text: text.slice(0, 12000) })
    while (task.events.length > 128 || Buffer.byteLength(JSON.stringify(task.events)) > 65536) { task.events.shift(); task.eventsTruncated = true }
  }
  private async root(root: string, identity?: string) {
    const catalogue = this.shared.get<WorkspaceCatalogue>(workspaceKey('catalogue', this.workspace))
    const saved = catalogue?.repositories.find(repo => repo.root === root)
    const rel = relative(this.workspace, root)
    if (!saved || (this.options.allowedRoots && !this.options.allowedRoots.includes(root)) || !isAbsolute(root) || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Select an exact checkout from this saved workspace')
    const live = await describeCheckout(root), info = await lstat(live.commonDirectory)
    const actual = digest([live.commonDirectory, info.dev, info.ino])
    if (live.commonDirectory !== saved.commonDirectory || (identity && actual !== identity)) throw new Error('Checkout identity changed; reconcile the task')
    return { identity: actual, checkout: live }
  }
  snapshot() {
    return { enabled: true, roots: this.options.allowedRoots ?? [], hosts: [{ id: 'codex', available: !!this.factories.codex }, { id: 'claude', available: !!this.factories.claude }, { id: 'kimi', available: false }, { id: 'ollama', available: false }], maxRunSeconds: this.options.maxRunSeconds ?? 600, maxActive: 1, active: this.live.size,
      tasks: this.state().tasks.map(({ id, revision, title, root, host, status, updatedAt, eventSequence }) => ({ id, revision, title, root, host, status, updatedAt, eventSequence })) }
  }
  task(id: string) { uuid.parse(id); const task = this.state().tasks.find(task => task.id === id); if (!task) throw new Error('Task not found'); const live = this.live.get(id); return { ...task, liveOutput: live?.output ?? '', outputSequence: live?.outputSequence ?? 0 } }
  async action(raw: unknown) {
    return this.queue(async () => {
      if (this.closing) throw new Error('Console is closing')
      const action = consoleActionSchema.parse(raw), hash = digest(action)
      if (action.action === 'create') {
        const old = this.state().tasks.find(task => task.id === action.requestId)
        if (old) { if (old.createHash !== hash) throw new Error('Request ID reused with different content'); return old }
        if (!this.factories[action.host]) throw new Error('Selected host is not configured in this console')
        const root = await this.root(action.root)
        // Reuse the coordination boundary to validate relative path syntax before saving.
        if (action.paths.some(path => path !== '.' && (path.includes('\\') || path.includes(':') || path.startsWith('/') || path.endsWith('//') || posix.normalize(path.replace(/\/$/, '')) !== path.replace(/\/$/, '') || path.split('/').includes('..') || /[\x00-\x1f]/.test(path)))) throw new Error('Intended paths must be relative and cannot traverse')
        if (Buffer.byteLength(JSON.stringify(action.paths)) > 8192) throw new Error('Intended paths exceed limit')
        return this.change(state => {
          if (state.tasks.length >= 64) throw new Error('Console journal holds at most 64 tasks')
          const task: Task = { id: action.requestId, revision: 1, eventSequence: 0, createdAt: Date.now(), updatedAt: Date.now(), root: action.root, identity: root.identity, host: action.host, title: action.title, objective: action.objective, paths: action.paths, status: 'draft', createHash: hash, receipts: [], pending: [], events: [], eventsTruncated: false, result: '', diff: '', coordId: randomUUID(), coordRevision: 0 }
          this.log(task, 'Task saved locally. Starting a run uses the installed host configuration.'); state.tasks.push(task); return task
        })
      }
      let task: Task = this.task(action.id)
      const old = task.receipts.find(receipt => receipt.id === action.requestId)
      if (old) { if (old.hash !== hash) throw new Error('Request ID reused with different content'); return task }
      if (task.revision !== action.expectedRevision) throw new Error('Task changed. Refresh and review before retrying.')
      await this.root(task.root, task.identity)
      if (action.action === 'run') {
        if (!this.factories[task.host]) throw new Error('Selected host is not configured in this console')
        if (!['draft', 'review', 'cancelled', 'failed', 'unknown'].includes(task.status) || this.live.size) throw new Error('A run is active or this task cannot run')
        if (task.threadId && !action.message?.trim()) throw new Error('Enter a follow-up instruction before continuing the saved thread')
        const live: Live = { finishing: false, output: '', outputSequence: 0, proposals: new Map() }
        task = this.record(action, hash, current => { current.status = 'starting'; current.pending = []; current.review = undefined; current.reviewError = undefined; current.accepted = undefined; current.result = ''; current.diff = ''; this.log(current, action.message ? 'Follow-up: ' + action.message : 'Starting the selected host with its existing configuration.') })
        this.live.set(task.id, live)
        void this.launch(task, live, action.message).catch(error => { void this.lost(task.id, 'Host start failed: ' + String(error).slice(0, 500)) })
        return task
      }
      if (action.action === 'answer') {
        const pending = task.pending.find(item => item.id === action.pendingId), live = this.live.get(task.id)
        if (!pending || !live?.host || task.status !== 'waiting') throw new Error('This host request is no longer pending')
        let result: unknown
        if (pending.method === 'item/tool/requestUserInput') {
          if (action.decision || !action.answers) throw new Error('Question answers required')
          const questions = pending.params.questions
          if (!Array.isArray(questions) || questions.some((q: any) => q.isSecret) || questions.length > 3) throw new Error('This question requires the native host')
          if (Object.keys(action.answers).some(id => !questions.some((q: any) => q.id === id)) || questions.some((q: any) => !action.answers![q.id]?.trim())) throw new Error('Answer every requested question')
          result = { answers: Object.fromEntries(questions.map((q: any) => [q.id, { answers: [action.answers![q.id]] }])) }
        } else {
          if (!action.decision || action.answers) throw new Error('Approval decision required')
          if (action.decision === 'accept' && pending.method === 'item/fileChange/requestApproval') {
            const changes = live.proposals.get(pending.params.itemId)
            if (!pending.preview || !changes || digest(changes) !== pending.preview.hash) throw new Error('A matching current file-change preview is required before approval')
          }
          result = { decision: action.decision }
        }
        task = this.record(action, hash, current => { current.pending = current.pending.filter(item => item.id !== action.pendingId); current.status = current.pending.length ? 'waiting' : 'running'; this.log(current, 'Owner answered host request: ' + (action.decision ?? 'question answer')) })
        try { live.host.respond(pending.wireId, result); await this.publish(this.task(task.id), task.pending.length ? 'blocked' : 'working') }
        catch { await this.failWithinQueue(task.id, 'Answer delivery or activity update uncertain; reconcile the host thread') }
        return this.task(task.id)
      }
      if (action.action === 'stop') {
        const live = this.live.get(task.id)
        if (!live || !['starting', 'running', 'waiting'].includes(task.status)) throw new Error('No active host can be stopped')
        task = this.record(action, hash, current => { current.status = 'stopping'; current.pending = []; this.log(current, 'Stop requested. Waiting for a terminal host receipt.') })
        if (!live.host || !task.threadId || !task.turnId) { await this.failWithinQueue(task.id, 'Start stopped before a terminal host receipt. Reconcile before continuing.'); return this.task(task.id) }
        void live.host.request('turn/interrupt', { threadId: task.threadId, turnId: task.turnId }).catch(() => { void this.lost(task.id, 'Interrupt outcome unknown') })
        live.stopTimer = setTimeout(() => { void this.lost(task.id, 'No terminal interruption receipt; owned host stopped, reconcile before continuing') }, 3000)
        return task
      }
      if (task.status !== 'review' || !task.review || action.reviewHash !== task.review.hash) throw new Error('No matching result is ready for review')
      const audit = await this.audit(task)
      if (audit.hash !== task.review.hash) throw new Error('Checkout or result changed. Review a new run before accepting.')
      return this.record(action, hash, current => { current.status = action.decision === 'accept' ? 'accepted' : 'draft'; if (action.decision === 'accept') current.accepted = { at: Date.now(), hash: audit.hash }; this.log(current, action.decision === 'accept' ? 'Local owner accepted this exact result and checkout snapshot.' : 'Owner requested changes. Enter a follow-up instruction.') })
    })
  }
  private record(action: Exclude<Action, { action: 'create' }>, hash: string, update: (task: Task) => void) {
    return this.change(state => { const task = state.tasks.find(task => task.id === action.id)!; update(task); task.revision++; task.updatedAt = Date.now(); task.receipts.push({ id: action.requestId, hash }); task.receipts = task.receipts.slice(-64); return task })
  }
  private async publish(task: Task, state: 'working' | 'blocked' | 'reviewing' | 'done') {
    const coordination = new RepositoryCoordination(this.shared, task.coordId as ReturnType<typeof randomUUID>)
    const input = { expectedRoot: task.root, slot: 'console-' + task.id, label: (task.host === 'claude' ? 'Claude' : 'Codex') + ' / task console', task: task.title, paths: task.paths, state, expectedRevision: task.coordRevision, ttlSeconds: 1800 }
    let result
    try { result = await coordination.update(input) }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('activity revision changed')) throw error
      // An expired advisory row may have been pruned. CAS zero can recreate it,
      // but still refuses to overwrite any live/newer row with this identity.
      result = await coordination.update({ ...input, expectedRevision: 0 })
    }
    this.change(current => { current.tasks.find(item => item.id === task.id)!.coordRevision = result.agent.revision })
  }
  private async launch(task: Task, live: Live, message?: string) {
    await this.publish(task, 'working')
    const host = await this.factories[task.host]!(task.root, { event: event => { void this.queue(() => this.event(task.id, event)) }, request: request => { void this.queue(() => this.hostRequest(task.id, request)) }, lost: reason => { void this.lost(task.id, reason) } })
    live.host = host
    if (this.closing || this.live.get(task.id) !== live || live.finishing) { await host.close(); return }
    const settings = await host.request(task.threadId ? 'thread/resume' : 'thread/start', task.threadId ? { threadId: task.threadId, cwd: task.root, excludeTurns: true } : { cwd: task.root })
    if (settings.cwd !== task.root || settings.thread?.cwd !== task.root || typeof settings.thread.id !== 'string' || settings.thread.status?.type === 'active') throw new Error('Host thread checkout or state does not match the selected task')
    if (settings.thread.id.length > 512 || typeof settings.model !== 'string' || settings.model.length > 256 || typeof settings.modelProvider !== 'string' || settings.modelProvider.length > 256 || Buffer.byteLength(JSON.stringify([settings.approvalPolicy, settings.sandbox])) > 32768) throw new Error('Invalid host settings response')
    if (task.settings && (settings.model !== task.settings.model || settings.modelProvider !== task.settings.provider)) throw new Error('Saved host model/provider changed. Reconcile configuration before continuing.')
    await this.queue(async () => { this.change(state => { const current = state.tasks.find(item => item.id === task.id)!; current.threadId = settings.thread.id; current.settings = { model: settings.model, provider: settings.modelProvider, approvalPolicy: settings.approvalPolicy, sandbox: settings.sandbox }; current.revision++; this.log(current, 'Host: ' + settings.modelProvider + ' / ' + settings.model + '. Existing approval and sandbox settings retained.') }) })
    const result = await host.request('turn/start', { threadId: settings.thread.id, input: [{ type: 'text', text: message ?? task.objective, text_elements: [] }] })
    await this.queue(async () => { this.change(state => { const current = state.tasks.find(item => item.id === task.id)!; if (['starting', 'running'].includes(current.status)) { current.turnId = result.turn.id; current.status = 'running'; current.revision++ } }) })
  }
  private async hostRequest(id: string, request: HostRequest) {
    const live = this.live.get(id), task = this.task(id)
    if (!live?.host || live.finishing) return
    if (request.params.threadId !== task.threadId || (task.turnId && request.params.turnId !== task.turnId)) { live.host.reject(request.id); return }
    if (!(task.host === 'claude' ? ['claude/tool/requestApproval', 'item/tool/requestUserInput'] : ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput']).includes(request.method) || (request.method === 'item/fileChange/requestApproval' && request.params.grantRoot) || (request.method === 'item/tool/requestUserInput' && (!Array.isArray(request.params.questions) || request.params.questions.length > 3 || request.params.questions.some((q: any) => q.isSecret)))) {
      live.host.reject(request.id); await this.failWithinQueue(id, 'Host requested an unsupported interaction; use its native client to reconcile'); return
    }
    if (Buffer.byteLength(JSON.stringify(request.params)) > 32768 || task.pending.length >= 8) { live.host.reject(request.id); await this.failWithinQueue(id, 'Host request bound exceeded'); return }
    const changes = request.method === 'item/fileChange/requestApproval' ? live.proposals.get(request.params.itemId) : undefined
    const preview = changes && Buffer.byteLength(JSON.stringify(changes)) <= 131072 ? { changes, hash: digest(changes) } : undefined
    this.change(state => { const current = state.tasks.find(item => item.id === id)!; current.pending.push({ ...request, wireId: request.id, id: randomUUID(), ...(preview ? { preview } : {}) }); current.status = 'waiting'; current.revision++; this.log(current, 'Waiting for owner: ' + request.method) })
    await this.publish(this.task(id), 'blocked')
  }
  private async event(id: string, event: HostEvent) {
    const live = this.live.get(id)
    if (!live || live.finishing) return
    const task = this.task(id), p = event.params
    if (p.threadId && task.threadId && p.threadId !== task.threadId) return
    if (p.turnId && task.turnId && p.turnId !== task.turnId) return
    if (event.method === 'item/agentMessage/delta' && typeof p.delta === 'string') { live.output = (live.output + p.delta).slice(-65536); live.outputSequence++; return }
    if (event.method === 'item/started' && p.item?.type === 'fileChange' && typeof p.item.id === 'string' && Array.isArray(p.item.changes)) {
      if (live.proposals.size >= 16) live.proposals.delete(live.proposals.keys().next().value!)
      if (p.item.changes.length && Buffer.byteLength(JSON.stringify(p.item.changes)) <= 131072) live.proposals.set(p.item.id, p.item.changes)
    }
    if (event.method === 'turn/started' && p.turn?.id) this.change(state => { const t = state.tasks.find(item => item.id === id)!; t.turnId = p.turn.id; if (t.status === 'starting') { t.status = 'running'; t.revision++ } })
    if (event.method === 'serverRequest/resolved') this.change(state => { const t = state.tasks.find(item => item.id === id)!; const old = t.pending.length; t.pending = t.pending.filter(item => item.wireId !== p.requestId); if (old !== t.pending.length) { if (!t.pending.length && t.status === 'waiting') t.status = 'running'; t.revision++ } })
    if (event.method === 'item/completed') this.change(state => {
      const t = state.tasks.find(item => item.id === id)!, item = p.item
      if (item?.type === 'agentMessage') { t.result = String(item.text ?? '').slice(0, 65536); this.log(t, t.result) }
      else if (item?.type === 'commandExecution') this.log(t, 'Command: ' + String(item.command ?? '') + '\nStatus: ' + String(item.status) + ' · exit ' + String(item.exitCode) + '\n' + String(item.aggregatedOutput ?? '').slice(-12000))
      else if (item?.type === 'fileChange') this.log(t, 'File changes: ' + JSON.stringify(item.changes ?? []).slice(0, 12000))
      else if (item?.type === 'hostTool') this.log(t, 'Tool: ' + String(item.tool) + (item.isError ? ' · reported error' : ' · completed') + '\nInput: ' + JSON.stringify(item.input ?? null).slice(0, 4000) + '\nResult: ' + JSON.stringify(item.output ?? null).slice(-8000))
      else if (item?.type === 'mcpToolCall') this.log(t, 'Context/tool: ' + String(item.server) + '/' + String(item.tool) + ' · ' + String(item.status))
    })
    if (event.method === 'turn/diff/updated') this.change(state => { const t = state.tasks.find(item => item.id === id)!; t.diff = String(p.diff ?? '').slice(0, 131072) })
    if (event.method === 'turn/completed') {
      if (!p.turn?.id || (task.turnId && p.turn.id !== task.turnId)) return
      live.finishing = true; if (live.stopTimer) clearTimeout(live.stopTimer)
      await live.host?.close(); this.live.delete(id)
      this.change(state => { const t = state.tasks.find(item => item.id === id)!; t.pending = []; t.status = p.turn.status === 'completed' ? 'review' : p.turn.status === 'interrupted' ? 'cancelled' : 'failed'; t.revision++; this.log(t, 'Host turn ended: ' + String(p.turn.status) + (p.turn.error ? '\n' + String(p.turn.error.message).slice(0, 2000) : '')) })
      if (p.turn.status === 'completed') {
        try { const audit = await this.audit(this.task(id)); this.change(state => { const t = state.tasks.find(item => item.id === id)!; t.review = audit; t.revision++ }) }
        catch { this.change(state => { const t = state.tasks.find(item => item.id === id)!; t.reviewError = 'Working tree review exceeded a bound or could not be read. Acceptance is disabled; review through the native host.'; t.revision++ }) }
      }
      await this.publish(this.task(id), 'done')
    }
  }
  private lost(id: string, reason: string) { return this.queue(() => this.failWithinQueue(id, reason)) }
  private async failWithinQueue(id: string, reason: string) {
    const live = this.live.get(id)
    if (!live || live.finishing) return
    live.finishing = true; if (live.stopTimer) clearTimeout(live.stopTimer)
    await live.host?.close(); this.live.delete(id)
    this.change(state => { const task = state.tasks.find(task => task.id === id)!; task.status = 'unknown'; task.pending = []; task.revision++; this.log(task, reason) })
    await this.publish(this.task(id), 'done').catch(() => {})
  }
  private async audit(task: Task) {
    const root = await this.root(task.root, task.identity)
    const metadata = ['-C', task.root, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'core.untrackedCache=false']
    const run = async (args: string[]) => (await exec('git', [...metadata, ...args], { env: gitEnvironment(), timeout: 5000, maxBuffer: 262144 })).stdout
    let keys = ''
    try { keys = await run(['config', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|smudge|process|required)$']) }
    catch (error) { if ((error as { code?: unknown }).code !== 1) throw error }
    const drivers = [...new Set(keys.trim().split('\n').filter(Boolean).map(key => key.slice(0, key.lastIndexOf('.'))))]
    if (drivers.length > 128 || drivers.some(driver => driver.length > 512)) throw new Error('Git filter configuration exceeds review bound')
    // status/diff may otherwise invoke clean/process filters outside the coding
    // host's sandbox. Disable every configured executable filter for this audit.
    const disabled = drivers.flatMap(driver => ['-c', driver + '.clean=', '-c', driver + '.smudge=', '-c', driver + '.process=', '-c', driver + '.required=false'])
    const git = (args: string[]) => run([...disabled, ...args])
    const status = await git(['status', '--porcelain=v1', '--untracked-files=all'])
    const diff = await git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'])
    const names = (await git(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
    if (names.length > 64) throw new Error('Untracked file bound')
    let bytes = 0
    const untracked = []
    for (const name of names) {
      const path = join(task.root, name)
      if (await realpath(path) !== path) throw new Error('Untracked symlink refused')
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const info = await file.stat()
        if (!info.isFile() || info.size > 65536 || (bytes += info.size) > 262144) throw new Error('Untracked byte bound')
        const data = Buffer.alloc(info.size + 1); let length = 0
        while (length < data.length) { const part = await file.read(data, length, data.length - length, length); if (!part.bytesRead) break; length += part.bytesRead }
        const after = await file.stat(), named = await lstat(path)
        if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs || named.ino !== info.ino || named.dev !== info.dev || named.isSymbolicLink()) throw new Error('Changing file')
        const content = data.subarray(0, length), text = new TextDecoder('utf-8', { fatal: true }).decode(content)
        untracked.push({ name, hash: createHash('sha256').update(content).digest('hex'), text })
      } finally { await file.close() }
    }
    if ((await git(['status', '--porcelain=v1', '--untracked-files=all'])) !== status || (await git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'])) !== diff || (await describeCheckout(task.root)).head !== root.checkout.head) throw new Error('Checkout changed while reviewing')
    const value = { head: root.checkout.head, status, diff, untracked }
    return { ...value, hash: digest({ ...value, untracked, result: task.result, hostDiff: task.diff, thread: task.threadId, turn: task.turnId }) }
  }
  async close() {
    this.closing = true
    await this.queue(async () => { for (const id of [...this.live.keys()]) await this.failWithinQueue(id, 'Console closed. Reconcile the saved host thread before continuing.') })
    this.shared.close(); this.store.close()
    if (this.lock && await readFile(this.lock.path, 'utf8') === this.lock.bytes) await unlink(this.lock.path)
  }
}
