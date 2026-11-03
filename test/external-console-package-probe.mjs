import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Four independent real repository MCP clients, HTTP, encrypted restart and a
// registered worktree. Host labels are fixtures; no provider process/inference.
export async function probeExternalConsole(cli, inspect = async () => {}) {
  const dist = join(dirname(cli), '../dist')
  const { initialiseWorkspaceStore, WorkspaceStore } = await import(pathToFileURL(join(dist, 'workspace-store.js')))
  const { discoverWorkspace, gitEnvironment } = await import(pathToFileURL(join(dist, 'workspace-catalogue.js')))
  const { serveWorkspaceDashboard } = await import(pathToFileURL(join(dist, 'workspace-dashboard.js')))
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'z1p-external-wire-'))), workspace = join(temp, 'workspace'), root = join(workspace, 'project'), side = join(temp, 'linked-checkout'), cache = join(temp, 'cache'), control = join(temp, 'control'), links = join(temp, 'cards.json'), handovers = join(temp, 'handovers')
  const git = (args, cwd = root) => execFileSync('git', ['-C', cwd, ...args], { env: gitEnvironment(), encoding: 'utf8', stdio: 'pipe' }).trim()
  let server, store; const peers = [], linked = []
  const call = async (peer, name, args = {}) => { const r = await peer.client.callTool({ name, arguments: { expectedRoot: peer.root, ...args } }); assert.equal(!!r.isError, false, JSON.stringify(r)); return JSON.parse(r.content[0].text) }
  const read = async path => { const r = await fetch(server.url + 'console/' + path); assert.equal(r.status, 200, await r.clone().text()); return r.json() }
  const action = async value => { const r = await fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Z1P-Console': '1' }, body: JSON.stringify(value) }); assert.equal(r.status, 200, await r.clone().text()); return r.json() }
  const act = async (id, kind, extra = {}) => action({ action: kind, id, requestId: randomUUID(), expectedRevision: (await read('external/' + id)).revision, ...extra })
  const wait = async (id, check) => { const deadline = Date.now() + 25000; while (Date.now() < deadline) { const value = await read('external/' + id); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 80)) } throw new Error('External inbox deadline: ' + id) }
  const open = async () => server = await serveWorkspaceDashboard(workspace, cache, { controlDirectory: control, girnelLinks: links })
  const context = () => ({ server, root, side, peers, linked, read, action, act, wait, call })
  try {
    await mkdir(root, { recursive: true }); await writeFile(join(root, 'source.txt'), 'fixture source\n')
    git(['init', '-q']); git(['add', 'source.txt']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
    await initialiseWorkspaceStore(cache); store = new WorkspaceStore(cache); await discoverWorkspace(workspace, store)
    // Intentionally outside the catalogue/workspace: only its registered Git
    // relationship and an explicit actor selection can associate it with root.
    git(['worktree', 'add', '-b', 'external-fixture', side])
    await mkdir(handovers, { mode: 0o700 }); await writeFile(links, JSON.stringify({ version: 1, cards: [] })); await open()
    assert.equal((await read('snapshot')).hosts.some(host => host.available), false)
    for (const [index, host] of ['Codex', 'Claude', 'Kimi', 'Ollama host'].entries()) {
      const client = new Client({ name: 'external-' + index, version: '1' }), peer = { client, host, root: index % 2 ? root : side, slot: 'external-' + index }
      peers.push(peer); await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'session', '--cache-dir', cache, '--handover-base', handovers], cwd: peer.root, stderr: 'pipe' }))
      assert.equal((await client.listTools()).tools.length, 12)
      assert.equal((await call(peer, 'repository_status')).root, peer.root)
      peer.activity = (await call(peer, 'repository_activity', { slot: peer.slot, label: host + ' external fixture', task: 'Inspect source.txt in the selected checkout', paths: ['source.txt'], state: 'working', expectedRevision: 0, ttlSeconds: 900 })).agent
    }
    await inspect('registered', context())
    const candidates = await read('external-candidates?root=' + encodeURIComponent(root))
    assert.deepEqual(candidates.map(peer => peer.agentId).sort(), peers.map(peer => peer.activity.agentId).sort())
    for (const peer of peers) {
      const item = await action({ action: 'external-link', requestId: randomUUID(), root, agentId: peer.activity.agentId, expectedAgentRevision: peer.activity.revision }); linked.push(item)
      assert.equal(item.agentId, peer.activity.agentId); assert.equal(item.checkoutRoot, peer.root)
      const id = randomUUID(), text = 'PRIVATE owner note for ' + peer.host
      await act(item.id, 'external-note', { requestId: id, text })
      await wait(item.id, value => value.notes.some(note => note.id === id && note.deliveredAt))
      const received = await call(peer, 'repository_coordination', { maxBytes: 65536 })
      assert.equal(received.messages.filter(note => note.messageId === id).length, 1)
      await call(peer, 'repository_message', { slot: peer.slot, recipientAgentId: item.address, messageId: randomUUID(), text: 'ACK ' + id })
      const replyId = randomUUID()
      await call(peer, 'repository_message', { slot: peer.slot, recipientAgentId: item.address, messageId: replyId, text: 'PRIVATE reply from ' + peer.host })
      await wait(item.id, value => value.notes.some(note => note.id === id && note.acknowledgedAt) && value.notes.some(note => note.id === replyId))
    }
    assert.equal((await read('snapshot')).active, 0); assert.equal((await read('snapshot')).tasks.length, 0)
    assert.equal((await fetch(server.url + 'console/external/' + linked[0].id, { headers: { Origin: 'https://outside.example' } })).status, 403)
    assert.equal((await fetch(server.url + 'console/action', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'external-note', id: linked[0].id, requestId: randomUUID(), expectedRevision: (await read('external/' + linked[0].id)).revision, text: 'Rejected missing-header note' }) })).status, 403)
    await writeFile(links, JSON.stringify({ version: 1, cards: [{ checkoutRoot: root, agentId: peers[0].activity.agentId, appUrl: 'https://girnel.example/app/', boardId: 'selected-board', cardId: 'selected-card', title: 'Selected external work', column: 'To do', observedAt: Date.now() }] }))
    const publicSnapshot = await fetch(server.url + 'snapshot').then(response => response.json())
    assert.equal(JSON.stringify(publicSnapshot).includes('PRIVATE'), false)
    const ticket = publicSnapshot.tickets.find(ticket => ticket.girnel)
    assert.equal(ticket.agents.length, 1); assert.equal(ticket.agents[0].agentId, peers[0].activity.agentId); assert.equal(ticket.agents[0].checkoutRoot, side)
    const feedResponse = await fetch(ticket.observationUrl, { headers: { Origin: 'https://girnel.example' } }); assert.equal(feedResponse.status, 200)
    const feed = await feedResponse.text(); assert.equal(feed.includes('PRIVATE'), false); assert.equal(JSON.parse(feed).agents.length, 1)
    await inspect('inbox', context())
    assert.equal(JSON.stringify(await fetch(server.url + 'snapshot').then(response => response.json())).includes('PRIVATE'), false)
    const ids = linked.map(item => item.id), addresses = linked.map(item => item.address)
    await server.close(); server = undefined; await open()
    for (const [index, id] of ids.entries()) {
      const item = await wait(id, value => value.active)
      assert.equal(item.address, addresses[index]); assert.ok(item.notes.some(note => note.acknowledgedAt)); assert.equal(item.checkoutRoot, peers[index].root)
    }
    await inspect('restart', context())
    const before = await call(peers[0], 'repository_coordination', { maxBytes: 65536 })
    await inspect('before-remove', context())
    if ((await read('snapshot')).external.some(item => item.id === linked[0].id)) await act(linked[0].id, 'external-remove')
    assert.equal((await read('snapshot')).external.length, 3)
    const after = await call(peers[0], 'repository_coordination', { maxBytes: 65536 })
    assert.deepEqual(after.agents.find(agent => agent.agentId === peers[0].activity.agentId), before.agents.find(agent => agent.agentId === peers[0].activity.agentId))
    assert.equal(git(['status', '--porcelain']), ''); assert.equal(git(['status', '--porcelain'], side), '')
    const result = { hosts: peers.map(peer => peer.host), actualMcpClients: 4, providerProcesses: 0, inference: false, privateInboxes: true, explicitAcknowledgements: true, restartAddressesPreserved: true, peerUnaffectedByRemoval: true, registeredWorktreeAssociation: true, scopedGirnelFeed: true, sourceUnchanged: true }
    console.log('External console: four real MCP clients/HTTP inboxes, exact worktree pins, ACKs, encrypted restart, private feed boundaries and independent peer lifetime passed (no inference).')
    return result
  } finally {
    await server?.close()
    const closed = await Promise.allSettled(peers.map(peer => peer.client.close())); for (const result of closed) if (result.status === 'rejected') throw result.reason
    store?.close()
    if (git(['worktree', 'list', '--porcelain', '-z']).split('\0').includes('worktree ' + side)) {
      assert.equal(git(['status', '--porcelain'], side), ''); assert.equal(git(['rev-parse', 'HEAD'], side), git(['rev-parse', 'HEAD']))
      git(['worktree', 'remove', side]); git(['branch', '-d', 'external-fixture']); git(['worktree', 'prune'])
    }
    await rm(temp, { recursive: true, force: true })
  }
}
