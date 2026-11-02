import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { consoleFixture } from './agent-console-fixture.mjs'

export async function probeAgentConsole(cli) {
  const dist = join(dirname(cli), '../dist'), f = await consoleFixture(dist)
  const { serveWorkspaceDashboard } = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  let server
  try {
    server = await serveWorkspaceDashboard(f.workspace, f.cache, { controlDirectory: f.control, codexExecutable: f.executable, maxRunSeconds: 30 })
    const origin = new URL(server.url).origin
    const read = async path => { const response = await fetch(server.url + 'console/' + path); assert.equal(response.status, 200); return response.json() }
    const action = async value => { const response = await fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(value) }); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    const wait = async (id, check) => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) { const task = await read('task/' + id); if (check(task)) return task; await new Promise(resolve => setTimeout(resolve, 40)) }
      throw new Error('Console state deadline')
    }
    const created = await action({ action: 'create', requestId: randomUUID(), root: f.root, title: 'A complete local journey', objective: 'ask-question then fix source.txt and run a regression.', host: 'codex', paths: ['source.txt'] })
    const cmd = async (kind, task, extra = {}) => action({ action: kind, id: task.id, requestId: randomUUID(), expectedRevision: task.revision, ...extra })
    const launch = { action: 'run', id: created.id, requestId: randomUUID(), expectedRevision: created.revision }
    await action(launch)
    let task = await wait(created.id, task => task.status === 'waiting')
    assert.equal(task.pending[0].method, 'item/tool/requestUserInput')
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'before\n')
    await cmd('answer', task, { pendingId: task.pending[0].id, answers: { scope: 'Run the regression test.' } })
    task = await wait(created.id, task => task.status === 'waiting' && task.pending[0].method.includes('requestApproval'))
    await cmd('answer', task, { pendingId: task.pending[0].id, decision: 'accept' })
    task = await wait(created.id, task => task.status === 'review' && task.review)
    assert.equal(task.settings.model, 'fixture-configured-model')
    assert.match(task.review.diff, /after/)
    assert.ok(task.review.untracked.some(file => file.name === 'regression.test.mjs' && file.text.includes('assert.equal')))
    assert.ok(task.events.some(event => event.text.includes('exit 0')))
    // Retrying an acknowledged/uncertain original launch cannot send a second turn.
    await action(launch)
    const trace = (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(trace.filter(item => item.method === 'turn/start').length, 1)
    assert.deepEqual(trace.find(item => item.method === 'thread/start').params, { cwd: f.root })
    await cmd('review', task, { decision: 'accept', reviewHash: task.review.hash })
    assert.equal((await read('task/' + task.id)).status, 'accepted')
    for (const headers of [{ Origin: 'https://evil.example', 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, { Origin: origin, 'Content-Type': 'application/json' }]) assert.equal((await fetch(server.url + 'console/action', { method: 'POST', headers, body: '{}' })).status, 403)
    await server.close(); server = undefined
    server = await serveWorkspaceDashboard(f.workspace, f.cache, { controlDirectory: f.control, codexExecutable: f.executable, maxRunSeconds: 30 })
    const retained = await fetch(server.url + 'console/task/' + created.id).then(response => response.json())
    assert.equal(retained.status, 'accepted')
    assert.ok(!(await readFile(join(f.control, 'workspace.sqlite'))).includes(Buffer.from('A complete local journey')))
    console.log('Packed task console: real stdio host process, questions, approvals, scoped fixture edit/test, exact review, replay rejection, restart and encrypted persistence passed (no model inference).')
  } finally { if (server) await server.close(); await f.cleanup() }
}
