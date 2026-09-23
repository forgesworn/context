#!/usr/bin/env node
// Applies protocol.json's decision rule to rep1..repN receipts. Written before any cell of attempt 3 ran.
// Usage: node summarise.mjs <evidence-parent>   (prints markdown tables and the verdict)
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const protocol = JSON.parse(readFileSync(join(here, 'protocol.json'), 'utf8'))
const parent = process.argv[2]
if (!parent) throw new Error('usage: summarise.mjs <evidence-parent>')
const arms = ['plain', 'graphify', 'context']
const reps = Array.from({ length: protocol.repetitions }, (_, i) => i + 1)

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const geomean = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length)
// Deterministic PRNG (mulberry32) so the interval is reproducible from the seed.
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

function toolStats(streamPath) {
  let bytes = 0; let errors = 0; let results = 0
  if (!existsSync(streamPath)) return { bytes: null, errors: null, results: null }
  for (const line of readFileSync(streamPath, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const event = JSON.parse(line)
    if (event.type !== 'user' || !Array.isArray(event.message?.content)) continue
    for (const part of event.message.content) {
      if (part.type !== 'tool_result') continue
      results += 1
      if (part.is_error) errors += 1
      const text = typeof part.content === 'string' ? part.content : (part.content ?? []).map((p) => p.text ?? '').join('\n')
      bytes += Buffer.byteLength(text)
    }
  }
  return { bytes, errors, results }
}

const cells = {}
for (const task of protocol.tasks) for (const arm of arms) {
  cells[`${task}/${arm}`] = reps.map((rep) => {
    const dir = join(parent, `rep${rep}`, task, arm)
    const path = join(dir, 'receipt.json')
    if (!existsSync(path)) return null
    const r = JSON.parse(readFileSync(path, 'utf8'))
    return { accepted: Boolean(r.accepted), input: r.executorRun.inputTotal, turns: r.executorRun.numTurns, reviewerSeconds: r.reviewerRun?.seconds ?? null, ...toolStats(join(dir, 'executor.stream.jsonl')) }
  })
}
const complete = Object.values(cells).every((runs) => runs.every(Boolean))

const acceptedTasks = (arm) => protocol.tasks.filter((t) => cells[`${t}/${arm}`].filter((c) => c?.accepted).length >= 2).length
const medInput = (task, arm, runs = cells[`${task}/${arm}`]) => median(runs.filter(Boolean).map((c) => c.input))
const ratio = (comparator, pick = (t, a) => medInput(t, a)) => geomean(protocol.tasks.map((t) => pick(t, 'context') / pick(t, comparator)))

function bootstrap(comparator, draws = 10000, seed = 20260923) {
  const random = rng(seed)
  const resample = (runs) => { const ok = runs.filter(Boolean); return ok.map(() => ok[Math.floor(random() * ok.length)]) }
  const values = []
  for (let i = 0; i < draws; i += 1) {
    const sampled = {}
    for (const t of protocol.tasks) for (const a of ['context', comparator]) sampled[`${t}/${a}`] = resample(cells[`${t}/${a}`])
    values.push(ratio(comparator, (t, a) => median(sampled[`${t}/${a}`].map((c) => c.input))))
  }
  values.sort((a, b) => a - b)
  return [values[Math.floor(0.05 * draws)], values[Math.floor(0.95 * draws) - 1]]
}

const out = []
out.push(`Cells complete: ${complete ? 'yes' : 'no'}\n`)
out.push('| Task | Arm | Accepted | Median input | Input range | Median tool bytes | Tool errors | Median turns |')
out.push('| --- | --- | ---: | ---: | --- | ---: | ---: | ---: |')
for (const task of protocol.tasks) for (const arm of arms) {
  const runs = cells[`${task}/${arm}`].filter(Boolean)
  if (!runs.length) continue
  const inputs = runs.map((c) => c.input)
  out.push(`| ${task} | ${arm} | ${runs.filter((c) => c.accepted).length} of ${runs.length} | ${Math.round(median(inputs)).toLocaleString('en-GB')} | ${Math.min(...inputs).toLocaleString('en-GB')} to ${Math.max(...inputs).toLocaleString('en-GB')} | ${Math.round(median(runs.map((c) => c.bytes))).toLocaleString('en-GB')} | ${runs.reduce((a, c) => a + c.errors, 0)} / ${runs.reduce((a, c) => a + c.results, 0)} | ${median(runs.map((c) => c.turns))} |`)
}
if (complete) {
  out.push('\n| Comparator | Geometric mean ratio (context / comparator) | 90% interval | Context-repo tasks | KithMoot tasks | Accepted tasks (context vs comparator) | Cost | Guard |')
  out.push('| --- | ---: | --- | ---: | ---: | --- | --- | --- |')
  const verdicts = []
  for (const comparator of ['plain', 'graphify']) {
    const g = ratio(comparator)
    const [lo, hi] = bootstrap(comparator)
    const sub = (repo) => geomean(protocol.tasks.filter((t) => t.endsWith(`-${repo}`)).map((t) => medInput(t, 'context') / medInput(t, comparator)))
    const cost = g <= 0.8 && hi < 1
    const guard = acceptedTasks('context') >= acceptedTasks(comparator)
    verdicts.push(cost && guard)
    out.push(`| ${comparator} | ${g.toFixed(3)} | ${lo.toFixed(3)} to ${hi.toFixed(3)} | ${sub('context').toFixed(3)} | ${sub('kithmoot').toFixed(3)} | ${acceptedTasks('context')} vs ${acceptedTasks(comparator)} | ${cost ? 'met' : 'not met'} | ${guard ? 'met' : 'not met'} |`)
  }
  out.push(`\nDecision rule: ${verdicts.every(Boolean) ? 'met' : 'not met'}. Graphify accepted ${acceptedTasks('graphify')}, plain ${acceptedTasks('plain')}, Context ${acceptedTasks('context')} of ${protocol.tasks.length} tasks (two of three repetitions).`)
}
process.stdout.write(`${out.join('\n')}\n`)
