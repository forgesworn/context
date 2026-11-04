#!/usr/bin/env node
// OS2 phase 0 transcript metrics. Model-free; reads one recorded executor stream.
//
// Input: a `codex exec --json` stream as the v3 runner writes it, one JSON object
// per line, either the raw event or wrapped as {"event": ...}. Only
// `item.completed` events are used:
//   command_execution: command, aggregated_output, exit_code, status
//   mcp_tool_call:     server, tool, status, error, result.content[].text, result.isError
//   file_change:       counted as a tool result only
// Field names were confirmed from the Codex 0.166.0 binary and the v3 runner. They
// are checked against a real 0.166.0 stream by the write probe; nothing earlier.
//
// Packet coverage comes from repository_packet results on server z1p-repository:
// the 0.26.0 text header `source <path>:<start>-<end>  sha256 <hash>  <N> lines`,
// or the JSON form's packet.sources[].{path,startLine,endLine}.
//
// readsAfterPacket = distinct packet-covered files later read directly with an
// overlapping line range (whole file when the command gives no range), divided by
// distinct packet-covered files. Reads before a file's covering packet do not count.
// Searches (rg, grep, git grep, find) are the plain arm's prescribed behaviour and
// are reported separately, outside the threshold. Commands the classifier does
// not recognise are counted as unclassified so classifier coverage stays visible.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { posix } from 'node:path'

const READERS = new Set(['cat', 'nl', 'bat', 'head', 'tail', 'sed', 'awk', 'less', 'more'])
const SEARCHERS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'ag', 'find', 'fd'])
const NON_READS = new Set([
  'ls', 'cd', 'pwd', 'echo', 'printf', 'true', 'false', 'test', '[', 'mkdir', 'touch', 'rm', 'mv', 'cp',
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'python', 'python3', 'pytest', 'tsc', 'vitest', 'cargo',
  'wc', 'sort', 'uniq', 'cut', 'tr', 'xargs', 'jq', 'diff', 'apply_patch', 'export', 'set', 'which', 'env', 'date',
])

export function parseEvents(text) {
  const events = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let value
    try { value = JSON.parse(line) } catch { continue }
    const event = value && typeof value.event === 'object' && value.event !== null ? value.event : value
    if (event && typeof event === 'object') events.push(event)
  }
  return events
}

/** Ranges a packet result returned, as [{path, start, end}]. */
export function packetRanges(item) {
  const ranges = []
  for (const content of item?.result?.content ?? []) {
    const text = typeof content?.text === 'string' ? content.text : ''
    try {
      const json = JSON.parse(text)
      const sources = json?.packet?.sources ?? json?.sources
      if (Array.isArray(sources)) {
        for (const s of sources) {
          if (typeof s?.path === 'string' && Number.isInteger(s.startLine) && Number.isInteger(s.endLine)) {
            ranges.push({ path: normalise(s.path), start: s.startLine, end: s.endLine })
          }
        }
        continue
      }
    } catch { /* text form */ }
    for (const m of text.matchAll(/^source (\S+):(\d+)-(\d+)\s/gm)) {
      ranges.push({ path: normalise(m[1]), start: Number(m[2]), end: Number(m[3]) })
    }
  }
  return ranges
}

/** Split a shell command into words, honouring single and double quotes and
 * treating && || ; | and newlines as segment separators. Output redirect targets
 * (`> out`, `2>&1`) are dropped; `< file` keeps the file as a word. */
export function segments(command) {
  const out = []
  let words = [], word = '', quote = null, has = false, dropNext = false
  const endWord = () => {
    if (has) { if (dropNext) dropNext = false; else words.push(word) }
    word = ''; has = false
  }
  const endSegment = () => { endWord(); dropNext = false; if (words.length) out.push(words); words = [] }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += c
      continue
    }
    if (c === "'" || c === '"') { quote = c; has = true; continue }
    if (c === '\\' && i + 1 < command.length) { word += command[++i]; has = true; continue }
    if (c === ' ' || c === '\t') { endWord(); continue }
    if (c === '\n' || c === ';') { endSegment(); continue }
    if ((c === '&' || c === '|') && command[i + 1] === c) { endSegment(); i++; continue }
    if (c === '|') { endSegment(); continue }
    if (c === '>') {
      if (/^\d*$/.test(word)) { word = ''; has = false } else endWord()
      if (command[i + 1] === '>') i++
      if (command[i + 1] === '&') { i++; while (/\d|-/.test(command[i + 1] ?? '')) i++; continue }
      dropNext = true; continue
    }
    if (c === '<') { endWord(); continue }
    word += c; has = true
  }
  endSegment()
  return out
}

/** Unwrap `bash -lc '<script>'` and similar into the inner script. */
export function innerScript(command) {
  const parts = Array.isArray(command) ? command : null
  if (parts) {
    const i = parts.findIndex(p => p === '-c' || p === '-lc')
    return i >= 0 && i + 1 < parts.length ? parts[i + 1] : parts.join(' ')
  }
  const words = segments(command)[0] ?? []
  if (/^(\/bin\/|\/usr\/bin\/)?(ba|z)?sh$/.test(words[0] ?? '') && (words[1] === '-c' || words[1] === '-lc') && words[2]) return words[2]
  return command
}

function normalise(path, root) {
  let p = path
  if (root && p.startsWith(root.endsWith('/') ? root : root + '/')) p = p.slice(root.length + (root.endsWith('/') ? 0 : 1))
  p = posix.normalize(p)
  return p.startsWith('./') ? p.slice(2) : p
}

const WHOLE = { start: 1, end: Number.MAX_SAFE_INTEGER }

