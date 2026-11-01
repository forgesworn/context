import type { WorkspaceActivityRow, WorkspaceActivitySnapshot } from './workspace-activity-types.js'

/** Owner-facing text view of a workspace activity snapshot. Every displayed
 * string is untrusted task metadata: control, bidi and line-break characters are
 * shown as visible escapes, and long fields are truncated with a marker. Use the
 * JSON snapshot for full detail. */
export interface RenderWorkspaceActivityOptions {
  /** Shown rows; additional rows are summarised. Default 100. */
  maxRows?: number
  /** Shown issue lines; additional issues are summarised. Default 20. */
  maxIssues?: number
  /** Whether the snapshot was requested with expired leases included (--all). */
  includeInactive?: boolean
}

const CAPS = { state: 9, task: 48, checkout: 48, reported: 32, files: 48, updated: 17, expires: 16 } as const
const TRUNCATED = '\u2026'

// C0/C1 controls, DEL, line/paragraph separators, bidi embeddings/overrides/
// isolates/marks, zero-width and invisible format characters, and BOM.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|[\ud800-\udfff]/gu
const NAMED: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\u001b': '\\e' }

/** Returns a single-line, terminal-inert representation of untrusted text. */
export function escapeTerminalText(value: string): string {
  return value.replace(UNSAFE, char => NAMED[char] ?? '\\u{' + char.codePointAt(0)!.toString(16).padStart(4, '0') + '}')
}

function truncate(value: string, max: number): string {
  const points = Array.from(value)
  return points.length <= max ? value : points.slice(0, Math.max(1, max - 1)).join('') + TRUNCATED
}

function field(value: string, max: number): string { return truncate(escapeTerminalText(value), max) }

function width(value: string): number { return Array.from(value).length }

function iso(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'unknown'
  return new Date(ms).toISOString().slice(0, 16) + 'Z'
}

function span(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 120) return minutes + 'm'
  const hours = Math.round(minutes / 60)
  return hours < 48 ? hours + 'h' : Math.round(hours / 24) + 'd'
}

function expiry(row: WorkspaceActivityRow, observedAt: number): string {
  const delta = row.expiresAt - observedAt
  if (!row.active && delta > 0) return 'inactive'
  if (delta <= 0) return 'expired ' + span(delta) + ' ago'
  return 'in ' + span(delta)
}

function files(paths: string[]): string {
  if (paths.length === 0) return '(none)'
  const escaped = paths.map(escapeTerminalText), full = escaped.join(', ')
  if (width(full) <= CAPS.files) return full
  const more = (shown: number) => shown < escaped.length ? ` +${escaped.length - shown} more` : ''
  let shown = 0, used = 0
  while (shown < escaped.length) {
    const next = used + (shown > 0 ? 2 : 0) + width(escaped[shown])
    if (next + width(more(shown + 1)) > CAPS.files) break
    used = next; shown++
  }
  if (shown === 0) return truncate(escaped[0], CAPS.files - width(more(1))) + more(1)
  return escaped.slice(0, shown).join(', ') + more(shown)
}

function reported(row: WorkspaceActivityRow): string {
  const branch = row.branch === null ? '(detached)' : field(row.branch, CAPS.reported - 13)
  const head = row.head === null ? 'no HEAD' : field(row.head, 12)
  return branch + '@' + head
}

function agent(row: WorkspaceActivityRow): string {
  const slot = row.agentId.includes('/') ? row.agentId.slice(row.agentId.lastIndexOf('/') + 1) : row.agentId
  return field(row.label, 28) + ' [' + field(slot, 20) + ']'
}

const STOP: Record<WorkspaceActivitySnapshot['stopReason'], string> = {
  complete: 'complete',
  'max-rows': 'stopped at the row limit; raise --limit (up to 500)',
  'max-bytes': 'stopped at the byte budget; raise --max-bytes (up to 262144)',
  deadline: 'stopped at the time limit; raise --timeout-ms (up to 30000) or narrow with --repo',
  'unavailable-roots': 'some checkout boards could not be read',
}

