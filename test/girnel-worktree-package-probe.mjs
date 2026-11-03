import assert from 'node:assert/strict'
import {dirname, join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {writeFile, rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {consoleFixture} from './agent-console-fixture.mjs'

/** Actual packaged HTTP/stdio/worktree boundaries; no model inference or edits. */
export async function probeGirnelWorktree(cli) {
  const dist = join(dirname(cli), '../dist'), f = await consoleFixture(dist), links = join(f.temp, 'cards.json')
  const {serveWorkspaceDashboard} = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  const {gitEnvironment} = await import(pathToFileURL(join(dist, 'workspace-catalogue.js')))
  let server
  try {
    await writeFile(links, JSON.stringify({version: 1, cards: []}))
    server = await serveWorkspaceDashboard(f.workspace, f.cache, {repositoryRoot: f.root, girnelLinks: links, controlDirectory: f.control, codexExecutable: f.executable, maxRunSeconds: 30})
    const action = async body => {
      const response = await fetch(server.url + 'console/action', {method: 'POST', headers: {Origin: new URL(server.url).origin, 'X-Z1P-Console': '1', 'Content-Type': 'application/json'}, body: JSON.stringify(body)})
      assert.equal(response.status, 200, await response.clone().text()); return response.json()
    }
    const draft = await action({action: 'create', requestId: randomUUID(), root: f.root, host: 'codex', isolation: 'worktree', title: 'Isolated selected task', objective: 'Inspect selected fixture; approval remains unanswered', paths: ['source.txt']})
    await action({action: 'run', id: draft.id, requestId: randomUUID(), expectedRevision: draft.revision})
    let task
    const deadline = Date.now() + 15000
    do {
      task = await fetch(server.url + 'console/task/' + draft.id).then(response => response.json())
      assert.ok(!['unknown', 'failed'].includes(task.status), JSON.stringify(task.events))
      if (task.status === 'waiting') break
      await new Promise(resolve => setTimeout(resolve, 40))
    } while (Date.now() < deadline)
    assert.equal(task.status, 'waiting'); assert.notEqual(task.executionRoot, f.root)
    assert.ok(task.pending.some(item => item.method.includes('requestApproval')))
    await writeFile(links, JSON.stringify({version: 1, cards: [{checkoutRoot: f.root, agentId: task.address, appUrl: 'https://girnel.example/app/', boardId: 'selected-board', cardId: 'selected-card', title: 'Selected work', column: 'To do', observedAt: Date.now()}]}))
    const snapshot = await fetch(server.url + 'snapshot').then(response => response.json()), ticket = snapshot.tickets.find(value => value.girnel)
    assert.equal(ticket.agents.length, 1, 'saved project binding must include its explicitly selected isolated task')
    assert.equal(ticket.agents[0].agentId, task.address); assert.equal(ticket.agents[0].checkoutRoot, task.executionRoot)
    assert.ok(ticket.checkoutRoots.includes(f.root)); assert.ok(ticket.checkoutRoots.includes(task.executionRoot))
    assert.equal(ticket.girnel.column, 'To do')
    const response = await fetch(ticket.observationUrl, {headers: {Origin: 'https://girnel.example'}})
    assert.equal(response.status, 200)
    const text = await response.text(), feed = JSON.parse(text)
    assert.equal(feed.agents.length, 1); assert.equal(feed.agents[0].agentId, task.address)
    assert.ok(!text.includes(f.root) && !text.includes(task.executionRoot))
    assert.equal(f.git(['status', '--porcelain']).toString().trim(), '')
    console.log('Packed Girnel feed: source-project binding follows a real isolated task; execution provenance, unchanged column and read-only origin boundary retained (no inference or edits).')
  } finally {
    if (server) await server.close()
    // This fixture never grants the queued approval, so its worktrees must be
    // clean and still at the parent's HEAD. Preserve anything unexpected.
    const head = f.git(['rev-parse', 'HEAD']).toString().trim()
    for (const block of f.git(['worktree', 'list', '--porcelain']).toString().trim().split('\n\n')) {
      const path = block.split('\n').find(line => line.startsWith('worktree '))?.slice(9)
      if (!path || path === f.root) continue
      const git = args => execFileSync('git', ['-C', path, ...args], {env: gitEnvironment(), encoding: 'utf8', stdio: 'pipe'}).trim()
      assert.equal(git(['status', '--porcelain']), ''); assert.equal(git(['rev-parse', 'HEAD']), head)
      const branch = git(['symbolic-ref', '--short', 'HEAD'])
      f.git(['worktree', 'remove', path]); f.git(['branch', '-d', branch])
    }
    f.git(['worktree', 'prune']); await rm(f.temp, {recursive: true, force: true})
  }
}
