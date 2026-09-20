import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import type { ContextRecord, ContextRelation } from '@forgesworn/context'

export interface RepositoryScanOptions {
  maxPackages?: number
  maxDepth?: number
  observedAt?: number
}
export interface RepositoryScan {
  /** Canonical absolute path for the local operator; never copied into records. */
  root: string
  records: ContextRecord[]
  packagesScanned: number
  manifestsSkipped: number
}

interface PackageManifest {
  path: string
  name: string
  version?: string
  private?: boolean
  description?: string
  dependencies: string[]
}

const ignored = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage'])
const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
const decoder = new TextDecoder('utf-8', { fatal: true })
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function recordId(path: string): string {
  return createHash('sha256').update(`forgesworn/context/repository-package/v1\0${path}`).digest('hex')
}
function validString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value)
}
function relativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}
async function readManifest(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    assert(info.isFile() && info.size <= 256 * 1024, 'Manifest is not a bounded regular file.')
    return JSON.parse(decoder.decode(await handle.readFile()))
  } finally { await handle.close() }
}
function parseManifest(value: unknown, path: string): PackageManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (!validString(input.name, 214)) return undefined
  if (input.version !== undefined && !validString(input.version, 256)) return undefined
  if (input.description !== undefined && !validString(input.description, 1000)) return undefined
  if (input.private !== undefined && typeof input.private !== 'boolean') return undefined
  const dependencies = new Set<string>()
  for (const field of dependencyFields) {
    const group = input[field]
    if (group === undefined) continue
    if (!group || typeof group !== 'object' || Array.isArray(group)) return undefined
    for (const [name, constraint] of Object.entries(group as Record<string, unknown>)) {
      if (!validString(name, 214) || !validString(constraint, 1024)) return undefined
      dependencies.add(name)
    }
  }
  return { path, name: input.name, ...(input.version ? { version: input.version } : {}),
    ...(input.private !== undefined ? { private: input.private } : {}),
    ...(input.description ? { description: input.description } : {}), dependencies: [...dependencies].sort() }
}
function text(manifest: PackageManifest): string {
  const qualifiers = [manifest.version ? `version ${manifest.version}` : undefined,
    manifest.private === true ? 'private' : manifest.private === false ? 'public' : undefined].filter(Boolean).join(', ')
  const prefix = `Package ${manifest.name}${qualifiers ? ` (${qualifiers})` : ''}.`
  return manifest.description ? `${prefix} ${manifest.description}`.slice(0, 3999) : prefix
}

/** Inspect package manifests under an explicitly selected directory. The scan
 * is local, read-only and bounded; it neither executes packages nor reads source. */
export async function scanPackageEcosystem(root: string, options: RepositoryScanOptions = {}): Promise<RepositoryScan> {
  assert(typeof root === 'string' && root.length > 0, 'Repository scan root is required.')
  const maxPackages = options.maxPackages ?? 64, maxDepth = options.maxDepth ?? 4
  const observedAt = options.observedAt ?? Math.floor(Date.now() / 1000)
  assert(Number.isSafeInteger(maxPackages) && maxPackages >= 1 && maxPackages <= 128, 'Repository scan allows 1 to 128 packages.')
  assert(Number.isSafeInteger(maxDepth) && maxDepth >= 0 && maxDepth <= 8, 'Repository scan depth must be 0 to 8.')
  assert(Number.isSafeInteger(observedAt) && observedAt >= 0, 'Repository scan observation time is invalid.')
  const canonicalRoot = await realpath(root)
  assert((await stat(canonicalRoot)).isDirectory(), 'Repository scan root must be a directory.')
  const found: PackageManifest[] = []
  let manifestsSkipped = 0
  async function visit(directory: string, depth: number): Promise<void> {
    const entries = []
    for await (const entry of await opendir(directory)) entries.push(entry)
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (entry.name === 'package.json') {
        const path = join(directory, entry.name)
        try {
          const info = await lstat(path)
          if (info.isSymbolicLink() || !info.isFile()) continue
          const manifest = parseManifest(await readManifest(path), relativePath(canonicalRoot, path))
          if (!manifest) { manifestsSkipped++; continue }
          if (found.length >= maxPackages) { manifestsSkipped++; continue }
          found.push(manifest)
        } catch { manifestsSkipped++ }
        continue
      }
      if (depth >= maxDepth || entry.name.startsWith('.') || ignored.has(entry.name)) continue
      const path = join(directory, entry.name)
      const info = await lstat(path).catch(() => undefined)
      if (info?.isDirectory() && !info.isSymbolicLink()) await visit(path, depth + 1)
    }
  }
  await visit(canonicalRoot, 0)
  found.sort((a, b) => a.path.localeCompare(b.path))
  const ids = new Map(found.map(manifest => [manifest.path, recordId(manifest.path)]))
  const names = new Map<string, string[]>()
  for (const manifest of found) names.set(manifest.name, [...(names.get(manifest.name) ?? []), ids.get(manifest.path)!])
  const records = found.map((manifest): ContextRecord => {
    const relations: ContextRelation[] = []
    for (const dependency of manifest.dependencies) {
      const targets = names.get(dependency)
      if (targets?.length === 1 && targets[0] !== ids.get(manifest.path)) relations.push({ to: targets[0], kind: 'depends-on' })
    }
    relations.sort((a, b) => a.to.localeCompare(b.to))
    return { id: ids.get(manifest.path)!, kind: 'evidence', text: text(manifest), source: `repo://${manifest.path}`,
      observedAt, ...(relations.length ? { relations } : {}) }
  })
  return { root: canonicalRoot, records, packagesScanned: records.length, manifestsSkipped }
}
