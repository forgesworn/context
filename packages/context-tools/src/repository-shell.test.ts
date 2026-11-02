import { afterEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { runRepositoryShell, writeRepositoryShellFrame, type RepositoryShellOptions } from './repository-shell.js'
import { initialiseWorkspaceStore } from './workspace-store.js'

const exec = promisify(execFile), scratch: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture() {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'z1p-shell-'))); scratch.push(parent)
  const root = join(parent, 'repository'), cacheDirectory = join(parent, 'cache'), handoverBase = join(parent, 'handovers')
  await mkdir(root); await mkdir(handoverBase, { mode: 0o700 }); await initialiseWorkspaceStore(cacheDirectory)
  await writeFile(join(root, 'example.ts'), 'export const shellMarker = 7\n')
  await exec('git', ['init', '-q', root]); await exec('git', ['-C', root, 'add', 'example.ts'])
  await exec('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  return { parent, root, cacheDirectory, handoverBase }
}
function open(options: RepositoryShellOptions) {
  const input = new PassThrough(), output = new PassThrough()
  let pending = '', id = 0
  const frames: any[] = [], waiters: Array<(value: any) => void> = []
  output.on('data', chunk => {
    pending += chunk.toString()
    for (let newline; (newline = pending.indexOf('\n')) >= 0;) {
      const value = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1)
      const waiter = waiters.shift(); if (waiter) waiter(value); else frames.push(value)
    }
  })
  const done = runRepositoryShell(options, input, output)
  void done.catch(() => {})
  const next = (): Promise<any> => frames.length ? Promise.resolve(frames.shift()) : new Promise(resolve => waiters.push(resolve))
  const send = async (name: string, args = {}) => { const requestId = ++id; input.write(JSON.stringify({ id: requestId, name, arguments: args }) + '\n'); const frame = await next(); expect(frame.id).toBe(requestId); return frame }
  return { input, output, next, send, done, close: async () => { const result = await send('close'); await done; return result } }
}
const task = { label: 'test host', task: 'Inspect source with shared context', paths: ['example.ts'] }

it('starts without native tools, rejects root overrides, and keeps a generation through source reads', async () => {
  const f = await fixture(), c = open({ root: f.root })
  try {
    const ready = await c.next()
    expect(ready.nativeToolDiscovery).toBe(false); expect(ready.tools).toHaveLength(7)
    expect(ready.status.root).toBe(f.root); expect(ready.status.freshness).toBe('unavailable')
    expect((await c.send('repository_search', { expectedRoot: f.parent, term: 'shellMarker' })).isError).toBe(true)
    expect((await c.send('context_read')).isError).toBe(true)
    const fresh = await c.send('repository_refresh'); expect(fresh.isError).toBe(false)
    const found = await c.send('repository_search', { term: 'shellMarker', format: 'json' })
    expect(found.result.generation).toBe(fresh.result.generation); expect(found.result.results[0].text).toContain('shellMarker')
  } finally { await c.close() }
})

it('publishes two tasks, exchanges deduplicated notes, and finishes leases on close and EOF', async () => {
  const f = await fixture(), a = open({ ...f, task }), b = open({ ...f, task: { ...task, label: 'other host' } })
  try {
    const [x, y] = await Promise.all([a.next(), b.next()])
    expect(x.activity.agent.agentId).not.toBe(y.activity.agent.agentId)
    expect(x.activity.conflicts.length + y.activity.conflicts.length).toBe(1)
    const note = { slot: x.activity.agent.slot, recipientAgentId: y.activity.agent.agentId, messageId: randomUUID(), text: 'Please inspect the test while I inspect implementation.' }
    expect((await a.send('repository_message', note)).result.duplicate).toBe(false)
    expect((await a.send('repository_message', note)).result.duplicate).toBe(true)
    const inbox = await b.send('repository_coordination')
    expect(inbox.result.messages[0].text).toBe(note.text)
    const closed = await a.close(); expect(closed.isError).toBe(false)
    const board = await b.send('repository_coordination')
    expect(board.result.agents.find((row: any) => row.agentId === x.activity.agent.agentId).active).toBe(false)
    expect((await b.send('repository_message', { ...note, slot: y.activity.agent.slot, recipientAgentId: x.activity.agent.agentId, messageId: randomUUID() })).isError).toBe(true)
    b.input.end(); const end = await b.next(); expect(end.event).toBe('closed'); expect(end.finished[0].result.agent.state).toBe('done')
    await b.done
  } finally { a.input.end(); b.input.end(); await Promise.all([a.done, b.done]) }
})

