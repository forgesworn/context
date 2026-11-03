import { afterEach, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { RepositoryCoordination } from './repository-coordination.js'
import { discoverWorkspace, gitEnvironment } from './workspace-catalogue.js'
import { initialiseWorkspaceStore, WorkspaceStore } from './workspace-store.js'
import { dashboardOverlaps, dashboardTickets, readGirnelLinks, readWorkspaceDashboard, serveWorkspaceDashboard, type GirnelCardLink } from './workspace-dashboard.js'
import type { WorkspaceActivityRow } from './workspace-activity-types.js'
import { RepositoryNavigation } from './repository-navigation.js'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
const row = (extra: Partial<WorkspaceActivityRow> = {}): WorkspaceActivityRow => ({ groupId: 'same-git', agentId: 'claude/task', label: 'Claude', task: 'Fix queue cancellation', paths: ['src/'], state: 'working', revision: 1, checkoutRoot: '/workspace/project', branch: 'fix/queue', head: 'a'.repeat(40), updatedAt: Date.now(), expiresAt: Date.now() + 60000, active: true, ...extra })
const link = (extra: Partial<GirnelCardLink> = {}): GirnelCardLink => ({ checkoutRoot: '/workspace/project', agentId: 'claude/task', appUrl: 'https://girnel.example/app/', boardId: 'a'.repeat(64), cardId: '18cd382f-21a7-42a4-b784-05fa70e3a05e', title: 'Queue cancellation', column: 'To do', observedAt: 1793620000000, ...extra })

it('groups explicitly bound agents by durable Girnel card while preserving ticket status and source identity', () => {
  const rows = [row({ state: 'done', active: false }), row({ agentId: 'codex/test', checkoutRoot: '/workspace/linked', state: 'reviewing' }), row({ groupId: 'unrelated', agentId: 'claude/task', checkoutRoot: '/workspace/other' })]
  const cards = dashboardTickets(rows, [link(), link({ agentId: 'codex/test', checkoutRoot: '/workspace/linked' })])
  expect(cards).toHaveLength(2)
  expect(cards[0].agents).toHaveLength(2)
  expect(cards[0].lane).toBe('reviewing')
  expect(cards[0].girnel!.column).toBe('To do')
  expect(cards[0].girnel!.href).toBe('https://girnel.example/app/#/b/' + 'a'.repeat(64) + '/c/' + link().cardId)
  expect(cards[1].girnel).toBeNull()
  const finished = dashboardTickets([row({ state: 'done', active: false })], [link()])[0]
  expect(finished.lane).toBe('done')
  expect(finished.girnel!.column).toBe('To do')
  expect(dashboardTickets([row({ active: false })], [])[0].lane).toBe('inactive')
})

it('finds exact and directory overlaps across worktrees without conflating unrelated repositories or sibling prefixes', () => {
  const result = dashboardOverlaps([row(), row({ agentId: 'kimi/test', label: 'Kimi', checkoutRoot: '/workspace/linked', paths: ['src/queue.ts'] }), row({ agentId: 'other', groupId: 'different-git', paths: ['src/queue.ts'] }), row({ agentId: 'sibling', paths: ['src-other/queue.ts'] }), row({ agentId: 'expired', paths: ['src/queue.ts'], active: false })])
  expect(result.complete).toBe(true)
  expect(result.rows).toEqual([{ first: 'Claude', second: 'Kimi', paths: ['src/queue.ts'], checkouts: ['/workspace/project', '/workspace/linked'] }])
  expect(dashboardOverlaps(Array.from({ length: 30 }, (_, i) => row({ agentId: String(i) }))).complete).toBe(false)
})

it('keeps selected Girnel tickets visible before an agent publishes, without inferring completion', () => {
  const cards = dashboardTickets([], [link({ agentId: null }), link({ agentId: 'not-published-yet', cardId: 'other-card' })])
  expect(cards).toHaveLength(2)
  expect(cards.every(card => card.lane === 'inactive' && card.agents.length === 0)).toBe(true)
  expect(cards[0].checkoutRoots).toEqual(['/workspace/project'])
})

async function fixture() {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'z1p-dashboard-')))
  cleanups.push(() => rm(temporary, { recursive: true, force: true }))
  const workspace = join(temporary, 'workspace'), root = join(workspace, 'project'), cache = join(temporary, 'cache')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'source.ts'), 'export const doNotExposePrivateSource = 7\n')
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { env: gitEnvironment(), stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'source.ts']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  await initialiseWorkspaceStore(cache)
  const store = new WorkspaceStore(cache)
  try {
    await discoverWorkspace(workspace, store)
    const coordination = new RepositoryCoordination(store)
    const publication = await coordination.update({ expectedRoot: root, slot: 'task', label: 'Codex', task: 'Review <script>globalThis.injected=true</script>', paths: ['source.ts'], state: 'working', expectedRevision: 0, ttlSeconds: 900 })
    await coordination.send({ expectedRoot: root, slot: 'task', recipientAgentId: publication.agent.agentId, messageId: 'a18a14d1-39d8-45bb-9c4a-d0fac3c0d38e', text: 'doNotExposePrivateInbox' })
  } finally { store.close() }
  return { temporary, workspace, root, cache }
}

