#!/usr/bin/env node
// What each executor session showed the model, and how much of the source it read
// was near anything it later cited or changed. Model-free; reads recorded cells.
//
//   node read-volume.mjs PLAN_DIR [PLAN_DIR ...]
//
// Bytes are tool-result text by kind: navigation (Context search/explore/status/
// refresh/coverage), packet (Context source), shell search (rg, grep, find, ls),
// shell read (cat, sed, nl, head, tail, awk) and shell other (tests, builds, edits).
// Source lines read are packet ranges plus shell read ranges; "used" means within
// USE_MARGIN lines of an answer evidence range or a changed (diff) range in the same
// file. A heuristic for where retrieval went, not a quality measure.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseEvents, packetRanges, analyse } from './metrics.mjs'

const USE_MARGIN = 15

function usedRanges(cell) {
  const used = []
  try {
    const answer = JSON.parse(readFileSync(join(cell, 'workspace', 'answer.json'), 'utf8'))
    for (const e of answer.evidence ?? []) if (typeof e?.path === 'string') used.push({ path: e.path.replace(/^\.\//, ''), start: e.startLine ?? 1, end: e.endLine ?? e.startLine ?? 1 })
  } catch { /* no answer */ }
  if (existsSync(join(cell, 'executor.diff'))) {
    let file = null
    for (const line of readFileSync(join(cell, 'executor.diff'), 'utf8').split('\n')) {
      const f = /^--- a\/(.+)$/.exec(line); if (f) { file = f[1]; continue }
      const h = /^@@ -(\d+)(?:,(\d+))? /.exec(line)
      if (h && file) used.push({ path: file, start: Number(h[1]), end: Number(h[1]) + Math.max(Number(h[2] ?? 1), 1) - 1 })
    }
  }
  return used
}

function cellStats(cell) {
  const ex = JSON.parse(readFileSync(join(cell, 'executor.json'), 'utf8'))
  const root = (ex.activeRoot ?? '') + '/workspace'
  const events = parseEvents(readFileSync(join(cell, 'executor-events.jsonl'), 'utf8'))
  const bytes = { navigation: 0, packet: 0, shellSearch: 0, shellRead: 0, shellOther: 0 }
  const counts = { navigation: 0, packet: 0, shellSearch: 0, shellRead: 0, shellOther: 0 }
  const read = [] // {path, start, end, via}
  for (const e of events) {
    if (e.type !== 'item.completed') continue
    const it = e.item ?? {}
    if (it.type === 'mcp_tool_call') {
      const text = (it.result?.content ?? []).map(c => c?.text ?? '').join('')
      const kind = it.tool === 'repository_packet' ? 'packet' : 'navigation'
      bytes[kind] += text.length; counts[kind]++
      if (kind === 'packet') for (const r of packetRanges(it, root)) read.push({ ...r, via: 'packet' })
    } else if (it.type === 'command_execution') {
      const out = it.aggregated_output ?? ''
      const a = analyse(it.command ?? '', root)
      const kind = a.reads.length ? 'shellRead' : a.searches ? 'shellSearch' : 'shellOther'
      bytes[kind] += out.length; counts[kind]++
      if (kind === 'shellRead') {
        const lines = out.split('\n').length
        for (const r of a.reads) read.push({ path: r.path, start: r.start ?? 1, end: r.end ?? (r.start ?? 1) + lines - 1, via: 'shell' })
      }
    }
  }
  const used = usedRanges(cell)
  const near = (path, n) => used.some(u => u.path === path && n >= u.start - USE_MARGIN && n <= u.end + USE_MARGIN)
  const lines = { packet: new Set(), shell: new Set() }
  for (const r of read) for (let n = r.start; n <= Math.min(r.end, r.start + 5000); n++) lines[r.via].add(`${r.path}:${n}`)
  const all = new Set([...lines.packet, ...lines.shell])
  const usedCount = s => [...s].filter(k => { const i = k.lastIndexOf(':'); return near(k.slice(0, i), Number(k.slice(i + 1))) }).length
  return { tokens: ex.usage?.total, bytes, counts, linesRead: { packet: lines.packet.size, shell: lines.shell.size, distinct: all.size },
           linesNearUse: { packet: usedCount(lines.packet), shell: usedCount(lines.shell), distinct: usedCount(all) }, usedRanges: used.length }
}

for (const plan of process.argv.slice(2)) {
  const sched = JSON.parse(readFileSync(join(plan, 'schedule.json'), 'utf8'))
  for (const c of sched.cells) {
    const cell = join(plan, c.directory)
    if (!existsSync(join(cell, 'executor-events.jsonl'))) continue
    console.log(JSON.stringify({ plan: plan.split('/').at(-1), arm: c.arm, ...cellStats(cell) }))
  }
}
