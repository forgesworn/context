import { afterEach, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDependencyEvidence } from './dependency-evidence.js'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'dependency-evidence-')); roots.push(root); return root }

it('separates npm declarations, lock candidates and unvisited local pointers', async () => {
  const root = await fixture()
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { api: '^2', local: 'file:../not-authorised', inherited: 'workspace:*' } }))
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/api': { version: '2.4.0' } } }))
  const { evidence, verify } = await readDependencyEvidence(root)
  expect(evidence.dependencies.find(d => d.name === 'api')).toMatchObject({ requested: '^2', lockedCandidates: [{ version: '2.4.0', sourceKind: 'lockfile-package' }], resolution: 'one-lock-candidate' })
  expect(evidence.dependencies.find(d => d.name === 'local')).toMatchObject({ sourceKind: 'local-path', resolution: 'unresolved' })
  expect(evidence.installedStateVerified).toBe(false)
  await verify()
  await writeFile(join(root, 'package.json'), '{}')
  await expect(verify()).rejects.toThrow(/changed/)
})

it('preserves Cargo rename, feature/config uncertainty and multiple locked versions', async () => {
  const root = await fixture()
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname="consumer"\nversion="1.0.0"\n[dependencies]\nrenamed={package="api",version="*"}\nlocal={path="../unvisited"}\n[features]\ndefault=["fast"]\nfast=[]\n')
  await writeFile(join(root, 'Cargo.lock'), 'version=3\n[[package]]\nname="api"\nversion="1.0.0"\nsource="registry+https://registry.invalid"\n[[package]]\nname="api"\nversion="2.0.0"\nsource="registry+https://registry.invalid"\n')
  const { evidence } = await readDependencyEvidence(root)
  expect(evidence.dependencies.find(d => d.name === 'renamed')).toMatchObject({ resolution: 'ambiguous-lock-candidates', lockedCandidates: [{ version: '1.0.0', sourceKind: 'registry' }, { version: '2.0.0', sourceKind: 'registry' }] })
  expect(evidence.buildContext).toMatchObject({ declaredCargoFeatures: ['default', 'fast'], activeCargoFeatures: null, activeCargoCfg: null })
})

it('does not attach a registry lock entry to a declared local Cargo dependency', async () => {
  const root = await fixture()
  await writeFile(join(root, 'Cargo.toml'), '[dependencies]\napi={path="../unvisited"}\n')
  await writeFile(join(root, 'Cargo.lock'), 'version=3\n[[package]]\nname="api"\nversion="8.0.0"\nsource="registry+https://registry.invalid"\n')
  const { evidence } = await readDependencyEvidence(root)
  expect(evidence.dependencies[0]).toMatchObject({ sourceKind: 'local-path', lockedCandidates: [], resolution: 'unresolved' })
})

it('reports malformed/linked metadata and respects exclusions without reading targets', async () => {
  const root = await fixture(), outside = await fixture()
  await writeFile(join(outside, 'secret'), 'DO_NOT_READ')
  await symlink(join(outside, 'secret'), join(root, 'Cargo.toml'))
  await writeFile(join(root, 'package.json'), 'broken')
  const { evidence } = await readDependencyEvidence(root)
  expect(evidence.issues).toHaveLength(2)
  expect(JSON.stringify(evidence)).not.toContain('DO_NOT_READ')
  await writeFile(join(root, '.gitignore'), 'package.json\n')
  expect((await readDependencyEvidence(root)).evidence.issues).toHaveLength(1)
})
