// Runs in a real independent tarball consumer against the installed CLI.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function probeDashboard(cli, workspace, cache, agents, privateNote) {
  const links = join(workspace, 'selected-girnel-cards.json')
  await writeFile(links, JSON.stringify({ version: 1, cards: agents.map(agent => ({
    checkoutRoot: agent.checkout.root, agentId: agent.agentId,
    appUrl: 'https://girnel.example/app/', boardId: 'packed-board', cardId: 'packed-card',
    title: 'Review a shared ticket', column: 'To do', observedAt: Date.now(),
  })) }), { mode: 0o600 })
  const before = await readFile(join(cache, 'workspace.sqlite'))
  const child = spawn(process.execPath, [cli, 'workspace', 'dashboard', workspace, '--cache-dir', cache, '--girnel-links', links], { stdio: ['ignore', 'pipe', 'pipe'] })
  const lines = createInterface({ input: child.stdout })
  let timer
  try {
    const line = await Promise.race([
      once(lines, 'line').then(([value]) => value),
      once(child, 'exit').then(() => { throw new Error('dashboard exited before its URL') }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('dashboard startup deadline')), 30000) }),
    ])
    clearTimeout(timer)
    const url = /^Z1P local dashboard: (http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}\/)$/u.exec(line)?.[1]
    assert.ok(url)
    const page = await fetch(url)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.match(await page.text(), /Work in view/)
    const response = await fetch(url + 'snapshot'), body = await response.text()
    assert.equal(response.status, 200)
    const data = JSON.parse(body)
    const ticket = data.tickets.find(item => item.girnel)
    assert.equal(ticket.agents.length, 2)
    assert.equal(ticket.girnel.column, 'To do')
    assert.equal(ticket.girnel.href, 'https://girnel.example/app/#/b/packed-board/c/packed-card')
    assert.ok(data.overlaps.rows.length >= 1)
    assert.ok(!body.includes(privateNote)); assert.ok(!body.includes('sharedPrivateMarker')); assert.ok(!body.includes('commonDirectory'))
    assert.equal((await fetch(url + 'snapshot', { headers: { Origin: 'https://other.example' } })).status, 403)
    assert.equal((await fetch(url + 'snapshot', { method: 'POST' })).status, 405)
    assert.equal((await fetch(new URL('/', url))).status, 404)
    assert.deepEqual(await readFile(join(cache, 'workspace.sqlite')), before)
  } finally {
    clearTimeout(timer); lines.close()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
      await exited; clearTimeout(kill)
    }
    await rm(links)
  }
  console.log('Packed dashboard: private loopback URL, Girnel grouping, shared paths, read-only cache and HTTP rejections passed.')
}
