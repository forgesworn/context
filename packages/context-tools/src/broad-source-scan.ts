import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { ContextRecord, ContextRelation } from '@forgesworn/context'

export interface BroadSourceGraphScanOptions {
  maxFiles?: number; maxDepth?: number; maxBytes?: number; maxFileBytes?: number; maxRecords?: number; observedAt?: number
}
export interface BroadSourceGraphScan {
  root: string; records: ContextRecord[]; filesScanned: number; filesSkipped: number; bytesRead: number
  symbolsFound: number; importsFound: number; languages: string[]
}
type Language = 'python' | 'rust' | 'go' | 'java' | 'kotlin' | 'swift' | 'c' | 'cpp' | 'csharp' | 'ruby' | 'php'
interface Declaration { kind: string; name: string; line: number }
interface ParsedFile { absolute: string; path: string; language: Language; declarations: Declaration[]; imports: string[] }

const ignored = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage', 'out', 'target', 'vendor', '__pycache__'])
const languages = new Map<string, Language>([
  ['.py', 'python'], ['.rs', 'rust'], ['.go', 'go'], ['.java', 'java'], ['.kt', 'kotlin'], ['.kts', 'kotlin'],
  ['.swift', 'swift'], ['.c', 'c'], ['.h', 'c'], ['.cc', 'cpp'], ['.cpp', 'cpp'], ['.cxx', 'cpp'], ['.hh', 'cpp'],
  ['.hpp', 'cpp'], ['.hxx', 'cpp'], ['.cs', 'csharp'], ['.rb', 'ruby'], ['.php', 'php'],
])
const decoder = new TextDecoder('utf-8', { fatal: true })
const extracted = { derivation: 'extracted', method: 'source-file', confidence: 100 } as const
const inferred = { derivation: 'inferred', method: 'language-regex', confidence: 60 } as const
const ambiguous = { derivation: 'ambiguous', method: 'language-regex', confidence: 30 } as const
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function normal(root: string, path: string): string { return relative(root, path).split(sep).join('/') }
function id(type: 'file' | 'symbol', value: string): string {
  return createHash('sha256').update(`forgesworn/context/broad-source-${type}/v1\0${value}`).digest('hex')
}
function lineAt(text: string, offset: number): number { return text.slice(0, offset).split('\n').length }
async function readBounded(path: string, max: number): Promise<{ text: string; bytes: number }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat(); assert(info.isFile() && info.size <= max, 'Source is not a bounded regular file.')
    const bytes = await handle.readFile(); assert(bytes.byteLength <= max, 'Source file grew beyond its byte limit.')
    return { text: decoder.decode(bytes), bytes: bytes.byteLength }
  } finally { await handle.close() }
}

/** Mask comments and optionally quoted strings while retaining offsets/newlines.
 * This is deliberately lexical, not a claim of parsing any supported language. */
