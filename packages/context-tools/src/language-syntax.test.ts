import { describe, expect, it } from 'vitest'
import { parseLanguageSyntax } from './language-syntax.js'

describe('selected Rust and Kotlin syntax', () => {
  it('distinguishes impl methods and ignores comment/string declarations', async () => {
    const syntax = await parseLanguageSyntax('lib.rs', '// fn pretend() {}\nimpl Client {\n  fn run(&self) { let s = "fn fake() {}"; }\n}\ntrait Run {\n  fn run(&self);\n}\n')
    expect(syntax.hasErrors).toBe(false)
    expect(syntax.declarations.map(d => d.qualified)).toEqual(['Client', 'Client.run', 'Run', 'Run.run'])
    expect(syntax.units.find(u => u.name === 'Client.run')).toMatchObject({ startLine: 3, endLine: 3 })
  })
  it('retains Kotlin extensions, overload spans, imports and package identity', async () => {
    const syntax = await parseLanguageSyntax('Api.kt', 'package demo.api\nimport other.send as deliver\n\nfun String.decorate(): String = this\n\nfun decorate(x: Int): Int = x\n')
    expect(syntax.hasErrors).toBe(false)
    expect(syntax.packageName).toBe('demo.api')
    expect(syntax.declarations.map(d => d.qualified)).toEqual(['String.decorate', 'decorate'])
    expect(syntax.imports).toEqual([{ text: 'import other.send as deliver', line: 2 }])
  })
  it('exposes parse errors rather than inventing complete declarations', async () => {
    expect((await parseLanguageSyntax('bad.rs', 'fn broken( {')).hasErrors).toBe(true)
    await expect(parseLanguageSyntax('bad.py', 'def run(): pass')).rejects.toThrow(/unsupported/)
  })
  it('keeps Rust attributes attached to a complete declaration', async () => {
    const syntax = await parseLanguageSyntax('lib.rs', '#[cfg(test)]\n#[test]\nfn checks() {\n  assert!(true);\n}\n')
    expect(syntax.units.find(unit => unit.name === 'checks')).toMatchObject({ startLine: 1, endLine: 5, start: 0 })
  })
})