it('rejects unsafe Girnel links, duplicate bindings, unknown fields, outside roots and symlinks', async () => {
  const f = await fixture(), path = join(f.temporary, 'links.json'), roots = new Set([link().checkoutRoot])
  const write = async (cards: unknown[]) => writeFile(path, JSON.stringify({ version: 1, cards }))
  await write([link()]); expect(await readGirnelLinks(path, roots)).toEqual([link()])
  for (const appUrl of ['javascript:alert(1)', 'http://girnel.example/app/', 'https://user:secret@girnel.example/', 'https://girnel.example/?key=x', 'https://girnel.example/#invite']) {
    await write([link({ appUrl })]); await expect(readGirnelLinks(path, roots)).rejects.toThrow()
  }
  await write([link(), link()]); await expect(readGirnelLinks(path, roots)).rejects.toThrow('one Girnel binding')
  await write([{ ...link(), secret: 'refuse me' }]); await expect(readGirnelLinks(path, roots)).rejects.toThrow()
  await write([link({ checkoutRoot: '/outside' })]); await expect(readGirnelLinks(path, roots)).rejects.toThrow('selected saved catalogue')
  await write([link()]); const alias = join(f.temporary, 'alias.json'); await symlink(path, alias)
  await expect(readGirnelLinks(alias, roots)).rejects.toThrow('canonical')
  await writeFile(path, 'x'.repeat(262145)); await expect(readGirnelLinks(path, roots)).rejects.toThrow('256 KiB')
})

it('reads the saved catalogue and advisory board without writes, source text or addressed notes', async () => {
  const f = await fixture(), database = join(f.cache, 'workspace.sqlite')
  const before = await readFile(database), snapshot = await readWorkspaceDashboard(f.workspace, f.cache, { repositoryRoot: f.root })
  expect(snapshot.tickets).toHaveLength(1)
  expect(snapshot.projects[0]).toMatchObject({ root: f.root, cachedIndex: false, freshness: 'unavailable' })
  expect(snapshot.projects[0].checkedAt).toBeTypeOf('number')
  expect(snapshot.girnel.configured).toBe(false)
  expect(JSON.stringify(snapshot)).not.toMatch(/doNotExposePrivateSource|doNotExposePrivateInbox|commonDirectory/)
  expect(await readFile(database)).toEqual(before)
  await expect(readWorkspaceDashboard(f.workspace, f.cache, { repositoryRoot: '/outside' })).rejects.toThrow()
  await expect(readWorkspaceDashboard(f.temporary, f.cache)).rejects.toThrow('saved workspace catalogue')
})

it('checks only an explicitly selected cached source manifest and never rebuilds a stale or missing index', async () => {
  const f = await fixture(), store = new WorkspaceStore(f.cache)
  try { await new RepositoryNavigation(f.root, undefined, store).refresh() } finally { store.close() }
  const before = await readFile(join(f.cache, 'workspace.sqlite'))
  expect((await readWorkspaceDashboard(f.workspace, f.cache)).projects[0].freshness).toBe('not-checked')
  expect((await readWorkspaceDashboard(f.workspace, f.cache, { repositoryRoot: f.root })).projects[0].freshness).toBe('current')
  await writeFile(join(f.root, 'source.ts'), 'export const changed = 42\n')
  expect((await readWorkspaceDashboard(f.workspace, f.cache, { repositoryRoot: f.root })).projects[0].freshness).toBe('unknown')
  expect(await readFile(join(f.cache, 'workspace.sqlite'))).toEqual(before)
})

