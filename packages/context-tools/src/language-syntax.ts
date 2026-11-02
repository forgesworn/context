import { createRequire } from 'node:module'
import Parser from 'web-tree-sitter'
import type { ParsedScript } from './repository-explore.js'

export interface SyntaxUnit { name: string; kind: string; start: number; end: number; startLine: number; endLine: number }
export interface LanguageSyntax extends ParsedScript {
  language: 'rust' | 'kotlin'
  method: 'tree-sitter-syntax'
  parserVersion: '0.20.8'
  grammarBundleVersion: '0.1.13'
  hasErrors: boolean
  units: SyntaxUnit[]
  packageName?: string
  imports: { text: string; line: number }[]
  identifiers: { name: string; line: number; start: number; end: number }[]
}
const require = createRequire(import.meta.url)
const languages = new Map<string, Promise<Parser.Language>>()
let initialised: Promise<void> | undefined
export function syntaxLanguage(path: string): 'rust' | 'kotlin' | undefined {
  return path.endsWith('.rs') ? 'rust' : /\.kts?$/.test(path) ? 'kotlin' : undefined
}

/** Parse selected text only. Grammars are installed dependencies, never paths
 * from the project. No language server, build, macro expansion or network. */
export async function parseLanguageSyntax(path: string, text: string): Promise<LanguageSyntax> {
  const language = syntaxLanguage(path)
  if (!language || Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('Language syntax: unsupported or oversized source')
  initialised ??= Parser.init()
  await initialised
  let grammar = languages.get(language)
  if (!grammar) {
    grammar = Parser.Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${language}.wasm`))
    languages.set(language, grammar)
  }
  const parser = new Parser()
  parser.setLanguage(await grammar)
  parser.setTimeoutMicros(500_000)
  let tree: Parser.Tree | undefined
  try {
    tree = parser.parse(text)
    if (!tree) throw new Error('Language syntax: parser budget exceeded')
    const result: LanguageSyntax = { language, method: 'tree-sitter-syntax', parserVersion: '0.20.8', grammarBundleVersion: '0.1.13',
      hasErrors: tree.rootNode.hasError(), lines: text.split('\n').map(line => line.replace(/\r$/, '')), declarations: [], tests: [], importLines: new Set(), units: [], imports: [], identifiers: [] }
    const kinds: Record<string, string> = language === 'rust'
      ? { function_item: 'function', function_signature_item: 'signature', struct_item: 'struct', enum_item: 'enum', trait_item: 'trait', impl_item: 'impl', mod_item: 'module', type_item: 'type', const_item: 'const', static_item: 'static' }
      : { function_declaration: 'function', class_declaration: 'class', object_declaration: 'object', type_alias: 'type', property_declaration: 'property', secondary_constructor: 'constructor' }
    let visited = 0
    const visit = (node: Parser.SyntaxNode, parent?: string): void => {
      if (++visited > 200_000) throw new Error('Language syntax: node budget exceeded')
      let start = node.startIndex, startLine = node.startPosition.row + 1
      const endLine = node.endPosition.row + (node.endPosition.column === 0 ? 0 : 1)
      if (['identifier', 'type_identifier', 'simple_identifier'].includes(node.type) && node.namedChildCount === 0) result.identifiers.push({ name: node.text, line: startLine, start: node.startIndex, end: node.endIndex })
      if (node.type === 'package_header') result.packageName = node.namedChildren.find(child => child.type === 'identifier')?.text
      if (node.type === 'use_declaration' || node.type === 'import_header') {
        result.imports.push({ text: node.text, line: startLine })
        for (let line = startLine; line <= endLine; line++) result.importLines.add(line)
      }
      let owner = parent
      const kind = kinds[node.type]
      if (kind && !node.hasError()) {
        // Rust outer attributes are sibling nodes; omitting cfg/test attributes
        // from a selected declaration would discard its contract.
        if (language === 'rust') {
          let previous = node.previousNamedSibling
          while (previous && ['attribute_item', 'line_comment', 'block_comment'].includes(previous.type)) {
            start = previous.startIndex; startLine = previous.startPosition.row + 1; previous = previous.previousNamedSibling
          }
        }
        const nameNode = node.childForFieldName('name') ?? (node.type === 'impl_item' ? node.childForFieldName('type') : undefined)
          ?? node.namedChildren.find(child => ['simple_identifier', 'type_identifier', 'variable_declaration'].includes(child.type))
        const name = nameNode?.text
        if (name) {
          const receiver = language === 'kotlin' && kind === 'function' ? node.namedChildren.find(child => child.type === 'user_type' && child.endIndex < nameNode!.startIndex)?.text : undefined
          const qualified = parent ? `${parent}.${name}` : receiver ? `${receiver}.${name}` : name
          result.declarations.push({ name, qualified, kind, exported: language === 'rust' ? node.namedChildren.some(child => child.type === 'visibility_modifier') : !/^\s*private\b/.test(node.text),
            startLine, nameLine: nameNode!.startPosition.row + 1, endLine, start, end: node.endIndex, nameStart: nameNode!.startIndex, nameEnd: nameNode!.endIndex, ...(parent ? { parent } : {}) })
          result.units.push({ name: qualified, kind, start, end: node.endIndex, startLine, endLine })
          owner = qualified
        }
      }
      for (const child of node.namedChildren) visit(child, owner)
    }
    visit(tree.rootNode)
    return result
  } finally { tree?.delete(); parser.delete() }
}
