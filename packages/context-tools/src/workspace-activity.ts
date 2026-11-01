import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import { performance } from 'node:perf_hooks'
import { RepositoryCoordination } from './repository-coordination.js'
import { git, type WorkspaceCatalogue } from './workspace-catalogue.js'
import { workspaceKey, type WorkspaceStore } from './workspace-store.js'
import type { WorkspaceActivityOptions, WorkspaceActivityRow, WorkspaceActivitySnapshot } from './workspace-activity-types.js'

type Activity = Awaited<ReturnType<RepositoryCoordination['read']>>['agents'][number]
type ActivityBoard = { version: 1; revision: number; agents: Record<string, Activity> }
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
const within = (workspace: string, root: string) => {
  const path = relative(workspace, root)
  return path === '' || (path !== '..' && !path.startsWith('../') && !isAbsolute(path))
}
function integer(value: number | undefined, fallback: number, min: number, max: number, name: string) {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${name} must be an integer from ${min} to ${max}`)
  return result
}

/** One-shot advisory metadata from the saved catalogue, never live source or process proof.
 * Git inspection uses the same non-executing metadata commands as coordination.
 * The timeout is soft: an already running Git/store operation can finish after it. */
export async function readWorkspaceActivity(workspace: string, store: WorkspaceStore, options: WorkspaceActivityOptions = {}): Promise<WorkspaceActivitySnapshot> {
  const limit = integer(options.limit, 100, 1, 500, 'limit')
  const maxBytes = integer(options.maxBytes, 65536, 2048, 262144, 'maxBytes')
  const timeoutMs = integer(options.timeoutMs, 30000, 1, 30000, 'timeoutMs')
  if (options.includeInactive !== undefined && typeof options.includeInactive !== 'boolean') throw new Error('includeInactive must be a boolean')
  const deadline = performance.now() + timeoutMs
  if (typeof workspace !== 'string' || !isAbsolute(workspace) || await realpath(workspace) !== workspace || !(await lstat(workspace)).isDirectory()) {
    throw new Error('workspace must be a canonical absolute directory')
  }
  const catalogue = store.get<WorkspaceCatalogue>(workspaceKey('catalogue', workspace))
  if (!catalogue) throw new Error('no saved workspace catalogue; run workspace discover first')
  if (catalogue.version !== 1 || catalogue.workspace !== workspace || !Array.isArray(catalogue.repositories) || catalogue.repositories.length > 2000 || !Array.isArray(catalogue.skipped) || catalogue.skipped.length > 10000) {
    throw new Error('invalid or oversized saved workspace catalogue; discover again explicitly')
  }
  const filter = options.repositoryRoot
  if (filter !== undefined && (typeof filter !== 'string' || !isAbsolute(filter) || !catalogue.repositories.some(repo => repo.root === filter) || !within(workspace, filter))) {
    throw new Error('repositoryRoot must be an exact canonical saved-catalogue checkout root in this workspace')
  }
  const result: WorkspaceActivitySnapshot = {
    version: 1, workspace, observedAt: Date.now(), catalogueDiscoveredAt: catalogue.discoveredAt,
    catalogueRoots: catalogue.repositories.length, inspectedRoots: 0, rows: [], issues: [],
    complete: true, stopReason: 'complete', minimumBytesRequired: 0,
  }
  if (bytes(result) + 64 > maxBytes) throw new Error(`maxBytes cannot fit snapshot metadata; minimumBytesRequired=${bytes(result) + 64}`)
  const stop = (reason: WorkspaceActivitySnapshot['stopReason']) => { result.complete = false; result.stopReason = reason }
  const expired = () => {
    if (performance.now() < deadline) return false
    stop('deadline'); return true
  }
  // Reserve bytes for the final stop reason, booleans and minimum-byte count.
  const fits = () => bytes(result) + 64 <= maxBytes
  const issue = (root: string, reason: string) => {
    result.issues.push({ root, reason })
    if (fits()) return true
    result.minimumBytesRequired = Math.max(result.minimumBytesRequired, bytes(result) + 64)
    result.issues.pop(); stop('max-bytes'); return false
  }
  const verified = new Map<string, { key: string; commonDirectory: string }>()
  const groups = new Map<string, string>()
  for (const skipped of catalogue.skipped) {
    if (expired()) break
    if (filter !== undefined && skipped.path !== filter) continue
    if (!issue(skipped.path, 'saved catalogue skipped root: ' + skipped.reason)) break
  }
  if (result.stopReason === 'complete') {
    const candidates = catalogue.repositories.filter(saved => filter === undefined || saved.root === filter)
    type Verified = { root: string; key?: string; commonDirectory?: string; reason?: string }
    const outcomes: (Verified | undefined)[] = new Array(candidates.length)
    let next = 0
    // Bound concurrent metadata subprocesses. Branch/HEAD are published reports,
    // so checking identity needs only top-level and common-directory queries.
    const worker = async () => {
      while (next < candidates.length && !expired()) {
        const index = next++, saved = candidates[index]
        result.inspectedRoots++
        if (!within(workspace, saved.root)) { outcomes[index] = { root: saved.root, reason: 'saved checkout is outside the selected workspace' }; continue }
        try {
          if (!isAbsolute(saved.root) || await realpath(saved.root) !== saved.root || await git(saved.root, ['rev-parse', '--show-toplevel']) !== saved.root) throw new Error('non-canonical checkout')
          const commonDirectory = await realpath(await git(saved.root, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
          if (commonDirectory !== saved.commonDirectory) throw new Error('changed Git identity')
          const identity = await lstat(commonDirectory)
          if (!identity.isDirectory()) throw new Error('unavailable Git directory')
          const key = workspaceKey('board', commonDirectory + '\0' + identity.dev + ':' + identity.ino)
          outcomes[index] = { root: saved.root, key, commonDirectory }
        } catch { outcomes[index] = { root: saved.root, reason: 'checkout unavailable, non-canonical or Git identity changed' } }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker))
    for (const outcome of outcomes) {
      if (!outcome) continue
      if (outcome.reason) { if (!issue(outcome.root, outcome.reason)) break; continue }
      verified.set(outcome.root, { key: outcome.key!, commonDirectory: outcome.commonDirectory! })
      if (!groups.has(outcome.key!)) groups.set(outcome.key!, outcome.root)
    }
  }
  if (result.stopReason === 'complete') boardLoop: for (const [key, root] of groups) {
    if (expired()) break
    try {
      // Boards are encrypted units, so decryption necessarily includes their stored
      // payload. Do not access inbox fields: expose only agents to the existing
      // coordination reader, with an empty notes projection and no write methods.
      const board = store.get<ActivityBoard>(key)
      if (!board) continue
      if (board && (board.version !== 1 || !board.agents || Object.keys(board.agents).length > 128)) throw new Error('invalid activity board')
      const activityStore = {
        get: <T>(requested: string): T | undefined => {
          if (requested !== key) throw new Error('Git identity changed while reading activity')
          return board ? { version: board.version, revision: board.revision, sequence: 0, agents: board.agents, notes: [] } as T : undefined
        },
      } as WorkspaceStore
      const coordination = new RepositoryCoordination(activityStore)
      let offset = 0
      // Coordination caps boards at 128 agents. A progressing offset bounds pages;
      // oversized/non-progressing pages terminate without retries.
      for (let pageNumber = 0; pageNumber < 129; pageNumber++) {
        if (expired()) break boardLoop
        const page = await coordination.read({ expectedRoot: root, afterMessage: 0, offset, maxBytes: 65536 })
        if (expired()) break boardLoop
        for (const agent of page.agents) {
          const checkout = verified.get(agent.checkout.root)
          if (!checkout || checkout.key !== key || agent.checkout.commonDirectory !== checkout.commonDirectory) continue
          const active = agent.expiresAt > result.observedAt && agent.state !== 'done'
          if (!active && !options.includeInactive) continue
          if (result.rows.length >= limit) { stop('max-rows'); break boardLoop }
          const row: WorkspaceActivityRow = {
            groupId: workspaceKey('activity-group', key), agentId: agent.agentId, label: agent.label,
            task: agent.task, paths: agent.paths, state: agent.state, revision: agent.revision,
            checkoutRoot: agent.checkout.root, branch: agent.checkout.branch, head: agent.checkout.head,
            updatedAt: agent.updatedAt, expiresAt: agent.expiresAt, active,
          }
          result.rows.push(row)
          if (!fits()) {
            result.minimumBytesRequired = Math.max(result.minimumBytesRequired, bytes(result) + 64)
            result.rows.pop(); stop('max-bytes'); break boardLoop
          }
        }
        if (page.agentsComplete) break
        if (page.nextOffset <= offset) {
          result.minimumBytesRequired = Math.max(result.minimumBytesRequired, page.minimumBytesRequired)
          stop('max-bytes'); break boardLoop
        }
        offset = page.nextOffset
      }
    } catch {
      if (!issue(root, 'activity board unavailable or Git identity changed during read')) break
    }
  }
  if (result.stopReason === 'complete' && result.issues.length) stop('unavailable-roots')
  return result
}
