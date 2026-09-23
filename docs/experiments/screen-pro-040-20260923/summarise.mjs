#!/usr/bin/env node
// Applies the screen rule. Written before the first screen cell ran.
// Usage: node summarise.mjs <screen-evidence-parent> <repeated-run-evidence-parent>
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const protocol = JSON.parse(readFileSync(join(here, 'protocol.json'), 'utf8'))
const [screen, baseline] = process.argv.slice(2)
if (!screen || !baseline) throw new Error('usage: summarise.mjs <screen-parent> <repeated-run-parent>')
const reps = Array.from({ length: protocol.repetitions }, (_, i) => i + 1)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const geomean = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function errors(stream) {
  let n = 0; let total = 0
  for (const line of readFileSync(stream, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const e = JSON.parse(line)
    if (e.type !== 'user' || !Array.isArray(e.message?.content)) continue
    for (const p of e.message.content) if (p.type === 'tool_result') { total += 1; if (p.is_error) n += 1 }
  }
  return [n, total]
}
const load = (parent, task, arm) => reps.map((rep) => {
  const dir = join(parent, `rep${rep}`, task, arm)
  if (!existsSync(join(dir, 'receipt.json'))) return null
  const r = JSON.parse(readFileSync(join(dir, 'receipt.json'), 'utf8'))
  return { input: r.executorRun.inputTotal, turns: r.executorRun.numTurns, accepted: r.accepted, errors: errors(join(dir, 'executor.stream.jsonl')) }
})
const cells = {}
for (const task of protocol.tasks) {
  cells[`${task}/new`] = load(screen, task, 'context')
  for (const arm of ['context', 'plain', 'graphify']) cells[`${task}/${arm}`] = load(baseline, task, arm)
}
const complete = Object.values(cells).every((runs) => runs.every(Boolean))
const med = (task, g, runs = cells[`${task}/${g}`]) => median(runs.filter(Boolean).map((c) => c.input))
const ratio = (g, pick = med) => geomean(protocol.tasks.map((t) => pick(t, 'new') / pick(t, g)))
function bootstrap(g, draws = 10000, seed = 20260923) {
  const random = rng(seed); const values = []
  for (let i = 0; i < draws; i += 1) {
    const s = {}
    for (const t of protocol.tasks) for (const k of ['new', g]) { const ok = cells[`${t}/${k}`].filter(Boolean); s[`${t}/${k}`] = ok.map(() => ok[Math.floor(random() * ok.length)]) }
    values.push(ratio(g, (t, k) => median(s[`${t}/${k}`].map((c) => c.input))))
  }
  values.sort((a, b) => a - b)
  return [values[Math.floor(0.05 * draws)], values[Math.floor(0.95 * draws) - 1]]
}
const out = [`Cells complete: ${complete ? 'yes' : 'no'}\n`, '| Task | 0.4.0 median input | earlier Context | plain | graphify | 0.4.0 median turns | earlier Context turns | 0.4.0 tool errors | 0.4.0 code accepted |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
const fmt = (n) => Math.round(n).toLocaleString('en-GB')
for (const t of protocol.tasks) {
  const n = cells[`${t}/new`].filter(Boolean)
  if (!n.length) continue
  const e = n.reduce((a, c) => [a[0] + c.errors[0], a[1] + c.errors[1]], [0, 0])
  out.push(`| ${t} | ${fmt(med(t, 'new'))} | ${fmt(med(t, 'context'))} | ${fmt(med(t, 'plain'))} | ${fmt(med(t, 'graphify'))} | ${median(n.map((c) => c.turns))} | ${median(cells[`${t}/context`].map((c) => c.turns))} | ${e[0]} / ${e[1]} | ${t.startsWith('code-change') ? `${n.filter((c) => c.accepted).length} of ${n.length}` : 'not reviewed'} |`)
}
if (complete) {
  out.push('\n| Against | Geometric mean ratio (0.4.0 / against) | 90% interval | Screen |', '| --- | ---: | --- | --- |')
  const verdict = []
  for (const g of ['plain', 'graphify', 'context']) {
    const r = ratio(g); const [lo, hi] = bootstrap(g); const pass = r <= 0.8 && hi < 1
    if (g !== 'context') verdict.push(pass)
    out.push(`| ${g === 'context' ? 'earlier Context (reported only)' : g} | ${r.toFixed(3)} | ${lo.toFixed(3)} to ${hi.toFixed(3)} | ${g === 'context' ? '-' : pass ? 'passes' : 'does not pass'} |`)
  }
  out.push(`\nScreen: ${verdict.every(Boolean) ? 'passes against both comparators' : 'does not pass against both comparators'}.`)
}
process.stdout.write(`${out.join('\n')}\n`)
