import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { RepositoryNavigation } from './repository-navigation.js'
import {
  analyseExplore, exploreMatcher, fitExplore, parseExploreSymbol, parseScript, renderExplore,
  type ExploreResult,
} from './repository-explore.js'

const owned: string[] = []
afterEach(async () => {
  while (owned.length) await fsp.rm(owned.pop()!, { recursive: true, force: true })
})

const OWNERSHIP = [
  '/** Options bound to the owner. */',
  'export function ownerOptions(input: string): string {',
  '  return helper(input)',
  '}',
  '',
  'function helper(input: string): string { return input }',
  '',
  'export class Store {',
  '  constructor(private readonly options: string) {}',
  '  write(value: string): string { return ownerOptions(value) }',
  '  static open(): Store { return new Store(ownerOptions(\'x\')) }',
  '}',
  '',
].join('\n')
const SERVER = [
  "import { ownerOptions, Store } from './ownership.js'",
  'export const createServer = () => {',
  "  const store = new Store(ownerOptions('root'))",
  "  return store.write('payload')",
  '}',
  '',
].join('\n')
const TEST = [
  "import { describe, it, expect } from 'vitest'",
  "import { ownerOptions } from './ownership.js'",
  "describe('ownerOptions', () => {",
  "  it('returns its input', () => {",
  "    expect(ownerOptions('a')).toBe('a')",
  '  })',
  '})',
  '',
].join('\n')

async function fixture(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'repo-explore-'))
  owned.push(root)
  await fsp.mkdir(path.join(root, 'src'), { recursive: true })
  await fsp.writeFile(path.join(root, 'src', 'ownership.ts'), OWNERSHIP)
  await fsp.writeFile(path.join(root, 'src', 'server.ts'), SERVER)
  await fsp.writeFile(path.join(root, 'src', 'ownership.test.ts'), TEST)
  await fsp.writeFile(path.join(root, 'notes.md'), 'ownerOptions is documented here.\nOwnerOptions in another case.\n')
  return root
}

describe('explore symbol parsing and matching', () => {
  it('accepts identifiers and one-level qualified members only', () => {
    expect(parseExploreSymbol('ownerOptions')).toEqual({ raw: 'ownerOptions', member: 'ownerOptions' })
    expect(parseExploreSymbol('Store.write')).toEqual({ raw: 'Store.write', member: 'write', owner: 'Store' })
    expect(() => parseExploreSymbol('two words')).toThrow(/symbol/)
    expect(() => parseExploreSymbol('a.b.c')).toThrow(/symbol/)
    expect(() => parseExploreSymbol('')).toThrow(/symbol/)
  })

  it('matches whole identifiers case-sensitively and members as property access or declaration', () => {
    const plain = exploreMatcher(parseExploreSymbol('ownerOptions'))
    expect(plain('return ownerOptions(value)')).toBe(true)
    expect(plain('myownerOptions()')).toBe(false)
    expect(plain('ownerOptionsX()')).toBe(false)
    expect(plain('OwnerOptions()')).toBe(false)
    const member = exploreMatcher(parseExploreSymbol('Store.write'))
    expect(member("store.write('payload')")).toBe(true)
    expect(member('  write(value: string): string {')).toBe(true)
    expect(member('  async write(value) {')).toBe(true)
    expect(member('writer(value)')).toBe(false)
    expect(member('  write = (value: string) => value')).toBe(true)
    expect(member('rewrite(value)')).toBe(false)
  })
})

