import { afterEach, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentConsole as ConsoleType } from './agent-console.js'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  const module = await import(pathToFileURL(fileURLToPath(new URL('../../../test/kimi-console-fixture.mjs', import.meta.url))).href)
  const f = await module.kimiConsoleFixture(fileURLToPath(new URL('../dist', import.meta.url)))
  cleanup.push(f.cleanup)
  const { AgentConsole } = await import(pathToFileURL(fileURLToPath(new URL('../dist/agent-console.js', import.meta.url))).href)
  const console = await AgentConsole.open(f.workspace, f.cache, { directory: f.control, kimiExecutable: f.executable, maxRunSeconds: 20, allowedRoots: [f.root] })
  cleanup.push(() => console.close())
  const create = (objective = 'ask-question then fix source.txt') => console.action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'kimi', title: 'Native Kimi task', objective, paths: ['source.txt'] })
  const act = (id: string, action: string, extra = {}) => console.action({ action, id, requestId: randomUUID(), expectedRevision: console.task(id).revision, ...extra })
  const wait = async (id: string, check: (task: ReturnType<ConsoleType['task']>) => boolean) => { await vi.waitFor(() => expect(check(console.task(id))).toBe(true), { timeout: 7000 }); return console.task(id) }
  const trace = async () => (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse)
  return { ...f, console, create, act, wait, trace }
}

it('runs Kimi native forms and exact one-operation approval, real edit/regression, review and same-session resume', async () => {
  const f = await fixture(), task = await f.create()
  expect(f.console.snapshot().hosts.filter(host => host.available).map(host => host.id)).toEqual(['kimi'])
  await f.act(task.id, 'run'); let current = await f.wait(task.id, t => t.status === 'waiting')
  expect(current.settings).toMatchObject({ model: 'native-model', provider: 'native-provider', approvalPolicy: 'default' })
  const thread = current.threadId, pendingId = current.pending[0].id
  await expect(f.act(task.id, 'answer', { pendingId, answers: { q0: 'unoffered choice' } })).rejects.toThrow('valid answer')
  expect(f.console.task(task.id).pending[0].id).toBe(pendingId)
  expect((await f.trace()).filter((row: any) => row.id === 'form' && row.result)).toHaveLength(0)
  await f.act(task.id, 'answer', { pendingId, answers: { q0: 'Regression' } })
  current = await f.wait(task.id, t => t.status === 'waiting' && t.pending[0].method === 'kimi/tool/requestApproval')
  expect(current.pending[0].params.input.rawInput).toEqual({ command: 'node --test --test-reporter=tap regression.test.mjs', source: 'after\n' })
  expect(await readFile(join(f.root, 'source.txt'), 'utf8')).toBe('before\n')
  const approval = { action: 'answer', id: task.id, requestId: randomUUID(), expectedRevision: current.revision, pendingId: current.pending[0].id, decision: 'accept' }
  await f.console.action(approval); await f.console.action(approval)
  current = await f.wait(task.id, t => !!t.review)
  expect(current.review!.diff).toContain('after')
  expect(current.events.some(event => event.text.includes('# pass 1'))).toBe(true)
  expect(current.review!.untracked.some(file => file.name === 'regression.test.mjs')).toBe(true)
  expect(current.accepted).toBeUndefined()
  await f.act(task.id, 'review', { decision: 'changes', reviewHash: current.review!.hash })
  await f.act(task.id, 'run', { message: 'read-only verification' }); current = await f.wait(task.id, t => !!t.review)
  expect(current.threadId).toBe(thread)
  const trace = await f.trace()
  expect(trace.filter((row: any) => row.argv).map((row: any) => row.argv)).toEqual([['acp'], ['acp']])
  expect(trace.filter((row: any) => row.method === 'initialize').every((row: any) => JSON.stringify(row.params.clientCapabilities) === JSON.stringify({ elicitation: { form: {} } }))).toBe(true)
  expect(trace.find((row: any) => row.method === 'session/resume').params).toEqual({ cwd: f.root, mcpServers: [], sessionId: thread })
  expect(trace.filter((row: any) => row.id === 'approval' && row.result).map((row: any) => row.result)).toEqual([{ outcome: { outcome: 'selected', optionId: 'once' } }])
  await f.act(task.id, 'review', { decision: 'accept', reviewHash: current.review!.hash })
  expect(f.console.task(task.id).status).toBe('accepted')
}, 20000)

