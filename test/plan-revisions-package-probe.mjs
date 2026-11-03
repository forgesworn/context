import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { consoleFixture } from './agent-console-fixture.mjs'

// Real HTTP, native-protocol processes and an independent stdio MCP peer.
// The peer is a protocol fixture, not a model identity or adoption claim.
export async function probePlanRevisions(cli, hook) {
  const dist = join(dirname(cli), '../dist'), f = await consoleFixture(dist), { serveWorkspaceDashboard } = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  await writeFile(join(f.root, 'source.md'), 'before\n'); f.git(['add', 'source.md']); f.git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'revision source fixture'])
  await writeFile(f.executable, (await readFile(f.executable, 'utf8')).replaceAll('source.txt', 'source.md'))
  const options = { controlDirectory: f.control, codexExecutable: f.executable, maxRunSeconds: 30 }, peer = new Client({ name: 'revision-inbox-fixture', version: '1' })
  let server, peerRoot, peerRevision, peerSlot
  const slot = id => 'worker-' + id
  const call = async (name, args) => { const r = await peer.callTool({ name, arguments: { expectedRoot: peerRoot, ...args } }); assert.notEqual(r.isError, true, JSON.stringify(r)); return JSON.parse(r.content[0].text) }
  try {
    server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
    const read = async path => { const response = await fetch(server.url + 'console/' + path); assert.equal(response.status, 200); return response.json() }
    const request = value => fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(value) })
    const action = async value => { const response = await request(value); assert.equal(response.status, 200, await response.clone().text()); return response.json() }
    const act = async (id, kind, extra = {}) => action({ action: kind, id, requestId: randomUUID(), expectedRevision: (await read('task/' + id)).revision, ...extra })
    const wait = async (path, condition) => { const end = Date.now() + 25000; while (Date.now() < end) { const value = await read(path); if (condition(value)) return value; await new Promise(resolve => setTimeout(resolve, 50)) } throw new Error('Plan revision deadline: ' + path) }
    const input = { title: 'A versioned feature', root: f.root, maxConcurrent: 2, nodes: [0, 1].map(index => ({ title: index ? 'Integrate the feature' : 'Implement the feature', task: 'Fix source.md and run the regression', host: 'codex', paths: ['source.md', 'regression.test.mjs'], checks: ['regression test'], dependsOn: index ? [0] : [] })) }
    const parent = await action({ action: 'plan-create', requestId: randomUUID(), plan: input }), oldId = parent.nodes[0].taskId
    await act(oldId, 'run'); const old = await wait('task/' + oldId, task => task.status === 'waiting')
    peerRoot = old.executionRoot; peerSlot = slot(oldId)
    await peer.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'session', '--cache-dir', f.cache], stderr: 'pipe' }))
    const activity = await call('repository_activity', { slot: slot(oldId), label: 'Registered revision protocol peer', task: 'Receive and acknowledge task notices only', paths: ['source.md'], state: 'working', expectedRevision: 0, ttlSeconds: 900 }); peerRevision = activity.agent.revision
    const next = structuredClone(input); next.nodes[0].task = 'NEW requirements: fix source.md and verify the changed contract'; next.nodes[0].checks = ['revised regression test']
    const reason = 'PRIVATE revision <img src=x onerror="window.__revisionInjected=1">'
    const revision = { action: 'plan-revise', requestId: randomUUID(), id: parent.id, expectedRevision: parent.revision, reason, plan: next }
    const env = () => ({ ...f, server, read, request, action, act, wait, input, parent, old, oldId, next, reason, revision })
    const child = await hook?.('revise', env()) ?? await action(revision)
    assert.equal(child.revisionNumber, 2); assert.deepEqual(child.change.changed, ['step-1']); assert.deepEqual(child.change.affected, ['step-1', 'step-2'])
    assert.equal((await read('snapshot')).tasks.length, 4); assert.equal((await read('task/' + oldId)).status, 'waiting')
    assert.equal((await request({ action: 'answer', requestId: randomUUID(), id: oldId, expectedRevision: (await read('task/' + oldId)).revision, pendingId: old.pending[0].id, decision: 'accept' })).status, 409)
    assert.equal((await read('task/' + oldId)).worktree.root, old.worktree.root)
    await wait('plan/' + child.id, plan => plan.notices[0].delivery === 'stored_in_shared_inbox')
    const notes = await call('repository_coordination', { maxBytes: 65536 }), noteId = child.notices[0].noteId, note = notes.messages.find(note => note.messageId === noteId)
    assert.ok(note); assert.ok(note.text.includes(child.revision)); assert.ok(note.text.includes(reason)); assert.ok(note.text.includes('Do not retarget'))
    await call('repository_message', { slot: slot(oldId), recipientAgentId: (await read('task/' + oldId)).address, messageId: randomUUID(), text: 'ACK ' + noteId })
    await wait('plan/' + child.id, plan => plan.notices[0].delivery === 'acknowledged')
    assert.equal((await read('snapshot')).active, 1)
    await hook?.('notified', { ...env(), child })
    await act(oldId, 'stop'); await wait('task/' + oldId, task => task.status === 'cancelled')
    assert.equal(await readFile(join(old.executionRoot, 'source.md'), 'utf8'), 'before\n')
    await server.close(); server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
    assert.equal((await read('plan/' + child.id)).notices[0].delivery, 'acknowledged'); assert.deepEqual((await read('plan/' + parent.id)).ready, [])
    await hook?.('restart', { ...env(), child })
    for (const step of child.nodes) {
      await act(step.taskId, 'run'); let task = await wait('task/' + step.taskId, task => task.status === 'waiting')
      await act(task.id, 'answer', { pendingId: task.pending[0].id, decision: 'accept' }); task = await wait('task/' + task.id, task => task.status === 'review' && task.review)
      assert.ok(task.events.some(event => event.text.includes('exit 0')))
      if (step.id === 'step-1') assert.equal((await request({ action: 'review', requestId: randomUUID(), id: task.id, expectedRevision: task.revision, decision: 'accept', reviewHash: task.review.hash, planReview: { evidence: 'Old named check', checks: [{ check: 'regression test', outcome: 'passed', evidence: 'Prior contract receipt' }] } })).status, 409)
      const handled = await hook?.('review', { ...env(), child, task, step })
      if (!handled) await act(task.id, 'review', { decision: 'accept', reviewHash: task.review.hash, planReview: { evidence: 'Reviewed current-revision output and exact branch', checks: step.checks.map(check => ({ check: check.check, outcome: 'passed', evidence: 'Current fixture command: node --test regression.test.mjs; exit0' })) } })
    }
    assert.equal((await read('plan/' + child.id)).reportedComplete, true); assert.equal((await read('plan/' + parent.id)).reportedComplete, false)
    const snapshot = await fetch(server.url + 'snapshot').then(response => response.text()); assert.equal(snapshot.includes(reason), false)
    assert.equal((await readFile(join(f.control, 'workspace.sqlite'))).includes(Buffer.from(reason)), false)
    const trace = (await readFile(f.trace, 'utf8')).trim().split('\n').map(JSON.parse), turns = trace.filter(item => item.method === 'turn/start')
    assert.equal(turns.length, 3); assert.ok(turns[1].params.input[0].text.includes('Requirements revision 2')); assert.ok(turns[1].params.input[0].text.includes(old.executionRoot))
    await hook?.('finished', { ...env(), child })
    const result = { nativeFixtureTurns: 3, currentRevisionRegressions: 2, independentMcpAck: true, previousBranchPreserved: true, noAutomaticRestart: true, modelInference: false }
    console.log('Packed plan revisions: real HTTP/stdio + MCP note/ACK, stale approval refusal, native stop, revised source/receipts, restart/history, private data and executed regressions passed (no model inference).')
    return result
  } finally {
    if (peerRevision) await call('repository_activity', { slot: peerSlot, label: 'Registered revision protocol peer', task: 'Fixture finished', paths: [], state: 'done', expectedRevision: peerRevision }).catch(() => {})
    await peer.close(); await server?.close(); await f.cleanup()
  }
}