describe('script parsing', () => {
  it('collects declarations with attached comments, class members, tests and import lines', () => {
    const script = parseScript('src/ownership.ts', OWNERSHIP)
    expect(script.declarations.map((d) => [d.qualified, d.kind, d.exported, d.startLine, d.endLine])).toEqual([
      ['ownerOptions', 'function', true, 1, 4],
      ['helper', 'function', false, 6, 6],
      ['Store', 'class', true, 8, 12],
      ['Store.constructor', 'constructor', true, 9, 9],
      ['Store.write', 'method', true, 10, 10],
      ['Store.open', 'static method', true, 11, 11],
    ])
    const test = parseScript('src/ownership.test.ts', TEST)
    expect(test.tests).toEqual([
      { kind: 'describe', title: 'ownerOptions', startLine: 3, endLine: 7 },
      { kind: 'it', title: 'returns its input', startLine: 4, endLine: 6 },
    ])
    expect([...test.importLines]).toEqual([1, 2])
    const server = parseScript('src/server.ts', SERVER)
    expect(server.declarations.map((d) => [d.qualified, d.kind])).toEqual([['createServer', 'function']])
  })

  it('does not attach a file banner separated by a blank line', () => {
    const script = parseScript('a.ts', '// banner\n\n/** doc */\nexport const value = 1\n')
    expect(script.declarations[0]).toMatchObject({ name: 'value', kind: 'const', startLine: 3, endLine: 4 })
  })
})

describe('explore analysis', () => {
  it('separates definitions, resolved references, tests, imports and lexical files', () => {
    const symbol = parseExploreSymbol('ownerOptions')
    const analysis = analyseExplore(symbol, [
      { path: 'src/ownership.ts', sha256: 'a'.repeat(64), text: OWNERSHIP, hits: [{ line: 2, text: OWNERSHIP.split('\n')[1] }, { line: 10, text: OWNERSHIP.split('\n')[9] }, { line: 11, text: OWNERSHIP.split('\n')[10] }] },
      { path: 'src/server.ts', sha256: 'b'.repeat(64), text: SERVER, hits: [{ line: 1, text: SERVER.split('\n')[0] }, { line: 3, text: SERVER.split('\n')[2] }] },
      { path: 'src/ownership.test.ts', sha256: 'c'.repeat(64), text: TEST, hits: [{ line: 2, text: TEST.split('\n')[1] }, { line: 3, text: TEST.split('\n')[2] }, { line: 5, text: TEST.split('\n')[4] }] },
      { path: 'notes.md', sha256: 'd'.repeat(64), hits: [{ line: 1, text: 'ownerOptions is documented here.' }] },
    ])
    expect(analysis.definitions).toHaveLength(1)
    expect(analysis.definitions[0]).toMatchObject({ path: 'src/ownership.ts', kind: 'function', name: 'ownerOptions', exported: true, startLine: 1, endLine: 4 })
    expect(analysis.definitions[0].lines.map((l) => l.line)).toEqual([1, 2, 3, 4])
    expect(analysis.references.map((r) => [r.path, r.line, r.scope, r.resolved])).toEqual([
      ['notes.md', 1, '', false],
      ['src/ownership.ts', 10, 'in Store.write', true],
      ['src/ownership.ts', 11, 'in Store.open', true],
      ['src/server.ts', 3, 'in createServer', true],
    ])
    expect(analysis.tests.map((r) => [r.line, r.scope])).toEqual([[3, "in describe('ownerOptions')"], [5, "in it('returns its input')"]])
    expect(analysis.imports).toEqual(['src/ownership.test.ts', 'src/server.ts'])
    expect(analysis.lexicalFiles).toBe(1)
  })

  it('outlines long containers and truncates long functions', () => {
    const members = Array.from({ length: 70 }, (_, i) => `  m${i}(): number { return ${i} }`)
    const text = ['export class Big {', ...members, '}', '', 'export function long(): number {', ...Array.from({ length: 260 }, (_, i) => `  const v${i} = ${i}`), '  return 0', '}', ''].join('\n')
    const analysis = analyseExplore(parseExploreSymbol('Big'), [{ path: 'big.ts', sha256: 'e'.repeat(64), text, hits: [{ line: 1, text: 'export class Big {' }] }])
    expect(analysis.definitions[0]).toMatchObject({ kind: 'class', outline: true, startLine: 1, endLine: 72 })
    expect(analysis.definitions[0].lines.map((l) => l.line)).toEqual([1, ...members.map((_, i) => i + 2), 72])
    const fn = analyseExplore(parseExploreSymbol('long'), [{ path: 'big.ts', sha256: 'e'.repeat(64), text, hits: [{ line: 74, text: 'export function long(): number {' }] }])
    expect(fn.definitions[0].lines).toHaveLength(200)
    expect(fn.definitions[0].omittedLines).toBe(63)
  })
})

