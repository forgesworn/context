import { constants } from 'node:fs'
import { open, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { parse as parseToml } from 'smol-toml'
import { NavigationPolicy } from './repository-navigation-policy.js'

export interface DependencyObservation {
  ecosystem: 'npm' | 'cargo'; name: string; scope: string; requested: string | null
  sourceKind: 'registry' | 'local-path' | 'git' | 'workspace' | 'unknown'
  lockedCandidates: { version: string; sourceKind: string }[]
  resolution: 'one-lock-candidate' | 'ambiguous-lock-candidates' | 'unresolved'
}
const object = (x: unknown): Record<string, any> => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, any> : {}
function safe(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return null
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)([^\s/]+)/gi, (_, scheme, host) => scheme + host.split('@').at(-1)).replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1')
}

/** Manifest and lock observations, never an installed-state or release claim.
 * Only four named root files are read; declared paths are never followed. */
export async function readDependencyEvidence(root: string) {
  const policy = await NavigationPolicy.load(root)
  const paths = ['package.json', 'package-lock.json', 'Cargo.toml', 'Cargo.lock']
  const snapshots = new Map<string, Buffer | undefined>(), issues: { path: string; reason: string }[] = []
  async function read(path: string) {
    if (!policy.allows(path, false, policy.rootDirectoryScope())) return undefined
    const absolute = join(root, path)
    const entry = await lstat(absolute).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error })
    if (!entry) return undefined
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 2 * 1024 * 1024) throw new Error('unreadable-metadata')
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const before = await file.stat()
      if (!before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino || before.size !== entry.size) throw new Error('changing-metadata')
      const buffer = Buffer.alloc(before.size)
      let offset = 0
      while (offset < buffer.length) { const r = await file.read(buffer, offset, buffer.length - offset, offset); if (!r.bytesRead) break; offset += r.bytesRead }
      const after = await file.stat(), current = await lstat(absolute)
      if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || current.isSymbolicLink() || current.dev !== before.dev || current.ino !== before.ino) throw new Error('changing-metadata')
      return buffer
    } finally { await file.close() }
  }
  for (const path of paths) try { snapshots.set(path, await read(path)) } catch { issues.push({ path, reason: 'unreadable-linked-oversized-or-changing' }) }
  const decode = (path: string) => {
    const bytes = snapshots.get(path)
    if (!bytes) return {}
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return object(path.endsWith('.json') ? JSON.parse(text) : parseToml(text, { unsafeKeyBehaviour: 'throw' }))
    } catch { issues.push({ path, reason: 'invalid-or-unsupported-metadata' }); return {} }
  }
  const npm = decode('package.json'), npmLock = decode('package-lock.json'), cargo = decode('Cargo.toml'), cargoLock = decode('Cargo.lock')
  const dependencies: DependencyObservation[] = []
  let omittedDependencies = 0
  const add = (row: Omit<DependencyObservation, 'resolution'>) => {
    if (dependencies.length >= 256) { omittedDependencies++; return }
    dependencies.push({ ...row, resolution: row.lockedCandidates.length === 1 ? 'one-lock-candidate' : row.lockedCandidates.length > 1 ? 'ambiguous-lock-candidates' : 'unresolved' })
  }
  for (const scope of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) for (const [name, requested] of Object.entries(object(npm[scope]))) {
    if (!safe(name)) continue
    const value = safe(requested), locked = object(object(npmLock.packages)[`node_modules/${name}`])
    const sourceKind = value?.startsWith('workspace:') ? 'workspace' : value && /^(file:|link:|\.\.?\/|\/)/.test(value) ? 'local-path' : value && /^(git|https?:\/\/.*\.git)/.test(value) ? 'git' : value ? 'registry' : 'unknown'
    add({ ecosystem: 'npm', name, scope, requested: value, sourceKind,
      lockedCandidates: safe(locked.version) ? [{ version: safe(locked.version)!, sourceKind: locked.link ? 'local-path' : 'lockfile-package' }] : [] })
  }
  const cargoGroups: { scope: string; values: Record<string, any> }[] = []
  const group = (prefix: string, data: Record<string, any>) => {
    for (const name of ['dependencies', 'dev-dependencies', 'build-dependencies']) cargoGroups.push({ scope: prefix + name, values: object(data[name]) })
  }
  group('', cargo)
  for (const [cfg, target] of Object.entries(object(cargo.target))) group(`target.${safe(cfg) ?? 'unknown'}.`, object(target))
  const cargoLocked = new Map<string, { version: string; sourceKind: string }[]>()
  for (const item of Array.isArray(cargoLock.package) ? cargoLock.package : []) {
    const name = safe(object(item).name), version = safe(object(item).version)
    if (!name || !version) continue
    const source = object(item).source
    const candidate = { version, sourceKind: typeof source === 'string' ? source.startsWith('registry+') ? 'registry' : source.startsWith('git+') ? 'git' : 'unknown' : 'local-or-workspace' }
    const rows = cargoLocked.get(name) ?? []; rows.push(candidate); cargoLocked.set(name, rows)
  }
  for (const { scope, values } of cargoGroups) for (const [name, raw] of Object.entries(values)) {
    if (!safe(name)) continue
    let declaration = typeof raw === 'string' ? { version: raw } : object(raw)
    const workspace = declaration.workspace === true
    if (workspace) declaration = typeof object(object(cargo.workspace).dependencies)[name] === 'string'
      ? { version: object(object(cargo.workspace).dependencies)[name] } : object(object(object(cargo.workspace).dependencies)[name])
    const packageName = safe(declaration.package) ?? name
    const local = safe(declaration.path), git = safe(declaration.git)
    const sourceKind = local ? 'local-path' : git ? 'git' : workspace ? 'workspace' : safe(declaration.version) ? 'registry' : 'unknown'
    const candidates = (cargoLocked.get(packageName) ?? []).filter(candidate => sourceKind === 'local-path' ? candidate.sourceKind === 'local-or-workspace'
      : sourceKind === 'git' ? candidate.sourceKind === 'git' : sourceKind === 'registry' ? candidate.sourceKind === 'registry' : true)
    // Name matching cannot select a version when Cargo.lock contains several.
    add({ ecosystem: 'cargo', name, scope, requested: local ?? git ?? safe(declaration.version), sourceKind, lockedCandidates: candidates.slice(0, 32) })
    if (candidates.length > 32) omittedDependencies += candidates.length - 32
  }
  const files = paths.map(path => ({ path, state: snapshots.get(path) ? 'observed' : issues.some(i => i.path === path) ? 'unavailable' : 'absent-or-excluded', sha256: snapshots.get(path) ? createHash('sha256').update(snapshots.get(path)!).digest('hex') : null }))
  return { evidence: { files, dependencies, omittedDependencies, issues,
    buildContext: { declaredCargoFeatures: Object.keys(object(cargo.features)).filter(name => safe(name)).slice(0, 256), activeCargoFeatures: null, activeCargoCfg: null, kotlinBuildEvaluated: false },
    installedStateVerified: false, releaseSourceVerified: false,
    caveat: 'Declared ranges, lock candidates and local source pointers are separate observations. A name match does not select the installed package, build configuration, source commit or released artefact. Local paths are not followed.' },
    verify: async () => {
      for (const [path, before] of snapshots) {
        const after = await read(path)
        if (before === undefined ? after !== undefined : !after?.equals(before)) throw new Error('Dependency metadata changed during graph construction')
      }
    } }
}
