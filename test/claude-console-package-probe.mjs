import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { claudeConsoleFixture } from './claude-console-fixture.mjs'

export async function probeClaudeConsole(cli) {
  const dist = join(dirname(cli), '../dist'), f = await claudeConsoleFixture(dist)
  const { serveWorkspaceDashboard } = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  let server
  try {
    const options = { controlDirectory: f.control, codexExecutable: f.codexExecutable, claudeExecutable: f.executable, maxRunSeconds: 30 }
    server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
    const read = async path => { const response = await fetch(server.url + 'console/' + path); assert.equal(response.status, 200); return response.json() }
    const action = async value => {
      const response = await fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(value) })
      assert.equal(response.status, 200, await response.clone().text()); return response.json()
    }
    const cmd = async (kind, task, extra = {}) => action({ action: kind, id: task.id, requestId: randomUUID(), expectedRevision: task.revision, ...extra })
    const wait = async (id, check) => {
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) { const task = await read('task/' + id); if (check(task)) return task; await new Promise(resolve => setTimeout(resolve, 40)) }
      throw new Error('Claude console state deadline: ' + JSON.stringify(await read('task/' + id)))
    }
    assert.deepEqual((await read('snapshot')).hosts.filter(host => host.available).map(host => host.id), ['codex', 'claude'])
    let task = await action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'claude', title: 'Packed Claude journey', objective: 'ask-question then fix the fixture', paths: ['source.txt'] })
    await cmd('run', task); task = await wait(task.id, task => task.status === 'waiting')
    await cmd('answer', task, { pendingId: task.pending[0].id, answers: { q0: 'Run the regression test.' } })
    task = await wait(task.id, task => task.status === 'waiting' && task.pending[0].method === 'claude/tool/requestApproval')
    assert.deepEqual(task.pending[0].params.input, { file_path: join(f.root, 'source.txt'), content: 'after\n' })
    assert.equal(await readFile(join(f.root, 'source.txt'), 'utf8'), 'before\n')
    await cmd('answer', task, { pendingId: task.pending[0].id, decision: 'accept' })
    task = await wait(task.id, task => task.status === 'review' && task.review)
    assert.match(task.review.diff, /after/)
    assert.ok(task.events.some(event => event.text.includes('# pass 1')))
    assert.ok(!JSON.stringify(task).includes('PRIVATE_SECRET_MARKER'))
    const thread = task.threadId
    await cmd('review', task, { decision: 'changes', reviewHash: task.review.hash })
    task = await read('task/' + task.id)
    await cmd('run', task, { message: 'read-only verification' })
    task = await wait(task.id, task => task.status === 'review' && task.review)
    assert.equal(task.threadId, thread)
    await cmd('review', task, { decision: 'accept', reviewHash: task.review.hash })
    await server.close(); server = undefined
    server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
    assert.equal((await read('task/' + task.id)).status, 'accepted')
    const trace = (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(trace.filter(item => item.type === 'user').length, 2)
    assert.equal(trace.filter(item => item.argv).at(-1).argv.at(-1), '--resume=' + thread)
    assert.ok(trace.filter(item => item.type === 'control_response').every(item => !item.response.response.updatedPermissions))
    assert.ok(!(await readFile(join(f.control, 'workspace.sqlite'))).includes(Buffer.from('Packed Claude journey')))
    console.log('Packed Claude console: native stdio/control handshake, questions, exact native input approvals, real fixture edit/regression, same-session fresh-process revision, review and encrypted restart passed (no inference).')
  } finally { if (server) await server.close(); await f.cleanup() }
}