function sample(overrides: Partial<ExploreResult> = {}): ExploreResult {
  return {
    trust: 'local-source-unsigned', generation: 'g'.repeat(32), revision: 'r'.repeat(64), freshness: 'current',
    policy: { freshness: 'current', digest: 'p'.repeat(64) }, symbol: 'ownerOptions', files: 3, matchedLines: 6, otherCaseLines: 1, scanTruncated: false,
    definitions: [{ path: 'src/ownership.ts', sha256: 'a'.repeat(64), kind: 'function', name: 'ownerOptions', exported: true, startLine: 1, endLine: 4, lines: OWNERSHIP.split('\n').slice(0, 4).map((text, i) => ({ line: i + 1, text })) }],
    references: Array.from({ length: 40 }, (_, i) => ({ path: `src/ref${i % 4}.ts`, line: i + 1, text: `call ownerOptions(${i})`, scope: 'in caller', resolved: true })),
    tests: [{ path: 'src/ownership.test.ts', line: 5, text: "    expect(ownerOptions('a')).toBe('a')", scope: "in it('returns its input')", resolved: true }],
    imports: ['src/server.ts'], lexicalFiles: 0, omitted: { definitions: 0, references: 0, tests: 0 },
    ...overrides,
  }
}

describe('explore rendering and budget', () => {
  it('renders a compact text form with definition lines, grouped references and a note', () => {
    const text = renderExplore(sample({ references: sample().references.slice(0, 2) }))
    const lines = text.split('\n')
    expect(lines[0]).toBe(`explore ownerOptions  6 lines in 3 files  (+1 other-case lines ignored)  generation ${'g'.repeat(32)}  revision ${'r'.repeat(16)}  freshness current`)
    expect(lines[1]).toBe(`definition src/ownership.ts:1-4  exported function ownerOptions  sha256 ${'a'.repeat(16)}`)
    expect(lines[2]).toBe('1: /** Options bound to the owner. */')
    expect(text).toContain("tests 1 lines in 1 files\nsrc/ownership.test.ts\n  5 in it('returns its input'):     expect(ownerOptions('a')).toBe('a')")
    expect(text).toContain('references 2 lines in 2 files\nsrc/ref0.ts\n  1 in caller: call ownerOptions(0)\nsrc/ref1.ts\n  2 in caller: call ownerOptions(1)')
    expect(text).toContain('imports 1 files: src/server.ts')
    expect(lines.at(-1)).toMatch(/^note: exact-token matches/)
  })

  it('drops references, then tests, then definition lines to fit the budget and reports omissions', () => {
    const full = fitExplore(sample(), 100_000, 'text')
    expect(full.result.omitted).toEqual({ definitions: 0, references: 0, tests: 0 })
    const tight = fitExplore(sample(), 900, 'text')
    expect(Buffer.byteLength(tight.body, 'utf8')).toBeLessThanOrEqual(900)
    expect(tight.result.omitted.references).toBeGreaterThan(0)
    expect(tight.body).toContain('omitted entries: raise maxBytes or narrow with pathPrefix')
    const tighter = fitExplore(sample(), 800, 'text')
    expect(tighter.result.references).toHaveLength(0)
    expect(tighter.result.omitted.references).toBe(40)
    const tightest = fitExplore(sample(), 740, 'text')
    expect(tightest.result.omitted.tests).toBe(1)
    expect(Buffer.byteLength(tightest.body, 'utf8')).toBeLessThanOrEqual(740)
    expect(() => fitExplore(sample(), 1, 'text')).toThrow(/increase maxBytes/)
    const json = fitExplore(sample(), 2000, 'json')
    expect(JSON.parse(json.body).omitted.references).toBeGreaterThan(0)
    expect(sample().references).toHaveLength(40)
  })
})

