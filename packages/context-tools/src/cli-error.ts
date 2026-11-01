import { escapeTerminalText } from './workspace-activity-render.js'

/** One bounded, terminal-inert diagnostic line, including filesystem paths. */
export function formatCliError(error: unknown): string {
  const prefix = 'encrypted-context: ', maximum = 4096
  const safe = escapeTerminalText(error instanceof Error ? error.message : 'operation failed')
  const budget = maximum - Buffer.byteLength(prefix + '…\n')
  let text = '', used = 0, truncated = false
  for (const point of safe) {
    const next = Buffer.byteLength(point)
    if (used + next > budget) { truncated = true; break }
    text += point; used += next
  }
  return prefix + text + (truncated ? '…' : '') + '\n'
}