function sanitise(text: string, hideStrings: boolean, hashComments: boolean): string {
  const out = [...text], blank = (i: number) => { if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ' }
  let quote = '', triple = false, line = false, block = false
  for (let i = 0; i < out.length; i++) {
    const ch = out[i], next = out[i + 1]
    if (line) { if (ch === '\n') line = false; else blank(i); continue }
    if (block) { blank(i); if (ch === '*' && next === '/') { blank(++i); block = false }; continue }
    if (quote) {
      if (hideStrings) blank(i)
      if (ch === '\\') { if (hideStrings && i + 1 < out.length) blank(i + 1); i++; continue }
      if (triple && ch === quote && next === quote && out[i + 2] === quote) {
        if (hideStrings) { blank(i + 1); blank(i + 2) }; i += 2; quote = ''; triple = false
      } else if (!triple && ch === quote) quote = ''
      continue
    }
    if (ch === '/' && next === '/') { blank(i); blank(++i); line = true; continue }
    if (ch === '/' && next === '*') { blank(i); blank(++i); block = true; continue }
    if (hashComments && ch === '#') { blank(i); line = true; continue }
    if (ch === '"' || ch === "'" || ch === '`') {
      triple = (ch === '"' || ch === "'") && next === ch && out[i + 2] === ch
      quote = ch
      if (hideStrings) { blank(i); if (triple) { blank(i + 1); blank(i + 2); i += 2 } }
    }
  }
  return out.join('')
}

const declarations: Record<Language, { kind: string; regex: RegExp }[]> = {
  python: [{ kind: 'function', regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm }, { kind: 'class', regex: /^\s*class\s+([A-Za-z_]\w*)/gm }],
  rust: ['fn', 'struct', 'enum', 'trait', 'mod'].map(kind => ({ kind, regex: new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?${kind}\\s+([A-Za-z_]\\w*)`, 'gm') })),
  go: [{ kind: 'function', regex: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm }, { kind: 'type', regex: /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/gm }],
  java: [{ kind: 'type', regex: /^\s*(?:(?:public|protected|private|static|final|abstract|sealed|non-sealed)\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/gm }],
  kotlin: [{ kind: 'type', regex: /^\s*(?:(?:public|private|internal|protected|data|sealed|enum)\s+)*(?:class|interface|object)\s+([A-Za-z_]\w*)/gm }, { kind: 'function', regex: /^\s*(?:(?:public|private|internal|protected|suspend|inline)\s+)*fun\s+([A-Za-z_]\w*)/gm }],
  swift: [{ kind: 'type', regex: /^\s*(?:(?:public|private|internal|fileprivate|open|final)\s+)*(?:class|struct|enum|protocol|actor|extension)\s+([A-Za-z_]\w*)/gm }, { kind: 'function', regex: /^\s*(?:(?:public|private|internal|fileprivate|open|static|class)\s+)*func\s+([A-Za-z_]\w*)/gm }],
  c: [{ kind: 'type', regex: /^\s*(?:typedef\s+)?(?:struct|union|enum)\s+([A-Za-z_]\w*)/gm }, { kind: 'function', regex: /^\s*(?:static\s+|extern\s+|inline\s+)*[A-Za-z_]\w*(?:\s+|\s*\*+\s*)([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/gm }],
  cpp: [{ kind: 'type', regex: /^\s*(?:template\s*<[^>]*>\s*)?(?:class|struct|enum(?:\s+class)?)\s+([A-Za-z_]\w*)/gm }, { kind: 'function', regex: /^\s*(?:static\s+|inline\s+|virtual\s+)*[A-Za-z_]\w*(?:[\w:<>,*&\s]*\s)([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/gm }],
  csharp: [{ kind: 'type', regex: /^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial)\s+)*(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/gm }, { kind: 'function', regex: /^\s*(?:(?:public|private|protected|internal|static|async|virtual|override)\s+)+[A-Za-z_][\w<>\[\],?]*\s+([A-Za-z_]\w*)\s*\(/gm }],
  ruby: [{ kind: 'type', regex: /^\s*(?:class|module)\s+([A-Z]\w*(?:::[A-Z]\w*)*)/gm }, { kind: 'function', regex: /^\s*def\s+(?:self\.)?([a-z_]\w*[!?=]?)/gm }],
  php: [{ kind: 'type', regex: /^\s*(?:<\?php\s+)?(?:(?:abstract|final)\s+)?(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/gm }, { kind: 'function', regex: /^\s*(?:<\?php\s+)?(?:(?:public|private|protected|static)\s+)*function\s+([A-Za-z_]\w*)/gm }],
}
function importSpecs(language: Language, text: string): string[] {
  const specs: string[] = [], add = (value: string) => { if (value && !specs.includes(value)) specs.push(value) }
  const patterns: RegExp[] = language === 'python' ? [/^\s*from\s+(\.+[A-Za-z0-9_.]*)\s+import\s+/gm]
    : language === 'rust' ? [/^\s*mod\s+([A-Za-z_]\w*)\s*;/gm]
    : language === 'c' || language === 'cpp' ? [/^\s*#\s*include\s+"([^"]+)"/gm]
    : language === 'ruby' ? [/^\s*require_relative\s+["']([^"']+)["']/gm]
    : language === 'php' ? [/^\s*(?:require|include)(?:_once)?\s*(?:\(\s*)?__DIR__\s*\.\s*["']([^"']+)["']/gm]
    : language === 'go' ? [/^\s*(?:import\s+)?(?:[A-Za-z_]\w*\s+)?["'](\.{1,2}\/[^"']+)["']/gm] : []
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) add(match[1])
  return specs.sort()
}
function candidates(file: ParsedFile, spec: string): string[] {
  const base = dirname(file.absolute)
  if (file.language === 'python') {
    const dots = spec.match(/^\.+/)![0].length, module = spec.slice(dots).replaceAll('.', sep)
    let root = base; for (let i = 1; i < dots; i++) root = dirname(root)
    return [resolve(root, `${module}.py`), resolve(root, module, '__init__.py')]
  }
  if (file.language === 'rust') return [resolve(base, `${spec}.rs`), resolve(base, spec, 'mod.rs')]
  if (file.language === 'ruby') return [resolve(base, spec.endsWith('.rb') ? spec : `${spec}.rb`)]
  if (file.language === 'php') return [resolve(base, `.${spec}`)]
  if (file.language === 'go') return [resolve(base, spec)]
  return [resolve(base, spec)]
}

export async function scanBroadSourceGraph(root: string, options: BroadSourceGraphScanOptions = {}): Promise<BroadSourceGraphScan> {
  assert(typeof root === 'string' && root.length > 0, 'Broad source scan root is required.')
  const maxFiles = options.maxFiles ?? 64, maxDepth = options.maxDepth ?? 8, maxBytes = options.maxBytes ?? 1024 * 1024
  const maxFileBytes = options.maxFileBytes ?? 256 * 1024, maxRecords = options.maxRecords ?? 128
  const observedAt = options.observedAt ?? Math.floor(Date.now() / 1000)
  assert(Number.isSafeInteger(maxFiles) && maxFiles >= 1 && maxFiles <= 128, 'Broad source scan allows 1 to 128 files.')
  assert(Number.isSafeInteger(maxDepth) && maxDepth >= 0 && maxDepth <= 16, 'Broad source scan depth must be 0 to 16.')
  assert(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 8 * 1024 * 1024, 'Broad source scan byte budget must be 1024 to 8388608 bytes.')
  assert(Number.isSafeInteger(maxFileBytes) && maxFileBytes >= 1024 && maxFileBytes <= 1024 * 1024 && maxFileBytes <= maxBytes, 'Broad source file budget must be 1024 to 1048576 bytes and no larger than the total budget.')
  assert(Number.isSafeInteger(maxRecords) && maxRecords >= 1 && maxRecords <= 128, 'Broad source scan allows 1 to 128 records.')
  assert(Number.isSafeInteger(observedAt) && observedAt >= 0, 'Broad source scan observation time is invalid.')
  const canonicalRoot = await realpath(root); assert((await stat(canonicalRoot)).isDirectory(), 'Broad source scan root must be a directory.')
  const found: string[] = []; let filesSkipped = 0
  async function visit(directory: string, depth: number): Promise<void> {
    if (found.length >= maxFiles) return
    const entries = []; for await (const entry of await opendir(directory)) entries.push(entry)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue
      const path = join(directory, entry.name), info = await lstat(path).catch(() => undefined)
      if (!info || info.isSymbolicLink()) { if (info?.isSymbolicLink()) filesSkipped++; continue }
      if (info.isDirectory()) { if (depth < maxDepth) await visit(path, depth + 1); if (found.length >= maxFiles) return; continue }
      if (!info.isFile() || !languages.has(extname(entry.name).toLowerCase())) continue
      if (info.size > maxFileBytes || `repo://${normal(canonicalRoot, path)}`.length > 1000) { filesSkipped++; continue }
      found.push(path); if (found.length >= maxFiles) return
    }
  }
  await visit(canonicalRoot, 0); found.sort((a, b) => normal(canonicalRoot, a).localeCompare(normal(canonicalRoot, b)))
  const parsed: ParsedFile[] = []; let bytesRead = 0
  for (const absolute of found) try {
    const read = await readBounded(absolute, maxFileBytes)
    if (bytesRead + read.bytes > maxBytes) { filesSkipped++; continue }
    bytesRead += read.bytes
    const path = normal(canonicalRoot, absolute), language = languages.get(extname(absolute).toLowerCase())!
    const commentFree = sanitise(read.text, false, ['python', 'ruby', 'php'].includes(language))
    const clean = sanitise(read.text, true, ['python', 'ruby', 'php'].includes(language)), declarationsFound: Declaration[] = []
    for (const { kind, regex } of declarations[language]) for (const match of clean.matchAll(regex)) {
      const name = match[1]; if (name && name.length <= 200) declarationsFound.push({ kind, name, line: lineAt(clean, match.index!) })
    }
    const unique = new Map(declarationsFound.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name)).map(item => [`${item.kind}:${item.name}:${item.line}`, item]))
    parsed.push({ absolute, path, language, declarations: [...unique.values()], imports: importSpecs(language, commentFree) })
  } catch { filesSkipped++ }
  const known = new Set(parsed.map(file => file.absolute)), fileIds = new Map(parsed.map(file => [file.path, id('file', file.path)]))
  const resolved = new Map<string, string[]>()
  for (const file of parsed) for (const spec of file.imports) {
    const targets = candidates(file, spec).filter(path => known.has(path)).sort()
    if (targets.length === 1) resolved.set(file.path, [...(resolved.get(file.path) ?? []), normal(canonicalRoot, targets[0])])
  }
  const fileCandidates = parsed.map(file => ({ type: 'file' as const, file }))
  const symbolCandidates = parsed.flatMap(file => file.declarations.map(symbol => ({ type: 'symbol' as const, file, symbol })))
  const retained = [...fileCandidates, ...symbolCandidates].slice(0, maxRecords), retainedFiles = new Set(retained.filter(item => item.type === 'file').map(item => item.file.path))
  let importsFound = 0
  const records = retained.map((item): ContextRecord => {
    if (item.type === 'file') {
      const targets = [...new Set(resolved.get(item.file.path) ?? [])].filter(path => retainedFiles.has(path)).sort()
      const relations: ContextRelation[] = targets.map((path): ContextRelation => ({ to: fileIds.get(path)!, kind: 'imports' })).slice(0, 16); importsFound += relations.length
      return { id: fileIds.get(item.file.path)!, kind: 'evidence', text: `Source file ${item.file.path} (${item.file.language}): ${item.file.declarations.length} declaration${item.file.declarations.length === 1 ? '' : 's'}; ${relations.length} resolved internal import${relations.length === 1 ? '' : 's'}.`, source: `repo://${item.file.path}`, observedAt,
        provenance: relations.length ? ambiguous : extracted, ...(relations.length ? { relations } : {}) }
    }
    const symbol = item.symbol
    return { id: id('symbol', `${item.file.path}#${symbol.kind}:${symbol.name}:${symbol.line}`), kind: 'evidence',
      text: `Inferred ${symbol.kind} ${symbol.name} in ${item.file.path} at line ${symbol.line}.`,
      source: `repo://${item.file.path}#${encodeURIComponent(`${symbol.kind}:${symbol.name}:${symbol.line}`)}`, observedAt,
      provenance: inferred, ...(retainedFiles.has(item.file.path) ? { relations: [{ to: fileIds.get(item.file.path)!, kind: 'relates-to' }] as ContextRelation[] } : {}) }
  })
  return { root: canonicalRoot, records, filesScanned: parsed.length, filesSkipped, bytesRead,
    symbolsFound: parsed.reduce((sum, file) => sum + file.declarations.length, 0), importsFound,
    languages: [...new Set(parsed.map(file => file.language))].sort() }
}
