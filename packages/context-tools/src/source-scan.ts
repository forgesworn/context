import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { ContextRecord, ContextRelation, ContextRelationKind } from '@forgesworn/context'

export interface SourceGraphScanOptions {
  maxFiles?: number
  maxDepth?: number
  maxBytes?: number
  maxFileBytes?: number
  maxRecords?: number
  observedAt?: number
}
export interface SourceGraphScan {
  /** Canonical absolute path for the local operator; never copied into records. */
  root: string
  records: ContextRecord[]
  filesScanned: number
  filesSkipped: number
  bytesRead: number
  symbolsFound: number
  importsFound: number
  callsFound: number
}

type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable'
interface ImportBinding { target: string; imported: string }
interface ParsedSymbol { key: string; file: string; name: string; kind: SymbolKind; exported: boolean; line: number; parameters?: number; node: ts.Node; className?: string }
interface ParsedFile { path: string; bytes: number; source: ts.SourceFile; imports: string[]; bindings: Map<string, ImportBinding>; symbols: ParsedSymbol[] }

const ignored = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage', 'out'])
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'])
const resolutionExtensions = [...extensions]
const decoder = new TextDecoder('utf-8', { fatal: true })
const provenance = { derivation: 'extracted', method: 'typescript-ast', confidence: 90 } as const
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function normal(root: string, path: string): string { return relative(root, path).split(sep).join('/') }
function validRecordSource(value: string): boolean { return value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f]/u.test(value) }
function id(kind: 'file' | 'symbol', value: string): string {
  return createHash('sha256').update(`forgesworn/context/source-${kind}/v1\0${value}`).digest('hex')
}
function exported(node: ts.Node): boolean {
  return !!ts.getCombinedModifierFlags(node as ts.Declaration) && !!(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export)
}
function sourceKind(path: string): ts.ScriptKind {
  const ext = extname(path)
  return ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : ['.js', '.mjs', '.cjs'].includes(ext) ? ts.ScriptKind.JS : ts.ScriptKind.TS
}
function resolveImport(from: string, specifier: string, known: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined
  const raw = resolve(dirname(from), specifier).split(sep).join('/')
  const suffix = extname(raw)
  const substitutions = suffix === '.js' || suffix === '.jsx'
    ? ['.ts', '.tsx', '.js', '.jsx']
    : suffix === '.mjs' ? ['.mts', '.mjs'] : suffix === '.cjs' ? ['.cts', '.cjs'] : []
  const stem = substitutions.length ? raw.slice(0, -suffix.length) : raw
  const choices = [raw, ...substitutions.map(ext => stem + ext),
    ...(suffix ? [] : resolutionExtensions.map(ext => raw + ext)),
    ...(suffix ? [] : resolutionExtensions.map(ext => `${raw}/index${ext}`))]
  return choices.find(candidate => known.has(candidate))
}
function declarationName(node: ts.DeclarationStatement): string | undefined {
  const name = 'name' in node ? node.name : undefined
  return name && ts.isIdentifier(name) ? name.text : undefined
}
function relation(to: string, kind: ContextRelationKind): ContextRelation { return { to, kind } }
function relationSort(a: ContextRelation, b: ContextRelation): number { return a.kind.localeCompare(b.kind) || a.to.localeCompare(b.to) }

async function readBounded(path: string, max: number): Promise<{ text: string; bytes: number }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    assert(info.isFile() && info.size <= max, 'Source is not a bounded regular file.')
    const bytes = await handle.readFile()
    assert(bytes.byteLength <= max, 'Source file grew beyond its byte limit.')
    return { text: decoder.decode(bytes), bytes: bytes.byteLength }
  } finally { await handle.close() }
}

/** Parse local TypeScript and JavaScript syntax into bounded evidence records.
 * This never executes code, loads a tsconfig or follows a symlink. Relations
 * are syntax-backed hints, not type-checked proof or execution authority. */
