import ts from 'typescript'

export interface SelectedValueFile {
  path: string
  source: ts.SourceFile
  modules: Map<string, string>
  symbols: { name: string; kind: string; exported: boolean; node: ts.Node }[]
}

/** Prove a value export path separately from compiler aliases, which can
 * otherwise select a type-only or conflicting barrel export. No filesystem. */
export function createSelectedValueBindings(files: SelectedValueFile[], checker: ts.TypeChecker) {
  const modules = new Map(files.map(file => [file.source.fileName, file.modules]))
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
  return { valueBindings, valueExports }
}
