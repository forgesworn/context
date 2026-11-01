import { afterEach, expect, it, vi } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { RepositoryCoordination } from './repository-coordination.js'
import { discoverWorkspace, gitEnvironment, type WorkspaceCatalogue } from './workspace-catalogue.js'
import { initialiseWorkspaceStore, WorkspaceStore, workspaceKey } from './workspace-store.js'
import { readWorkspaceActivity } from './workspace-activity.js'

const exec = promisify(execFile)
const fixtures: { temporary: string; root: string; worktrees: string[]; store: WorkspaceStore }[] = []
const git = (root: string, args: string[]) => exec('git', ['-C', root, ...args], { env: gitEnvironment() })
afterEach(async () => {
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    f.store.close()
    for (const worktree of f.worktrees) await git(f.root, ['worktree', 'remove', worktree])
    await git(f.root, ['worktree', 'prune'])
    await rm(f.temporary, { recursive: true, force: true })
  }
})
async function fixture() {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'z1p-activity-api-')))
  const workspace = join(temporary, 'workspace'), cache = join(temporary, 'cache')
  const root = join(workspace, 'first'), unrelated = join(workspace, 'unrelated'), outside = join(temporary, 'outside')
  await mkdir(workspace)
  for (const directory of [root, unrelated]) {
    await mkdir(directory)
    await writeFile(join(directory, 'source.ts'), 'export const doNotReadSource = "private source"\n')
    await git(directory, ['init', '-q'])
    await git(directory, ['add', 'source.ts'])
    await git(directory, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  }
  const worktree = join(workspace, 'first-worktree')
  await git(root, ['worktree', 'add', '--detach', worktree])
  await initialiseWorkspaceStore(cache)
  const store = new WorkspaceStore(cache)
  const entry = { temporary, root, worktrees: [worktree], store }
  fixtures.push(entry)
  const catalogue = await discoverWorkspace(workspace, store)
  return { ...entry, workspace, cache, unrelated, worktree, outside, catalogue }
}
const publish = (coordination: RepositoryCoordination, root: string, slot: string, extra = {}) => coordination.update({
  expectedRoot: root, slot, label: slot, task: 'Implement activity API', paths: ['src/'], state: 'working', expectedRevision: 0, ttlSeconds: 900, ...extra,
})

it('reads real publications across two worktrees and an independent repo, preserving per-repo duplicate IDs', async () => {
  const f = await fixture(), shared = new RepositoryCoordination(f.store), other = new RepositoryCoordination(f.store)
  const first = await publish(shared, f.root, 'same'), linked = await publish(other, f.worktree, 'linked')
  const independent = await publish(shared, f.unrelated, 'same')
  expect(first.agent.agentId).toBe(independent.agent.agentId)
  const snapshot = await readWorkspaceActivity(f.workspace, f.store)
  expect(snapshot.complete).toBe(true)
  expect(snapshot.catalogueRoots).toBe(3)
  expect(snapshot.inspectedRoots).toBe(3)
  expect(snapshot.rows).toHaveLength(3)
  const main = snapshot.rows.find(row => row.checkoutRoot === f.root)!
  const worktree = snapshot.rows.find(row => row.agentId === linked.agent.agentId)!
  const unrelated = snapshot.rows.find(row => row.checkoutRoot === f.unrelated)!
  expect(main.groupId).toBe(worktree.groupId)
  expect(main.groupId).not.toBe(unrelated.groupId)
  expect(main.head).toBe(first.agent.checkout.head)
  expect(worktree.branch).toBeNull()
  expect(JSON.stringify(snapshot)).not.toContain('commonDirectory')
  expect(JSON.stringify(snapshot)).not.toContain('board:')
  expect(Object.keys(main).sort()).toEqual(['groupId', 'agentId', 'label', 'task', 'paths', 'state', 'revision', 'checkoutRoot', 'branch', 'head', 'updatedAt', 'expiresAt', 'active'].sort())
})

it('uses observed lease/state and exposes only coordination recent history when requested', async () => {
  const f = await fixture(), coordination = new RepositoryCoordination(f.store)
  await publish(coordination, f.root, 'expired', { ttlSeconds: 60 })
  await publish(coordination, f.worktree, 'done', { state: 'done' })
  await publish(coordination, f.unrelated, 'working', { ttlSeconds: 3600 })
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 61000)
  const active = await readWorkspaceActivity(f.workspace, f.store)
  expect(active.rows.map(row => row.label)).toEqual(['working'])
  const all = await readWorkspaceActivity(f.workspace, f.store, { includeInactive: true })
  expect(all.rows).toHaveLength(3)
  expect(all.rows.filter(row => !row.active).map(row => row.label).sort()).toEqual(['done', 'expired'])
  vi.mocked(Date.now).mockReturnValue(now + 2 * 86400_000)
  expect((await readWorkspaceActivity(f.workspace, f.store, { includeInactive: true })).rows).toEqual([])
})

