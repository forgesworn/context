import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { consoleFixture } from './agent-console-fixture.mjs'

// Actual HTTP + stdio host process + executed fixture test. No model inference.
export async function probeWorkflowConsole(cli, hook) {
  const dist = join(dirname(cli), '../dist'), f = await consoleFixture(dist)
  const { serveWorkspaceDashboard } = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  await writeFile(join(f.root, 'source.md'), 'before\n')
  f.git(['add', 'source.md']); f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'plan source fixture'])
  await writeFile(f.executable, (await readFile(f.executable, 'utf8')).replaceAll('source.txt', 'source.md'))
  let server
  const options = { controlDirectory: f.control, codexExecutable: f.executable, maxRunSeconds: 30 }
  try {
    server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
    const read = async path => { const response = await fetch(server.url + 'console/' + path); assert.equal(response.status, 200); return response.json() }
    const request = value => fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(value) })
    const action = async value => { const response = await request(value); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    const act = async (id, kind, extra = {}) => action({ action: kind, id, requestId: randomUUID(), expectedRevision: (await read('task/' + id)).revision, ...extra })
    const wait = async (id, condition) => { const end = Date.now() + 20000; while (Date.now() < end) { const task = await read('task/' + id); if (condition(task)) return task; await new Promise(resolve => setTimeout(resolve, 40)) } throw new Error('Workflow console deadline') }
    const title = 'PRIVATE plan <img src=x onerror="window.__planInjected=1">'
    const input = { action: 'plan-create', requestId: randomUUID(), plan: { title, root: f.root, maxConcurrent: 2,
      nodes: [0, 1].map(index => ({ title: index ? 'Integrate and verify' : 'Implement change', task: 'Fix source.md and run the regression test', host: 'codex', paths: ['source.md', 'regression.test.mjs'], checks: ['regression test'], dependsOn: index ? [0] : [] })) } }
    const env = () => ({ ...f, server, read, action, act, wait, title, input })
    const plan = await hook?.('create', env()) ?? await action(input)
    const [first, second] = plan.nodes.map(node => node.taskId)
    assert.equal((await read('snapshot')).tasks.length, 2); assert.equal((await read('snapshot')).active, 0)
    assert.deepEqual((await read('plan/' + plan.id)).ready, ['step-1'])
    assert.equal((await request({ action: 'run', id: second, requestId: randomUUID(), expectedRevision: 1 })).status, 409)
    await hook?.('created', { ...env(), plan })
    for (const [index, id] of [first, second].entries()) {
      const launch = { action: 'run', id, requestId: randomUUID(), expectedRevision: (await read('task/' + id)).revision }
      await action(launch)
      let task = await wait(id, task => task.status === 'waiting')
      assert.equal(task.pending[0].method, 'item/commandExecution/requestApproval')
      await act(id, 'answer', { pendingId: task.pending[0].id, decision: 'accept' })
      task = await wait(id, task => task.status === 'review' && task.review)
      assert.ok(task.events.some(event => event.text.includes('exit 0')))
      assert.match(task.review.diff, /after/)
      const withoutReceipts = { action: 'review', id, requestId: randomUUID(), expectedRevision: task.revision, decision: 'accept', reviewHash: task.review.hash }
      assert.equal((await request(withoutReceipts)).status, 409)
      const reviewed = await hook?.('review', { ...env(), plan, task, index })
      if (!reviewed) await act(id, 'review', { decision: 'accept', reviewHash: task.review.hash, planReview: { evidence: 'Inspected fixture command exit 0 and exact tracked/untracked changes', checks: [{ check: 'regression test', outcome: 'passed', evidence: 'Executed node --test regression.test.mjs; command event exit 0' }] } })
      await action(launch) // reconcile original execution request, never replay
      assert.equal((await read('task/' + id)).status, 'accepted')
      assert.equal((await read('snapshot')).active, 0)
      if (index === 0) {
        assert.deepEqual((await read('plan/' + plan.id)).ready, ['step-2'])
        await hook?.('accepted', { ...env(), plan })
        await server.close(); server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
        assert.deepEqual((await read('plan/' + plan.id)).ready, ['step-2'])
        await hook?.('restart', { ...env(), plan })
      }
    }
    const final = await read('plan/' + plan.id), publicSnapshot = await fetch(server.url + 'snapshot').then(response => response.text())
    assert.equal(final.reportedComplete, true); assert.equal(final.metrics.wholeTaskCost, null)
    assert.equal(publicSnapshot.includes(title), false); assert.equal(publicSnapshot.includes('regression test'), false)
    assert.equal((await readFile(join(f.control, 'workspace.sqlite'))).includes(Buffer.from(title)), false)
    const trace = (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse), turns = trace.filter(item => item.method === 'turn/start')
    assert.equal(turns.length, 2); assert.match(turns[1].params.input[0].text, /Dependency results:.*reviewedHash/)
    assert.match(turns[0].params.input[0].text, /Fresh source packet:/)
    for (const headers of [{ Origin: 'https://evil.example', 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, { Origin: new URL(server.url).origin, 'Content-Type': 'application/json' }]) assert.equal((await fetch(server.url + 'console/action', { method: 'POST', headers, body: JSON.stringify(input) })).status, 403)
    await hook?.('finished', { ...env(), plan, final })
    console.log('Packed task plans: real HTTP/stdio, dependency refusal, explicit starts, fresh packets, executed checks, exact owner review, no replay, restart, encrypted/private records and Origin guards passed (no inference).')
    return { testsExecuted: 2, nativeTurns: turns.length, wholeTaskCost: null }
  } finally { await server?.close(); await f.cleanup() }
}
