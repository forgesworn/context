/** Owner-visible advisory activity. Published checkout/branch/HEAD are reports,
 * not current source freshness, process liveness or acceptance. No inbox notes. */
export interface WorkspaceActivityRow {
  groupId: string
  agentId: string
  label: string
  task: string
  paths: string[]
  state: 'working' | 'blocked' | 'reviewing' | 'done'
  revision: number
  checkoutRoot: string
  branch: string | null
  head: string | null
  updatedAt: number
  expiresAt: number
  active: boolean
}
export interface WorkspaceActivityOptions {
  includeInactive?: boolean
  repositoryRoot?: string
  limit?: number
  maxBytes?: number
  timeoutMs?: number
}
export interface WorkspaceActivitySnapshot {
  version: 1
  workspace: string
  observedAt: number
  catalogueDiscoveredAt: number
  catalogueRoots: number
  inspectedRoots: number
  rows: WorkspaceActivityRow[]
  issues: { root: string; reason: string }[]
  complete: boolean
  stopReason: 'complete' | 'max-rows' | 'max-bytes' | 'deadline' | 'unavailable-roots'
  minimumBytesRequired: number
}
