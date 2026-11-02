import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { parseArgs } from 'node:util'
import { readWorkspaceActivity } from './workspace-activity.js'
import type { WorkspaceActivityRow } from './workspace-activity-types.js'
import type { WorkspaceCatalogue } from './workspace-catalogue.js'
import { checkHandoverDirectory } from './repository-handover-mcp.js'
import { readHandoverSummary } from './task-handover.mjs'
import { WorkspaceStore, workspaceKey } from './workspace-store.js'
import { RepositoryNavigation } from './repository-navigation.js'
import { renderWorkspaceDashboard } from './workspace-dashboard-view.js'

const text = z.string().min(1).max(2048).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const cardSchema = z.object({
  checkoutRoot: text, agentId: text.nullable(), appUrl: z.string().max(2048), boardId: id, cardId: id,
  title: text, column: text, observedAt: z.number().int().nonnegative(),
}).strict()
const linksSchema = z.object({ version: z.literal(1), cards: z.array(cardSchema).max(500) }).strict()
export type GirnelCardLink = z.infer<typeof cardSchema>
export interface DashboardOptions { repositoryRoot?: string; handoverBase?: string; girnelLinks?: string }
export interface DashboardTicket {
  id: string; title: string; lane: 'working' | 'blocked' | 'reviewing' | 'done' | 'inactive'
  agents: WorkspaceActivityRow[]; checkoutRoots: string[]; girnel: (GirnelCardLink & { href: string }) | null
}

/** The file is an explicit selection of card metadata, never a Girnel key/DB export. */
export async function readGirnelLinks(path: string, roots: Set<string>): Promise<GirnelCardLink[]> {
  if (!isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) throw new Error('Girnel links require a canonical file')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > 262144) throw new Error('Girnel links require a regular file of at most 256 KiB')
    const bytes = Buffer.alloc(before.size + 1)
    let length = 0
    while (length < bytes.length) { const result = await file.read(bytes, length, bytes.length - length, length); if (!result.bytesRead) break; length += result.bytesRead }
    const after = await file.stat(), named = await lstat(path)
    if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== named.ino || before.dev !== named.dev || named.isSymbolicLink()) throw new Error('Girnel links changed while reading')
    const links = linksSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)))).cards
    const seen = new Set<string>()
    for (const link of links) {
      const url = new URL(link.appUrl)
      if (url.username || url.password || url.search || url.hash || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Girnel appUrl must be HTTPS or loopback HTTP, without credentials, query or fragment')
      if (!roots.has(link.checkoutRoot)) throw new Error('Girnel binding checkout must be in the selected saved catalogue')
      const key = JSON.stringify(link.agentId === null ? [link.checkoutRoot, link.appUrl, link.boardId, link.cardId] : [link.checkoutRoot, link.agentId])
      if (seen.has(key)) throw new Error('one Girnel binding per checkout and agent slot is required')
      seen.add(key)
    }
    return links
  } finally { await file.close() }
}

export function dashboardTickets(rows: WorkspaceActivityRow[], links: GirnelCardLink[]): DashboardTicket[] {
  const bindings = new Map(links.filter(link => link.agentId !== null).map(link => [JSON.stringify([link.checkoutRoot, link.agentId]), link]))
  const tickets = new Map<string, DashboardTicket>()
  for (const link of links) {
    const href = new URL('#/b/' + encodeURIComponent(link.boardId) + '/c/' + encodeURIComponent(link.cardId), link.appUrl).href
    const key = JSON.stringify(['girnel', href]), existing = tickets.get(key)
    if (!existing) tickets.set(key, { id: key, title: link.title, lane: 'inactive', agents: [], checkoutRoots: [link.checkoutRoot], girnel: { ...link, href } })
    else {
      if (!existing.checkoutRoots.includes(link.checkoutRoot)) existing.checkoutRoots.push(link.checkoutRoot)
      if (link.observedAt > existing.girnel!.observedAt) { existing.title = link.title; existing.girnel = { ...link, href } }
    }
  }
  for (const row of rows) {
    const link = bindings.get(JSON.stringify([row.checkoutRoot, row.agentId]))
    const href = link ? new URL('#/b/' + encodeURIComponent(link.boardId) + '/c/' + encodeURIComponent(link.cardId), link.appUrl).href : null
    const key = link ? JSON.stringify(['girnel', href]) : JSON.stringify(['activity', row.groupId, row.checkoutRoot, row.agentId])
    let ticket = tickets.get(key)
    if (!ticket) { ticket = { id: key, title: link?.title ?? row.task, lane: 'inactive', agents: [], checkoutRoots: [row.checkoutRoot], girnel: link ? { ...link, href: href! } : null }; tickets.set(key, ticket) }
    // A shared ticket uses the newest supplied metadata; progress never changes its Girnel column.
    if (link && ticket.girnel && link.observedAt > ticket.girnel.observedAt) { ticket.title = link.title; ticket.girnel = { ...link, href: href! } }
    ticket.agents.push(row)
    if (!ticket.checkoutRoots.includes(row.checkoutRoot)) ticket.checkoutRoots.push(row.checkoutRoot)
  }
  for (const ticket of tickets.values()) {
    const active = ticket.agents.filter(agent => agent.active)
    ticket.lane = active.some(agent => agent.state === 'blocked') ? 'blocked' : active.some(agent => agent.state === 'working') ? 'working' : active.length ? 'reviewing' : ticket.agents.length > 0 && ticket.agents.every(agent => agent.state === 'done') ? 'done' : 'inactive'
  }
  return [...tickets.values()]
}

