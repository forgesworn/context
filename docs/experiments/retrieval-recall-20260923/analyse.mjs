// Model-free retrieval measures from recorded executor streams.
// Usage: node analyse.mjs <label>=<evidence-dir> [...] > results.json
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const acceptanceDir = join(here, '../d5-20260921/acceptance')
// Tokens a Context tool prints in its own metadata, so their presence proves nothing about retrieval.
const toolMetadataTokens = new Set(['local-source-unsigned'])

const textOf = (content) => typeof content === 'string'
  ? content
  : (content ?? []).map((part) => part.type === 'text' ? part.text : '').join('\n')

function cells(dir) {
  const found = []
  const walk = (d, depth) => {
    if (existsSync(join(d, 'receipt.json')) && existsSync(join(d, 'executor.stream.jsonl'))) found.push(d)
    else if (depth < 4) for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (n !== 'workspace' && statSync(p).isDirectory()) walk(p, depth + 1)
    }
  }
  walk(dir, 0)
  return found
}

function analyse(cellDir) {
  const receipt = JSON.parse(readFileSync(join(cellDir, 'receipt.json'), 'utf8'))
  const acceptance = JSON.parse(readFileSync(join(acceptanceDir, `${receipt.task}.json`), 'utf8'))
  const required = acceptance.requiredEvidence ?? []
  const first = new Map()
  let turn = 0; let bytes = 0; let results = 0; let errors = 0; let requests = 0
  const seenCalls = new Map()
  let repeatedCalls = 0
  for (const line of readFileSync(join(cellDir, 'executor.stream.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue
    const event = JSON.parse(line)
    if (event.type === 'assistant') {
      requests += 1
      for (const part of event.message.content ?? []) {
        if (part.type !== 'tool_use') continue
        const key = `${part.name}:${JSON.stringify(part.input)}`
        if (seenCalls.has(key)) repeatedCalls += 1
        seenCalls.set(key, true)
      }
    }
    if (event.type !== 'user' || !Array.isArray(event.message?.content)) continue
    for (const part of event.message.content) {
      if (part.type !== 'tool_result') continue
      turn += 1; results += 1
      if (part.is_error) errors += 1
      const text = textOf(part.content)
      bytes += Buffer.byteLength(text)
      for (const [i, item] of required.entries()) {
        if (!first.has(i) && text.includes(item.token)) first.set(i, { result: turn, bytes })
      }
    }
  }
  const scored = required.map((item, i) => ({ token: item.token, leaked: toolMetadataTokens.has(item.token), at: first.get(i) ?? null }))
  const honest = scored.filter((s) => !s.leaked)
  const run = receipt.executorRun
  return {
    task: receipt.task, arm: receipt.arm, accepted: receipt.accepted,
    required: required.length,
    recall: required.length ? scored.filter((s) => s.at).length / required.length : null,
    recallExcludingToolMetadata: honest.length ? honest.filter((s) => s.at).length / honest.length : null,
    bytesToFullRecall: honest.length && honest.every((s) => s.at) ? Math.max(...honest.map((s) => s.at.bytes)) : null,
    missing: scored.filter((s) => !s.at).map((s) => s.token),
    toolResults: results, toolErrors: errors, repeatedCalls, toolResultBytes: bytes,
    turns: run.numTurns, inputTotal: run.inputTotal, inputUncached: run.inputUncached, output: run.output,
  }
}

const out = {}
for (const arg of process.argv.slice(2)) {
  const [label, dir] = arg.split('=')
  out[label] = cells(dir).map(analyse)
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`)
