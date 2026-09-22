#!/usr/bin/env node
// Replay probe: do batched yes/no "done?" questions, derived from the task
// brief only, predict which recorded answers the blind reviewer rejected?
// Usage: node probe.mjs --evidence DIR [--evidence DIR ...] --out PRIVATE_DIR [--concurrency 4]
// Reads answer.json and receipt.json from each run's <task>/<arm>/ directory.
// Calls headless Claude Code with no tools; never sees the rubric or verdict.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packDir = resolve(here, '../d5-20260921')
const protocol = JSON.parse(readFileSync(join(here, 'protocol.json'), 'utf8'))
const argv = process.argv.slice(2)
const all = (key) => argv.flatMap((value, i) => (argv[i - 1] === `--${key}` ? [value] : []))
const one = (key) => all(key)[0]
const evidenceDirs = all('evidence').map((dir) => resolve(dir))
const out = one('out') && resolve(one('out'))
const concurrency = Number(one('concurrency') ?? 4)
if (!evidenceDirs.length || !out) throw new Error('usage: probe.mjs --evidence DIR [...] --out DIR')
mkdirSync(out, { recursive: true })
const sha = (text) => createHash('sha256').update(text).digest('hex')

function questionsFor(task) {
  const perFinding = task.requiredFindingIds.map((id) => ({
    id: `finding:${id}`,
    text: protocol.questions.perFinding.replace('{id}', id),
  }))
  const general = protocol.questions.all.map((text, i) => ({ id: `all:${i}`, text }))
  const category = (protocol.questions[task.category] ?? []).map((text, i) => ({ id: `${task.category}:${i}`, text }))
  return [...perFinding, ...general, ...category]
}

const schema = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, yes: { type: 'boolean' }, probabilityYes: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['id', 'yes', 'probabilityYes'],
      },
    },
  },
  required: ['answers'],
}

function prompt(task, answer, questions) {
  return [
    'You judge whether a coding agent\'s answer is complete. You see only the task and the answer, not the source code.',
    'Answer each question yes or no about the answer text as written, with your probability that the answer is yes.',
    'Judge presence and specificity only; do not guess whether statements are correct.',
    '',
    `Task (${task.category}): ${task.prompt}`,
    `Required finding ids: ${task.requiredFindingIds.join(', ')}`,
    '',
    'Answer:',
    JSON.stringify({ summary: answer.summary, findings: answer.findings }, null, 1),
    '',
    'Questions:',
    ...questions.map((q) => `- ${q.id}: ${q.text}`),
    '',
    'Return every question id exactly once.',
  ].join('\n')
}

function ask(name, text) {
  const argvClaude = ['-p', '--model', protocol.decider.model, '--effort', protocol.decider.effort,
    '--output-format', 'json', '--dangerously-skip-permissions', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--disable-slash-commands', '--no-session-persistence', '--setting-sources', 'project',
    '--settings', JSON.stringify({ enabledPlugins: { 'agents-md@builtin': false } }),
    '--max-turns', String(protocol.decider.maxTurns), '--disallowedTools', protocol.decider.disallowedTools.join(','),
    '--json-schema', JSON.stringify(schema)]
  const started = Date.now()
  return new Promise((resolveRun) => {
    const child = spawn('claude', argvClaude, { cwd: out, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = [], errors = []
    child.stdout.on('data', (d) => chunks.push(d))
    child.stderr.on('data', (d) => errors.push(d))
    child.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf8')
      writeFileSync(join(out, `${name}.result.json`), raw)
      let parsed = null
      try { parsed = JSON.parse(raw) } catch {}
      resolveRun({ code, seconds: (Date.now() - started) / 1000, structured: parsed?.structured_output ?? null, usage: parsed?.usage ?? null, stderr: Buffer.concat(errors).toString('utf8').slice(0, 500) })
    })
    child.stdin.end(text)
  })
}