export function dashboardOverlaps(rows: WorkspaceActivityRow[]) {
  const active = rows.filter(row => row.active)
  const overlaps: { first: string; second: string; paths: string[]; checkouts: string[] }[] = []
  let comparisons = 0, complete = true
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j]
    if (a.groupId !== b.groupId) continue
    const paths = new Set<string>()
    for (const left of a.paths) for (const right of b.paths) {
      if (++comparisons > 100000 || overlaps.length >= 100) return { rows: overlaps, complete: false }
      const x = left.replace(/\/$/, ''), y = right.replace(/\/$/, '')
      if (x === y || x.startsWith(y + '/') || y.startsWith(x + '/')) paths.add(x.length > y.length ? x : y)
    }
    if (paths.size > 16) complete = false
    if (paths.size) overlaps.push({ first: a.label, second: b.label, paths: [...paths].slice(0, 16), checkouts: [a.checkoutRoot, b.checkoutRoot] })
  }
  return { rows: overlaps, complete }
}

async function checkpointSummaries(root: string, base: string) {
  checkHandoverDirectory(base)
  const directory = join(base, createHash('sha256').update(root).digest('hex'))
  try { checkHandoverDirectory(directory) } catch (error) {
    try { await lstat(directory) } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return { rows: [], complete: true } }
    throw error
  }
  const dir = await opendir(directory), names: { name: string; modified: number }[] = []
  let visited = 0, complete = true
  try {
    for await (const entry of dir) {
      if (++visited > 128) { complete = false; break }
      if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(entry.name)) continue
      const info = await lstat(join(directory, entry.name))
      names.push({ name: entry.name, modified: info.mtimeMs })
    }
  } finally { await dir.close().catch(() => {}) }
  names.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name))
  const rows = []
  for (const { name } of names.slice(0, 4)) {
    try {
      const summary = await readHandoverSummary({ handover: join(directory, name) })
      if (summary.canonicalRoot !== root) throw new Error('checkpoint checkout mismatch')
      rows.push({ name, root, ...summary })
    }
    catch { rows.push({ name, root, error: 'Checkpoint unavailable or invalid; no summary loaded.' }) }
  }
  return { rows, complete, retained: names.length, displayed: Math.min(names.length, 4) }
}

