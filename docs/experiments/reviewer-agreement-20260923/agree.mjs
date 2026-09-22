#!/usr/bin/env node
// Reviewer agreement probe: re-review recorded answers with the recorded
// reviewer prompt (replay) and with a fixed dimension list (fixed), several
// times each, and measure how often the verdicts agree. No executor runs.
// Usage: node agree.mjs --evidence NAME=DIR [...] --out PRIVATE_DIR
//          [--conditions replay,fixed] [--repeats 3] [--concurrency 3] [--estimate | --summarise]
// --estimate prints the job count and a cost estimate from the recorded reviews without any model call.
// --summarise recomputes the report from results already in --out. Finished reviews are never repeated.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packDir = resolve(here, '../d5-20260921')
const harness = JSON.parse(readFileSync(resolve(here, '../graphify-20260922/protocol.json'), 'utf8'))
const protocol = JSON.parse(readFileSync(join(here, 'protocol.json'), 'utf8'))
const argv = process.argv.slice(2)
const all = (key) => argv.flatMap((value, i) => (argv[i - 1] === `--${key}` ? [value] : []))
const one = (key) => all(key)[0]
const flag = (key) => argv.includes(`--${key}`)
const runs = all('evidence').map((arg) => { const [name, dir] = arg.split('='); return { name, dir: resolve(dir) } })
const out = one('out') && resolve(one('out'))
const conditions = (one('conditions') ?? 'replay,fixed').split(',')
const repeats = Number(one('repeats') ?? protocol.repeats)
const concurrency = Number(one('concurrency') ?? 3)
if (!runs.length || !out) throw new Error('usage: agree.mjs --evidence NAME=DIR [...] --out DIR')
const sha = (text) => createHash('sha256').update(text).digest('hex')
const arms = ['plain', 'graphify', 'context']

// The recorded review schema from graphify-20260922/run.mjs.
const reviewSchema = {
  type: 'object',
  properties: {
    accepted: { type: 'boolean' },
    dimensions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, pass: { type: 'boolean' }, note: { type: 'string' } }, required: ['id', 'pass', 'note'] } },
    materialIssues: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['accepted', 'dimensions', 'materialIssues', 'summary'],
}

function fixedIds(acceptance) {
  if (acceptance.kind === 'structured') return Object.keys(acceptance.reviewerRubric)
  return [...(acceptance.behaviour ?? []).map((_, i) => `b${i + 1}`), 'scope']
}

function fixedPrompt(recorded, ids) {
  const lines = recorded.split('\n')
  const last = lines.lastIndexOf('Return JSON only, matching the provided schema.')
  if (last < 0) throw new Error('recorded prompt has no final schema line')
  const block = [`Report exactly these dimensions, once each, in this order: ${ids.join(', ')}. Do not add, split, merge or rename dimensions; fold any other concern into the nearest listed dimension or into materialIssues.`, '']
  return [...lines.slice(0, last), ...block, ...lines.slice(last)].join('\n')
}

function fixedSchema(ids) {
  const schema = structuredClone(reviewSchema)
  schema.properties.dimensions.items.properties.id = { type: 'string', enum: ids }
  Object.assign(schema.properties.dimensions, { minItems: ids.length, maxItems: ids.length })
  return schema
}

const cells = []
for (const { name, dir } of runs) {
  for (const task of readdirSync(dir).sort()) {
    const acceptancePath = join(packDir, 'acceptance', `${task}.json`)
    if (!existsSync(acceptancePath)) continue
    const acceptance = JSON.parse(readFileSync(acceptancePath, 'utf8'))
    for (const arm of arms) {
      const armDir = join(dir, task, arm)
      if (!existsSync(join(armDir, 'receipt.json')) || !existsSync(join(armDir, 'reviewer.prompt.txt'))) continue
      const receipt = JSON.parse(readFileSync(join(armDir, 'receipt.json'), 'utf8'))
      if (!receipt.reviewerRun?.verdict) continue
      const prompt = readFileSync(join(armDir, 'reviewer.prompt.txt'), 'utf8')
      const recordedSha = JSON.parse(readFileSync(join(armDir, 'reviewer.argv.json'), 'utf8')).promptSha256
      if (sha(prompt) !== recordedSha) throw new Error(`${name}/${task}/${arm}: reviewer prompt does not match its recorded hash`)
      cells.push({ run: name, task, arm, category: receipt.category, checkerPassed: Boolean(receipt.checker?.passed), acceptance, prompt,
        recorded: { verdict: receipt.reviewerRun.verdict, accepted: Boolean(receipt.accepted), cost: receipt.reviewerRun.totalCostUsd, usage: receipt.reviewerRun.usage, seconds: receipt.reviewerRun.seconds } })
    }
  }
}

