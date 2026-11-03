import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { claudeConsoleFixture } from './claude-console-fixture.mjs'

// Two independent native-protocol doubles plus two actual repository MCP clients.
// Files, Git worktrees, tests, notes and encrypted restart are real; no inference.
export async function probeConcurrentConsole(cli, inspect = async () => {}) {
  const dist = join(dirname(cli), '../dist'), f = await claudeConsoleFixture(dist)
  const { serveWorkspaceDashboard } = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  let server; const clients = []
  const open = async () => server = await serveWorkspaceDashboard(f.workspace, f.cache, { controlDirectory: f.control, codexExecutable: f.codexExecutable, claudeExecutable: f.executable, maxRunSeconds: 90, maxActive: 2 })
  const read = async path => { const response = await fetch(server.url + 'console/' + path); assert.equal(response.status, 200); return response.json() }
  const action = async value => { const response = await fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(value) }); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
  const act = async (id, kind, extra = {}) => action({ action: kind, id, requestId: randomUUID(), expectedRevision: (await read('task/' + id)).revision, ...extra })
  const wait = async (id, check) => { const deadline = Date.now() + 20000; while (Date.now() < deadline) { const task = await read('task/' + id); if (check(task)) return task; await new Promise(resolve => setTimeout(resolve, 80)) } throw new Error('Concurrent console deadline: ' + id) }
  const tool = async (client, name, args) => { const result = await client.callTool({ name, arguments: args }); assert.equal(!!result.isError, false, JSON.stringify(result)); return JSON.parse(result.content[0].text) }
  try {
    await open()
    const tasks = []
    for (const host of ['codex', 'claude']) {
      const task = await action({ action: 'create', requestId: randomUUID(), root: f.root, title: 'Concurrent ' + host, objective: 'file-preview change source.txt and verify the regression.', host, isolation: 'worktree', paths: ['source.txt'] })
      await act(task.id, 'run'); tasks.push(await wait(task.id, t => t.status === 'waiting'))
    }
    assert.equal((await read('snapshot')).active, 2)
    assert.notEqual(tasks[0].executionRoot, tasks[1].executionRoot)
    const workers = []
    for (const task of tasks) {
      const client = new Client({ name: 'concurrent-installed-worker', version: '1' }); clients.push(client)
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'session', '--cache-dir', f.cache], cwd: task.executionRoot, stderr: 'pipe' }))
      const slot = 'worker-' + task.id, activity = await tool(client, 'repository_activity', { expectedRoot: task.executionRoot, slot, label: 'Installed worker ' + task.host, task: task.title, paths: ['source.txt'], state: 'working', expectedRevision: 0 })
      workers.push({ client, slot, root: task.executionRoot, id: activity.agent.agentId })
    }
    const id = randomUUID(), [a, b] = workers
    await tool(a.client, 'repository_message', { expectedRoot: a.root, slot: a.slot, recipientAgentId: tasks[1].address, messageId: id, text: 'Handover: keep the source change and regression together.' })
    await wait(tasks[1].id, task => task.inbox.some(note => note.id === id && note.deliveredAt))
    const received = await tool(b.client, 'repository_coordination', { expectedRoot: b.root, maxBytes: 65536 })
    assert.ok(received.messages.some(note => note.messageId === id))
    await tool(b.client, 'repository_message', { expectedRoot: b.root, slot: b.slot, recipientAgentId: tasks[1].address, messageId: randomUUID(), text: 'ACK ' + id })
    await wait(tasks[1].id, task => task.inbox.some(note => note.id === id && note.acknowledgedAt))
    await inspect('handover', { server, f, tasks, read, act, wait, action })
    const before = (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse), turns = before.filter(row => row.method === 'turn/start' || row.type === 'user').length
    await server.close(); server = undefined; await open()
    assert.equal((await read('snapshot')).active, 0)
    for (const task of tasks) { const saved = await read('task/' + task.id); assert.equal(saved.status, 'unknown'); assert.equal(saved.executionRoot, task.executionRoot); assert.equal(saved.threadId, task.threadId) }
    const after = (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(after.filter(row => row.method === 'turn/start' || row.type === 'user').length, turns)
    await inspect('restart', { server, f, tasks, read, act, wait, action })
    for (const task of tasks) { await act(task.id, 'run', { message: 'Reconciled interruption. file-preview finish the scoped fixture and run its regression.' }); await wait(task.id, t => t.status === 'waiting') }
    assert.equal((await read('snapshot')).active, 2)
    for (const task of tasks) {
      const pending = (await read('task/' + task.id)).pending[0]
      await act(task.id, 'answer', { pendingId: pending.id, decision: 'accept' })
      const reviewed = await wait(task.id, t => !!t.review)
      assert.match(reviewed.review.diff, /after/); assert.ok(reviewed.events.some(event => /exit 0|# pass 1/.test(event.text)))
      execFileSync(process.execPath, ['--test', 'regression.test.mjs'], { cwd: reviewed.executionRoot, stdio: 'pipe' })
      await writeFile(join(reviewed.executionRoot, 'source.txt'), 'before\n')
      assert.throws(() => execFileSync(process.execPath, ['--test', 'regression.test.mjs'], { cwd: reviewed.executionRoot, stdio: 'pipe' }))
      await writeFile(join(reviewed.executionRoot, 'source.txt'), 'after\n')
    }
    assert.equal((await read('snapshot')).reviewCount, 2)
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'before\n')
    await inspect('review', { server, f, tasks, read, act, wait, action })
    const first = await read('task/' + tasks[0].id); await act(first.id, 'review', { decision: 'accept', reviewHash: first.review.hash })
    assert.equal((await read('task/' + tasks[1].id)).status, 'review')
    const result = { concurrent: ['codex', 'claude'], isolatedBranches: true, originalUnchanged: true, actualMcpHandoverAndAck: true, restartWithoutReplay: true, explicitThreadResume: true, separateReview: true, bothRegressionsRejectBaseline: true, inference: false }
    console.log('Packed concurrent console: two native-protocol processes/worktrees, actual MCP handover+ACK, active restart/no replay, explicit resumes and independent rejecting regressions passed.')
    return result
  } finally { for (const client of clients) await client.close(); if (server) await server.close(); await f.cleanup() }
}