export async function scanSourceGraph(root: string, options: SourceGraphScanOptions = {}): Promise<SourceGraphScan> {
  assert(typeof root === 'string' && root.length > 0, 'Source scan root is required.')
  const maxFiles = options.maxFiles ?? 64, maxDepth = options.maxDepth ?? 8
  const maxBytes = options.maxBytes ?? 1024 * 1024, maxFileBytes = options.maxFileBytes ?? 256 * 1024
  const maxRecords = options.maxRecords ?? 128, observedAt = options.observedAt ?? Math.floor(Date.now() / 1000)
  assert(Number.isSafeInteger(maxFiles) && maxFiles >= 1 && maxFiles <= 128, 'Source scan allows 1 to 128 files.')
  assert(Number.isSafeInteger(maxDepth) && maxDepth >= 0 && maxDepth <= 16, 'Source scan depth must be 0 to 16.')
  assert(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 8 * 1024 * 1024, 'Source scan byte budget must be 1024 to 8388608 bytes.')
  assert(Number.isSafeInteger(maxFileBytes) && maxFileBytes >= 1024 && maxFileBytes <= 1024 * 1024 && maxFileBytes <= maxBytes, 'Source scan file budget must be 1024 to 1048576 bytes and no larger than the total budget.')
  assert(Number.isSafeInteger(maxRecords) && maxRecords >= 1 && maxRecords <= 128, 'Source scan allows 1 to 128 records.')
  assert(Number.isSafeInteger(observedAt) && observedAt >= 0, 'Source scan observation time is invalid.')
  const canonicalRoot = await realpath(root)
  assert((await stat(canonicalRoot)).isDirectory(), 'Source scan root must be a directory.')

  const discovered: string[] = []
  let filesSkipped = 0
  async function visit(directory: string, depth: number): Promise<void> {
    if (discovered.length >= maxFiles) return
    const entries = []
    for await (const entry of await opendir(directory)) entries.push(entry)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue
      const path = join(directory, entry.name)
      const info = await lstat(path).catch(() => undefined)
      if (!info || info.isSymbolicLink()) { if (info?.isSymbolicLink()) filesSkipped++; continue }
      if (info.isDirectory()) { if (depth < maxDepth) await visit(path, depth + 1); if (discovered.length >= maxFiles) return; continue }
      if (!info.isFile() || !extensions.has(extname(entry.name))) continue
      if (!validRecordSource(`repo://${normal(canonicalRoot, path)}`)) { filesSkipped++; continue }
      if (info.size > maxFileBytes) { filesSkipped++; continue }
      discovered.push(path)
      if (discovered.length >= maxFiles) return
    }
  }
  await visit(canonicalRoot, 0)
  discovered.sort((a, b) => normal(canonicalRoot, a).localeCompare(normal(canonicalRoot, b)))
  const selected: { path: string; text: string; bytes: number }[] = []
  let bytesRead = 0
  for (const path of discovered) {
    try {
      const read = await readBounded(path, maxFileBytes)
      if (bytesRead + read.bytes > maxBytes) { filesSkipped++; continue }
      selected.push({ path, ...read }); bytesRead += read.bytes
    } catch { filesSkipped++ }
  }

  const known = new Set(selected.map(file => file.path.split(sep).join('/')))
  const parsed: ParsedFile[] = selected.map(file => {
    const path = normal(canonicalRoot, file.path)
    const source = ts.createSourceFile(path, file.text, ts.ScriptTarget.Latest, true, sourceKind(path))
    const symbols: ParsedSymbol[] = [], rawImports: { specifier: string; clause?: ts.ImportClause; declaration?: ts.ExportDeclaration }[] = []
    for (const node of source.statements) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) rawImports.push({ specifier: node.moduleSpecifier.text, clause: node.importClause })
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) rawImports.push({ specifier: node.moduleSpecifier.text, declaration: node })
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
        const name = declarationName(node)
        if (name) symbols.push({ key: `${path}#${name}`, file: path, name, kind: ts.isFunctionDeclaration(node) ? 'function' : ts.isClassDeclaration(node) ? 'class' : ts.isInterfaceDeclaration(node) ? 'interface' : ts.isTypeAliasDeclaration(node) ? 'type' : 'enum', exported: exported(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, parameters: ts.isFunctionDeclaration(node) ? node.parameters.length : undefined, node })
        if (name && ts.isClassDeclaration(node)) for (const member of node.members) {
          if ((!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member)) || !member.name || !ts.isIdentifier(member.name)) continue
          const method = member.name.text
          symbols.push({ key: `${path}#${name}.${method}`, file: path, name: `${name}.${method}`, kind: 'method', exported: exported(node), line: source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1, parameters: member.parameters.length, node: member, className: name })
        }
      }
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const init = declaration.initializer
        if (!init || (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init))) continue
        const name = declaration.name.text
        symbols.push({ key: `${path}#${name}`, file: path, name, kind: 'variable', exported: exported(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, parameters: init.parameters.length, node })
      }
    }
    const imports: string[] = [], bindings = new Map<string, ImportBinding>()
    for (const item of rawImports) {
      const absolute = resolveImport(file.path.split(sep).join('/'), item.specifier, known)
      if (!absolute) continue
      const target = normal(canonicalRoot, absolute)
      imports.push(target)
      if (item.clause?.name) bindings.set(item.clause.name.text, { target, imported: 'default' })
      if (item.clause?.namedBindings && ts.isNamedImports(item.clause.namedBindings)) for (const element of item.clause.namedBindings.elements) bindings.set(element.name.text, { target, imported: element.propertyName?.text ?? element.name.text })
      if (item.declaration?.exportClause && ts.isNamedExports(item.declaration.exportClause)) for (const element of item.declaration.exportClause.elements) bindings.set(element.name.text, { target, imported: element.propertyName?.text ?? element.name.text })
    }
    const uniqueSymbols = new Map<string, ParsedSymbol>()
    for (const symbol of symbols) uniqueSymbols.set(symbol.key, symbol)
    return { path, bytes: file.bytes, source, imports: [...new Set(imports)].sort(), bindings,
      symbols: [...uniqueSymbols.values()].filter(symbol => validRecordSource(`repo://${path}#${encodeURIComponent(symbol.name)}`))
        .sort((a, b) => a.line - b.line || a.name.localeCompare(b.name)) }
  })

  // Preserve repository coverage before declaration detail. Exported symbols
  // are the most useful navigation entry points when the collection's bounded
  // record capacity cannot retain every local declaration.
  type FileCandidate = { key: string; type: 'file'; file: ParsedFile }
  type SymbolCandidate = { key: string; type: 'symbol'; file: ParsedFile; symbol: ParsedSymbol }
  type Candidate = FileCandidate | SymbolCandidate
  const files: FileCandidate[] = parsed.map(file => ({ key: file.path, type: 'file', file }))
  const symbols: SymbolCandidate[] = parsed.flatMap(file => file.symbols.map(symbol => ({ key: symbol.key, type: 'symbol', file, symbol })))
  const exportedSymbols = symbols.filter(candidate => candidate.symbol.exported)
  const localSymbols = symbols.filter(candidate => !candidate.symbol.exported)
  const exportedByFile = new Map<string, SymbolCandidate[]>(parsed.map(file => [file.path, []]))
  const localByFile = new Map<string, SymbolCandidate[]>(parsed.map(file => [file.path, []]))
  for (const candidate of exportedSymbols) exportedByFile.get(candidate.file.path)!.push(candidate)
  for (const candidate of localSymbols) localByFile.get(candidate.file.path)!.push(candidate)
  const retained: Candidate[] = files.slice(0, maxRecords)
  const retainedKeys = new Set(retained.map(candidate => candidate.key))
  // Round-robin across per-file buckets so an early file with many exports
  // cannot starve later files. Exports are visited before locals and files
  // are retained first; each bucket preserves source order and the record
  // cap still terminates every loop.
  const rounds = Math.max(1, ...parsed.map(file => Math.max(exportedByFile.get(file.path)!.length, localByFile.get(file.path)!.length)))
  for (let round = 0; round < rounds && retained.length < maxRecords; round++) {
    for (const file of parsed) {
      if (retained.length >= maxRecords) break
      const bucket = exportedByFile.get(file.path)!
      if (round < bucket.length) {
        const candidate = bucket[round]
        if (!retainedKeys.has(candidate.key)) { retained.push(candidate); retainedKeys.add(candidate.key) }
      }
    }
  }
  for (let round = 0; round < rounds && retained.length < maxRecords; round++) {
    for (const file of parsed) {
      if (retained.length >= maxRecords) break
      const bucket = localByFile.get(file.path)!
      if (round < bucket.length) {
        const candidate = bucket[round]
        if (!retainedKeys.has(candidate.key)) { retained.push(candidate); retainedKeys.add(candidate.key) }
      }
    }
  }
  const ids = new Map(retained.map(candidate => [candidate.key, id(candidate.type, candidate.key)]))
  const symbolsByFile = new Map(parsed.map(file => [file.path, new Map(file.symbols.map(symbol => [symbol.name, symbol]))]))
  let callsFound = 0
  const records = retained.map((candidate): ContextRecord => {
    const relations: ContextRelation[] = []
    if (candidate.type === 'file') {
      for (const target of candidate.file.imports) if (retainedKeys.has(target)) relations.push(relation(ids.get(target)!, 'imports'))
      const kinds = new Map<string, number>()
      for (const symbol of candidate.file.symbols) kinds.set(symbol.kind, (kinds.get(symbol.kind) ?? 0) + 1)
      const summary = [...kinds].map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`).join(', ') || 'no named declarations'
      const nameList: string[] = []
      let namesLength = 0
      let omitted = 0
      for (const symbol of candidate.file.symbols) {
        if (!symbol.exported) continue
        const separator = nameList.length ? ', ' : ''
        if (namesLength + separator.length + symbol.name.length > 600) { omitted++; continue }
        nameList.push(symbol.name)
        namesLength += separator.length + symbol.name.length
      }
      const omittedText = omitted ? ` (+${omitted} omitted)` : ''
      const names = nameList.length || omitted
        ? `; exported: ${nameList.join(', ')}${omittedText}`
        : ''
      return { id: ids.get(candidate.key)!, kind: 'evidence', text: `Source file ${candidate.file.path}: ${summary}; ${candidate.file.imports.length} resolved internal import${candidate.file.imports.length === 1 ? '' : 's'}${names}.`, source: `repo://${candidate.file.path}`, observedAt, provenance, ...(relations.length ? { relations: relations.sort(relationSort).slice(0, 16) } : {}) }
    }
    const symbol = candidate.symbol
    if (retainedKeys.has(symbol.file)) relations.push(relation(ids.get(symbol.file)!, 'relates-to'))
    const local = symbolsByFile.get(symbol.file)!
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expression = node.expression
        let target: ParsedSymbol | undefined
        if (ts.isIdentifier(expression)) {
          target = local.get(expression.text)
          const imported = candidate.file.bindings.get(expression.text)
          if (!target && imported) target = symbolsByFile.get(imported.target)?.get(imported.imported)
        } else if (ts.isPropertyAccessExpression(expression) && expression.expression.kind === ts.SyntaxKind.ThisKeyword && symbol.className) {
          target = local.get(`${symbol.className}.${expression.name.text}`)
        }
        if (target && retainedKeys.has(target.key) && target.key !== symbol.key) {
          const edge = relation(ids.get(target.key)!, 'calls')
          if (!relations.some(item => item.kind === edge.kind && item.to === edge.to)) { relations.push(edge); callsFound++ }
        }
      }
      ts.forEachChild(node, visit)
    }
    if (['function', 'method', 'variable'].includes(symbol.kind)) visit(symbol.node)
    return { id: ids.get(candidate.key)!, kind: 'evidence', text: `${symbol.exported ? 'Exported' : 'Local'} ${symbol.kind} ${symbol.name} in ${symbol.file} at line ${symbol.line}${symbol.parameters === undefined ? '' : ` with ${symbol.parameters} parameter${symbol.parameters === 1 ? '' : 's'}`}.`, source: `repo://${symbol.file}#${encodeURIComponent(symbol.name)}`, observedAt, provenance, ...(relations.length ? { relations: relations.sort(relationSort).slice(0, 16) } : {}) }
  })
  return { root: canonicalRoot, records, filesScanned: parsed.length, filesSkipped, bytesRead,
    symbolsFound: parsed.reduce((sum, file) => sum + file.symbols.length, 0),
    importsFound: parsed.reduce((sum, file) => sum + file.imports.length, 0), callsFound }
}
