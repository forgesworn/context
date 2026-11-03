import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ollamaConsoleFixture } from './ollama-console-fixture.mjs'

export async function probeOllamaConsole(cli) {
  const dist = join(dirname(cli), '../dist'), f = await ollamaConsoleFixture(dist)
  const { serveWorkspaceDashboard } = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  let server
  try {
    const options = { controlDirectory: f.control, ollamaProfile: f.profile, maxRunSeconds: 60 }
    server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
    const read = async path => { const r = await fetch(server.url + 'console/' + path); assert.equal(r.status, 200); return r.json() }
    const action = async data => { const r = await fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(data) }); assert.equal(r.status, 200, await r.clone().text()); return r.json() }
    const act = (kind, task, extra = {}) => action({ action: kind, id: task.id, requestId: randomUUID(), expectedRevision: task.revision, ...extra })
    const wait = async (id, check) => { const end = Date.now() + 15000; while (Date.now() < end) { const task = await read('task/' + id); if (check(task)) return task; await new Promise(r => setTimeout(r, 40)) }; throw new Error('Worker fixture deadline') }
    const approve = async (id, tool) => { const task = await wait(id, task => task.status === 'waiting' && task.pending[0]?.params.tool === tool); await act('answer', task, { pendingId: task.pending[0].id, decision: 'accept' }) }
    let task = await action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'ollama', title: 'Packed bounded worker', objective: 'Propose source and regression changes.', paths: ['source.mjs', 'regression.test.mjs'] })
    await act('run', task); await approve(task.id, 'Send bounded worker packet'); await approve(task.id, 'Apply exact worker replacements'); await approve(task.id, 'Run configured verification')
    task = await wait(task.id, t => !!t.review); const thread = task.threadId
    execFileSync(process.execPath, ['--test', 'regression.test.mjs'], { cwd: f.root, stdio: 'pipe' })
    await writeFile(join(f.root, 'source.mjs'), "export const value = 'before'\n")
    assert.throws(() => execFileSync(process.execPath, ['--test', 'regression.test.mjs'], { cwd: f.root, stdio: 'pipe' }))
    await writeFile(join(f.root, 'source.mjs'), "export const value = 'after'\n")
    await act('review', task, { decision: 'changes', reviewHash: task.review.hash }); task = await read('task/' + task.id)
    await writeFile(f.mode, 'readonly'); await act('run', task, { message: 'Verify from fresh source evidence.' }); await approve(task.id, 'Send bounded worker packet'); await approve(task.id, 'Run configured verification')
    task = await wait(task.id, t => !!t.review); assert.equal(task.threadId, thread); await act('review', task, { decision: 'accept', reviewHash: task.review.hash })
    await server.close(); server = undefined; server = await serveWorkspaceDashboard(f.workspace, f.cache, options)
    assert.equal((await read('task/' + task.id)).status, 'accepted')
    const trace = (await readFile(f.workerTrace, 'utf8')).trim().split('\n').map(JSON.parse)
    assert.equal(trace.filter(row => row.command === 'run').length, 2); assert.equal(trace.filter(row => row.command === 'review').length, 2)
    assert.ok(!(await readFile(join(f.control, 'workspace.sqlite'))).includes(Buffer.from('Packed bounded worker')))
    console.log('Packed Ollama controller: bounded dispatch/replacement/check approvals, real fixture edit/regression/baseline rejection, fresh-packet continuation, helper review and encrypted restart passed (helper double; no inference).')
  } finally { if (server) await server.close(); await f.cleanup() }
}
