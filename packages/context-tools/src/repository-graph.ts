import { createHash } from 'node:crypto'
import ts from 'typescript'
import { parseScript, isTestPath, isScriptPath } from './repository-explore.js'
import { parseLanguageSyntax, syntaxLanguage } from './language-syntax.js'
import { loadSourceProject } from './source-project.js'
import type { RepositoryNavigation } from './repository-navigation.js'
import { readDependencyEvidence } from './dependency-evidence.js'
import { createSelectedValueBindings, type SelectedValueFile } from './typescript-bindings.js'

export interface GraphNode { id: string; path: string; sha256: string; name: string; kind: string; language: string; startLine: number; endLine: number; startOffset: number; endOffset: number; test: boolean }
export interface GraphEdge { from: string; to: string; kind: 'contains' | 'imports' | 'references' | 'calls'; method: 'syntax' | 'typescript-binding' | 'name-candidate'; path: string; line: number }
export interface RepositoryGraph {
  schema: 'context-repository-graph-v1'
  trust: 'local-source-unsigned'
  generation: string; revision: string; policyDigest: string
  nodes: GraphNode[]; edges: GraphEdge[]
  sources: { path: string; sha256: string; text: string }[]
  completeness: { omittedFiles: number; omittedNodes: number; omittedEdges: number; analysisTruncated: boolean; parseFailures: string[]; unresolvedImports: { path: string; line: number; specifier: string }[] }
  project?: Awaited<ReturnType<typeof loadSourceProject>>['evidence']
  dependencies: Awaited<ReturnType<typeof readDependencyEvidence>>['evidence']
  caveat: string
}
export interface GraphQueryOptions { action?: 'summary' | 'symbol' | 'neighbours' | 'impact' | 'path' | 'dependencies'; symbol?: string; from?: string; to?: string; maxNodes?: number; maxDepth?: number }
const id = (key: string) => createHash('sha256').update(`context-derived-graph-v1\0${key}`).digest('hex')
const MAX_NODES = 20_000, MAX_EDGES = 40_000

/** Derived graph, independent of signed v1 collection capacity. TS binding is
 * static evidence. Rust/Kotlin references are explicitly name candidates. */