export function renderWorkspaceActivity(snapshot: WorkspaceActivitySnapshot, options: RenderWorkspaceActivityOptions = {}): string {
  const maxRows = options.maxRows ?? 100, maxIssues = options.maxIssues ?? 20
  const lines: string[] = []
  lines.push(`Workspace activity: ${field(snapshot.workspace, 120)}`)
  lines.push(`Observed ${iso(snapshot.observedAt)}; saved catalogue ${snapshot.catalogueDiscoveredAt > 0 ? 'from ' + iso(snapshot.catalogueDiscoveredAt) : 'absent'}, ${snapshot.catalogueRoots} checkout(s), ${snapshot.inspectedRoots} inspected.`)
  lines.push(options.includeInactive ? 'View: all retained leases, including finished and expired (inactive) ones.' : 'View: active leases only; use --all to include finished and expired (inactive) leases.')
  lines.push('Active means an unexpired advisory lease. It does not prove a running process, current source or acceptance.')
  lines.push('Branch and HEAD are as published by each agent, not the checkout\'s current state.')
  if (!snapshot.complete) {
    lines.push(`INCOMPLETE: ${Object.hasOwn(STOP, snapshot.stopReason) ? STOP[snapshot.stopReason] : field(String(snapshot.stopReason), 40)}.`)
    if (snapshot.minimumBytesRequired > 0) lines.push(`An item needs at least --max-bytes ${snapshot.minimumBytesRequired}.`)
  }
  if (snapshot.issues.length > 0) {
    lines.push(`Issues (${snapshot.issues.length}):`)
    for (const issue of snapshot.issues.slice(0, maxIssues)) lines.push(`  ${field(issue.root, 80)}: ${field(issue.reason, 120)}`)
    if (snapshot.issues.length > maxIssues) lines.push(`  +${snapshot.issues.length - maxIssues} more issue(s); use --json.`)
  }
  lines.push('')
  if (snapshot.rows.length === 0) {
    lines.push(snapshot.complete ? `No ${options.includeInactive ? 'retained' : 'active'} agent leases in this view.` : 'No agent leases returned before the view stopped.')
    if (!snapshot.complete || snapshot.issues.length > 0) lines.push('An empty or partial view does not show that no agent is working.')
    lines.push(options.includeInactive ? 'Use --json for the full snapshot.' : 'Use --all to include finished and expired leases, or --json for the full snapshot.')
    return lines.join('\n') + '\n'
  }
  const header = ['AGENT', 'STATE', 'TASK', 'CHECKOUT', 'REPORTED BRANCH@HEAD', 'INTENDED FILES', 'UPDATED (UTC)', 'LEASE']
  const table = snapshot.rows.slice(0, maxRows).map(row => [
    agent(row),
    row.active ? field(row.state, CAPS.state) : 'inactive',
    field(row.task, CAPS.task),
    field(row.checkoutRoot, CAPS.checkout),
    reported(row),
    files(row.paths),
    iso(row.updatedAt),
    expiry(row, snapshot.observedAt),
  ])
  const widths = header.map((title, index) => Math.max(width(title), ...table.map(cells => width(cells[index]))))
  const format = (cells: string[]) => cells.map((cell, index) => index === cells.length - 1 ? cell : cell + ' '.repeat(widths[index] - width(cell))).join('  ').trimEnd()
  lines.push(format(header))
  for (const cells of table) lines.push(format(cells))
  if (snapshot.rows.length > maxRows) lines.push(`+${snapshot.rows.length - maxRows} more row(s); use --json.`)
  lines.push('')
  const active = snapshot.rows.filter(row => row.active).length
  lines.push(`${snapshot.rows.length} row(s), ${active} active${active < snapshot.rows.length ? `, ${snapshot.rows.length - active} inactive (finished or expired lease)` : ''}. Long fields end in ${TRUNCATED}; use --json for full detail.`)
  return lines.join('\n') + '\n'
}
