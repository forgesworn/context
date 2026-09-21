import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanSourceGraph } from './source-scan.js'
import { ContextVault } from '@forgesworn/context'
import { createNostrIdentity } from '@forgesworn/context/nostr'

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
})