export async function readWorkspaceDashboard(workspace: string, cacheDirectory: string, options: DashboardOptions = {}) {
  if (options.handoverBase) checkHandoverDirectory(options.handoverBase)
  const store = new WorkspaceStore(cacheDirectory, undefined, { readOnly: true })
  try {
    const activity = await readWorkspaceActivity(workspace, store, { includeInactive: true, repositoryRoot: options.repositoryRoot, limit: 500, maxBytes: 262144 })
    const catalogue = store.get<WorkspaceCatalogue>(workspaceKey('catalogue', workspace))!
    const roots = catalogue.repositories.map(repo => repo.root).filter(root => {
      const rel = relative(workspace, root)
      return isAbsolute(root) && resolve(root) === root && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel)
    })
    const links = options.girnelLinks ? await readGirnelLinks(options.girnelLinks, new Set(roots)) : []
    const projects = roots.filter(root => !options.repositoryRoot || root === options.repositoryRoot).map(root => ({ root, cachedIndex: store.has(workspaceKey('index', root)), freshness: 'not-checked' as 'not-checked' | 'current' | 'stale' | 'unknown' | 'unavailable', checkedAt: null as number | null }))
    // Live hash checks are limited to the explicitly selected --repo. Never build an index here.
    if (options.repositoryRoot && projects.length === 1) {
      const project = projects[0]
      project.freshness = project.cachedIndex ? 'unknown' : 'unavailable'
      if (project.cachedIndex) {
        try {
          const navigation = new RepositoryNavigation(project.root, undefined, store)
          const signal = AbortSignal.timeout(5000)
          if (await navigation.restoreFromCache(signal)) project.freshness = (await navigation.status(signal)).freshness
        } catch { /* Failed/timed-out checks never claim current source. */ }
      }
      project.checkedAt = Date.now()
    }
    const checkpointRoots = [...new Set(options.repositoryRoot ? [options.repositoryRoot] : activity.rows.map(row => row.checkoutRoot))]
    const checkpoints = options.handoverBase ? await Promise.all(checkpointRoots.slice(0, 12).map(async root => {
      try { return { root, ...await checkpointSummaries(root, options.handoverBase!) } }
      catch { return { root, rows: [], complete: false, error: 'Private checkpoint directory unavailable.' } }
    })) : []
    const selectedLinks = options.repositoryRoot ? links.filter(link => link.checkoutRoot === options.repositoryRoot) : links
    return { version: 1, activity, projects, tickets: dashboardTickets(activity.rows, selectedLinks), overlaps: dashboardOverlaps(activity.rows), checkpoints,
      checkpointScope: { enabled: !!options.handoverBase, rootsRequested: checkpointRoots.length, rootsRead: options.handoverBase ? Math.min(12, checkpointRoots.length) : 0 },
      girnel: { configured: !!options.girnelLinks, bindings: links.length, mode: 'explicit-file-metadata' },
    }
  } finally { store.close() }
}

/** Local owner view: no source excerpts, discovery, writes, inboxes or remote calls. */
export async function serveWorkspaceDashboard(workspace: string, cacheDirectory: string, options: DashboardOptions = {}) {
  // Refuse an invalid root/cache/catalogue/config before starting a listener.
  let snapshot = await readWorkspaceDashboard(workspace, cacheDirectory, options)
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2 * 1024 * 1024) throw new Error('dashboard snapshot exceeds 2 MiB; narrow with --repo')
  let cachedAt = Date.now(), pending: Promise<typeof snapshot> | undefined
  const prefix = '/' + randomBytes(24).toString('hex') + '/'
  const page = renderWorkspaceDashboard()
  let origin = ''
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    const fail = (code: number, message: string) => { response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end(message) }
    if (request.headers.host !== new URL(origin).host || (request.headers.origin !== undefined && request.headers.origin !== origin) || request.headers['sec-fetch-site'] === 'cross-site') return fail(403, 'Forbidden')
    if (request.method !== 'GET') return fail(405, 'Read-only dashboard')
    if (request.url === prefix) {
      response.setHeader('Content-Security-Policy', page.csp)
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page.html); return
    }
    if (request.url !== prefix + 'snapshot') return fail(404, 'Not found')
    try {
      if (Date.now() - cachedAt >= 5000) {
        if (!pending) pending = readWorkspaceDashboard(workspace, cacheDirectory, options).then(value => { snapshot = value; cachedAt = Date.now(); return value }).finally(() => { pending = undefined })
        await pending
      }
      const json = JSON.stringify(snapshot)
      if (Buffer.byteLength(json) > 2 * 1024 * 1024) throw new Error('snapshot too large')
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(json)
    } catch { fail(503, 'Observation failed. Previous data is stale; check the local cache and explicitly selected files.') }
  })
  server.maxConnections = 16; server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 1000
  await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); accept() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('dashboard listener unavailable')
  origin = 'http://127.0.0.1:' + address.port
  return { url: origin + prefix, close: () => new Promise<void>((accept, reject) => { server.close(error => error ? reject(error) : accept()); server.closeAllConnections() }) }
}

export async function runWorkspaceDashboardCli(args: string[]) {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    'cache-dir': { type: 'string' }, repo: { type: 'string' }, 'handover-base': { type: 'string' }, 'girnel-links': { type: 'string' },
  } })
  if (positionals.length !== 1 || !values['cache-dir']) throw new Error('workspace dashboard ROOT --cache-dir ABS [--repo ABS] [--handover-base ABS] [--girnel-links ABS]')
  const dashboard = await serveWorkspaceDashboard(positionals[0], values['cache-dir'], { repositoryRoot: values.repo, handoverBase: values['handover-base'], girnelLinks: values['girnel-links'] })
  const stop = () => {
    process.off('SIGINT', stop); process.off('SIGTERM', stop)
    void dashboard.close().catch(() => { process.exitCode = 1 })
  }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  return 'Z1P local dashboard: ' + dashboard.url + '\nRead-only; keep this private URL local. Press Ctrl-C to stop.\n'
}