export async function buildRepositoryGraph(navigation: RepositoryNavigation, options: { project?: string; pathPrefix?: string; signal?: AbortSignal } = {}): Promise<RepositoryGraph> {
  const selected = await navigation.graphFiles(options.pathPrefix, options.signal)
  const status = await navigation.status(options.signal)
  const project = options.project === undefined ? undefined : await loadSourceProject(status.root, options.project)
  const dependencies = await readDependencyEvidence(status.root)
  const graph: RepositoryGraph = { schema: 'context-repository-graph-v1', trust: 'local-source-unsigned',
    generation: selected.generation, revision: selected.revision, policyDigest: selected.policyDigest,
    nodes: [], edges: [], sources: selected.files,
    completeness: { omittedFiles: selected.omittedFiles, omittedNodes: 0, omittedEdges: 0, analysisTruncated: false, parseFailures: [], unresolvedImports: [] },
    ...(project ? { project: project.evidence } : {}),
    dependencies: dependencies.evidence,
    caveat: 'Selected source only; static bindings and name candidates do not prove runtime calls, test coverage or complete impact. No macro, build script or project code is executed. Refresh before reusing evidence after edits.' }
  const addNode = (node: GraphNode) => { if (graph.nodes.length < MAX_NODES) graph.nodes.push(node); else graph.completeness.omittedNodes++ }
  const keys = new Set<string>()
  const addEdge = (edge: GraphEdge) => {
    const key = `${edge.from}:${edge.to}:${edge.kind}:${edge.line}`
    if (keys.has(key)) return
    keys.add(key)
    if (graph.edges.length < MAX_EDGES) graph.edges.push(edge); else graph.completeness.omittedEdges++
  }
  const scripts = new Map<string, ts.SourceFile>()
  const parsed = new Map<string, ReturnType<typeof parseScript>>()
  const other = new Map<string, Awaited<ReturnType<typeof parseLanguageSyntax>>>()
  for (const file of selected.files) {
    options.signal?.throwIfAborted()
    const language = syntaxLanguage(file.path) ?? 'typescript-javascript'
    addNode({ id: id(file.path), path: file.path, sha256: file.sha256, name: file.path, kind: 'file', language, startLine: 1, endLine: file.text.split('\n').length, startOffset: 0, endOffset: file.text.length, test: isTestPath(file.path) })
    let syntax
    if (isScriptPath(file.path)) {
      const source = ts.createSourceFile('/' + file.path, file.text, ts.ScriptTarget.Latest, true)
      scripts.set(source.fileName, source)
      if ((source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) { graph.completeness.parseFailures.push(file.path); continue }
      syntax = parseScript(file.path, file.text)
      parsed.set(file.path, syntax)
    } else {
      const tree = await parseLanguageSyntax(file.path, file.text)
      if (tree.hasErrors) { graph.completeness.parseFailures.push(file.path); continue }
      other.set(file.path, tree)
      syntax = tree
    }
    for (const declaration of syntax.declarations) {
      const nodeId = id(`${file.path}#${declaration.kind}:${declaration.qualified}:${declaration.nameStart}`)
      addNode({ id: nodeId, path: file.path, sha256: file.sha256, name: declaration.qualified, kind: declaration.kind, language,
        startLine: declaration.startLine, endLine: declaration.endLine, startOffset: declaration.start, endOffset: declaration.end, test: isTestPath(file.path) })
      addEdge({ from: id(file.path), to: nodeId, kind: 'contains', method: 'syntax', path: file.path, line: declaration.nameLine })
    }
  }
  const symbolNodes = graph.nodes.filter(node => node.kind !== 'file')
  const byPath = new Map<string, GraphNode[]>(), byName = new Map<string, GraphNode[]>()
  for (const node of symbolNodes) {
    byPath.set(node.path, [...(byPath.get(node.path) ?? []), node])
    const key = node.language + ':' + node.name.split('.').at(-1)
    byName.set(key, [...(byName.get(key) ?? []), node])
  }
  let work = 0
  const budget = () => { if (++work > 2_000_000) { graph.completeness.analysisTruncated = true; return false }; return true }
  const ownerAt = (path: string, position: number) => {
    let best: GraphNode | undefined
    for (const node of byPath.get(path) ?? []) {
      if (!budget()) return undefined
      if (node.startOffset <= position && node.endOffset > position && (!best || node.endOffset - node.startOffset < best.endOffset - best.startOffset)) best = node
    }
    return best?.id ?? id(path)
  }
  const compilerOptions: ts.CompilerOptions = { ...project?.compilerOptions, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.Latest, allowJs: true, noLib: true, noEmit: true, types: [] }
  const resolveModule = (specifier: string, from: string) => ts.resolveModuleName(specifier, from, compilerOptions,
    { fileExists: path => scripts.has(path), readFile: path => scripts.get(path)?.text }).resolvedModule
  const host: ts.CompilerHost = { getSourceFile: path => scripts.get(path), getDefaultLibFileName: () => '/__no_lib__.d.ts', writeFile: () => {},
    getCurrentDirectory: () => '/', getDirectories: () => [], fileExists: path => scripts.has(path), readFile: path => scripts.get(path)?.text,
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n',
    resolveModuleNames: (names, from) => names.map(name => resolveModule(name, from)) }
  const checker = ts.createProgram([...scripts.keys()], compilerOptions, host).getTypeChecker()
  const bindings = new Map<ts.Symbol, GraphNode[]>()
  const declarationNames = new Set<ts.Node>()
  const callableScopes = new Set<ts.Node>()
  const valueFiles: SelectedValueFile[] = []
  for (const [path, source] of scripts) {
    if (!parsed.has(path.slice(1))) continue
    const declarations = parsed.get(path.slice(1))!.declarations
    const declarationMap = new Map(declarations.map(d => [`${d.nameStart}:${d.nameEnd}`, d]))
    const nodeMap = new Map((byPath.get(path.slice(1)) ?? []).map(n => [n.id, n]))
    const valueFile: SelectedValueFile = { path: path.slice(1), source, symbols: [], modules: new Map() }
    valueFiles.push(valueFile)
    for (const node of source.statements) if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveModule(node.moduleSpecifier.text, path)?.resolvedFileName
      if (target) valueFile.modules.set(node.moduleSpecifier.text, target.slice(1))
    }
    const visit = (node: ts.Node) => {
      if (!budget()) return
      if (ts.isIdentifier(node) && (node.parent as ts.NamedDeclaration).name === node) {
        const declaration = declarationMap.get(`${node.getStart(source)}:${node.end}`)
        const target = declaration && nodeMap.get(id(`${path.slice(1)}#${declaration.kind}:${declaration.qualified}:${declaration.nameStart}`))
        const binding = checker.getSymbolAtLocation(node)
        if (target && binding && declaration) {
          bindings.set(binding, [...(bindings.get(binding) ?? []), target]); declarationNames.add(node)
          valueFile.symbols.push({ name: declaration.name, kind: declaration.kind, exported: declaration.exported, node: node.parent })
          if (ts.isFunctionLike(node.parent)) callableScopes.add(node.parent)
          else if (ts.isVariableDeclaration(node.parent) && node.parent.initializer && ts.isFunctionLike(node.parent.initializer)) callableScopes.add(node.parent.initializer)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  const valueLookup = createSelectedValueBindings(valueFiles, checker)
  for (const [path, source] of scripts) {
    if (!parsed.has(path.slice(1))) continue
    options.signal?.throwIfAborted()
    const visit = (node: ts.Node) => {
      if (!budget()) return
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolveModule(node.moduleSpecifier.text, path)?.resolvedFileName
        if (target && scripts.has(target)) addEdge({ from: id(path.slice(1)), to: id(target.slice(1)), kind: 'imports', method: 'typescript-binding', path: path.slice(1), line })
        else if (graph.completeness.unresolvedImports.length < 2048) graph.completeness.unresolvedImports.push({ path: path.slice(1), line, specifier: node.moduleSpecifier.text })
      }
      if (ts.isIdentifier(node) && !declarationNames.has(node)) {
        let binding = checker.getSymbolAtLocation(node)
        const alias = binding && binding.flags & ts.SymbolFlags.Alias ? binding : undefined
        const typeOnly = binding?.declarations?.some(ts.isTypeOnlyImportOrExportDeclaration)
        if (binding?.flags && binding.flags & ts.SymbolFlags.Alias) binding = checker.getAliasedSymbol(binding)
        const targets = binding ? bindings.get(binding) : undefined
        if (targets?.length === 1) {
          const target = targets[0], from = ownerAt(path.slice(1), node.getStart(source))
          const values = alias ? valueLookup.valueBindings(alias, new Set()) : undefined
          let scope: ts.Node | undefined = node.parent
          while (scope && !ts.isFunctionLike(scope)) scope = scope.parent
          const call = (!scope || callableScopes.has(scope)) && !typeOnly && (!alias || values?.size === 1 && values.has(binding!)) && ts.isCallExpression(node.parent) && node.parent.expression === node
          if (from && target.id !== from && (target.path === path.slice(1) || ts.isExternalModule(source))) addEdge({ from, to: target.id, kind: call ? 'calls' : 'references', method: 'typescript-binding', path: path.slice(1), line })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  for (const [path, syntax] of other) {
    const names = new Set(syntax.declarations.map(d => `${d.nameStart}:${d.nameEnd}`))
    for (const token of syntax.identifiers) {
      if (!budget()) break
      if (names.has(`${token.start}:${token.end}`)) continue
      const targets = byName.get(syntax.language + ':' + token.name) ?? []
      if (targets.length > 8) { graph.completeness.omittedEdges += targets.length; continue }
      for (const target of targets) {
        const from = ownerAt(path, token.start)
        if (from && from !== target.id) addEdge({ from, to: target.id, kind: 'references', method: 'name-candidate', path, line: token.line })
      }
    }
  }
  const retained = new Set(graph.nodes.map(node => node.id))
  graph.edges = graph.edges.filter(edge => retained.has(edge.from) && retained.has(edge.to))
  await project?.verify()
  await dependencies.verify()
  const final = await navigation.status(options.signal)
  if (final.generation !== selected.generation || final.freshness !== 'current' || final.policy.freshness !== 'current') throw new Error('Repository graph changed; refresh before querying')
  return graph
}

/** Queries never silently treat an ambiguous name as one symbol. */
export function queryRepositoryGraph(graph: RepositoryGraph, options: GraphQueryOptions = {}) {
  const action = options.action ?? 'summary', maxNodes = options.maxNodes ?? 100, maxDepth = options.maxDepth ?? 3
  if (!['summary', 'symbol', 'neighbours', 'impact', 'path', 'dependencies'].includes(action) || !Number.isSafeInteger(maxNodes) || maxNodes < 1 || maxNodes > 500 || !Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 8) throw new Error('Invalid repository graph query limits')
  const match = (value: string | undefined) => graph.nodes.filter(node => node.id === value || node.name === value || `${node.path}#${node.name}` === value)
  if (action === 'symbol' && !options.symbol) throw new Error('Graph symbol query requires a symbol')
  const seeds = action === 'summary' ? graph.nodes.filter(node => node.kind === 'file') : action === 'symbol' ? graph.nodes.filter(node => node.name === options.symbol || node.name.split('.').at(-1) === options.symbol) : match(options.from)
  if ((action === 'path' || action === 'neighbours' || action === 'impact') && seeds.length !== 1) throw new Error('Select one unambiguous graph node ID')
  const chosen = new Set(seeds.map(node => node.id)), queue = seeds.map(node => ({ id: node.id, depth: 0 }))
  const parents = new Map<string, string>()
  const targets = action === 'path' ? match(options.to) : []
  if (action === 'path' && targets.length !== 1) throw new Error('Select one unambiguous target node ID')
  const traversable = graph.edges.filter(edge => edge.kind !== 'contains')
  if (['neighbours', 'impact', 'path'].includes(action)) for (let index = 0; index < queue.length && chosen.size < 5000; index++) {
    const row = queue[index]
    if (row.depth >= maxDepth) continue
    for (const edge of traversable) {
      const next = action === 'impact' ? edge.to === row.id ? edge.from : undefined : edge.from === row.id ? edge.to : action === 'neighbours' && edge.to === row.id ? edge.from : undefined
      if (next && !chosen.has(next)) { chosen.add(next); parents.set(next, row.id); queue.push({ id: next, depth: row.depth + 1 }) }
    }
  }
  let found: boolean | undefined
  if (action === 'path') {
    found = chosen.has(targets[0].id)
    chosen.clear()
    if (found) { let cursor: string | undefined = targets[0].id; while (cursor) { chosen.add(cursor); cursor = parents.get(cursor) } }
  }
  const all = graph.nodes.filter(node => chosen.has(node.id)), nodes = all.slice(0, maxNodes), kept = new Set(nodes.map(node => node.id))
  return { schema: graph.schema, trust: graph.trust, generation: graph.generation, revision: graph.revision, action, ...(found === undefined ? {} : { found }),
    nodes, edges: graph.edges.filter(edge => kept.has(edge.from) && kept.has(edge.to)),
    completeness: { ...graph.completeness, queryOmittedNodes: all.length - nodes.length, maxDepth, totalNodes: graph.nodes.length, totalEdges: graph.edges.length },
    ...(graph.project ? { project: graph.project } : {}),
    ...(action === 'dependencies' ? { dependencies: { ...graph.dependencies, dependencies: graph.dependencies.dependencies.slice(0, maxNodes), queryOmittedDependencies: Math.max(0, graph.dependencies.dependencies.length - maxNodes) } } : {}),
    dependencySummary: { declarations: graph.dependencies.dependencies.length, omitted: graph.dependencies.omittedDependencies, issues: graph.dependencies.issues, installedStateVerified: false }, caveat: graph.caveat }
}