it('filters to an exact saved checkout without admitting linked roots or unpublished discoveries', async () => {
  const f = await fixture(), coordination = new RepositoryCoordination(f.store)
  await publish(coordination, f.root, 'first')
  await publish(coordination, f.worktree, 'linked')
  const before = await readWorkspaceActivity(f.workspace, f.store, { repositoryRoot: f.worktree })
  expect(before.rows.map(row => row.checkoutRoot)).toEqual([f.worktree])
  await mkdir(f.outside)
  await git(f.outside, ['init', '-q'])
  await publish(coordination, f.outside, 'outside')
  await expect(readWorkspaceActivity(f.workspace, f.store, { repositoryRoot: f.outside })).rejects.toThrow(/exact canonical saved-catalogue/)
  await expect(readWorkspaceActivity(f.workspace, f.store, { repositoryRoot: f.root + '/' })).rejects.toThrow(/exact canonical saved-catalogue/)
})

it('excludes outside-workspace linked publications and surfaces catalogue skips as incomplete', async () => {
  const f = await fixture(), coordination = new RepositoryCoordination(f.store)
  await git(f.root, ['worktree', 'add', '--detach', f.outside]); f.worktrees.push(f.outside)
  await publish(coordination, f.root, 'in-scope')
  await publish(coordination, f.outside, 'outside')
  await discoverWorkspace(f.workspace, f.store)
  const snapshot = await readWorkspaceActivity(f.workspace, f.store)
  expect(snapshot.rows.map(row => row.label)).toEqual(['in-scope'])
  expect(snapshot.complete).toBe(false)
  expect(snapshot.stopReason).toBe('unavailable-roots')
  expect(snapshot.issues.some(issue => issue.root === f.outside)).toBe(true)
})

it('does not access inbox fields, source/index records or mutable store operations', async () => {
  const f = await fixture(), a = new RepositoryCoordination(f.store), b = new RepositoryCoordination(f.store)
  await publish(a, f.root, 'a'); const recipient = await publish(b, f.worktree, 'b')
  await a.send({ expectedRoot: f.root, slot: 'a', recipientAgentId: recipient.agent.agentId, messageId: randomUUID(), text: 'secret inbox note' })
  const before = await readFile(join(f.cache, 'workspace.sqlite'))
  const get = f.store.get.bind(f.store)
  vi.spyOn(f.store, 'get').mockImplementation(<T>(key: string): T | undefined => {
    expect(key.startsWith('catalogue:') || key.startsWith('board:')).toBe(true)
    const value = get<T>(key)
    if (key.startsWith('board:') && value) Object.defineProperty(value, 'notes', { get() { throw new Error('inbox must not be accessed') } })
    return value
  })
  for (const method of ['put', 'remove', 'transaction'] as const) vi.spyOn(f.store, method).mockImplementation(() => { throw new Error('read must not write') })
  // Changed source and source-controlled executable configuration remain untouched.
  await writeFile(join(f.root, 'source.ts'), 'throw new Error("never execute source")\n')
  const snapshot = await readWorkspaceActivity(f.workspace, f.store)
  expect(snapshot.rows).toHaveLength(2)
  expect(snapshot.complete).toBe(true)
  expect(JSON.stringify(snapshot)).not.toMatch(/secret inbox|private source|never execute/)
  expect(await readFile(join(f.cache, 'workspace.sqlite'))).toEqual(before)
  expect(f.store.info().indexes).toBe(0)
})

it('does not let a replacement at the same Git path borrow the previous board', async () => {
  const f = await fixture(), coordination = new RepositoryCoordination(f.store)
  await publish(coordination, f.unrelated, 'old-repository')
  await rename(f.unrelated, join(f.temporary, 'old-unrelated'))
  await mkdir(f.unrelated); await git(f.unrelated, ['init', '-q'])
  expect((await readWorkspaceActivity(f.workspace, f.store)).rows).toEqual([])
  await publish(coordination, f.unrelated, 'new-repository')
  expect((await readWorkspaceActivity(f.workspace, f.store)).rows.map(row => row.label)).toEqual(['new-repository'])
})