/** Classify one segment: {kind: 'read'|'search'|'other'|'unclassified', reads: [{path,start,end}]} */
export function classify(words, root) {
  const name = posix.basename(words[0] ?? '')
  const args = words.slice(1)
  if (READERS.has(name)) {
    const reads = []
    if (name === 'sed') {
      let ranges = null; const files = []
      for (let i = 0; i < args.length; i++) {
        const a = args[i]
        if (a === '-n') continue
        if (a === '-e' && i + 1 < args.length) { ranges = parseSedRanges(args[++i]) ?? ranges; continue }
        if (ranges === null && parseSedRanges(a)) { ranges = parseSedRanges(a); continue }
        if (!a.startsWith('-')) files.push(a)
      }
      for (const f of files) for (const r of ranges ?? [WHOLE]) reads.push({ path: normalise(f, root), ...r })
      return { kind: 'read', reads }
    }
    if (name === 'awk') {
      const program = args.find(a => !a.startsWith('-')) ?? ''
      const files = args.filter(a => !a.startsWith('-') && a !== program)
      const m = program.match(/NR\s*>=?\s*(\d+)\s*&&\s*NR\s*<=?\s*(\d+)/)
      const r = m ? { start: Number(m[1]), end: Number(m[2]) } : WHOLE
      for (const f of files) reads.push({ path: normalise(f, root), ...r })
      return { kind: 'read', reads }
    }
    let count = null; const files = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if ((a === '-n' || a === '-c') && i + 1 < args.length) { count = Number(args[++i]); continue }
      if (/^-\d+$/.test(a)) { count = Number(a.slice(1)); continue }
      if (/^-n\d+$/.test(a)) { count = Number(a.slice(2)); continue }
      if (a.startsWith('-')) continue
      files.push(a)
    }
    const r = name === 'head' ? { start: 1, end: Number.isFinite(count) && count > 0 ? count : 10 } : WHOLE
    for (const f of files) reads.push({ path: normalise(f, root), ...r })
    return { kind: 'read', reads }
  }
  if (SEARCHERS.has(name) || (name === 'git' && args[0] === 'grep')) return { kind: 'search', reads: [] }
  if (NON_READS.has(name) || /^[A-Z_][A-Z0-9_]*=/.test(words[0] ?? '')) return { kind: 'other', reads: [] }
  return { kind: 'unclassified', reads: [] }
}

function parseSedRanges(script) {
  const parts = script.split(';').map(s => s.trim()).filter(Boolean)
  const out = []
  for (const p of parts) {
    const m = p.match(/^(\d+)(?:,(\d+|\$))?p$/)
    if (!m) return null
    out.push({ start: Number(m[1]), end: m[2] === undefined ? Number(m[1]) : m[2] === '$' ? Number.MAX_SAFE_INTEGER : Number(m[2]) })
  }
  return out.length ? out : null
}

const overlaps = (a, b) => a.start <= b.end && b.start <= a.end

export function measure(events, { root } = {}) {
  const covered = new Map() // path -> ranges returned so far
  const reread = new Set()
  let toolResults = 0, toolErrors = 0, nonZeroExits = 0, packets = 0
  let searchesAfterPacket = 0, readsBeforePacket = 0, unclassified = 0, commands = 0
  for (const event of events) {
    if (event.type !== 'item.completed') continue
    const item = event.item ?? {}
    if (!['command_execution', 'mcp_tool_call', 'file_change'].includes(item.type)) continue
    toolResults++
    if (item.type === 'mcp_tool_call') {
      if (item.status !== 'completed' || item.error || item.result?.isError) toolErrors++
      if (item.server === 'z1p-repository' && item.tool === 'repository_packet' && item.status === 'completed' && !item.error && !item.result?.isError) {
        packets++
        for (const r of packetRanges(item)) {
          if (!covered.has(r.path)) covered.set(r.path, [])
          covered.get(r.path).push(r)
        }
      }
      continue
    }
    if (item.type === 'file_change') { if (item.status && item.status !== 'completed') toolErrors++; continue }
    commands++
    if (item.status && item.status !== 'completed' && item.status !== 'failed') toolErrors++
    else if (item.status === 'failed' && item.exit_code == null) toolErrors++
    if (Number.isInteger(item.exit_code) && item.exit_code !== 0) nonZeroExits++
    for (const words of segments(innerScript(item.command ?? ''))) {
      const c = classify(words, root)
      if (c.kind === 'unclassified') unclassified++
      if (c.kind === 'search' && packets > 0) searchesAfterPacket++
      for (const r of c.reads) {
        const prior = covered.get(r.path)
        if (prior && prior.some(p => overlaps(p, r))) reread.add(r.path)
        else if (!prior) readsBeforePacket++
      }
    }
  }
  return {
    packets,
    packetCoveredFiles: covered.size,
    rereadFiles: [...reread].sort(),
    readsAfterPacket: covered.size ? reread.size / covered.size : null,
    searchesAfterPacket,
    readsOutsidePackets: readsBeforePacket,
    commands,
    unclassifiedSegments: unclassified,
    toolResults,
    toolErrors,
    toolErrorRate: toolResults ? toolErrors / toolResults : null,
    nonZeroExits,
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, ...rest] = process.argv.slice(2)
  if (!file) { console.error('usage: node metrics.mjs <events.jsonl> [--root <workspace>]'); process.exit(2) }
  const i = rest.indexOf('--root')
  const root = i >= 0 ? rest[i + 1] : undefined
  console.log(JSON.stringify(measure(parseEvents(readFileSync(file, 'utf8')), { root }), null, 2))
}
