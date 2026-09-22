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
  /** Scoped uncertainty about discovery. Both flags false does not prove
   * complete coverage: ignored directories, non-source extensions, and
   * read/byte/size exclusions remain outside this signal. */
  scanBounds: {
    /** True when the eligible file discovery count reached the configured
     * maxFiles cap. This is not proof that additional eligible files exist;
     * the cap may have been reached exactly at the last eligible file. */
    maxFilesHit: boolean
    /** True when an otherwise traversable directory was not descended
     * because the configured maxDepth was reached. Ignored/hidden
     * directories that are never inspected do not set this flag. */
    maxDepthHit: boolean
  }
}

type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'variable'
interface ParsedSymbol { key: string; file: string; name: string; kind: SymbolKind; exported: boolean; line: number; parameters?: number; node: ts.Node; className?: string }
interface ParsedFile { path: string; bytes: number; source: ts.SourceFile; imports: string[]; modules: Map<string, string>; symbols: ParsedSymbol[] }

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

/** Bind only already selected syntax trees. The compiler has no filesystem,
 * config, default-library, package or network fallback. Virtual paths keep
 * compiler resolution independent of the operator's current directory. */
function callResolver(files: ParsedFile[]): (expression: ts.Expression, caller: ParsedSymbol) => ParsedSymbol | undefined {
  const sources = new Map(files.map(file => [file.source.fileName, file.source]))
  const modules = new Map(files.map(file => [file.source.fileName, file.modules]))
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext,
    allowJs: true, noLib: true, noEmit: true, types: [], skipLibCheck: true,
  }
  const host: ts.CompilerHost = {
    getSourceFile: path => sources.get(path),
    getDefaultLibFileName: () => '/__context_no_lib__.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: path => sources.has(path),
    readFile: path => sources.get(path)?.text,
    getCanonicalFileName: path => path,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    resolveModuleNames: (names, from) => names.map(name => {
      // Reuse only imports resolved against the real selected paths. Resolving
      // ../ at a virtual / root could otherwise alias an out-of-root import.
      const target = modules.get(from)?.get(name)
      return target ? { resolvedFileName: `/${target}` } : undefined
    }),
  }
  const checker = ts.createProgram([...sources.keys()], options, host).getTypeChecker()
  const declarations = new Map<ts.Symbol, ParsedSymbol>()
  for (const file of files) for (const symbol of file.symbols) {
    const name = (symbol.node as ts.NamedDeclaration).name
    if (!name) continue
    const binding = checker.getSymbolAtLocation(name)
    if (binding) declarations.set(binding, symbol)
  }
  // The checker follows type-only export stars to their original value symbol.
  // Prove a value export path separately before accepting an imported call.
  const byPath = new Map(files.map(file => [file.path, file]))
  type ExportSeen = Set<string | ts.Symbol>
  function valueBindings(binding: ts.Symbol | undefined, seen: ExportSeen): Set<ts.Symbol> {
    const values = new Set<ts.Symbol>()
    if (!binding || seen.has(binding)) return values
    seen.add(binding)
    if (!(binding.flags & ts.SymbolFlags.Alias)) {
      if (binding.flags & ts.SymbolFlags.Value) values.add(binding)
      return values
    }
    for (const node of binding.declarations ?? []) {
      if (ts.isTypeOnlyImportOrExportDeclaration(node)) continue
      let declaration: ts.ImportDeclaration | ts.ExportDeclaration
      let name: string
      if (ts.isImportSpecifier(node)) {
        if (!ts.isImportDeclaration(node.parent.parent.parent)) continue
        declaration = node.parent.parent.parent
        name = (node.propertyName ?? node.name).text
      } else if (ts.isImportClause(node)) {
        if (!ts.isImportDeclaration(node.parent)) continue
        declaration = node.parent
        name = 'default'
      } else if (ts.isExportSpecifier(node)) {
        declaration = node.parent.parent
        name = (node.propertyName ?? node.name).text
        if (!declaration.moduleSpecifier) {
          for (const value of valueBindings(checker.getExportSpecifierLocalTargetSymbol(node), seen)) values.add(value)
          continue
        }
      } else continue
      const specifier = declaration.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier)) continue
      const target = modules.get(declaration.getSourceFile().fileName)?.get(specifier.text)
      if (target !== undefined) for (const value of valueExports(target, name, seen)) values.add(value)
    }
    return values
  }
  function valueExports(path: string, name: string, seen: ExportSeen): Set<ts.Symbol> {
    const values = new Set<ts.Symbol>(), key = `${path}\0${name}`
    if (seen.has(key)) return values
    seen.add(key)
    const file = byPath.get(path)
    if (!file) return values
    let explicit = false
    for (const symbol of file.symbols) {
      if (!symbol.exported || symbol.kind === 'method') continue
      const exportName = ts.getCombinedModifierFlags(symbol.node as ts.Declaration) & ts.ModifierFlags.Default ? 'default' : symbol.name
      if (exportName === name) {
        explicit = true
        const binding = checker.getSymbolAtLocation((symbol.node as ts.NamedDeclaration).name!)
        for (const value of valueBindings(binding, seen)) values.add(value)
      }
    }
    const stars: string[] = []
    for (const node of file.source.statements) {
      if (!ts.isExportDeclaration(node)) continue
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) if (element.name.text === name) {
          explicit = true
          if (node.isTypeOnly || element.isTypeOnly) continue
          if (!node.moduleSpecifier) {
            for (const value of valueBindings(checker.getExportSpecifierLocalTargetSymbol(element), seen)) values.add(value)
          } else if (ts.isStringLiteral(node.moduleSpecifier)) {
            const target = file.modules.get(node.moduleSpecifier.text)
            if (target !== undefined) for (const value of valueExports(target, (element.propertyName ?? element.name).text, seen)) values.add(value)
          }
        }
      } else if (!node.exportClause && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = file.modules.get(node.moduleSpecifier.text)
        if (target) stars.push(target)
      }
    }
    if (!explicit && name !== 'default') for (const target of stars) {
      for (const value of valueExports(target, name, seen)) values.add(value)
    }
    return values
  }
  const importedValues = new Map<ts.Symbol, Set<ts.Symbol>>()
  return (expression, caller) => {
    // Ordinary object/namespace/dynamic calls remain outside this contract.
    const identifier = ts.isIdentifier(expression)
    const member = ts.isPropertyAccessExpression(expression)
      && expression.expression.kind === ts.SyntaxKind.ThisKeyword && !!caller.className
    if (!identifier && !member) return undefined
    let binding = checker.getSymbolAtLocation(identifier ? expression : expression.name)
    if (!binding) return undefined
    const imported = !!(binding.flags & ts.SymbolFlags.Alias)
    if (imported) {
      let values = importedValues.get(binding)
      if (!values) { values = valueBindings(binding, new Set()); importedValues.set(binding, values) }
      // A checker alias alone can choose the first of conflicting barrel exports.
      if (values.size !== 1) return undefined
      const [value] = values
      if (checker.getAliasedSymbol(binding) !== value) return undefined
    }
    const seen = new Set<ts.Symbol>()
    while (binding.flags & ts.SymbolFlags.Alias) {
      if (seen.has(binding) || binding.declarations?.some(ts.isTypeOnlyImportOrExportDeclaration)) return undefined
      seen.add(binding)
      binding = checker.getImmediateAliasedSymbol(binding)
      if (!binding) return undefined
    }
    const target = declarations.get(binding)
    // Do not infer a shared script-global environment across unrelated files.
    if (!target || (!imported && target.file !== caller.file)) return undefined
    if (member && !ts.isMethodDeclaration(target.node)) return undefined
    return target
  }
}

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
  let maxFilesHit = false
  let maxDepthHit = false
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
      if (info.isDirectory()) {
        if (depth < maxDepth) await visit(path, depth + 1)
        else maxDepthHit = true
        if (discovered.length >= maxFiles) return
        continue
      }
      if (!info.isFile() || !extensions.has(extname(entry.name))) continue
      if (!validRecordSource(`repo://${normal(canonicalRoot, path)}`)) { filesSkipped++; continue }
      if (info.size > maxFileBytes) { filesSkipped++; continue }
      discovered.push(path)
      if (discovered.length >= maxFiles) { maxFilesHit = true; return }
    }
  }
  await visit(canonicalRoot, 0)
  if (discovered.length >= maxFiles) maxFilesHit = true
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
    const source = ts.createSourceFile(`/${path}`, file.text, ts.ScriptTarget.Latest, true, sourceKind(path))
    const symbols: ParsedSymbol[] = [], rawImports: string[] = []
    for (const node of source.statements) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) rawImports.push(node.moduleSpecifier.text)
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) rawImports.push(node.moduleSpecifier.text)
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) {
        const name = declarationName(node)
        if (name) symbols.push({ key: `${path}#${name}`, file: path, name, kind: ts.isFunctionDeclaration(node) ? 'function' : ts.isClassDeclaration(node) ? 'class' : ts.isInterfaceDeclaration(node) ? 'interface' : ts.isTypeAliasDeclaration(node) ? 'type' : 'enum', exported: exported(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, parameters: ts.isFunctionDeclaration(node) ? node.parameters.length : undefined, node })
        if (name && ts.isClassDeclaration(node)) {
          const instanceNames = new Set(node.members.flatMap(member => member.name && ts.isIdentifier(member.name)
            && !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) ? [member.name.text] : []))
          for (const member of node.members) {
            if ((!ts.isMethodDeclaration(member) && !ts.isGetAccessorDeclaration(member) && !ts.isSetAccessorDeclaration(member)) || !member.name || !ts.isIdentifier(member.name)) continue
            // Static and instance members have different bindings. Split a legacy
            // shared name only when both exist; ordinary source identities stay stable.
            const method = (instanceNames.has(member.name.text) && (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) ? 'static.' : '') + member.name.text
            symbols.push({ key: `${path}#${name}.${method}`, file: path, name: `${name}.${method}`, kind: 'method', exported: exported(node), line: source.getLineAndCharacterOfPosition(member.getStart(source)).line + 1, parameters: member.parameters.length, node: member, className: name })
          }
        }
      }
      if (ts.isVariableStatement(node)) for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const init = declaration.initializer
        if (!init || (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init))) continue
        const name = declaration.name.text
        symbols.push({ key: `${path}#${name}`, file: path, name, kind: 'variable', exported: exported(node), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, parameters: init.parameters.length, node: declaration })
      }
    }
    const imports: string[] = [], modules = new Map<string, string>()
    for (const specifier of rawImports) {
      const absolute = resolveImport(file.path.split(sep).join('/'), specifier, known)
      if (!absolute) continue
      const target = normal(canonicalRoot, absolute)
      imports.push(target)
      modules.set(specifier, target)
    }
    const uniqueSymbols = new Map<string, ParsedSymbol>()
    for (const symbol of symbols) uniqueSymbols.set(symbol.key, symbol)
    return { path, bytes: file.bytes, source, imports: [...new Set(imports)].sort(), modules,
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
  const resolveCall = callResolver(parsed)
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
    const body = ts.isVariableDeclaration(symbol.node) ? symbol.node.initializer! : symbol.node
    function visit(node: ts.Node): void {
      // A nested callable owns its calls. It is not a direct call by its parent,
      // even when an arrow captures lexical this. Nested symbols are not indexed.
      if (node !== body && (ts.isFunctionLike(node) || ts.isClassLike(node))) return
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const target = resolveCall(node.expression, symbol)
        if (target && retainedKeys.has(target.key) && target.key !== symbol.key) {
          const edge = relation(ids.get(target.key)!, 'calls')
          if (!relations.some(item => item.kind === edge.kind && item.to === edge.to)) { relations.push(edge); callsFound++ }
        }
      }
      ts.forEachChild(node, visit)
    }
    if (['function', 'method', 'variable'].includes(symbol.kind)) visit(body)
    return { id: ids.get(candidate.key)!, kind: 'evidence', text: `${symbol.exported ? 'Exported' : 'Local'} ${symbol.kind} ${symbol.name} in ${symbol.file} at line ${symbol.line}${symbol.parameters === undefined ? '' : ` with ${symbol.parameters} parameter${symbol.parameters === 1 ? '' : 's'}`}.`, source: `repo://${symbol.file}#${encodeURIComponent(symbol.name)}`, observedAt, provenance, ...(relations.length ? { relations: relations.sort(relationSort).slice(0, 16) } : {}) }
  })
  return { root: canonicalRoot, records, filesScanned: parsed.length, filesSkipped, bytesRead,
    symbolsFound: parsed.reduce((sum, file) => sum + file.symbols.length, 0),
    importsFound: parsed.reduce((sum, file) => sum + file.imports.length, 0), callsFound,
    scanBounds: { maxFilesHit, maxDepthHit } }
}
