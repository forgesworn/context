#!/usr/bin/env node
// Aggregate receipts from the three-way comparison into a markdown table and JSON summary.
// Usage: node summarise.mjs --evidence /private/evidence [--out RESULTS.md]
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined }
const evidence = resolve(opt('evidence') ?? '')
const arms = ['plain', 'graphify', 'context']
const rows = []
for (const task of readdirSync(evidence, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
  for (const arm of arms) {
    const path = join(evidence, task, arm, 'receipt.json')
    if (!existsSync(path)) continue
    const r = JSON.parse(readFileSync(path, 'utf8'))
    const e = r.executorRun ?? {}, v = r.reviewerRun ?? {}
    rows.push({
      task, arm, order: r.orderIndex, accepted: r.accepted, checker: r.checker?.passed ?? null, reviewer: v.verdict?.accepted ?? null, scope: r.scope ? r.scope.passed : null,
      subtype: e.subtype, turns: e.numTurns, toolCalls: e.toolCallsTotal, toolCallsByName: e.toolCalls,
      inputTotal: e.inputTotal, inputUncached: e.inputUncached, cacheRead: e.usage?.cache_read_input_tokens ?? null, output: e.output,
      costUsd: e.totalCostUsd, executorSeconds: e.seconds, reviewerInput: v.inputTotal, reviewerOutput: v.output, reviewerSeconds: v.seconds,
      graphifyBuildSeconds: r.setup?.graphify?.seconds ?? null, armSeconds: r.armSeconds, toolResultBytes: e.toolResultBytes,
    })
  }
}
const fmt = (n) => n === null || n === undefined ? '?' : typeof n === 'number' ? (Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toFixed(1)) : String(n)
const lines = ['| Task | Arm | Order | Accepted | Checker | Reviewer | Turns | Tool calls | Input total | Uncached input | Output | Cost est. USD | Executor s | Reviewer in/out | Arm s |', '| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
for (const r of rows) lines.push(`| ${r.task} | ${r.arm} | ${r.order} | ${r.accepted ? 'yes' : 'no'} | ${r.checker ? 'pass' : 'fail'} | ${r.scope !== null ? (r.scope ? 'scope ok' : 'scope fail') : r.reviewer === null ? '?' : r.reviewer ? 'accept' : 'reject'} | ${fmt(r.turns)} | ${fmt(r.toolCalls)} | ${fmt(r.inputTotal)} | ${fmt(r.inputUncached)} | ${fmt(r.output)} | ${r.costUsd === null ? '?' : r.costUsd.toFixed(2)} | ${fmt(r.executorSeconds)} | ${fmt(r.reviewerInput)}/${fmt(r.reviewerOutput)} | ${fmt(r.armSeconds)} |`)
const agg = {}
for (const arm of arms) {
  const set = rows.filter(r => r.arm === arm)
  if (!set.length) continue
  const sum = (k) => set.reduce((a, r) => a + (r[k] ?? 0), 0)
  agg[arm] = { tasks: set.length, accepted: set.filter(r => r.accepted).length, toolCalls: sum('toolCalls'), inputTotal: sum('inputTotal'), inputUncached: sum('inputUncached'), output: sum('output'), costUsd: sum('costUsd'), executorSeconds: sum('executorSeconds'), reviewerInput: sum('reviewerInput'), reviewerSeconds: sum('reviewerSeconds'), armSeconds: sum('armSeconds') }
}
lines.push('', '| Arm | Tasks | Accepted | Tool calls | Input total | Uncached input | Output | Cost est. USD | Executor s | Reviewer input | Reviewer s | Arm s |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
for (const [arm, g] of Object.entries(agg)) lines.push(`| ${arm} | ${g.tasks} | ${g.accepted} | ${fmt(g.toolCalls)} | ${fmt(g.inputTotal)} | ${fmt(g.inputUncached)} | ${fmt(g.output)} | ${g.costUsd.toFixed(2)} | ${fmt(g.executorSeconds)} | ${fmt(g.reviewerInput)} | ${fmt(g.reviewerSeconds)} | ${fmt(g.armSeconds)} |`)
const rel = (a, b) => { if (!b) return '?'; const p = ((a - b) / b) * 100; return `${Math.abs(p).toFixed(1)}% ${p <= 0 ? 'lower' : 'higher'}` }
const perAccepted = (g) => g.accepted ? Math.round(g.inputTotal / g.accepted) : null
const compare = (x, y) => `${x} vs ${y}: input total ${rel(agg[x].inputTotal, agg[y].inputTotal)}, uncached input ${rel(agg[x].inputUncached, agg[y].inputUncached)}, tool calls ${rel(agg[x].toolCalls, agg[y].toolCalls)}, cost estimate ${rel(agg[x].costUsd, agg[y].costUsd)}, reviewer time ${rel(agg[x].reviewerSeconds, agg[y].reviewerSeconds)}, input per accepted task ${perAccepted(agg[x]) && perAccepted(agg[y]) ? rel(perAccepted(agg[x]), perAccepted(agg[y])) : '?'}.`
lines.push('')
for (const [arm, g] of Object.entries(agg)) lines.push(`${arm}: input per accepted task ${perAccepted(g) === null ? 'undefined (none accepted)' : perAccepted(g).toLocaleString('en-GB')}.`)
if (agg.context && agg.plain) lines.push('', compare('context', 'plain'))
if (agg.context && agg.graphify) lines.push(compare('context', 'graphify'))
if (agg.graphify && agg.plain) lines.push(compare('graphify', 'plain'))
const text = lines.join('\n') + '\n'
process.stdout.write(text)
writeFileSync(join(evidence, 'summary.json'), JSON.stringify({ rows, aggregate: agg }, null, 2))
if (opt('out')) writeFileSync(resolve(opt('out')), text)
