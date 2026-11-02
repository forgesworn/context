import { afterEach, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentConsole as ConsoleType } from './agent-console.js'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture() {
  // Test imports the same independent native wire double as the packed consumer.
  const module = await import(pathToFileURL(fileURLToPath(new URL('../../../test/claude-console-fixture.mjs', import.meta.url))).href)
  const f = await module.claudeConsoleFixture(fileURLToPath(new URL('../dist', import.meta.url)))
  cleanup.push(f.cleanup)
  const { AgentConsole } = await import(pathToFileURL(fileURLToPath(new URL('../dist/agent-console.js', import.meta.url))).href)
  const console = await AgentConsole.open(f.workspace, f.cache, { directory: f.control, claudeExecutable: f.executable, maxRunSeconds: 20, allowedRoots: [f.root] })
  cleanup.push(() => console.close())
  const create = (objective = 'ask-question then fix source.txt') => console.action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'claude', title: 'Native Claude task', objective, paths: ['source.txt'] })
  const act = (id: string, action: string, extra = {}) => console.action({ action, id, requestId: randomUUID(), expectedRevision: console.task(id).revision, ...extra })
  const wait = async (id: string, check: (task: ReturnType<ConsoleType['task']>) => boolean) => { await vi.waitFor(() => expect(check(console.task(id))).toBe(true), { timeout: 7000 }); return console.task(id) }
  const trace = async () => (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse)
  return { ...f, console, create, act, wait, trace }
}

it('completes Claude questions, exact native approvals, real fixture edits/tests, review and fresh-process resume', async () => {
  const f = await fixture(), task = await f.create()
  expect(f.console.snapshot().hosts.filter(host => host.available).map(host => host.id)).toEqual(['claude'])
  await f.act(task.id, 'run')
  let current = await f.wait(task.id, t => t.status === 'waiting')
  const threadId = current.threadId
  expect(current.settings).toMatchObject({ model: 'fixture-native-model', provider: 'fixture-native-provider', approvalPolicy: 'manual' })
  expect(JSON.stringify(current)).not.toMatch(/PRIVATE_(SECRET|ACCOUNT)_MARKER/)
  expect(current.pending[0].params.questions[0].options[0].label).toBe('Regression')
  await f.act(task.id, 'answer', { pendingId: current.pending[0].id, answers: { q0: 'Run the regression test.' } })
  current = await f.wait(task.id, t => t.status === 'waiting' && t.pending[0].method === 'claude/tool/requestApproval')
  expect(current.pending[0].params.input).toEqual({ file_path: join(f.root, 'source.txt'), content: 'after\n' })
  expect(await readFile(join(f.root, 'source.txt'), 'utf8')).toBe('before\n')
  const approval = { action: 'answer', id: task.id, requestId: randomUUID(), expectedRevision: current.revision, pendingId: current.pending[0].id, decision: 'accept' }
  await f.console.action(approval); await f.console.action(approval)
  current = await f.wait(task.id, t => !!t.review)
  expect(current.status).toBe('review'); expect(current.review!.diff).toContain('after')
  expect(current.review!.untracked.some(file => file.name === 'regression.test.mjs')).toBe(true)
  expect(current.events.some(event => event.text.includes('# pass 1'))).toBe(true)
  expect(current.accepted).toBeUndefined()
  await f.act(task.id, 'review', { decision: 'changes', reviewHash: current.review!.hash })
  await f.act(task.id, 'run', { message: 'read-only verification' }); current = await f.wait(task.id, t => t.status === 'review' && !!t.review)
  expect(current.threadId).toBe(threadId)
  const trace = await f.trace(), argv = trace.filter((row: any) => row.argv).map((row: any) => row.argv)
  expect(argv).toHaveLength(2)
  expect(argv[0].slice(0, -1)).toEqual(['--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--permission-prompt-tool', 'stdio'])
  expect(argv[0].at(-1)).toBe('--session-id=' + current.threadId)
  expect(argv[1].at(-1)).toBe('--resume=' + current.threadId)
  const wireApprovals = trace.filter((row: any) => row.type === 'control_response')
  expect(wireApprovals).toHaveLength(2)
  expect(wireApprovals.every((row: any) => !row.response.response.updatedPermissions)).toBe(true)
  await f.act(task.id, 'review', { decision: 'accept', reviewHash: current.review!.hash })
  expect(f.console.task(task.id).status).toBe('accepted')
}, 20000)

it.each(['model-change', 'provider-change', 'missing-settings'])('refuses %s before another prompt is sent', async mode => {
  const f = await fixture(), task = await f.create('read-only')
  await f.act(task.id, 'run'); await f.wait(task.id, t => !!t.review)
  await writeFile(f.mode, mode)
  await f.act(task.id, 'run', { message: 'A fresh instruction' }); await f.wait(task.id, t => t.status === 'unknown')
  expect((await f.trace()).filter((row: any) => row.type === 'user')).toHaveLength(1)
}, 15000)

it.each(['decline', 'cancel'])('returns a one-request native %s without applying the proposed input', async decision => {
  const f = await fixture(), task = await f.create('fix the fixture')
  await f.act(task.id, 'run'); const current = await f.wait(task.id, t => t.status === 'waiting')
  await f.act(task.id, 'answer', { pendingId: current.pending[0].id, decision })
  await f.wait(task.id, t => t.status === 'failed')
  expect(await readFile(join(f.root, 'source.txt'), 'utf8')).toBe('before\n')
  const response = (await f.trace()).find((row: any) => row.type === 'control_response').response.response
  expect(response).toEqual({ behavior: 'deny', message: 'Owner did not approve this request.', ...(decision === 'cancel' ? { interrupt: true } : {}) })
}, 15000)

it.each(['unsupported', 'secret-question', 'oversized', 'bad-session'])('leaves %s requiring reconciliation, without a broad grant', async objective => {
  const f = await fixture(), task = await f.create(objective)
  await f.act(task.id, 'run'); const current = await f.wait(task.id, t => t.status === 'unknown')
  expect(current.pending).toEqual([])
  expect(await readFile(join(f.root, 'source.txt'), 'utf8')).toBe('before\n')
  expect(JSON.stringify((await f.trace()).filter((row: any) => row.type === 'control_response'))).not.toContain('"behavior":"allow"')
}, 15000)

it('invalidates a cancelled native approval so a stale UI decision cannot execute it', async () => {
  const f = await fixture(), task = await f.create('cancel-request')
  await f.act(task.id, 'run'); const waiting = await f.wait(task.id, t => t.status === 'waiting')
  const current = await f.wait(task.id, t => !!t.review)
  expect(current.pending).toEqual([])
  await expect(f.act(task.id, 'answer', { pendingId: waiting.pending[0].id, decision: 'accept' })).rejects.toThrow('no longer pending')
  expect((await f.trace()).filter((row: any) => row.type === 'control_response')).toHaveLength(0)
}, 15000)

it.each(['interrupt-ack-only', 'interrupt-result'])('does not treat %s as a terminal interruption receipt', async objective => {
  const f = await fixture(), task = await f.create(objective)
  await f.act(task.id, 'run'); await f.wait(task.id, t => t.status === 'running')
  await f.act(task.id, 'stop'); expect(f.console.task(task.id).status).toBe('stopping')
  await f.wait(task.id, t => t.status === 'unknown')
  expect((await f.trace()).some((row: any) => row.request?.subtype === 'interrupt')).toBe(true)
}, 15000)

it('rejects a Claude task when that executable was not configured by the operator', async () => {
  const f = await fixture()
  await expect(f.console.action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'codex', title: 'Not configured', objective: 'No execution' })).rejects.toThrow('not configured')
})
