import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanPackageEcosystem } from './repository-scan.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'context-scan-')); roots.push(root); return root
}
async function manifest(root: string, path: string, value: unknown): Promise<void> {
  const directory = join(root, path); await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), typeof value === 'string' ? value : JSON.stringify(value))
}

describe('bounded package ecosystem scan', () => {
  it('produces deterministic cyclic dependency records without signed absolute paths', async () => {
    const root = await fixture()
    await manifest(root, 'packages/b', { name: '@demo/b', version: '1.0.0', dependencies: { '@demo/a': '*' } })
    await manifest(root, 'packages/a', { name: '@demo/a', private: true, description: 'Alpha package', devDependencies: { '@demo/b': '*' } })
    const first = await scanPackageEcosystem(root, { observedAt: 123 })
    const second = await scanPackageEcosystem(root, { observedAt: 123 })
    expect(first.records).toEqual(second.records)
    expect(first.records.map(record => record.source)).toEqual(['repo://packages/a/package.json', 'repo://packages/b/package.json'])
    expect(first.records.every(record => !JSON.stringify(record).includes(root))).toBe(true)
    expect(first.records[0].relations?.[0].to).toBe(first.records[1].id)
    expect(first.records[1].relations?.[0].to).toBe(first.records[0].id)
  })

  it('ignores hidden, generated and symlinked directories and counts malformed manifests', async () => {
    const root = await fixture(), outside = await fixture()
    await manifest(root, 'good', { name: 'good' })
    await manifest(root, 'bad', '{')
    await manifest(root, 'node_modules/nope', { name: 'nope' })
    await manifest(root, '.hidden/nope', { name: 'hidden' })
    await manifest(outside, 'external', { name: 'external' })
    await symlink(join(outside, 'external'), join(root, 'linked'))
    const result = await scanPackageEcosystem(root)
    expect(result.records.map(record => record.text)).toEqual(['Package good.'])
    expect(result).toMatchObject({ packagesScanned: 1, manifestsSkipped: 1 })
  })

  it('enforces depth and package bounds', async () => {
    const root = await fixture()
    await manifest(root, 'one', { name: 'one' })
    await manifest(root, 'two', { name: 'two' })
    await manifest(root, 'one/deep', { name: 'deep' })
    const result = await scanPackageEcosystem(root, { maxPackages: 1, maxDepth: 1 })
    expect(result.records).toHaveLength(1)
    expect(result.manifestsSkipped).toBe(1)
    await expect(scanPackageEcosystem(root, { maxPackages: 129 })).rejects.toThrow('1 to 128')
    await expect(scanPackageEcosystem(root, { maxDepth: 9 })).rejects.toThrow('0 to 8')
  })
})
