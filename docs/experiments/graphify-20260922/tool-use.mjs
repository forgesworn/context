#!/usr/bin/env node
// Tabulate how each arm actually used its retrieval tools, from the executor
// transcripts: Context MCP calls by tool with result bytes, Graphify CLI calls,
// and built-in file reads. Usage: node tool-use.mjs --evidence /private/evidence
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const argv = process.argv.slice(2)
const opt = (key) => { const i = argv.indexOf(`--${key}`); return i >= 0 ? argv[i + 1] : undefined }
const evidence = resolve(opt('evidence') ?? '')
const arms = ['plain', 'graphify', 'context']

function events(path) {
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
}

function summarise(streamPath) {
  const list = events(streamPath)
  const uses = new Map()
  const counts = { status: 0, refresh: 0, explore: 0, search: 0, packet: 0, graphify: 0, read: 0, bash: 0, other: 0, contextBytes: 0, readBytes: 0, bashBytes: 0 }
  for (const event of list) {
    if (event.type !== 'assistant') continue
    for (const part of event.message?.content ?? []) {
      if (part.type !== 'tool_use') continue
      uses.set(part.id, part)
      const name = part.name
      if (name.startsWith('mcp__z1p-repository__')) counts[name.replace('mcp__z1p-repository__repository_', '')] += 1
      else if (name === 'Bash' && /(^|\s|\/)graphify\s/.test(part.input?.command ?? '')) counts.graphify += 1
      else if (name === 'Read') counts.read += 1
      else if (name === 'Bash') counts.bash += 1
      else counts.other += 1
    }
  }
  for (const event of list) {
    if (event.type !== 'user') continue
    for (const part of event.message?.content ?? []) {
      if (part.type !== 'tool_result') continue
      const use = uses.get(part.tool_use_id)
      if (!use) continue
      const bytes = Buffer.byteLength(Array.isArray(part.content) ? part.content.map((c) => c.text ?? '').join('') : String(part.content ?? ''), 'utf8')
      if (use.name.startsWith('mcp__z1p-repository__')) counts.contextBytes += bytes
      else if (use.name === 'Read') counts.readBytes += bytes
      else if (use.name === 'Bash') counts.bashBytes += bytes
    }
  }
  return counts
}

const fmt = (n) => n.toLocaleString('en-GB')
const lines = ['| Task | Arm | Context status/refresh/explore/search/packet | Context bytes | Graphify CLI | Reads | Read bytes | Bash | Bash bytes |', '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |']
const totals = {}
for (const task of readdirSync(evidence, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  for (const arm of arms) {
    const stream = join(evidence, task, arm, 'executor.stream.jsonl')
    if (!existsSync(stream)) continue
    const c = summarise(stream)
    totals[arm] ??= { status: 0, refresh: 0, explore: 0, search: 0, packet: 0, graphify: 0, read: 0, bash: 0, contextBytes: 0, readBytes: 0, bashBytes: 0 }
    for (const key of Object.keys(totals[arm])) totals[arm][key] += c[key]
    lines.push(`| ${task} | ${arm} | ${arm === 'context' ? `${c.status} / ${c.refresh} / ${c.explore} / ${c.search} / ${c.packet}` : ''} | ${arm === 'context' ? fmt(c.contextBytes) : ''} | ${arm === 'graphify' ? c.graphify : ''} | ${c.read} | ${fmt(c.readBytes)} | ${c.bash} | ${fmt(c.bashBytes)} |`)
  }
}
lines.push('')
for (const [arm, t] of Object.entries(totals)) lines.push(`${arm}: ${arm === 'context' ? `context calls ${t.status}/${t.refresh}/${t.explore}/${t.search}/${t.packet} returning ${fmt(t.contextBytes)} bytes; ` : ''}${arm === 'graphify' ? `graphify CLI calls ${t.graphify}; ` : ''}reads ${t.read} (${fmt(t.readBytes)} bytes); bash ${t.bash} (${fmt(t.bashBytes)} bytes).`)
process.stdout.write(lines.join('\n') + '\n')
