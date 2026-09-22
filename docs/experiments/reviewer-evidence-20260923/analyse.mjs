#!/usr/bin/env node
// What the recorded reviews show about reviewer consistency, without any model call.
// Usage: node analyse.mjs NAME=DIR [...] > report.json
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packDir = resolve(dirname(fileURLToPath(import.meta.url)), '../d5-20260921')
const runs = process.argv.slice(2).map((arg) => arg.split('='))
if (!runs.length) throw new Error('usage: analyse.mjs NAME=DIR [...]')
const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const stop = new Set('a an the and or of to in on for is are be by as at it its that this with from not no must before after when than then only same any which into can'.split(' '))
const words = (text) => new Set((text ?? '').toLowerCase().replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, '')))
const jaccard = (a, b) => { const i = [...a].filter((w) => b.has(w)).length; return a.size + b.size ? i / (a.size + b.size - i) : 1 }
const coverage = (rubric, text) => { const r = words(rubric), t = words(text); return r.size ? [...r].filter((w) => t.has(w)).length / r.size : null }
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const round = (x) => (x === null ? null : Number(x.toFixed(3)))

const cells = []
for (const [run, dir] of runs) {
  for (const task of readdirSync(dir).sort()) {
    const ap = join(packDir, 'acceptance', `${task}.json`)
    if (!existsSync(ap)) continue
    const acceptance = read(ap)
    for (const arm of ['plain', 'graphify', 'context']) {
      const armDir = join(dir, task, arm)
      if (!existsSync(join(armDir, 'receipt.json'))) continue
      const receipt = read(join(armDir, 'receipt.json'))
      const verdict = receipt.reviewerRun?.verdict
      if (!verdict) continue
      let answer = null
      try { answer = read(join(armDir, 'workspace', 'answer.json')) } catch {}
      const diff = existsSync(join(armDir, 'diff.patch')) ? readFileSync(join(armDir, 'diff.patch'), 'utf8') : null
      cells.push({ run, task, arm, kind: acceptance.kind, acceptance, verdict, answer, diff, checker: Boolean(receipt.checker?.passed), accepted: Boolean(receipt.accepted) })
    }
  }
}

// 1. Verdicts that contradict themselves.
const selfInconsistent = cells.filter((c) => {
  const allPass = c.verdict.dimensions.every((d) => d.pass)
  return (c.verdict.accepted && (!allPass || c.verdict.materialIssues.length)) || (!c.verdict.accepted && allPass && !c.verdict.materialIssues.length)
}).map((c) => ({ run: c.run, task: c.task, arm: c.arm, accepted: c.verdict.accepted, failed: c.verdict.dimensions.filter((d) => !d.pass).map((d) => d.id), materialIssues: c.verdict.materialIssues.length }))

// 2. Dimension ids reported against the ids the rubric defines.
const expectedIds = (c) => (c.kind === 'structured' ? Object.keys(c.acceptance.reviewerRubric) : [...c.acceptance.behaviour.map((_, i) => `b${i + 1}`), 'scope'])
const idDrift = cells.map((c) => { const exp = expectedIds(c), got = c.verdict.dimensions.map((d) => d.id); return { cell: `${c.run}/${c.task}/${c.arm}`, kind: c.kind, expected: exp.length, reported: got.length, missing: exp.filter((i) => !got.includes(i)), extra: got.filter((i) => !exp.includes(i)) } }).filter((d) => d.missing.length || d.extra.length)

// 3. Code tasks: the same diff reviewed more than once.
const norm = (d) => (d ?? '').split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).map((l) => l.replace(/\s+/g, ' ').trim()).join('\n')
const byDiff = {}
for (const c of cells.filter((c) => c.kind === 'code')) (byDiff[`${c.task}|${createHash('sha256').update(norm(c.diff)).digest('hex').slice(0, 12)}`] ??= []).push(c)
const sameDiff = Object.entries(byDiff).filter(([, cs]) => cs.length > 1).map(([key, cs]) => ({ key, cells: cs.map((c) => `${c.run}/${c.arm}`), checker: cs.map((c) => c.checker), accepted: cs.map((c) => c.accepted), dims: cs.map((c) => c.verdict.dimensions.length) }))
const codePairs = []
const code = cells.filter((c) => c.kind === 'code')
for (let i = 0; i < code.length; i += 1) for (let j = i + 1; j < code.length; j += 1) {
  const a = code[i], b = code[j]
  if (a.task !== b.task || !a.checker || !b.checker) continue
  codePairs.push({ sim: jaccard(words(norm(a.diff)), words(norm(b.diff))), agree: a.accepted === b.accepted, a: `${a.run}/${a.arm}`, b: `${b.run}/${b.arm}`, task: a.task })
}