const jobs = cells.flatMap((cell) => conditions.flatMap((condition) => Array.from({ length: repeats }, (_, i) => ({ cell, condition, rep: i + 1 }))))
const resultPath = (job) => join(out, job.condition, job.cell.run, job.cell.task, job.cell.arm, `r${job.rep}.json`)

if (flag('estimate')) {
  const recorded = (k) => cells.reduce((s, c) => s + (k(c) ?? 0), 0)
  const perReview = { cost: recorded((c) => c.recorded.cost) / cells.length, seconds: recorded((c) => c.recorded.seconds) / cells.length,
    input: recorded((c) => (c.recorded.usage?.input_tokens ?? 0) + (c.recorded.usage?.cache_creation_input_tokens ?? 0) + (c.recorded.usage?.cache_read_input_tokens ?? 0)) / cells.length,
    uncached: recorded((c) => (c.recorded.usage?.input_tokens ?? 0) + (c.recorded.usage?.cache_creation_input_tokens ?? 0)) / cells.length,
    output: recorded((c) => c.recorded.usage?.output_tokens) / cells.length }
  const pending = jobs.filter((job) => !existsSync(resultPath(job)))
  const byCost = pending.reduce((s, job) => s + (job.cell.recorded.cost ?? perReview.cost), 0)
  process.stdout.write(`${JSON.stringify({ cells: cells.length, jobs: jobs.length, pending: pending.length, conditions, repeats, recordedPerReview: perReview,
    estimate: { costUsd: Number(byCost.toFixed(2)), input: Math.round(perReview.input * pending.length), uncached: Math.round(perReview.uncached * pending.length),
      output: Math.round(perReview.output * pending.length), serialHours: Number((perReview.seconds * pending.length / 3600).toFixed(1)),
      hoursAtConcurrency: Number((perReview.seconds * pending.length / 3600 / concurrency).toFixed(1)), concurrency } }, null, 2)}\n`)
  process.exit(0)
}

function cleanEnv() {
  const env = { ...process.env }
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_SUBAGENT_MODEL']) delete env[key]
  return env
}

const blocked = /rate.?limit|429|out_of_credits|usage limit|overloaded|authentication|401/i
function review(dir, name, prompt, schema) {
  const args = ['-p', '--model', protocol.reviewer.model, '--effort', protocol.reviewer.effort, '--output-format', 'json',
    '--dangerously-skip-permissions', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
    '--no-session-persistence', '--setting-sources', harness.executor.settingSources, '--settings', JSON.stringify(harness.executor.settingsOverride),
    '--max-turns', String(protocol.reviewer.maxTurns), '--disallowedTools', [...harness.executor.disallowedTools, ...harness.reviewer.disallowedTools].join(','),
    '--json-schema', JSON.stringify(schema)]
  const started = Date.now()
  return new Promise((resolveRun) => {
    const child = spawn('claude', args, { cwd: dir, env: cleanEnv(), stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = [], errors = []
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.on('data', (d) => errors.push(d))
    child.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const stderr = Buffer.concat(errors).toString('utf8')
      writeFileSync(join(dir, `${name}.result.json`), raw)
      let parsed = null
      try { parsed = JSON.parse(raw) } catch {}
      let verdict = parsed?.structured_output ?? null
      if (!verdict && typeof parsed?.result === 'string') { try { verdict = JSON.parse(parsed.result.replace(/^```json\s*|```\s*$/g, '')) } catch {} }
      const failed = !parsed || (parsed.is_error && parsed.subtype !== 'error_max_turns') || blocked.test(stderr)
      resolveRun({ code, failed, seconds: (Date.now() - started) / 1000, verdict, usage: parsed?.usage ?? null, cost: parsed?.total_cost_usd ?? null, subtype: parsed?.subtype ?? null, stderr: stderr.slice(0, 500) })
    })
    child.stdin.end(prompt)
  })
}