it('validates multi-select form responses before changing the pending request', async () => {
  const f = await fixture(), task = await f.create('multi-question')
  await f.act(task.id, 'run'); const current = await f.wait(task.id, t => t.status === 'waiting'), pendingId = current.pending[0].id
  for (const value of ['[]', '["Regression","Regression"]', '["unknown"]', 'not JSON']) await expect(f.act(task.id, 'answer', { pendingId, answers: { q0: value } })).rejects.toThrow('choices')
  expect(f.console.task(task.id).status).toBe('waiting')
  await f.act(task.id, 'answer', { pendingId, answers: { q0: '["Regression","Lint"]' } })
  const approval = await f.wait(task.id, t => t.status === 'waiting' && t.pending[0].method === 'kimi/tool/requestApproval')
  await f.act(task.id, 'answer', { pendingId: approval.pending[0].id, decision: 'decline' }); await f.wait(task.id, t => !!t.review)
  expect((await f.trace()).find((row: any) => row.id === 'form' && row.result).result).toEqual({ action: 'accept', content: { verification: ['Regression', 'Lint'] } })
}, 15000)

it.each(['decline', 'cancel'])('returns native form %s with no unintended answer or permission grant', async decision => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); const current = await f.wait(task.id, t => t.status === 'waiting')
  await f.act(task.id, 'answer', { pendingId: current.pending[0].id, decision }); await f.wait(task.id, t => !!t.review)
  expect((await f.trace()).find((row: any) => row.id === 'form' && row.result).result).toEqual({ action: decision })
  expect(await readFile(join(f.root, 'source.txt'), 'utf8')).toBe('before\n')
}, 15000)

it.each(['model-change', 'provider-change', 'missing-settings', 'wrong-session'])('rejects %s before another prompt', async mode => {
  const f = await fixture(), task = await f.create('read-only'); await f.act(task.id, 'run'); await f.wait(task.id, t => !!t.review)
  await writeFile(f.mode, mode); await f.act(task.id, 'run', { message: 'Continue' }); await f.wait(task.id, t => t.status === 'unknown')
  expect((await f.trace()).filter((row: any) => row.method === 'session/prompt')).toHaveLength(1)
}, 15000)

it('requires negotiated history-free resume before sending any prompt', async () => {
  const f = await fixture(); await writeFile(f.mode, 'no-resume'); const task = await f.create('read-only'); await f.act(task.id, 'run'); await f.wait(task.id, t => t.status === 'unknown')
  expect((await f.trace()).filter((row: any) => row.method === 'session/prompt')).toHaveLength(0)
}, 15000)

it.each(['unsupported', 'secret', 'url-form', 'bad-session', 'changed-preview', 'partial-input', 'display-only'])('refuses %s without running the proposed operation', async objective => {
  const f = await fixture(), task = await f.create(objective); await f.act(task.id, 'run'); const current = await f.wait(task.id, t => t.status === 'unknown')
  expect(current.pending).toEqual([]); expect(await readFile(join(f.root, 'source.txt'), 'utf8')).toBe('before\n')
  expect((await f.trace()).filter((row: any) => row.id === 'approval' && row.result?.outcome?.optionId === 'once')).toHaveLength(0)
}, 15000)

it('cancels the exact native RPC and rejects a stale owner approval', async () => {
  const f = await fixture(), task = await f.create('cancel-request'); await f.act(task.id, 'run'); const current = await f.wait(task.id, t => t.status === 'waiting')
  await f.wait(task.id, t => !!t.review)
  await expect(f.act(task.id, 'answer', { pendingId: current.pending[0].id, decision: 'accept' })).rejects.toThrow('no longer pending')
  expect((await f.trace()).find((row: any) => row.id === 'approval' && row.result).result).toEqual({ outcome: { outcome: 'cancelled' } })
}, 15000)

it.each(['cancel-ack-only', 'cancel-result', 'cancel-success'])('requires a terminal prompt receipt for %s', async objective => {
  const f = await fixture(), task = await f.create(objective); await f.act(task.id, 'run'); await f.wait(task.id, t => t.status === 'running')
  await f.act(task.id, 'stop'); await f.wait(task.id, t => t.status === (objective === 'cancel-result' ? 'cancelled' : 'unknown'))
  expect((await f.trace()).some((row: any) => row.method === 'session/cancel' && row.params.sessionId === 'session_00000000-0000-4000-8000-000000000001')).toBe(true)
}, 15000)

it('reviews complete same-call streamed JSON when native approval precedes rawInput metadata', async () => {
  const f = await fixture(), task = await f.create('streamed-input'); await f.act(task.id, 'run'); const current = await f.wait(task.id, t => t.status === 'waiting')
  expect(current.pending[0].params.input.rawInput).toEqual({ command: 'node --test --test-reporter=tap regression.test.mjs', source: 'after\n' })
  await f.act(task.id, 'answer', { pendingId: current.pending[0].id, decision: 'accept' }); const reviewed = await f.wait(task.id, t => !!t.review)
  expect(reviewed.review!.diff).toContain('after')
  expect((await f.trace()).find((row: any) => row.id === 'approval' && row.result).result).toEqual({ outcome: { outcome: 'selected', optionId: 'once' } })
}, 15000)