describe('RepositoryNavigation.explore', () => {
  it('requires a refreshed current generation and verifies parsed file hashes', async () => {
    const root = await fixture()
    const nav = new RepositoryNavigation(root)
    await expect(nav.explore({ symbol: 'ownerOptions' })).rejects.toThrow(/no active generation/)
    await nav.refresh()
    const result = await nav.explore({ symbol: 'ownerOptions' })
    expect(result.files).toBe(4)
    expect(result.matchedLines).toBe(9)
    expect(result.otherCaseLines).toBe(1)
    expect(result.definitions.map((d) => [d.path, d.name, d.startLine, d.endLine])).toEqual([['src/ownership.ts', 'ownerOptions', 1, 4]])
    expect(result.references.map((r) => [r.path, r.line, r.scope])).toEqual([
      ['notes.md', 1, ''], ['src/ownership.ts', 10, 'in Store.write'], ['src/ownership.ts', 11, 'in Store.open'], ['src/server.ts', 3, 'in createServer'],
    ])
    expect(result.tests.map((r) => r.scope)).toEqual(["in describe('ownerOptions')", "in it('returns its input')"])
    expect(result.imports).toEqual(['src/ownership.test.ts', 'src/server.ts'])
    expect(result.lexicalFiles).toBe(1)
    expect(Object.isFrozen(result)).toBe(true)

    const narrowed = await nav.explore({ symbol: 'ownerOptions', pathPrefix: 'src/server' })
    expect(narrowed.files).toBe(1)
    expect(narrowed.definitions).toHaveLength(0)
    expect(narrowed.references.map((r) => r.path)).toEqual(['src/server.ts'])
    await expect(nav.explore({ symbol: 'ownerOptions', pathPrefix: '../x' })).rejects.toThrow(/pathPrefix/)

    const member = await nav.explore({ symbol: 'Store.write' })
    expect(member.definitions.map((d) => [d.name, d.kind, d.startLine])).toEqual([['Store.write', 'method', 10]])
    expect(member.references.map((r) => [r.path, r.line, r.scope])).toEqual([['src/server.ts', 4, 'in createServer']])

    await fsp.writeFile(path.join(root, 'src', 'server.ts'), SERVER + '// edited\n')
    await expect(nav.explore({ symbol: 'ownerOptions' })).rejects.toThrow(/requires current navigation/)
  })
})

describe('RepositoryNavigation.search pathPrefix', () => {
  it('filters by repository-relative prefix and binds continuation cursors to it', async () => {
    const root = await fixture()
    const nav = new RepositoryNavigation(root)
    await nav.refresh()
    const all = await nav.search({ term: 'ownerOptions' })
    expect(new Set(all.results.map((r) => r.path))).toEqual(new Set(['notes.md', 'src/ownership.ts', 'src/server.ts', 'src/ownership.test.ts']))
    const narrowed = await nav.search({ term: 'ownerOptions', pathPrefix: 'src/' })
    expect(narrowed.pathPrefix).toBe('src/')
    expect(narrowed.complete).toBe(true)
    expect(narrowed.results.every((r) => r.path.startsWith('src/'))).toBe(true)
    expect(narrowed.results.length).toBe(all.results.length - 2)
    const paged = await nav.search({ term: 'ownerOptions', pathPrefix: './src/', maxResults: 1 })
    expect(paged.pathPrefix).toBe('src/')
    expect(paged.nextCursor).toBeTruthy()
    await expect(nav.search({ term: 'ownerOptions', cursor: paged.nextCursor })).rejects.toThrow(/different pathPrefix/)
    const next = await nav.search({ term: 'ownerOptions', pathPrefix: 'src/', maxResults: 1, cursor: paged.nextCursor })
    expect(next.results[0].path.startsWith('src/')).toBe(true)
    expect(next.results[0]).not.toEqual(paged.results[0])
    await expect(nav.search({ term: 'ownerOptions', pathPrefix: '/abs' })).rejects.toThrow(/pathPrefix/)
    await expect(nav.search({ term: 'ownerOptions', pathPrefix: 'src/../' })).rejects.toThrow(/pathPrefix/)
    const none = await nav.search({ term: 'ownerOptions', pathPrefix: 'missing/' })
    expect(none.results).toEqual([])
    expect(none.complete).toBe(true)
    expect(none.visited).toBe(0)
  })
})