it('saves a verified handover, resumes in a new connection and rejects edited source', async () => {
  const f = await fixture(), a = open(f)
  await a.next()
  const refreshed = (await a.send('repository_refresh')).result
  const spec = { version: 1, task: 'Inspect source', acceptanceChecks: ['Read source'], allowedFiles: ['example.ts'], sources: [{ path: 'example.ts', startLine: 1, endLine: 1 }], exclusions: [], unresolvedQuestions: [] }
  const built = await a.send('repository_packet', { mode: 'build', spec, expectedGeneration: refreshed.generation, format: 'json' })
  expect(built.isError).toBe(false)
  const state = { version: 1, status: 'in_progress', completed: [], decisions: [], checks: [{ index: 0, outcome: 'not_run', evidence: null }], unresolvedQuestions: [], pendingEffects: [], nextAction: 'Review example.ts' }
  expect((await a.send('repository_handover_save', { name: 'handoff.json', packet: built.result.packet, state })).isError).toBe(false)
  await a.close()
  const b = open(f)
  try {
    await b.next()
    expect((await b.send('repository_handover_resume', { name: 'handoff.json' })).result.state.nextAction).toBe(state.nextAction)
    await writeFile(join(f.root, 'example.ts'), 'export const shellMarker = 8\n')
    expect((await b.send('repository_handover_resume', { name: 'handoff.json' })).isError).toBe(true)
    expect((await b.send('repository_packet', { mode: 'build', spec, expectedGeneration: refreshed.generation, format: 'json' })).isError).toBe(true)
  } finally { await b.close() }
})

it('bounds oversized UTF-8 requests, recovers at newlines and rejects unterminated input', async () => {
  const f = await fixture(), c = open({ root: f.root }); await c.next()
  c.input.write('{broken}\n'); expect((await c.next()).isError).toBe(true)
  c.input.write('😀'.repeat(40000)); c.input.write('\n')
  expect((await c.next()).result).toContain('131072')
  expect((await c.send('repository_status')).isError).toBe(false)
  c.input.end('{"id":2,"name":"repository_status"}')
  expect((await c.next()).result).toContain('newline'); expect((await c.next()).event).toBe('closed'); await c.done
})

it('renews on a work step when due, preserves compare-and-swap and does not renew while idle', async () => {
  const f = await fixture(), now = Date.now(); let time = now
  vi.spyOn(Date, 'now').mockImplementation(() => time)
  const c = open({ ...f, task }); const ready = await c.next()
  try {
    const initial = ready.activity.agent
    time += 449000
    expect((await c.send('repository_coordination')).result.agents[0].revision).toBe(1)
    time += 1000
    const renewed = (await c.send('repository_coordination')).result.agents[0]
    expect(renewed.revision).toBe(2); expect(renewed.expiresAt).toBe(time + 900000)
    expect((await c.send('repository_activity', { ...task, slot: initial.slot, expectedRevision: 1, state: 'working' })).isError).toBe(true)
    expect((await c.send('repository_activity', { ...task, slot: initial.slot, expectedRevision: 2, state: 'reviewing' })).result.agent.revision).toBe(3)
    expect((await c.close()).result.finished[0].result.agent.revision).toBe(4)
  } finally { c.input.end(); await c.done }
})