// 4. Structured tasks, per dimension: rubric-term coverage of the finding against the reviewer's pass,
//    and pairs of findings for the same dimension that are near-identical in wording yet judged differently.
const rows = []
for (const c of cells.filter((c) => c.kind === 'structured' && c.answer)) {
  for (const [id, rubric] of Object.entries(c.acceptance.reviewerRubric)) {
    const finding = c.answer.findings?.find((f) => f.id === id)?.value ?? ''
    const judged = c.verdict.dimensions.find((d) => d.id === id)
    if (!judged) continue
    rows.push({ cell: `${c.run}/${c.task}/${c.arm}`, task: c.task, id, pass: judged.pass, note: judged.note, cov: coverage(rubric, finding), finding, words: words(finding) })
  }
}
function auc(xs) {
  const pos = xs.filter((r) => r.pass), neg = xs.filter((r) => !r.pass)
  if (!pos.length || !neg.length) return null
  let w = 0
  for (const p of pos) for (const n of neg) w += p.cov > n.cov ? 1 : p.cov === n.cov ? 0.5 : 0
  return w / (pos.length * neg.length)
}
const byDim = {}
for (const r of rows) (byDim[`${r.task}|${r.id}`] ??= []).push(r)
const dimensions = Object.entries(byDim).map(([k, rs]) => ({ dim: k, n: rs.length, passed: rs.filter((r) => r.pass).length, coverageAuc: round(auc(rs)),
  meanCovPass: round(mean(rs.filter((r) => r.pass).map((r) => r.cov))), meanCovFail: round(mean(rs.filter((r) => !r.pass).map((r) => r.cov))) }))
const pairs = []
for (const rs of Object.values(byDim)) for (let i = 0; i < rs.length; i += 1) for (let j = i + 1; j < rs.length; j += 1) pairs.push({ sim: jaccard(rs[i].words, rs[j].words), agree: rs[i].pass === rs[j].pass, a: rs[i], b: rs[j] })
const band = (lo, hi) => { const p = pairs.filter((x) => x.sim >= lo && x.sim < hi); return { band: `${lo}-${hi}`, pairs: p.length, disagree: p.filter((x) => !x.agree).length, rate: round(p.length ? p.filter((x) => !x.agree).length / p.length : null) } }
const similarDisagree = pairs.filter((p) => !p.agree && p.sim >= 0.5).sort((x, y) => y.sim - x.sim).slice(0, 12)
  .map((p) => ({ dim: `${p.a.task}|${p.a.id}`, sim: round(p.sim), pass: p.a.pass ? p.a.cell : p.b.cell, fail: p.a.pass ? p.b.cell : p.a.cell, failNote: (p.a.pass ? p.b : p.a).note.slice(0, 300) }))

// 5. Unchanged arms v1 against v2: for each flipped verdict, which dimensions moved and how similar the findings were.
const get = (run, task, arm) => cells.find((c) => c.run === run && c.task === task && c.arm === arm)
const flips = []
for (const a of cells.filter((c) => c.run === 'v1' && c.arm !== 'context')) {
  const b = get('v2', a.task, a.arm)
  if (!b) continue
  const moved = a.kind === 'structured'
    ? Object.keys(a.acceptance.reviewerRubric).map((id) => {
        const pa = a.verdict.dimensions.find((d) => d.id === id)?.pass, pb = b.verdict.dimensions.find((d) => d.id === id)?.pass
        const fa = a.answer?.findings?.find((f) => f.id === id)?.value ?? '', fb = b.answer?.findings?.find((f) => f.id === id)?.value ?? ''
        return { id, v1: pa, v2: pb, findingSim: round(jaccard(words(fa), words(fb))), covV1: round(coverage(a.acceptance.reviewerRubric[id], fa)), covV2: round(coverage(a.acceptance.reviewerRubric[id], fb)) }
      }).filter((m) => m.v1 !== m.v2)
    : { diffSim: round(jaccard(words(norm(a.diff)), words(norm(b.diff)))), checker: [a.checker, b.checker], dims: [a.verdict.dimensions.map((d) => `${d.id}:${d.pass}`), b.verdict.dimensions.map((d) => `${d.id}:${d.pass}`)], issues: [a.verdict.materialIssues, b.verdict.materialIssues] }
  flips.push({ task: a.task, arm: a.arm, v1: a.accepted, v2: b.accepted, flipped: a.accepted !== b.accepted, moved })
}

process.stdout.write(`${JSON.stringify({
  cells: cells.length,
  selfInconsistent,
  idDrift: { cells: idDrift.length, byKind: { code: idDrift.filter((d) => d.kind === 'code').length, structured: idDrift.filter((d) => d.kind === 'structured').length }, examples: idDrift.slice(0, 8) },
  code: { sameDiff, pairsCheckerPassed: codePairs.length, highSimilarityDisagree: codePairs.filter((p) => p.sim >= 0.8 && !p.agree) },
  structured: { dimensionRows: rows.length, overallCoverageAuc: round(auc(rows)), dimensions, similarityBands: [band(0, 0.2), band(0.2, 0.35), band(0.35, 0.5), band(0.5, 1.01)], similarDisagree },
  unchangedArmsV1V2: flips,
}, null, 1)}\n`)
