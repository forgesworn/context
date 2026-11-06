// Replay the recorded pre-edit plan requests from OS2 Context cells through the
// two builds of the planner (OLD and NEW source-packet.mjs), against h3 at the task base.
// Model-free. Reports errors, returned line ranges and whether each later
// build request's lines were already in an earlier plan response (covered/requested).
//   node plan-replay.mjs ROOT OLD_SOURCE_PACKET NEW_SOURCE_PACKET CELL.jsonl...
import { readFileSync } from 'node:fs'

const [root, oldPath, newPath, ...cells] = process.argv.slice(2)
const oldMod = await import(oldPath)
const newMod = await import(newPath)
const defaults = (spec) => ({ version: 1, task: spec.task?.trim() || 'read exact source', acceptanceChecks: spec.acceptanceChecks?.length ? spec.acceptanceChecks : ['cite exact source lines'],
  allowedFiles: spec.allowedFiles ?? [], exclusions: spec.exclusions ?? [], unresolvedQuestions: spec.unresolvedQuestions ?? [], sources: spec.sources })

async function plan(mod, spec) {
  try {
    const { packet, coverage } = await mod.planPacketInline({ root, spec: defaults(spec) })
    return { ok: true, ranges: packet.sources.map((s) => [s.path, s.startLine, s.endLine]), lines: packet.sources.reduce((n, s) => n + s.lines.length, 0), unresolved: coverage.unresolved?.length ?? 0, included: coverage.included?.length ?? 0 }
  } catch (error) { return { ok: false, error: error.message.replace(/^worker-packet: /, '').slice(0, 110) } }
}
// Lines of path:start-end already returned by an earlier plan, as covered/requested.
const covers = (ranges, path, start, end) => {
  let n = 0
  for (let line = start; line <= end; line++) if (ranges.some(([p, a, b]) => p === path && a <= line && b >= line)) n++
  return `${n}/${end - start + 1}`
}

for (const cell of cells) {
  console.log(`== ${cell.split('/').pop()}`)
  const seen = { old: [], new: [] }
  for (const line of readFileSync(cell, 'utf8').split('\n')) {
    let e; try { e = JSON.parse(line) } catch { continue }
    const it = e.item ?? {}
    if (e.type === 'item.completed' && it.type === 'file_change') { console.log('  (first edit: replay stops)'); break }
    if (e.type !== 'item.completed' || it.type !== 'mcp_tool_call' || it.tool !== 'repository_packet') continue
    const { mode, spec } = it.arguments
    if (mode === 'plan') {
      const [o, n] = [await plan(oldMod, spec), await plan(newMod, spec)]
      if (o.ok) seen.old.push(...o.ranges)
      if (n.ok) seen.new.push(...n.ranges)
      const show = (r) => r.ok ? `${r.lines} lines${r.unresolved ? `, ${r.unresolved} unresolved` : ''}${r.included ? `, ${r.included} header` : ''}` : `ERROR ${r.error}`
      console.log(`  plan  ${spec.task?.slice(0, 60)}\n        old: ${show(o)}\n        new: ${show(n)}`)
    } else {
      for (const s of spec.sources) {
        let lines = 0
        try { lines = readFileSync(`${root}/${s.path}`, 'utf8').replace(/\n$/, '').split('\n').length } catch {}
        const start = s.startLine ?? 1, end = Math.min(s.endLine ?? lines, lines || Infinity)
        console.log(`  build ${s.path}:${start}-${end}  lines already in an earlier plan: old ${covers(seen.old, s.path, start, end)}, new ${covers(seen.new, s.path, start, end)}`)
      }
    }
  }
}