it('rejects parent workspace startup before publishing a task', async () => {
  const f = await fixture(), c = open({ ...f, root: f.parent, task })
  await expect(c.done).rejects.toThrow('canonical Git checkout root')
})

it('reports an uncertain close per slot and still finishes other tracked tasks', async () => {
  const f = await fixture(), c = open({ ...f, task }), observer = open(f)
  const ready = await c.next(); await observer.next()
  const worker = await c.send('repository_activity', { ...task, slot: 'worker', state: 'working', expectedRevision: 0 })
  expect(worker.isError).toBe(false)
  const realCall = Client.prototype.callTool
  const spy = vi.spyOn(Client.prototype, 'callTool').mockImplementation(async function (this: Client, ...args: Parameters<Client['callTool']>) {
    const request = args[0]
    if (request.name === 'repository_activity' && request.arguments?.slot === ready.activity.agent.slot && request.arguments?.state === 'done') throw new Error('transport interrupted; result unknown')
    return realCall.apply(this, args)
  })
  try {
    const closed = await c.send('close')
    expect(closed.isError).toBe(true); expect(closed.result.closed).toBe(true)
    expect(closed.result.finished).toHaveLength(2)
    expect(closed.result.finished[0].isError).toBe(true)
    expect(closed.result.finished[1].result.agent.state).toBe('done')
    const board = await observer.send('repository_coordination')
    expect(board.result.agents.find((row: any) => row.slot === 'worker').active).toBe(false)
    await c.done
  } finally { spy.mockRestore(); c.input.end(); await c.done.catch(() => {}); await observer.close() }
})

it('best-effort finishes published activity when input fails, while preserving the stream error', async () => {
  const f = await fixture(), c = open({ ...f, task }), observer = open(f)
  const ready = await c.next(); await observer.next()
  try {
    c.input.destroy(new Error('input interrupted'))
    await expect(c.done).rejects.toThrow('input interrupted')
    const board = await observer.send('repository_coordination')
    expect(board.result.agents.find((row: any) => row.agentId === ready.activity.agent.agentId).state).toBe('done')
    const closed = await c.next(); expect(closed.abnormal).toBe(true); expect(closed.finished[0].isError).toBe(false)
  } finally { await observer.close() }
})

it('rejects closed output and closure during a backpressured write instead of waiting for drain forever', async () => {
  for (const alreadyClosed of [true, false]) {
    const output = new Writable({ highWaterMark: 1, write(_chunk, _encoding, _callback) {} })
    if (alreadyClosed) output.destroy()
    const write = writeRepositoryShellFrame(output, { id: 1 }).then(() => 'written', () => 'closed')
    if (!alreadyClosed) output.destroy()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([write, new Promise(resolve => { timer = setTimeout(() => resolve('hung'), 250) })])
      expect(result).toBe('closed')
    } finally { clearTimeout(timer); output.emit('drain'); await write }
  }
  for (const options of [{}, { emitClose: false }, { autoDestroy: false }]) {
    const failed = new Writable({ ...options, write(_chunk, _encoding, callback) { callback(new Error('output failed')) } })
    await expect(writeRepositoryShellFrame(failed, { id: 2 })).rejects.toThrow('output failed')
    await new Promise(resolve => setImmediate(resolve))
    try {
      expect(failed.listenerCount('error')).toBe(0)
      expect(failed.listenerCount('close')).toBe(0)
    } finally { failed.destroy() }
  }
})

it('closes an idle connection and releases its task when its output disappears', async () => {
  const f = await fixture(), c = open({ ...f, task }), observer = open(f)
  const ready = await c.next(); await observer.next()
  try {
    c.output.destroy()
    await expect(c.done).rejects.toThrow('shell output is closed')
    const board = await observer.send('repository_coordination')
    expect(board.result.agents.find((row: any) => row.agentId === ready.activity.agent.agentId).state).toBe('done')
  } finally { await observer.close() }
})