if (!flag('summarise')) {
  const clientVersion = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim()
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'run-meta.json'), JSON.stringify({ probeId: protocol.probeId, protocolSha256: sha(readFileSync(join(here, 'protocol.json'), 'utf8')), clientVersion, conditions, repeats, startedAt: new Date().toISOString() }, null, 2))
  const pending = jobs.filter((job) => !existsSync(resultPath(job)))
  let next = 0, done = 0, stop = null
  async function worker() {
    while (!stop && next < pending.length) {
      const job = pending[next++]
      const { cell, condition, rep } = job
      const dir = dirname(resultPath(job))
      mkdirSync(dir, { recursive: true })
      const ids = fixedIds(cell.acceptance)
      const prompt = condition === 'fixed' ? fixedPrompt(cell.prompt, ids) : cell.prompt
      const schema = condition === 'fixed' ? fixedSchema(ids) : reviewSchema
      const attempts = []
      for (let attempt = 1; attempt <= 2 && !stop; attempt += 1) {
        const run = await review(dir, `r${rep}-a${attempt}`, prompt, schema)
        attempts.push(run)
        if (run.failed) { stop = { job: `${condition}/${cell.run}/${cell.task}/${cell.arm}/r${rep}`, subtype: run.subtype, stderr: run.stderr }; break }
        if (run.verdict) break
      }
      if (stop) break
      const verdict = attempts.at(-1).verdict
      writeFileSync(resultPath(job), JSON.stringify({ condition, run: cell.run, task: cell.task, arm: cell.arm, rep, promptSha256: sha(prompt), verdict,
        accepted: cell.checkerPassed && verdict?.accepted === true && (verdict?.materialIssues?.length ?? 1) === 0,
        attempts: attempts.map(({ subtype, seconds, usage, cost, verdict: v }) => ({ subtype, seconds, usage, cost, parsed: Boolean(v) })) }, null, 2))
      done += 1
      process.stderr.write(`${done}/${pending.length} ${condition} ${cell.run} ${cell.task} ${cell.arm} r${rep} accepted=${verdict?.accepted ?? 'unparsed'}\n`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  if (stop) {
    writeFileSync(join(out, 'stopped.json'), JSON.stringify({ at: new Date().toISOString(), ...stop }, null, 2))
    process.stderr.write(`stopped without retry: ${JSON.stringify(stop)}\n`)
    process.exit(2)
  }
}

// Fleiss' kappa for binary ratings; rows are arrays of booleans of equal length.
function fleiss(rows) {
  const usable = rows.filter((r) => r.length >= 2 && r.every((v) => typeof v === 'boolean'))
  if (!usable.length) return null
  const n = usable[0].length
  const same = usable.filter((r) => r.length === n)
  const p = same.flat().filter(Boolean).length / (same.length * n)
  const pe = p * p + (1 - p) * (1 - p)
  const pbar = same.reduce((s, r) => { const yes = r.filter(Boolean).length; return s + (yes * (yes - 1) + (n - yes) * (n - yes - 1)) / (n * (n - 1)) }, 0) / same.length
  return pe === 1 ? null : Number(((pbar - pe) / (1 - pe)).toFixed(3))
}
const pairwiseDisagreement = (rows) => {
  const usable = rows.filter((r) => r.length >= 2)
  if (!usable.length) return null
  const d = usable.reduce((s, r) => { const yes = r.filter(Boolean).length, n = r.length; return s + (2 * yes * (n - yes)) / (n * (n - 1)) }, 0)
  return Number((d / usable.length).toFixed(3))
}

const report = { probeId: protocol.probeId, meta: existsSync(join(out, 'run-meta.json')) ? JSON.parse(readFileSync(join(out, 'run-meta.json'), 'utf8')) : null, conditions: {} }
for (const condition of conditions) {
  const perCell = cells.map((cell) => {
    const results = Array.from({ length: repeats }, (_, i) => resultPath({ cell, condition, rep: i + 1 })).filter(existsSync).map((p) => JSON.parse(readFileSync(p, 'utf8')))
    return { cell, results, accepted: results.map((r) => r.accepted) }
  }).filter((c) => c.results.length)
  if (!perCell.length) continue
  const acc = perCell.map((c) => c.accepted)
  const byTask = {}
  for (const c of perCell) {
    const t = (byTask[c.cell.task] ??= { cells: 0, split: 0, dimensionCounts: {}, dims: {} })
    t.cells += 1
    if (new Set(c.accepted).size > 1) t.split += 1
    for (const r of c.results) { const k = r.verdict?.dimensions?.length ?? 'unparsed'; t.dimensionCounts[k] = (t.dimensionCounts[k] ?? 0) + 1 }
    for (const id of fixedIds(c.cell.acceptance)) (t.dims[id] ??= []).push(c.results.map((r) => r.verdict?.dimensions?.find((d) => d.id === id)?.pass))
  }
  for (const t of Object.values(byTask)) {
    t.dims = Object.fromEntries(Object.entries(t.dims).map(([id, rows]) => {
      const complete = rows.filter((r) => r.every((v) => typeof v === 'boolean'))
      return [id, { reported: complete.length, of: rows.length, unanimous: complete.filter((r) => new Set(r).size === 1).length, kappa: fleiss(complete) }]
    }))
  }
  const attempts = perCell.flatMap((c) => c.results.flatMap((r) => r.attempts))
  const u = (k) => attempts.reduce((s, a) => s + (a.usage?.[k] ?? 0), 0)
  const unchanged = perCell.filter((c) => ['v1', 'v2'].includes(c.cell.run) && c.cell.arm !== 'context')
  const entry = {
    cells: perCell.length, reviews: acc.flat().length,
    acceptance: { unanimousCells: acc.filter((r) => new Set(r).size === 1).length, pairwiseDisagreement: pairwiseDisagreement(acc), kappa: fleiss(acc),
      unchangedArmsV1V2: { answers: unchanged.length, pairwiseDisagreement: pairwiseDisagreement(unchanged.map((c) => c.accepted)) } },
    byTask,
    usage: { costUsd: Number(attempts.reduce((s, a) => s + (a.cost ?? 0), 0).toFixed(2)), input: u('input_tokens') + u('cache_creation_input_tokens') + u('cache_read_input_tokens'),
      uncached: u('input_tokens') + u('cache_creation_input_tokens'), output: u('output_tokens'), seconds: Math.round(attempts.reduce((s, a) => s + a.seconds, 0)), unparsedAttempts: attempts.filter((a) => !a.parsed).length },
  }
  if (condition === 'replay') {
    const withRecorded = perCell.map((c) => [c.cell.recorded.accepted, ...c.accepted])
    entry.acceptance.withRecorded = { unanimousCells: withRecorded.filter((r) => new Set(r).size === 1).length, recordedOutvoted: perCell.filter((c) => c.accepted.filter((a) => a !== c.cell.recorded.accepted).length > c.accepted.length / 2).length }
  }
  report.conditions[condition] = entry
}
// Cross-run flips on unchanged arms: v1 against v2, recorded verdicts only.
const recordedAccepted = new Map(cells.map((c) => [`${c.run}|${c.task}|${c.arm}`, c.recorded.accepted]))
const pairs = cells.filter((c) => c.run === 'v1' && c.arm !== 'context' && recordedAccepted.has(`v2|${c.task}|${c.arm}`))
report.crossRunV1V2UnchangedArms = { pairs: pairs.length, flipped: pairs.filter((c) => c.recorded.accepted !== recordedAccepted.get(`v2|${c.task}|${c.arm}`)).length }
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'agreement-summary.json'), JSON.stringify(report, null, 2))
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
