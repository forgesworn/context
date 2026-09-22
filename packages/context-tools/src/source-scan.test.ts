import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSourceGraph } from './source-scan.js'
import { ContextVault } from '@forgesworn/context'
import { createNostrIdentity } from '@forgesworn/context/nostr'
import ts from 'typescript'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'context-source-')); roots.push(root); return root }
async function source(root: string, path: string, text: string): Promise<void> {
  const file = join(root, path); await mkdir(join(file, '..'), { recursive: true }); await writeFile(file, text)
}
function bySource(records: Awaited<ReturnType<typeof scanSourceGraph>>['records'], source: string) {
  return records.find(record => record.source === source)
}

describe('bounded TypeScript and JavaScript source graph scan', () => {
  it.each(['ts', 'js'])('resolves file-level shadowing in %s without losing direct calls', async extension => {
    const root = await fixture()
    await source(root, `scope.${extension}`, `
      export function target() { return 1 }
      export function parameter(target) { return target() }
      export function destructured({ target }) { return target() }
      export function local() { const target = () => 2; return target() }
      export function block() { { let target = () => 2; target() } }
      export function caught() { try {} catch (target) { target() } }
      export function loop(items) { for (const target of items) target() }
      export function hoisted() { target(); function target() {} }
      export function direct() { return target() }
    `)
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    for (const name of ['parameter', 'destructured', 'local', 'block', 'caught', 'loop', 'hoisted']) {
      expect(bySource(records, `repo://scope.${extension}#${name}`)!.relations?.filter(edge => edge.kind === 'calls')).toEqual([])
    }
    expect(bySource(records, `repo://scope.${extension}#direct`)!.relations?.filter(edge => edge.kind === 'calls'))
      .toEqual([{ kind: 'calls', to: bySource(records, `repo://scope.${extension}#target`)!.id }])
  })

  it('resolves named defaults and re-export aliases to the selected declaration', async () => {
    const root = await fixture()
    await source(root, 'target.ts', `export default function target() {}\nexport const arrow = () => target()`)
    await source(root, 'barrel.ts', `export { default as renamed, arrow } from './target.js'`)
    await source(root, 'a.ts', `import defaultCall from './target.js'\nimport { renamed as indirect, arrow } from './barrel.js'\nexport function invoke() { defaultCall(); indirect(); arrow() }`)
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    expect(bySource(records, 'repo://a.ts#invoke')!.relations?.filter(edge => edge.kind === 'calls').map(edge => edge.to).sort())
      .toEqual(['target', 'arrow'].map(name => bySource(records, `repo://target.ts#${name}`)!.id).sort())
  })

  it('does not turn re-export names into local bindings or type-only imports into calls', async () => {
    const root = await fixture()
    await source(root, 'target.ts', 'export function target() {}')
    await source(root, 'a.ts', `export { target as alias } from './target'\nexport function invoke() { alias() }`)
    await source(root, 'b.ts', `import type { target } from './target'\nexport function invoke() { target() }`)
    await source(root, 'c.ts', `import { type target } from './target'\nexport function invoke() { target() }`)
    await source(root, 'barrel.ts', `export type { target } from './target'`)
    await source(root, 'd.ts', `import { target } from './barrel'\nexport function invoke() { target() }`)
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    for (const file of ['a', 'b', 'c', 'd']) {
      expect(bySource(records, `repo://${file}.ts#invoke`)!.relations?.filter(edge => edge.kind === 'calls')).toEqual([])
    }
  })

  it('keeps compiler binding inside selected sources without reading configs or excluded dependencies', async () => {
    const root = await fixture()
    await source(root, 'tsconfig.json', '{"extends":"../outside.json","compilerOptions":{"types":["outside"]}}')
    await source(root, 'node_modules/outside/index.ts', 'export function external() {}')
    await source(root, 'hidden.ts', 'export function hidden() {}')
    await source(root, 'a.ts', `/// <reference path="../outside.d.ts" />\nimport { external } from 'outside'\nimport { hidden } from './hidden'\nexport function target() {}\nexport function invoke() { external(); hidden(); target() }`)
    const spies = [vi.spyOn(ts.sys, 'readFile'), vi.spyOn(ts.sys, 'fileExists'), vi.spyOn(ts.sys, 'readDirectory')]
    for (const spy of spies) spy.mockImplementation(() => { throw new Error('Unexpected compiler filesystem access') })
    try {
      const { records } = await scanSourceGraph(root, { observedAt: 123, maxFiles: 1 })
      expect(records.every(record => record.source.startsWith('repo://a.ts'))).toBe(true)
      expect(bySource(records, 'repo://a.ts#invoke')!.relations?.filter(edge => edge.kind === 'calls'))
        .toEqual([{ kind: 'calls', to: bySource(records, 'repo://a.ts#target')!.id }])
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally { for (const spy of spies) spy.mockRestore() }
  })

  it('does not join unrelated script globals or same-named class methods', async () => {
    const root = await fixture()
    await source(root, 'a.ts', 'function target() {}')
    await source(root, 'b.ts', 'function invoke() { target() }')
    await source(root, 'classes.ts', `export class A { target() {} run() { return this.target() } }\nexport class B { target() {} run() { return this.target() } }`)
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    expect(bySource(records, 'repo://b.ts#invoke')!.relations?.filter(edge => edge.kind === 'calls')).toEqual([])
    for (const name of ['A', 'B']) {
      expect(bySource(records, `repo://classes.ts#${name}.run`)!.relations?.filter(edge => edge.kind === 'calls'))
        .toEqual([{ kind: 'calls', to: bySource(records, `repo://classes.ts#${name}.target`)!.id }])
    }
  })

  it('does not alias an escaping relative import to a selected file at the virtual root', async () => {
    const root = await fixture()
    await source(root, 'target.ts', 'export function target() {}')
    await source(root, 'a.ts', `import { target } from '../target'\nexport function invoke() { target() }`)
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    expect(bySource(records, 'repo://a.ts')!.relations ?? []).toEqual([])
    expect(bySource(records, 'repo://a.ts#invoke')!.relations?.filter(edge => edge.kind === 'calls')).toEqual([])
  })

  it('distinguishes type-only export stars from real values through chained and cyclic barrels', async () => {
    const root = await fixture()
    await source(root, 'target.ts', 'export function target() {}\nexport function live() {}')
    await source(root, 'types.ts', `export type * from './target'\nexport { live } from './target'`)
    await source(root, 'chain.ts', `export { target, live } from './types'`)
    await source(root, 'local.ts', `import { target, live } from './types'\nexport { target, live }`)
    await source(root, 'values.ts', `export * from './cycle'\nexport * from './target'`)
    await source(root, 'cycle.ts', `export * from './values'`)
    await source(root, 'consumer.ts', `
      import { target as types, live as a } from './types'
      import { target as chain, live as b } from './chain'
      import { target as local, live as c } from './local'
      import { target as value } from './values'
      export function omitted() { types(); chain(); local() }
      export function kept() { a(); b(); c(); value() }
    `)
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    expect(bySource(records, 'repo://consumer.ts#omitted')!.relations?.filter(edge => edge.kind === 'calls')).toEqual([])
    expect(bySource(records, 'repo://consumer.ts#kept')!.relations?.filter(edge => edge.kind === 'calls').map(edge => edge.to).sort())
      .toEqual(['target', 'live'].map(name => bySource(records, `repo://target.ts#${name}`)!.id).sort())
  })

  it.each(['named', 'star'])('omits ambiguous %s barrel exports while retaining explicit overrides', async form => {
    const root = await fixture()
    await source(root, 'a.ts', 'export function target() {}')
    await source(root, 'b.ts', 'export function target() {}')
    const clause = form === 'named' ? '{ target }' : '*'
    await source(root, 'ambiguous.ts', `export ${clause} from './a'\nexport ${clause} from './b'`)
    await source(root, 'explicit.ts', `export * from './a'\nexport { target } from './b'`)
    await source(root, 'consumer.ts', `import { target as ambiguous } from './ambiguous'\nimport { target as explicit } from './explicit'\nexport function omitted() { ambiguous() }\nexport function kept() { explicit() }`)
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    expect(bySource(records, 'repo://consumer.ts#omitted')!.relations?.filter(edge => edge.kind === 'calls')).toEqual([])
    expect(bySource(records, 'repo://consumer.ts#kept')!.relations?.filter(edge => edge.kind === 'calls'))
      .toEqual([{ kind: 'calls', to: bySource(records, 'repo://b.ts#target')!.id }])
  })

  it('preserves distinct static and instance method identities when their names coincide', async () => {
    const root = await fixture()
    await source(root, 'a.ts', 'export class C { static target() {} target() {} static s() { this.target() } i() { this.target() } }')
    const { records } = await scanSourceGraph(root, { observedAt: 123 })
    expect(bySource(records, 'repo://a.ts#C.s')!.relations?.filter(edge => edge.kind === 'calls'))
      .toEqual([{ kind: 'calls', to: bySource(records, 'repo://a.ts#C.static.target')!.id }])
    expect(bySource(records, 'repo://a.ts#C.i')!.relations?.filter(edge => edge.kind === 'calls'))
      .toEqual([{ kind: 'calls', to: bySource(records, 'repo://a.ts#C.target')!.id }])
  })

  it('extracts deterministic files, symbols, imports, re-exports and unambiguous calls', async () => {
    const root = await fixture()
    await source(root, 'src/a.ts', `export function alpha(value: number) { return helper(value) }\nfunction helper(value: number) { return value + 1 }\nexport class Worker { run() { return this.finish() } finish() { return alpha(1) } }`)
    await source(root, 'src/b.ts', `import { alpha as renamed } from './a'\nexport const beta = () => renamed(2)\nexternal.call()`)
    await source(root, 'src/index.ts', `export { alpha } from './a.js'`)
    await source(root, 'src/plain.js', `export function javascriptOnly() { return 1 }`)
    const first = await scanSourceGraph(root, { observedAt: 123 })
    const second = await scanSourceGraph(root, { observedAt: 123 })
    expect(first).toEqual(second)
    expect(first).toMatchObject({ filesScanned: 4, filesSkipped: 0, importsFound: 2 })
    expect(first.records.every(record => /^[0-9a-f]{64}$/.test(record.id) && !JSON.stringify(record).includes(root))).toBe(true)
    expect(first.records.every(record => JSON.stringify(record.provenance) === JSON.stringify({
      derivation: 'extracted', method: 'typescript-ast', confidence: 90,
    }))).toBe(true)
    const fileA = bySource(first.records, 'repo://src/a.ts')!
    const fileB = bySource(first.records, 'repo://src/b.ts')!
    const index = bySource(first.records, 'repo://src/index.ts')!
    expect(fileB.relations).toContainEqual({ to: fileA.id, kind: 'imports' })
    expect(index.relations).toContainEqual({ to: fileA.id, kind: 'imports' })
    const alpha = bySource(first.records, 'repo://src/a.ts#alpha')!
    const helper = bySource(first.records, 'repo://src/a.ts#helper')!
    const beta = bySource(first.records, 'repo://src/b.ts#beta')!
    const run = bySource(first.records, 'repo://src/a.ts#Worker.run')!
    const finish = bySource(first.records, 'repo://src/a.ts#Worker.finish')!
    expect(alpha.relations).toContainEqual({ to: helper.id, kind: 'calls' })
    expect(beta.relations).toContainEqual({ to: alpha.id, kind: 'calls' })
    expect(run.relations).toContainEqual({ to: finish.id, kind: 'calls' })
    expect(first.records.every(record => record.relations === undefined || record.relations.length <= 16)).toBe(true)
    expect(first.records.every(record => !record.text.includes('return helper'))).toBe(true)
  })

  it('does not infer ambiguous object method or unresolved external call edges', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `import * as namespace from './b'\nexport function same() {}\nexport function caller() { object.same(); object['same'](); namespace.same(); missing() }`)
    await source(root, 'b.ts', `export function same() {}`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const caller = bySource(result.records, 'repo://a.ts#caller')!
    expect(caller.relations?.filter(edge => edge.kind === 'calls') ?? []).toEqual([])
  })

  it('keeps cyclic imports and calls valid for atomic signed ingestion', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `import { b } from './b'\nexport function a() { return b() }`)
    await source(root, 'b.ts', `import { a } from './a'\nexport function b() { return a() }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const ids = new Set(result.records.map(record => record.id))
    expect(result.records.flatMap(record => record.relations ?? []).every(edge => ids.has(edge.to))).toBe(true)
    const identity = createNostrIdentity(new Uint8Array(32).fill(31))
    const vault = new ContextVault({ identity, now: () => 123 })
    let view = await vault.create({ title: 'Source graph', scope: 'personal' })
    view = await vault.appendBatch(view.id, view.head, result.records)
    expect(view.records).toHaveLength(result.records.length)
    const a = bySource(result.records, 'repo://a.ts#a')!, b = bySource(result.records, 'repo://b.ts#b')!
    expect(vault.graphPath(view.id, { from: a.id, to: b.id }).found).toBe(true)
  })

  it('prefers an exact JavaScript file before TypeScript source substitution', async () => {
    const root = await fixture()
    await source(root, 'a.ts', 'export function typed() {}')
    await source(root, 'a.js', 'export function runtime() {}')
    await source(root, 'consumer.ts', `import { runtime } from './a.js'\nexport function use() { runtime() }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const consumer = bySource(result.records, 'repo://consumer.ts')!
    const runtime = bySource(result.records, 'repo://a.js#runtime')!
    const use = bySource(result.records, 'repo://consumer.ts#use')!
    expect(consumer.relations).toContainEqual({ to: bySource(result.records, 'repo://a.js')!.id, kind: 'imports' })
    expect(use.relations).toContainEqual({ to: runtime.id, kind: 'calls' })
  })

  it('coalesces overload declarations into one append-safe symbol record', async () => {
    const root = await fixture()
    await source(root, 'overload.ts', `export function convert(value: string): string\nexport function convert(value: number): number\nexport function convert(value: string | number) { return value }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    expect(result.records.filter(record => record.source === 'repo://overload.ts#convert')).toHaveLength(1)
    expect(new Set(result.records.map(record => record.id)).size).toBe(result.records.length)
  })

  it('ignores generated, hidden and symlinked trees and enforces read/output bounds', async () => {
    const root = await fixture(), outside = await fixture()
    await source(root, 'src/good.ts', 'export function good() {}')
    await source(root, 'src/second.ts', 'export function second() {}')
    await source(root, 'node_modules/no.ts', 'export function nope() {}')
    await source(root, '.hidden/no.ts', 'export function hidden() {}')
    await source(root, 'dist/no.ts', 'export function built() {}')
    await source(root, 'large.ts', `export const large = '${'x'.repeat(1500)}'`)
    await source(outside, 'external.ts', 'export function external() {}')
    await symlink(outside, join(root, 'linked'))
    const result = await scanSourceGraph(root, { observedAt: 123, maxFileBytes: 1024, maxBytes: 2048, maxFiles: 2, maxRecords: 2 })
    expect(result.records).toHaveLength(2)
    expect(result.records.every(record => !record.source.includes('node_modules') && !record.source.includes('hidden') && !record.source.includes('dist') && !record.source.includes('linked'))).toBe(true)
    expect(result.filesSkipped).toBeGreaterThan(0)
    expect(result.bytesRead).toBeLessThanOrEqual(2048)
    const ids = new Set(result.records.map(record => record.id))
    expect(result.records.flatMap(record => record.relations ?? []).every(edge => ids.has(edge.to))).toBe(true)
    await expect(scanSourceGraph(root, { maxFiles: 129 })).rejects.toThrow('1 to 128')
    await expect(scanSourceGraph(root, { maxFileBytes: 2048, maxBytes: 1024 })).rejects.toThrow('no larger')
    await expect(scanSourceGraph(root, { maxRecords: 0 })).rejects.toThrow('1 to 128')
  })

  it('skips invalid UTF-8 without weakening valid source evidence', async () => {
    const root = await fixture()
    await source(root, 'valid.ts', 'export function valid() {}')
    await writeFile(join(root, 'invalid.ts'), Uint8Array.from([0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0xc3, 0x28]))
    const result = await scanSourceGraph(root, { observedAt: 123 })
    expect(result).toMatchObject({ filesScanned: 1, filesSkipped: 1 })
    expect(result.records.map(record => record.source)).toContain('repo://valid.ts')
    expect(result.records.every(record => !record.source.includes('invalid'))).toBe(true)
  })

  it('omits identifiers that cannot fit the signed source field', async () => {
    const root = await fixture()
    const huge = `symbol${'x'.repeat(1100)}`
    await source(root, 'bounded.ts', `export function normal() {}\nexport function ${huge}() {}`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    expect(result.records.map(record => record.source)).toContain('repo://bounded.ts#normal')
    expect(result.records.every(record => record.source.length <= 1000)).toBe(true)
    const identity = createNostrIdentity(new Uint8Array(32).fill(30))
    const vault = new ContextVault({ identity, now: () => 123 })
    const view = await vault.create({ title: 'Bounded source', scope: 'personal' })
    await expect(vault.appendBatch(view.id, view.head, result.records)).resolves.toBeDefined()
  })

  it('retains every scanned file before exported and local declaration detail', async () => {
    const root = await fixture()
    await source(root, 'a.ts', 'function localA() {}\nexport function publicA() {}')
    await source(root, 'b.ts', 'function localB() {}\nexport function publicB() {}')
    const filesOnly = await scanSourceGraph(root, { observedAt: 123, maxRecords: 2 })
    expect(filesOnly.records.map(record => record.source)).toEqual(['repo://a.ts', 'repo://b.ts'])
    const withExports = await scanSourceGraph(root, { observedAt: 123, maxRecords: 4 })
    expect(withExports.records.map(record => record.source)).toEqual([
      'repo://a.ts', 'repo://b.ts', 'repo://a.ts#publicA', 'repo://b.ts#publicB',
    ])
  })

  it('early file with many exports does not starve later file anchors under maxRecords 4', async () => {
    const root = await fixture()
    await source(root, 'early.ts', `export function e1() {}\nexport function e2() {}\nexport function e3() {}\nexport function e4() {}`)
    await source(root, 'later.ts', `export function onlyExport() {}`)
    const result = await scanSourceGraph(root, { observedAt: 123, maxRecords: 4 })
    expect(result.records.length).toBe(4)
    const sources = result.records.map(record => record.source)
    expect(sources).toContain('repo://early.ts')
    expect(sources).toContain('repo://later.ts')
    expect(sources).toContain('repo://early.ts#e1')
    expect(sources).toContain('repo://later.ts#onlyExport')
    const laterExport = bySource(result.records, 'repo://later.ts#onlyExport')!
    expect(laterExport).toBeDefined()
  })

  it('file summary includes exported names with exact omitted count under name and text bounds', async () => {
    const root = await fixture()
    const longName = `long${'a'.repeat(650)}`
    await source(root, 'mixed.ts', [
      `export function shortOne() {}`,
      `export function shortTwo() {}`,
      `export function ${longName}() {}`,
      `export function shortThree() {}`,
    ].join('\n'))
    const first = await scanSourceGraph(root, { observedAt: 123 })
    const second = await scanSourceGraph(root, { observedAt: 123 })
    expect(first).toEqual(second)
    const fileRecord = bySource(first.records, 'repo://mixed.ts')!
    expect(fileRecord.text).toContain('exported: shortOne, shortTwo, shortThree')
    expect(fileRecord.text).toContain('(+1 omitted)')
    expect(fileRecord.text).not.toContain(longName)
    expect(fileRecord.text).toContain('shortThree')
    const exportedSegment = fileRecord.text.slice(fileRecord.text.indexOf('exported:'))
    const namesSegment = exportedSegment.slice('exported: '.length, exportedSegment.indexOf('.'))
    expect(namesSegment.length).toBeLessThan(600)
    expect(fileRecord.text.length).toBeLessThan(4000)
    const identity = createNostrIdentity(new Uint8Array(32).fill(29))
    const vault = new ContextVault({ identity, now: () => 123 })
    const view = await vault.create({ title: 'Long name source', scope: 'personal' })
    await expect(vault.appendBatch(view.id, view.head, first.records)).resolves.toBeDefined()
  })

  it('reports omitted exports when no anchor name fits within the budget', async () => {
    const root = await fixture()
    const firstName = `first${'a'.repeat(650)}`
    const secondName = `second${'b'.repeat(650)}`
    await source(root, 'alllong.ts', [
      `export function ${firstName}() {}`,
      `export function ${secondName}() {}`,
    ].join('\n'))
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const fileRecord = bySource(result.records, 'repo://alllong.ts')!
    expect(fileRecord.text).toContain('(+2 omitted)')
    expect(fileRecord.text).not.toContain(firstName)
    expect(fileRecord.text).not.toContain(secondName)
    const identity = createNostrIdentity(new Uint8Array(32).fill(28))
    const vault = new ContextVault({ identity, now: () => 123 })
    const view = await vault.create({ title: 'All long names', scope: 'personal' })
    await expect(vault.appendBatch(view.id, view.head, result.records)).resolves.toBeDefined()
  })

  it('file anchors include every exported name and exclude local ones', async () => {
    const root = await fixture()
    await source(root, 'anchors.ts', [
      `export function exportedOne() {}`,
      `function localOne() {}`,
      `export function exportedTwo() {}`,
      `function localTwo() {}`,
    ].join('\n'))
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const fileRecord = bySource(result.records, 'repo://anchors.ts')!
    expect(fileRecord.text).toContain('exportedOne')
    expect(fileRecord.text).toContain('exportedTwo')
    expect(fileRecord.text).not.toContain('localOne')
    expect(fileRecord.text).not.toContain('localTwo')
  })

  it('reports maxFilesHit at cap and preserves bounded discovery semantics', async () => {
    const root = await fixture()
    await source(root, 'a.ts', 'export function a() {}')
    await source(root, 'b.ts', 'export function b() {}')
    await source(root, 'c.ts', 'export function c() {}')
    const first = await scanSourceGraph(root, { observedAt: 123, maxFiles: 1, maxRecords: 128 })
    expect(first).toMatchObject({
      filesScanned: 1,
      filesSkipped: 0,
      symbolsFound: 1,
      scanBounds: { maxFilesHit: true, maxDepthHit: false },
    })
    expect(first.records).toHaveLength(2)
    expect(Math.max(0, first.filesScanned + first.symbolsFound - first.records.length)).toBe(0)

    const second = await scanSourceGraph(root, { observedAt: 123, maxFiles: 64, maxRecords: 1 })
    expect(second).toMatchObject({
      filesScanned: 3,
      filesSkipped: 0,
      symbolsFound: 3,
      scanBounds: { maxFilesHit: false, maxDepthHit: false },
    })
    expect(second.records).toHaveLength(1)
    expect(second.filesScanned + second.symbolsFound - second.records.length).toBe(5)
  })

  it('reports maxFilesHit at an exact cap with no additional eligible files', async () => {
    const root = await fixture()
    await source(root, 'only.ts', 'export function only() {}')
    const result = await scanSourceGraph(root, { observedAt: 123, maxFiles: 1 })
    expect(result.scanBounds.maxFilesHit).toBe(true)
    expect(result.scanBounds.maxDepthHit).toBe(false)
    expect(result.filesScanned).toBe(1)
  })

  it('leaves both scan bounds false for a below-cap flat scan', async () => {
    const root = await fixture()
    await source(root, 'one.ts', 'export function one() {}')
    await source(root, 'two.ts', 'export function two() {}')
    const result = await scanSourceGraph(root, { observedAt: 123, maxFiles: 64, maxDepth: 8 })
    expect(result.scanBounds).toEqual({ maxFilesHit: false, maxDepthHit: false })
  })

  it('reports maxDepthHit only when an otherwise traversable directory is not descended', async () => {
    const root = await fixture()
    await source(root, 'root.ts', 'export function rootFn() {}')
    await source(root, 'nested/deep.ts', 'export function deep() {}')
    const shallow = await scanSourceGraph(root, { observedAt: 123, maxDepth: 0 })
    expect(shallow.filesScanned).toBe(1)
    expect(shallow.scanBounds).toEqual({ maxFilesHit: false, maxDepthHit: true })
    expect(shallow.records.map(record => record.source)).toContain('repo://root.ts')
    expect(shallow.records.every(record => !record.source.includes('nested'))).toBe(true)

    const deep = await scanSourceGraph(root, { observedAt: 123, maxDepth: 4 })
    expect(deep.filesScanned).toBe(2)
    expect(deep.scanBounds).toEqual({ maxFilesHit: false, maxDepthHit: false })
    expect(deep.records.map(record => record.source)).toContain('repo://nested/deep.ts')
  })

  it('does not set maxDepthHit for ignored directories that are never inspected', async () => {
    const root = await fixture()
    await source(root, 'root.ts', 'export function rootFn() {}')
    await source(root, '.hidden/no.ts', 'export function hidden() {}')
    await source(root, 'node_modules/no.ts', 'export function dependency() {}')
    const result = await scanSourceGraph(root, { observedAt: 123, maxDepth: 0 })
    expect(result.filesScanned).toBe(1)
    expect(result.scanBounds).toEqual({ maxFilesHit: false, maxDepthHit: false })
    expect(result.records.every(record => !record.source.includes('hidden') && !record.source.includes('node_modules'))).toBe(true)
  })

  it('keeps records unchanged across repeated scans with the same observedAt and flags', async () => {
    const root = await fixture()
    await source(root, 'a.ts', 'export function a() {}')
    await source(root, 'nested/b.ts', 'export function b() {}')
    const first = await scanSourceGraph(root, { observedAt: 123, maxFiles: 1 })
    const second = await scanSourceGraph(root, { observedAt: 123, maxFiles: 1 })
    expect(first.records).toEqual(second.records)
    expect(first.scanBounds).toEqual(second.scanBounds)
  })

  it('does not attribute calls inside nested function bodies to the outer callable', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `export function outer() {\n  function inner() { return target() }\n  return inner()\n}\nexport function target() { return 1 }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const outer = bySource(result.records, 'repo://a.ts#outer')!
    const target = bySource(result.records, 'repo://a.ts#target')!
    expect(bySource(result.records, 'repo://a.ts#inner')).toBeUndefined()
    expect(outer.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
  })

  it('does not attribute calls inside arrow bodies to the enclosing callable', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `export function outer() {\n  const step = () => target()\n  return step()\n}\nexport function target() { return 1 }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const outer = bySource(result.records, 'repo://a.ts#outer')!
    const target = bySource(result.records, 'repo://a.ts#target')!
    expect(bySource(result.records, 'repo://a.ts#step')).toBeUndefined()
    expect(outer.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
  })

  it('omits callback-only calls from the enclosing callable', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `export function outer() {\n  items.map(item => only())\n  return direct()\n}\nexport function only() { return 1 }\nexport function direct() { return 2 }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const outer = bySource(result.records, 'repo://a.ts#outer')!
    const only = bySource(result.records, 'repo://a.ts#only')!
    const direct = bySource(result.records, 'repo://a.ts#direct')!
    expect(outer.relations?.filter(edge => edge.kind === 'calls').map(edge => edge.to).sort()).toEqual([direct.id])
    expect(outer.relations?.filter(edge => edge.kind === 'calls' && edge.to === only.id) ?? []).toEqual([])
    expect(outer.relations).toContainEqual({ to: direct.id, kind: 'calls' })
  })

  it('binds this.finish for the method but not for ordinary nested functions', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `export class Worker {\n  run() {\n    function helper() { return this.finish() }\n    return helper()\n  }\n  finish() { return 1 }\n  direct() { return this.finish() }\n}`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const run = bySource(result.records, 'repo://a.ts#Worker.run')!
    const direct = bySource(result.records, 'repo://a.ts#Worker.direct')!
    const finish = bySource(result.records, 'repo://a.ts#Worker.finish')!
    expect(run.relations?.filter(edge => edge.kind === 'calls' && edge.to === finish.id) ?? []).toEqual([])
    expect(direct.relations).toContainEqual({ to: finish.id, kind: 'calls' })
  })

  it('keeps shadowing bindings distinct from imported call targets across independent functions', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `import { target } from './b'\nexport function paramShadow(target: () => number) {\n  return target()\n}\nexport function localShadow() {\n  const target = () => 3\n  return target()\n}\nexport function blockShadow() {\n  { const target = () => 4; target() }\n}\nexport function importParam(target: () => number) {\n  return target()\n}\nexport function catchShadow() {\n  try { throw 1 } catch (target) { target() }\n}\nexport function loopShadow() {\n  for (const target of items) target()\n}\nexport function direct() { return target() }`)
    await source(root, 'b.ts', `export function target() { return 1 }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const target = bySource(result.records, 'repo://b.ts#target')!
    const paramShadow = bySource(result.records, 'repo://a.ts#paramShadow')!
    const localShadow = bySource(result.records, 'repo://a.ts#localShadow')!
    const blockShadow = bySource(result.records, 'repo://a.ts#blockShadow')!
    const importParam = bySource(result.records, 'repo://a.ts#importParam')!
    const catchShadow = bySource(result.records, 'repo://a.ts#catchShadow')!
    const loopShadow = bySource(result.records, 'repo://a.ts#loopShadow')!
    const direct = bySource(result.records, 'repo://a.ts#direct')!
    expect(paramShadow.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
    expect(localShadow.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
    expect(blockShadow.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
    expect(importParam.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
    expect(catchShadow.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
    expect(loopShadow.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
    expect(direct.relations).toContainEqual({ to: target.id, kind: 'calls' })
  })

  it('attributes destructuring, catch and loop bindings to their local declarations only', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `export function pick() { return 1 }\nexport function use() {\n  const { pick } = source\n  try { pick() } catch (pick) { pick() }\n  for (const pick of items) pick()\n  return pick()\n}\nexport const source = { pick: () => 2 }\nconst items: Array<() => void> = []`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const use = bySource(result.records, 'repo://a.ts#use')!
    const pick = bySource(result.records, 'repo://a.ts#pick')!
    expect(use.relations?.filter(edge => edge.kind === 'calls' && edge.to === pick.id) ?? []).toEqual([])
  })

  it('keeps independently declared arrows in one variable statement as separate callables', async () => {
    const root = await fixture()
    await source(root, 'a.ts', `export const first = () => target(), second = () => other()\nexport function target() { return 1 }\nexport function other() { return 2 }`)
    const result = await scanSourceGraph(root, { observedAt: 123 })
    const first = bySource(result.records, 'repo://a.ts#first')!
    const second = bySource(result.records, 'repo://a.ts#second')!
    const target = bySource(result.records, 'repo://a.ts#target')!
    const other = bySource(result.records, 'repo://a.ts#other')!
    expect(first.relations).toContainEqual({ to: target.id, kind: 'calls' })
    expect(first.relations?.filter(edge => edge.kind === 'calls' && edge.to === other.id) ?? []).toEqual([])
    expect(second.relations).toContainEqual({ to: other.id, kind: 'calls' })
    expect(second.relations?.filter(edge => edge.kind === 'calls' && edge.to === target.id) ?? []).toEqual([])
  })

})
