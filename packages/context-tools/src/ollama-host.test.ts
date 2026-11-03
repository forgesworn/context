import { afterEach, expect, it, vi } from 'vitest'
import { readFile, writeFile, chmod, symlink, link } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function fixture(mode = '') {
  const { ollamaConsoleFixture } = await import(pathToFileURL(fileURLToPath(new URL('../../../test/ollama-console-fixture.mjs', import.meta.url))).href)
  const f = await ollamaConsoleFixture(fileURLToPath(new URL('../dist', import.meta.url))); cleanup.push(f.cleanup); await writeFile(f.mode, mode)
  const { AgentConsole } = await import(pathToFileURL(fileURLToPath(new URL('../dist/agent-console.js', import.meta.url))).href)
  const console = await AgentConsole.open(f.workspace, f.cache, { directory: f.control, ollamaProfile: f.profile, maxRunSeconds: 60, allowedRoots: [f.root] }); let closed = false; const close = async () => { if (!closed) { closed = true; await console.close() } }; cleanup.push(close)
  const create = (paths = ['source.mjs', 'regression.test.mjs']) => console.action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'ollama', title: 'Bounded worker task', objective: 'Update the fixture and propose a regression.', paths })
  const act = (id: string, action: string, extra = {}) => console.action({ action, id, requestId: randomUUID(), expectedRevision: console.task(id).revision, ...extra })
  const wait = async (id: string, check: (t: any) => boolean) => { await vi.waitFor(() => expect(check(console.task(id))).toBe(true), { timeout: 8000 }); return console.task(id) }
  const approval = async (id: string, tool: string, decision = 'accept') => { const task = await wait(id, t => t.status === 'waiting' && t.pending[0]?.params.tool === tool); await act(id, 'answer', { pendingId: task.pending[0].id, decision }); return task }
  const trace = async () => (await readFile(f.workerTrace, 'utf8')).trim().split('\n').map(JSON.parse)
  return { ...f, console, close, create, act, wait, approval, trace }
}
it('requires exact dispatch/replacement/check approvals, records real checks and resumes a fresh source packet', async () => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run')
  await f.wait(task.id, t => t.status === 'waiting'); expect((await f.trace()).filter((r: any) => r.command === 'run')).toHaveLength(0)
  await f.approval(task.id, 'Send bounded worker packet')
  const patch = await f.wait(task.id, t => t.status === 'waiting' && t.pending[0]?.params.tool === 'Apply exact worker replacements')
  expect(patch.pending[0].params.input.changes[0].content).toContain("'after'"); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toContain("'before'")
  await f.approval(task.id, 'Apply exact worker replacements'); await f.approval(task.id, 'Run configured verification')
  const first = await f.wait(task.id, t => !!t.review)
  expect(first.events.some((e: any) => e.text.includes('# pass 1'))).toBe(true); expect(first.review.untracked.some((e: any) => e.name === 'regression.test.mjs')).toBe(true)
  await f.act(task.id, 'review', { decision: 'changes', reviewHash: first.review.hash })
  await writeFile(f.mode, 'readonly'); await f.act(task.id, 'run', { message: 'Verify the same task from a fresh source packet' }); await f.approval(task.id, 'Send bounded worker packet'); await f.approval(task.id, 'Run configured verification')
  const second = await f.wait(task.id, t => !!t.review); expect(second.threadId).toBe(first.threadId)
  await f.act(task.id, 'review', { decision: 'accept', reviewHash: second.review.hash }); expect(f.console.task(task.id).status).toBe('accepted')
  const rows = await f.trace(); expect(rows.filter((r: any) => r.command === 'run')).toHaveLength(2); expect(rows.filter((r: any) => r.command === 'review').map((r: any) => r.args[r.args.indexOf('--disposition') + 1])).toEqual(['partial', 'accepted'])
  expect((await readFile(join(f.control, 'workspace.sqlite'))).includes(Buffer.from('Bounded worker task'))).toBe(false)
}, 30000)
it.each(['no-models', 'pending'])('disables an ineligible worker before a provider request: %s', async mode => {
  const f = await fixture(mode); expect(f.console.snapshot().hosts.find((h: any) => h.id === 'ollama')).toMatchObject({ available: false, reason: expect.any(String) }); await expect(f.create()).rejects.toThrow('not configured'); expect((await f.trace()).some((r: any) => r.command === 'run')).toBe(false)
})
it.each(['decline', 'cancel'])('dispatch %s has no provider request or source effect', async decision => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet', decision); await f.wait(task.id, t => decision === 'cancel' ? t.status === 'cancelled' : !!t.review); expect((await f.trace()).some((r: any) => r.command === 'run')).toBe(false); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toContain("'before'")
}, 15000)
it('refuses changed source after the owner sees a replacement proposal', async () => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet'); await f.wait(task.id, t => t.pending[0]?.params.tool === 'Apply exact worker replacements'); await writeFile(join(f.root, 'source.mjs'), 'external change\n'); await f.approval(task.id, 'Apply exact worker replacements'); await f.wait(task.id, t => t.status === 'unknown'); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toBe('external change\n')
}, 15000)
it('rechecks the packet after dispatch approval and before inference', async () => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); await f.wait(task.id, t => t.status === 'waiting'); await writeFile(join(f.root, 'source.mjs'), 'external change\n'); await f.approval(task.id, 'Send bounded worker packet'); await f.wait(task.id, t => t.status === 'unknown'); expect((await f.trace()).some((r: any) => r.command === 'run')).toBe(false)
}, 15000)
it('records a declined replacement as rejected worker output without applying it', async () => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet'); await f.approval(task.id, 'Apply exact worker replacements', 'decline'); const current = await f.wait(task.id, t => !!t.review); await f.act(task.id, 'review', { decision: 'accept', reviewHash: current.review.hash }); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toContain("'before'"); expect((await f.trace()).find((r: any) => r.command === 'review').args).toContain('rejected')
}, 15000)
it('keeps applied changes reviewable when verification is declined and reports no invented test result', async () => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet'); await f.approval(task.id, 'Apply exact worker replacements'); await f.approval(task.id, 'Run configured verification', 'decline'); const current = await f.wait(task.id, t => !!t.review); expect(current.result).toContain('Verification was not run'); expect(current.events.some((e: any) => e.text.startsWith('Command:'))).toBe(false); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toContain("'after'")
}, 15000)
it('reports an actual configured verification failure and preserves changes', async () => {
  const f = await fixture(); await writeFile(f.profile, JSON.stringify({ ...f.settings, verification: { ...f.settings.verification, args: ['--eval', 'process.exit(3)'] } })); const task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet'); await f.approval(task.id, 'Apply exact worker replacements'); await f.approval(task.id, 'Run configured verification'); const current = await f.wait(task.id, t => t.status === 'failed'); expect(current.events.some((e: any) => e.text.includes('exit 3'))).toBe(true); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toContain("'after'")
}, 15000)
it.each(['outside', 'duplicate', 'oversized', 'ill-formed', 'malformed', 'commands', 'wrong-model'])('rejects unsafe/unusable draft %s without source writes', async mode => {
  const f = await fixture(mode), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet'); await f.wait(task.id, t => t.status === 'unknown'); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toContain("'before'"); expect(f.console.task(task.id).pending).toEqual([])
}, 15000)
it.each(['refused', 'truncated', 'unknown'])('preserves %s receipts and never automatically retries', async mode => {
  const f = await fixture(mode), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet'); await f.wait(task.id, t => t.status === (mode === 'unknown' ? 'unknown' : 'failed')); expect((await f.trace()).filter((r: any) => r.command === 'run')).toHaveLength(1); expect(await readFile(join(f.root, 'source.mjs'), 'utf8')).toContain("'before'")
}, 15000)
it('stops a helper request as unknown, rather than inventing remote cancellation', async () => {
  const f = await fixture('hold'), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet'); await vi.waitFor(async () => expect((await f.trace()).some((r: any) => r.command === 'run')).toBe(true)); await f.act(task.id, 'stop'); await f.wait(task.id, t => t.status === 'unknown')
}, 15000)
it('refuses a changed saved profile before another inference turn', async () => {
  const f = await fixture(), task = await f.create(); await f.act(task.id, 'run'); await f.approval(task.id, 'Send bounded worker packet', 'decline'); const first = await f.wait(task.id, t => !!t.review)
  await writeFile(f.profile, JSON.stringify({ ...f.settings, maxOutput: 2048 })); await f.act(task.id, 'run', { message: 'Continue' }); await f.wait(task.id, t => t.status === 'unknown'); expect((await f.trace()).some((r: any) => r.command === 'run')).toBe(false); expect(first.threadId).toMatch(/^ollama_/)
}, 15000)
it.each(['.', '../outside.mjs', '.secret.mjs'])('rejects directory/traversal/hidden source selection %s', async path => {
  const f = await fixture(); if (path === '.') await expect(f.create([path])).rejects.toThrow('explicit'); else { const task = await f.create([path]).catch(() => null); if (task) { await f.act(task.id, 'run'); await f.wait(task.id, t => t.status === 'unknown') } }; expect((await f.trace()).some((r: any) => r.command === 'run')).toBe(false)
}, 15000)
it.each(['symlink', 'hardlink'])('refuses %s source aliases before disclosure', async kind => {
  const f = await fixture(); const path = join(f.root, 'alias.mjs'); if (kind === 'symlink') await symlink(join(f.root, 'source.mjs'), path); else await link(join(f.root, 'source.mjs'), path)
  const task = await f.create(['alias.mjs']); await f.act(task.id, 'run'); await f.wait(task.id, t => t.status === 'unknown'); expect((await f.trace()).some((r: any) => r.command === 'run')).toBe(false)
}, 15000)
it('rejects a non-private profile before starting a console', async () => {
  const f = await fixture(); await f.close(); await chmod(f.profile, 0o644)
  const { AgentConsole } = await import(pathToFileURL(fileURLToPath(new URL('../dist/agent-console.js', import.meta.url))).href)
  await expect(AgentConsole.open(f.workspace, f.cache, { directory: f.control, ollamaProfile: f.profile, maxRunSeconds: 60 })).rejects.toThrow('private')
})

it('keeps one Ollama request lane even when separate worktrees and spare console slots exist', async () => {
  const f = await fixture()
  const create = () => f.console.action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'ollama', isolation: 'worktree', title: 'Isolated bounded worker', objective: 'Review selected source only.', paths: ['source.mjs'] })
  const a = await create(), b = await create(); await f.act(a.id, 'run'); await f.wait(a.id, task => task.status === 'waiting')
  await expect(f.act(b.id, 'run')).rejects.toThrow('One Ollama request lane')
  expect(f.console.task(a.id).pending[0].params.tool).toBe('Send bounded worker packet')
  expect((await f.trace()).some((row: any) => row.command === 'run')).toBe(false)
}, 15000)
