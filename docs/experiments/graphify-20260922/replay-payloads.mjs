#!/usr/bin/env node
// Replay the Context arm's recorded MCP calls from a completed run against the
// frozen arm workspaces using the current context-tools build, and measure the
// tool-result payload in o200k_base tokens for the recorded JSON form and the
// compact text form. Also issues one repository_explore per distinct searched
// identifier to show what a single explore call costs. No model is involved.
// Usage: node replay-payloads.mjs --evidence /private/evidence [--dist packages/context-tools/dist] [--out FILE.md]
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'

const here = dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const opt = (key) => { const i = argv.indexOf(`--${key}`); return i >= 0 ? argv[i + 1] : undefined }
const evidence = resolve(opt('evidence') ?? '')
const dist = resolve(opt('dist') ?? join(here, '..', '..', '..', 'packages', 'context-tools', 'dist'))
const { createRepositoryNavigationServer } = await import(pathToFileURL(join(dist, 'repository-navigation-mcp.js')).href)

const tokens = (text) => encode(text).length
const textOf = (result) => (result.content ?? []).map((c) => c.text ?? '').join('')

function recordedCalls(streamPath) {
  const calls = []
  for (const line of readFileSync(streamPath, 'utf8').split('\n')) {
    if (!line) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    if (event.type !== 'assistant') continue
    for (const part of event.message?.content ?? []) {
      if (part.type !== 'tool_use' || !part.name.startsWith('mcp__z1p-repository__')) continue
      calls.push({ tool: part.name.replace('mcp__z1p-repository__', ''), input: part.input ?? {} })
    }
  }
  return calls
}

async function connect(root) {
  const { server } = createRepositoryNavigationServer(root)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'replay-payloads', version: '0' })
  await client.connect(clientTransport)
  return { client, close: async () => { await client.close(); await server.close() } }
}

const rows = []
const exploreRows = []
for (const task of readdirSync(evidence, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const stream = join(evidence, task, 'context', 'executor.stream.jsonl')
  const workspace = join(evidence, task, 'context', 'workspace')
  if (!existsSync(stream) || !existsSync(workspace)) continue
  const calls = recordedCalls(stream)
  const { client, close } = await connect(workspace)
  try {
    const refreshed = JSON.parse(textOf(await client.callTool({ name: 'repository_refresh', arguments: {} })))
    const generation = refreshed.generation
    const row = { task, searches: 0, searchJson: 0, searchText: 0, packets: 0, packetJson: 0, packetText: 0, errors: 0, explores: 0, exploreText: 0 }
    const cursors = { json: new Map(), text: new Map() }
    const terms = []
    for (const call of calls) {
      if (call.tool === 'repository_search') {
        const term = String(call.input.term ?? '')
        if (!terms.includes(term)) terms.push(term)
        row.searches += 1
        for (const format of ['json', 'text']) {
          const args = { ...call.input, format }
          if (call.input.cursor !== undefined) {
            const cursor = cursors[format].get(term)
            if (!cursor) { row.errors += 1; continue }
            args.cursor = cursor
          }
          const result = await client.callTool({ name: 'repository_search', arguments: args })
          const body = textOf(result)
          if (result.isError) row.errors += 1
          row[format === 'json' ? 'searchJson' : 'searchText'] += tokens(body)
          if (!result.isError) {
            const next = format === 'json' ? JSON.parse(body).nextCursor : (body.match(/^next: cursor ([a-f0-9]{32})/m) ?? [])[1]
            if (next) cursors[format].set(term, next); else cursors[format].delete(term)
          }
        }
      } else if (call.tool === 'repository_packet') {
        row.packets += 1
        for (const format of ['json', 'text']) {
          const result = await client.callTool({ name: 'repository_packet', arguments: { ...call.input, expectedGeneration: generation, format } })
          if (result.isError) row.errors += 1
          row[format === 'json' ? 'packetJson' : 'packetText'] += tokens(textOf(result))
        }
      }
    }
    for (const term of terms) {
      const result = await client.callTool({ name: 'repository_explore', arguments: { symbol: term } })
      const body = textOf(result)
      row.explores += 1
      row.exploreText += tokens(body)
      const header = body.split('\n')[0]
      const count = (label) => { const m = body.match(new RegExp(`^${label} (\\d+) lines in (\\d+) files`, 'm')); return m ? `${m[1]}/${m[2]}` : '0/0' }
      const definitions = (body.match(/^definition [^\n]+:\d+-\d+/gm) ?? []).length
      exploreRows.push({ task, term, tokens: tokens(body), error: !!result.isError, definitions, references: count('references'), tests: count('tests'), truncated: /omitted/.test(body), header: header.slice(0, 120) })
    }
    rows.push(row)
  } finally {
    await close()
  }
}

const sum = (key) => rows.reduce((total, row) => total + row[key], 0)
const pct = (before, after) => before ? `${(((before - after) / before) * 100).toFixed(1)}%` : '?'
const lines = ['| Task | Searches | Search tokens JSON | Search tokens text | Packets | Packet tokens JSON | Packet tokens text | Explore calls | Explore tokens | Errors |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |']
for (const row of rows) lines.push(`| ${row.task} | ${row.searches} | ${row.searchJson.toLocaleString('en-GB')} | ${row.searchText.toLocaleString('en-GB')} | ${row.packets} | ${row.packetJson.toLocaleString('en-GB')} | ${row.packetText.toLocaleString('en-GB')} | ${row.explores} | ${row.exploreText.toLocaleString('en-GB')} | ${row.errors} |`)
lines.push(`| total | ${sum('searches')} | ${sum('searchJson').toLocaleString('en-GB')} | ${sum('searchText').toLocaleString('en-GB')} | ${sum('packets')} | ${sum('packetJson').toLocaleString('en-GB')} | ${sum('packetText').toLocaleString('en-GB')} | ${sum('explores')} | ${sum('exploreText').toLocaleString('en-GB')} | ${sum('errors')} |`)
lines.push('', `Search payload: ${pct(sum('searchJson'), sum('searchText'))} fewer tokens as text. Packet payload: ${pct(sum('packetJson'), sum('packetText'))} fewer tokens as text.`)
lines.push('', '| Task | Symbol | Explore tokens | Definitions | References lines/files | Tests lines/files | Trimmed | Error |', '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |')
for (const row of exploreRows) lines.push(`| ${row.task} | ${row.term} | ${row.tokens.toLocaleString('en-GB')} | ${row.definitions} | ${row.references} | ${row.tests} | ${row.truncated ? 'yes' : 'no'} | ${row.error ? 'yes' : 'no'} |`)
const text = lines.join('\n') + '\n'
process.stdout.write(text)
writeFileSync(join(evidence, 'replay-payloads.json'), JSON.stringify({ rows, exploreRows }, null, 2))
if (opt('out')) writeFileSync(resolve(opt('out')), text)