const items = []
for (const dir of evidenceDirs) {
  for (const taskId of readdirSync(dir)) {
    const taskPath = join(packDir, 'tasks', `${taskId}.json`)
    if (!existsSync(taskPath)) continue
    const task = JSON.parse(readFileSync(taskPath, 'utf8'))
    if (!task.answerSchema) continue
    for (const arm of readdirSync(join(dir, taskId))) {
      const receiptPath = join(dir, taskId, arm, 'receipt.json')
      const answerPath = join(dir, taskId, arm, 'workspace', 'answer.json')
      if (!existsSync(receiptPath) || !existsSync(answerPath)) continue
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
      let answer
      try { answer = JSON.parse(readFileSync(answerPath, 'utf8')) } catch { continue }
      items.push({ run: receipt.experimentId, task, arm, accepted: Boolean(receipt.accepted), checkerPassed: Boolean(receipt.checker?.passed), answer })
    }
  }
}

const results = []
let next = 0
async function worker() {
  while (next < items.length) {
    const item = items[next++]
    const questions = questionsFor(item.task)
    const text = prompt(item.task, item.answer, questions)
    const name = sha(`${item.run}/${item.task.id}/${item.arm}`).slice(0, 16)
    let run = await ask(name, text)
    if (!run.structured) run = await ask(`${name}-retry`, text)
    const byId = new Map((run.structured?.answers ?? []).map((a) => [a.id, a]))
    const answered = questions.map((q) => ({ id: q.id, yes: byId.get(q.id)?.yes ?? null, probabilityYes: byId.get(q.id)?.probabilityYes ?? null }))
    results.push({ run: item.run, task: item.task.id, category: item.task.category, arm: item.arm, accepted: item.accepted, checkerPassed: item.checkerPassed,
      promptSha256: sha(text), seconds: run.seconds, usage: run.usage, parsed: Boolean(run.structured), answers: answered })
    process.stderr.write(`${results.length}/${items.length} ${item.run} ${item.task.id} ${item.arm} parsed=${Boolean(run.structured)}\n`)
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
writeFileSync(join(out, 'probe-results.json'), JSON.stringify(results, null, 1))

// Score = expected number of "no" answers; higher should mean rejection.
function auc(rows) {
  const pos = rows.filter((r) => !r.accepted), neg = rows.filter((r) => r.accepted)
  if (!pos.length || !neg.length) return null
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0
  return wins / (pos.length * neg.length)
}
const scored = results.filter((r) => r.parsed).map((r) => ({ ...r,
  score: r.answers.reduce((s, a) => s + (a.probabilityYes === null ? 0 : 1 - a.probabilityYes), 0),
  flags: r.answers.filter((a) => a.yes === false).length }))
const summary = (rows) => {
  const flagged = rows.filter((r) => r.flags > 0)
  const rejected = rows.filter((r) => !r.accepted)
  return { answers: rows.length, rejected: rejected.length, auc: auc(rows),
    anyFlag: { flagged: flagged.length, rejectedAmongFlagged: flagged.filter((r) => !r.accepted).length,
      rejectedCaught: rejected.filter((r) => r.flags > 0).length } }
}
const report = { protocol: protocol.probeId, all: summary(scored), checkerPassed: summary(scored.filter((r) => r.checkerPassed)),
  byCategory: Object.fromEntries(['orientation', 'diagnosis', 'impact'].map((c) => [c, summary(scored.filter((r) => r.category === c && r.checkerPassed))])),
  unparsed: results.filter((r) => !r.parsed).length,
  deciderUsage: results.reduce((u, r) => ({ input: u.input + (r.usage?.input_tokens ?? 0) + (r.usage?.cache_creation_input_tokens ?? 0) + (r.usage?.cache_read_input_tokens ?? 0), output: u.output + (r.usage?.output_tokens ?? 0) }), { input: 0, output: 0 }) }
writeFileSync(join(out, 'probe-summary.json'), JSON.stringify(report, null, 2))
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