function http(url: string, options: { method?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((accept, reject) => {
    const req = request(url, options, response => { let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk }); response.on('end', () => accept({ status: response.statusCode!, headers: response.headers, body })) })
    req.on('error', reject); req.end()
  })
}

it('serves only the private loopback routes; refuses cross-origin, rebinding, mutation and arbitrary file access', async () => {
  const f = await fixture(), server = await serveWorkspaceDashboard(f.workspace, f.cache)
  cleanups.push(server.close)
  expect(new URL(server.url).hostname).toBe('127.0.0.1')
  const page = await http(server.url)
  expect(page.status).toBe(200); expect(page.body).toContain('Work in view.')
  expect(page.headers['content-security-policy']).toContain("connect-src 'self'")
  expect(page.headers['cache-control']).toBe('no-store')
  expect(page.body).not.toContain('globalThis.injected')
  const data = await http(server.url + 'snapshot')
  expect(data.status).toBe(200); expect(JSON.parse(data.body).tickets).toHaveLength(1)
  expect(data.body).not.toMatch(/doNotExposePrivateSource|doNotExposePrivateInbox/)
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Host: 'evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) expect((await http(server.url + 'snapshot', { headers })).status).toBe(403)
  expect((await http(server.url + 'snapshot', { method: 'POST' })).status).toBe(405)
  for (const path of ['', 'snapshot?root=/outside', '../source.ts', 'source.ts']) expect((await http(new URL(path || '/', server.url).href)).status).toBe(404)
})

it('shares only bound card observations with its Girnel origin and revokes a removed binding immediately', async () => {
  const f = await fixture(), linksPath = join(f.temporary, 'selected-cards.json')
  const original = await readWorkspaceDashboard(f.workspace, f.cache)
  const selected = link({checkoutRoot: f.root, agentId: original.activity.rows[0].agentId})
  const write = (cards: GirnelCardLink[]) => writeFile(linksPath, JSON.stringify({version: 1, cards}))
  await write([selected])
  const server = await serveWorkspaceDashboard(f.workspace, f.cache, {girnelLinks: linksPath, repositoryRoot: f.root})
  cleanups.push(server.close)
  const snapshot = JSON.parse((await http(server.url + 'snapshot')).body)
  const url = snapshot.tickets[0].observationUrl
  expect(new URL(url).pathname).toMatch(/^\/girnel-observation\/[0-9a-f]{64}$/)
  expect(url).not.toContain(new URL(server.url).pathname)
  const headers = {Origin: 'https://girnel.example', 'Sec-Fetch-Site': 'cross-site'}
  const feed = await http(url, {headers})
  expect(feed.status).toBe(200)
  expect(feed.headers['access-control-allow-origin']).toBe('https://girnel.example')
  expect(feed.headers['access-control-allow-credentials']).toBeUndefined()
  expect(JSON.parse(feed.body)).toMatchObject({format: 'z1p-girnel-observation', version: 1, boardId: selected.boardId, cardId: selected.cardId, agents: [{agentId: selected.agentId, paths: ['source.ts']}]})
  expect(feed.body).not.toMatch(/checkoutRoot|commonDirectory|doNotExposePrivateSource|doNotExposePrivateInbox|console\/|checkpoint/)
  expect(feed.body).not.toContain(f.root)
  for (const bad of [{}, {Origin: 'null'}, {Origin: 'https://other.example'}, {...headers, Host: 'evil.example'}]) expect((await http(url, {headers: bad})).status).toBe(403)
  expect((await http(url, {headers, method: 'POST'})).status).toBe(405)
  expect((await http(url + '?card=other', {headers})).status).toBe(404)
  expect((await http(server.url + 'console/snapshot', {headers})).status).toBe(403)
  const preflight = await http(url, {method: 'OPTIONS', headers: {...headers, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true'}})
  expect(preflight.status).toBe(204); expect(preflight.headers['access-control-allow-private-network']).toBe('true')
  expect((await http(url, {method: 'OPTIONS', headers: {...headers, 'Access-Control-Request-Method': 'POST'}})).status).toBe(403)
  await write([link({...selected, agentId: null})])
  expect(JSON.parse((await http(url, {headers})).body).agents).toEqual([])
  await write([])
  expect((await http(url, {headers})).status).toBe(404)
  expect(JSON.parse((await http(server.url + 'snapshot')).body).tickets[0].girnel).toBeNull()
})