it('marks missing/noncanonical catalogue checkouts incomplete while keeping other rows', async () => {
  const f = await fixture(), coordination = new RepositoryCoordination(f.store)
  await publish(coordination, f.root, 'available')
  await rename(f.unrelated, join(f.temporary, 'moved-unrelated'))
  const missing = await readWorkspaceActivity(f.workspace, f.store)
  expect(missing.rows.map(row => row.label)).toEqual(['available'])
  expect(missing.stopReason).toBe('unavailable-roots')
  expect(missing.issues[0].root).toBe(f.unrelated)
  await symlink(join(f.temporary, 'moved-unrelated'), f.unrelated)
  expect((await readWorkspaceActivity(f.workspace, f.store)).stopReason).toBe('unavailable-roots')
})

it('validates canonical workspaces, saved catalogue presence and numeric bounds without discovery', async () => {
  const f = await fixture()
  await expect(readWorkspaceActivity(f.workspace + '/', f.store)).rejects.toThrow(/canonical/)
  await expect(readWorkspaceActivity('relative', f.store)).rejects.toThrow(/canonical/)
  const alias = join(f.temporary, 'alias'); await symlink(f.workspace, alias)
  await expect(readWorkspaceActivity(alias, f.store)).rejects.toThrow(/canonical/)
  for (const options of [{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { maxBytes: 2047 }, { maxBytes: 262145 }, { timeoutMs: 0 }, { timeoutMs: 30001 }]) {
    await expect(readWorkspaceActivity(f.workspace, f.store, options)).rejects.toThrow(/integer/)
  }
  f.store.remove(workspaceKey('catalogue', f.workspace))
  await expect(readWorkspaceActivity(f.workspace, f.store)).rejects.toThrow(/no saved workspace catalogue.*discover/)
  expect(f.store.has(workspaceKey('catalogue', f.workspace))).toBe(false)
})

it('bounds full encoded JSON, advertises oversized rows and stops at the selected row count', async () => {
  const f = await fixture(), coordination = new RepositoryCoordination(f.store)
  await publish(coordination, f.root, 'large', { task: '😀'.repeat(500), paths: Array.from({ length: 16 }, (_, i) => `src/${i}-${'a'.repeat(240)}`) })
  const bounded = await readWorkspaceActivity(f.workspace, f.store, { maxBytes: 2048 })
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(2048)
  expect(bounded.stopReason).toBe('max-bytes')
  expect(bounded.complete).toBe(false)
  expect(bounded.rows).toEqual([])
  expect(bounded.minimumBytesRequired).toBeGreaterThan(2048)
  const enough = await readWorkspaceActivity(f.workspace, f.store, { maxBytes: bounded.minimumBytesRequired })
  expect(enough.rows).toHaveLength(1)
  expect(enough.complete).toBe(true)
  await publish(coordination, f.unrelated, 'second')
  const limited = await readWorkspaceActivity(f.workspace, f.store, { limit: 1 })
  expect(limited.rows).toHaveLength(1)
  expect(limited.stopReason).toBe('max-rows')
  expect(limited.complete).toBe(false)
})

it('paginates a full coordination board without duplicating linked-worktree rows', async () => {
  const f = await fixture(), coordination = new RepositoryCoordination(f.store)
  for (let i = 0; i < 30; i++) await publish(coordination, i % 2 ? f.root : f.worktree, `agent-${i}`, { task: 'x'.repeat(1000), paths: ['src/' + 'x'.repeat(500)] })
  const snapshot = await readWorkspaceActivity(f.workspace, f.store, { maxBytes: 262144 })
  expect(snapshot.complete).toBe(true)
  expect(snapshot.rows).toHaveLength(30)
  expect(new Set(snapshot.rows.map(row => row.agentId)).size).toBe(30)
})

it('bounds issue metadata as well as rows and marks a soft deadline incomplete', async () => {
  const f = await fixture()
  const catalogue = f.store.get<WorkspaceCatalogue>(workspaceKey('catalogue', f.workspace))!
  catalogue.skipped = Array.from({ length: 30 }, (_, i) => ({ path: join(f.workspace, `missing-${i}`), reason: 'unavailable '.repeat(30) }))
  f.store.put(workspaceKey('catalogue', f.workspace), 'catalogue', catalogue)
  const bounded = await readWorkspaceActivity(f.workspace, f.store, { maxBytes: 2048 })
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(2048)
  expect(bounded.stopReason).toBe('max-bytes')
  expect(bounded.issues.length).toBeLessThan(30)
  const get = f.store.get.bind(f.store)
  vi.spyOn(f.store, 'get').mockImplementation(<T>(key: string): T | undefined => {
    const end = performance.now() + 5
    while (performance.now() < end) { /* bounded simulated synchronous store latency */ }
    return get<T>(key)
  })
  const deadline = await readWorkspaceActivity(f.workspace, f.store, { timeoutMs: 1 })
  expect(deadline.stopReason).toBe('deadline')
  expect(deadline.complete).toBe(false)
})
