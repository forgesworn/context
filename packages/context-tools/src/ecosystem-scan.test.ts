import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanEcosystem } from './ecosystem-scan.js'
import { ContextVault } from '@forgesworn/context'
import { createNostrIdentity } from '@forgesworn/context/nostr'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'context-ecosystem-')); roots.push(root); return root }
async function file(root: string, path: string, value: string | object): Promise<void> {
  const target = join(root, path); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value))
}
async function manifest(root: string, repositories: { id: string; path: string }[]): Promise<string> {
  const path = join(root, 'ecosystem.json'); await file(root, 'ecosystem.json', { v: 1, repositories }); return path
}
function record(result: Awaited<ReturnType<typeof scanEcosystem>>, source: string) { return result.records.find(item => item.source === source)! }

describe('bounded multi-repository ecosystem scan', () => {
  it('links globally unambiguous dependencies across repositories and remains append-safe', async () => {
    const root = await fixture()
    await file(root, 'alpha/package.json', { name: '@demo/alpha', dependencies: { '@demo/beta': '*' } })
    await file(root, 'beta/package.json', { name: '@demo/beta' })
    const path = await manifest(root, [{ id: 'alpha', path: 'alpha' }, { id: 'beta', path: 'beta' }])
    const first = await scanEcosystem(path, { observedAt: 123 }), second = await scanEcosystem(path, { observedAt: 123 })
    expect(first.records).toEqual(second.records)
    expect(record(first, 'repo://alpha/package.json').relations).toContainEqual({ to: record(first, 'repo://beta/package.json').id, kind: 'depends-on' })
    expect(first.records.every(item => !JSON.stringify(item).includes(root))).toBe(true)
    const vault = new ContextVault({ identity: createNostrIdentity(new Uint8Array(32).fill(41)), now: () => 123 })
    const view = await vault.create({ title: 'Ecosystem', scope: 'personal' })
    const appended = await vault.appendBatch(view.id, view.head, first.records)
    const alpha = record(first, 'repo://alpha/package.json'), beta = record(first, 'repo://beta/package.json')
    expect(vault.graphPath(appended.id, { from: alpha.id, to: beta.id })).toMatchObject({ found: true,
      edges: [{ from: alpha.id, to: beta.id, kind: 'depends-on' }] })
  })

  it('extracts duplicate headings, omits fenced code and links Markdown documents for traversal', async () => {
    const root = await fixture()
    await file(root, 'docs/package.json', { name: 'docs' })
    await file(root, 'docs/README.md', '# Decision\r\nUse signed evidence. See [details](design.md#why).\r\n```md\r\n# Not a heading\r\n```\r\n# Decision\r\nKeep provenance.')
    await file(root, 'docs/design.md', '# Why\nBecause trust is bounded.')
    const result = await scanEcosystem(await manifest(root, [{ id: 'docs', path: 'docs' }]), { observedAt: 123 })
    expect(result).toMatchObject({ documentsFound: 2, sectionsFound: 3 })
    expect(record(result, 'repo://docs/README.md#decision').text).not.toContain('Not a heading')
    expect(record(result, 'repo://docs/README.md#decision-2').text).toContain('Keep provenance')
    expect(record(result, 'repo://docs/README.md#decision').relations).toContainEqual({ to: record(result, 'repo://docs/design.md').id, kind: 'relates-to' })
  })

  it('does not invent a dependency edge when a package name is duplicated', async () => {
    const root = await fixture()
    await file(root, 'a/package.json', { name: 'consumer', dependencies: { shared: '*' } })
    await file(root, 'b/package.json', { name: 'shared' }); await file(root, 'c/package.json', { name: 'shared' })
    const result = await scanEcosystem(await manifest(root, [{ id: 'a', path: 'a' }, { id: 'b', path: 'b' }, { id: 'c', path: 'c' }]), { observedAt: 123 })
    expect(record(result, 'repo://a/package.json').relations?.filter(link => link.kind === 'depends-on') ?? []).toEqual([])
  })

  it('retains repository topology first, reports omissions and never leaves dangling links', async () => {
    const root = await fixture()
    await file(root, 'a/package.json', { name: 'a' }); await file(root, 'a/README.md', '# One\nText\n# Two\nText')
    await file(root, 'b/package.json', { name: 'b' })
    const result = await scanEcosystem(await manifest(root, [{ id: 'a', path: 'a' }, { id: 'b', path: 'b' }]), { observedAt: 123, maxRecords: 3 })
    expect(result.records.map(item => item.source)).toEqual(['repo://a/', 'repo://b/', 'repo://a/package.json'])
    expect(result.recordsOmitted).toBeGreaterThan(0)
    const ids = new Set(result.records.map(item => item.id))
    expect(result.records.flatMap(item => item.relations ?? []).every(link => ids.has(link.to))).toBe(true)
  })

  it('rejects escaping, duplicate and symlinked repository selections', async () => {
    const root = await fixture(), outside = await fixture()
    await mkdir(join(root, 'good')); await mkdir(join(outside, 'external'))
    await expect(scanEcosystem(await manifest(root, [{ id: 'bad', path: '../escape' }]))).rejects.toThrow('relative paths')
    await expect(scanEcosystem(await manifest(root, [{ id: 'same', path: 'good' }, { id: 'same', path: 'good' }]))).rejects.toThrow('unique')
    await symlink(join(outside, 'external'), join(root, 'linked'))
    await expect(scanEcosystem(await manifest(root, [{ id: 'linked', path: 'linked' }]))).rejects.toThrow('regular directory')
  })

  it('ignores generated and symlinked trees and enforces file, byte and repository bounds', async () => {
    const root = await fixture(), outside = await fixture()
    await file(root, 'repo/README.md', '# Kept\nUseful'); await file(root, 'repo/node_modules/no.md', '# Hidden')
    await file(outside, 'external.md', '# External'); await symlink(outside, join(root, 'repo/linked'))
    const path = await manifest(root, [{ id: 'repo', path: 'repo' }])
    const result = await scanEcosystem(path, { observedAt: 123, maxFiles: 1, maxFileBytes: 1024, maxBytes: 1024 })
    expect(result.records.some(item => item.text.includes('Hidden') || item.text.includes('External'))).toBe(false)
    expect(result.filesSkipped).toBeGreaterThan(0)
    await expect(scanEcosystem(path, { maxRepositories: 0 })).rejects.toThrow('1 to 32')
    await expect(scanEcosystem(path, { maxRecords: 0 })).rejects.toThrow('1 to 128')
  })
})
