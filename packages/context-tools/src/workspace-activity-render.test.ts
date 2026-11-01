import { expect, it } from 'vitest'
import { escapeTerminalText, renderWorkspaceActivity } from './workspace-activity-render.js'
import type { WorkspaceActivityRow, WorkspaceActivitySnapshot } from './workspace-activity-types.js'

const observedAt = Date.UTC(2026, 10, 1, 12, 0)
function row(overrides: Partial<WorkspaceActivityRow> = {}): WorkspaceActivityRow {
  return { groupId: 'g1', agentId: 'session-a/cli-slot', label: 'Claude / activity CLI', task: 'Render activity view', paths: ['src/a.ts', 'docs/b.md'],
    state: 'working', revision: 2, checkoutRoot: '/work/context', branch: 'feat/view', head: '0123456789abcdef0123', updatedAt: observedAt - 5 * 60_000,
    expiresAt: observedAt + 40 * 60_000, active: true, ...overrides }
}
function snapshot(overrides: Partial<WorkspaceActivitySnapshot> = {}): WorkspaceActivitySnapshot {
  return { version: 1, workspace: '/work', observedAt, catalogueDiscoveredAt: observedAt - 3_600_000, catalogueRoots: 3, inspectedRoots: 3,
    rows: [row()], issues: [], complete: true, stopReason: 'complete', minimumBytesRequired: 0, ...overrides }
}

it('renders populated rows as columns with reported branch/HEAD, files, update time and lease expiry', () => {
  const text = renderWorkspaceActivity(snapshot())
  const lines = text.split('\n')
  const header = lines.findIndex(line => line.startsWith('AGENT'))
  expect(lines[header]).toMatch(/AGENT +STATE +TASK +CHECKOUT +REPORTED BRANCH@HEAD +INTENDED FILES +UPDATED \(UTC\) +LEASE/)
  const body = lines[header + 1]
  expect(body).toContain('Claude / activity CLI [cli-slot]')
  expect(body).toContain('working')
  expect(body).toContain('/work/context')
  expect(body).toContain('feat/view@0123456789a\u2026')
  expect(body).toContain('src/a.ts, docs/b.md')
  expect(body).toContain('2026-11-01T11:55Z')
  expect(body).toContain('in 40m')
  expect(text).toContain('View: active leases only')
  expect(text).toContain('does not prove a running process, current source or acceptance')
  expect(text).toContain('as published by each agent')
  expect(text).toContain('1 row(s), 1 active.')
  expect(text).not.toContain('INCOMPLETE')
})

it('reports an empty complete view without implying nobody is working, and adapts the hint to --all', () => {
  const empty = renderWorkspaceActivity(snapshot({ rows: [] }))
  expect(empty).toContain('No active agent leases in this view.')
  expect(empty).toContain('Use --all to include finished and expired leases')
  expect(empty).not.toContain('AGENT')
  const all = renderWorkspaceActivity(snapshot({ rows: [] }), { includeInactive: true })
  expect(all).toContain('No retained agent leases in this view.')
  expect(all).not.toContain('Use --all')
})

it('labels expired leases inactive rather than showing their last state', () => {
  const text = renderWorkspaceActivity(snapshot({ rows: [row(), row({ agentId: 's/old', state: 'working', active: false, expiresAt: observedAt - 3 * 3_600_000, branch: null, head: null })] }), { includeInactive: true })
  const old = text.split('\n').find(line => line.includes('[old]'))!
  expect(old).toContain('inactive')
  expect(old).not.toMatch(/\bworking\b/)
  expect(old).toContain('(detached)@no HEAD')
  expect(old).toContain('expired 3h ago')
  expect(text).toContain('View: all retained leases')
  expect(text).toContain('2 row(s), 1 active, 1 inactive (finished or expired lease).')
})

it('surfaces incomplete scope, the byte requirement and issues, and does not treat a partial empty view as quiet', () => {
  const text = renderWorkspaceActivity(snapshot({ rows: [], complete: false, stopReason: 'max-bytes', minimumBytesRequired: 9000,
    inspectedRoots: 1, issues: Array.from({ length: 3 }, (_, i) => ({ root: `/work/r${i}`, reason: 'unavailable Git directory' })) }), { maxIssues: 2 })
  expect(text).toContain('INCOMPLETE: stopped at the byte budget; raise --max-bytes')
  expect(text).toContain('at least --max-bytes 9000')
  expect(text).toContain('Issues (3):')
  expect(text).toContain('/work/r0: unavailable Git directory')
  expect(text).not.toContain('/work/r2')
  expect(text).toContain('+1 more issue(s); use --json.')
  expect(text).toContain('No agent leases returned before the view stopped.')
  expect(text).toContain('does not show that no agent is working')
  for (const reason of ['max-rows', 'deadline', 'unavailable-roots'] as const)
    expect(renderWorkspaceActivity(snapshot({ complete: false, stopReason: reason }))).toContain('INCOMPLETE: ')
})

it('truncates long fields and path lists with visible markers and summarises extra rows', () => {
  const text = renderWorkspaceActivity(snapshot({ rows: [row({ task: 'x'.repeat(500), paths: Array.from({ length: 30 }, (_, i) => `packages/some/deep/file-${i}.ts`) }), row({ agentId: 's/two' })] }), { maxRows: 1 })
  const body = text.split('\n').find(line => line.includes('[cli-slot]'))!
  expect(body).toContain('x'.repeat(47) + '\u2026')
  expect(body).not.toContain('x'.repeat(48))
  expect(body).toMatch(/\+2\d more/)
  expect(text).not.toContain('[two]')
  expect(text).toContain('+1 more row(s); use --json.')
  expect(text).toContain('use --json for full detail')
})

it('neutralises terminal escapes, bidi controls and line breaks in every displayed field', () => {
  const hostile = 'ok\u001b]52;c;AAAA\u0007\u001b[2J\r\nFAKE ROW\u202ereversed\u2066\u200b\u2028\u0085\u009b31m'
  const text = renderWorkspaceActivity(snapshot({ workspace: '/w' + hostile, rows: [row({ label: hostile, agentId: 's/' + hostile, task: hostile, paths: [hostile],
    checkoutRoot: '/c' + hostile, branch: hostile, head: hostile, state: hostile as WorkspaceActivityRow['state'] })],
  issues: [{ root: hostile, reason: hostile }], complete: false, stopReason: hostile as WorkspaceActivitySnapshot['stopReason'] }))
  expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/)
  expect(text.split('\n').every(line => !line.startsWith('FAKE ROW'))).toBe(true)
  expect(escapeTerminalText(hostile)).toBe('ok\\e]52;c;AAAA\\u{0007}\\e[2J\\r\\nFAKE ROW\\u{202e}reversed\\u{2066}\\u{200b}\\u{2028}\\u{0085}\\u{009b}31m')
  expect(escapeTerminalText('caf\u00e9 \u{1F600} /plain/path')).toBe('caf\u00e9 \u{1F600} /plain/path')
  expect(escapeTerminalText('lone\ud800')).toBe('lone\\u{d800}')
})
