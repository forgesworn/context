import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import type { ContextRecord, ContextRelation } from '@forgesworn/context'

export interface EcosystemManifestRepository { id: string; path: string }
export interface EcosystemManifest { v: 1; repositories: EcosystemManifestRepository[] }
export interface EcosystemScanOptions {
  maxRepositories?: number
  maxFiles?: number
  maxDepth?: number
  maxBytes?: number
  maxFileBytes?: number
  maxRecords?: number
  observedAt?: number
}
export interface EcosystemScan {
  /** Canonical manifest path for the local operator; never copied into records. */
  manifest: string
  records: ContextRecord[]
  repositoriesScanned: number
  filesScanned: number
  filesSkipped: number
  bytesRead: number
  packagesFound: number
  documentsFound: number
  sectionsFound: number
  recordsOmitted: number
}

interface PackageCandidate { repo: string; path: string; name: string; version?: string; description?: string; dependencies: string[] }
interface DocumentCandidate { repo: string; path: string; sections: SectionCandidate[]; links: string[] }
interface SectionCandidate { anchor: string; heading: string; body: string; links: string[] }
interface Candidate { type: 'repository' | 'package' | 'document' | 'section'; key: string; repo: string; path: string; text: string; source: string; dependencies?: string[]; links?: string[]; parent?: string }

const ignored = new Set(['.git', 'node_modules', 'build', 'dist', 'coverage', 'out'])
const decoder = new TextDecoder('utf-8', { fatal: true })
const slug = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function id(key: string): string { return createHash('sha256').update(`forgesworn/context/ecosystem/v1\0${key}`).digest('hex') }
function normal(root: string, path: string): string { return relative(root, path).split(sep).join('/') }
function validText(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value) }
function source(repo: string, path = '', fragment = ''): string { return `repo://${repo}/${path}${fragment}` }
function contained(root: string, path: string): boolean { const rel = relative(root, path); return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) }

async function readBounded(path: string, max: number): Promise<{ text: string; bytes: number }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    assert(info.isFile() && info.size <= max, 'Ecosystem input is not a bounded regular file.')
    const bytes = await handle.readFile()
    assert(bytes.byteLength <= max, 'Ecosystem input grew beyond its byte limit.')
    return { text: decoder.decode(bytes), bytes: bytes.byteLength }
  } finally { await handle.close() }
}
function parseManifest(value: unknown): EcosystemManifest {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Invalid ecosystem manifest.')
  const input = value as Record<string, unknown>
  assert(input.v === 1 && Array.isArray(input.repositories), 'Ecosystem manifest must use version 1 and list repositories.')
  const repositories = input.repositories.map(item => {
    assert(item !== null && typeof item === 'object' && !Array.isArray(item), 'Invalid ecosystem repository.')
    const repo = item as Record<string, unknown>
    assert(typeof repo.id === 'string' && slug.test(repo.id), 'Repository IDs must be lowercase portable slugs.')
    assert(typeof repo.path === 'string' && repo.path.length > 0 && repo.path.length <= 500 && !isAbsolute(repo.path) && !repo.path.includes('\\') && !repo.path.includes('\0') &&
      repo.path.split('/').every(part => part && part !== '.' && part !== '..'), 'Repository paths must be bounded relative paths without dot segments.')
    return { id: repo.id, path: repo.path }
  })
  assert(repositories.length > 0 && new Set(repositories.map(repo => repo.id)).size === repositories.length, 'Ecosystem repository IDs must be non-empty and unique.')
  return { v: 1, repositories }
}
function parsePackage(text: string, repo: string, path: string): PackageCandidate | undefined {
  let value: unknown
  try { value = JSON.parse(text) } catch { return undefined }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (!validText(input.name, 214) || input.version !== undefined && !validText(input.version, 256) || input.description !== undefined && !validText(input.description, 1000)) return undefined
  const dependencies = new Set<string>()
  for (const field of dependencyFields) {
    const group = input[field]
    if (group === undefined) continue
    if (!group || typeof group !== 'object' || Array.isArray(group)) return undefined
    for (const [name, constraint] of Object.entries(group as Record<string, unknown>)) {
      if (!validText(name, 214) || !validText(constraint, 1024)) return undefined
      dependencies.add(name)
    }
  }
  return { repo, path, name: input.name, ...(input.version ? { version: input.version } : {}),
    ...(input.description ? { description: input.description } : {}), dependencies: [...dependencies].sort() }
}
function headingAnchor(value: string): string {
  const base = value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/[\s-]+/gu, '-')
  return base || 'section'
}
function markdownLinks(text: string, documentPath: string): string[] {
  const out = new Set<string>()
  const pattern = /!?\[[^\]\r\n]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))(?:\s+[^)]*)?\)/gu
  for (const match of text.matchAll(pattern)) {
    let target = match[1] ?? match[2]
    target = target.split('#', 1)[0].split('?', 1)[0]
    if (!target || target.includes('\\') || /^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith('/')) continue
    try { target = decodeURIComponent(target) } catch { continue }
    const resolved = posix.normalize(posix.join(posix.dirname(documentPath), target))
    if (resolved === '..' || resolved.startsWith('../') || !/\.md$/iu.test(resolved)) continue
    out.add(resolved)
  }
  return [...out].sort()
}
function parseMarkdown(text: string, repo: string, path: string): DocumentCandidate {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const sections: SectionCandidate[] = [], preface: string[] = []
  let fence: string | undefined, current: { heading: string; lines: string[] } | undefined
  const occurrences = new Map<string, number>()
  const flush = () => {
    if (!current) return
    const base = headingAnchor(current.heading), occurrence = (occurrences.get(base) ?? 0) + 1
    occurrences.set(base, occurrence)
    const body = current.lines.join('\n').replace(/<!--[^]*?-->/gu, ' ').replace(/\s+/gu, ' ').trim()
    sections.push({ anchor: occurrence === 1 ? base : `${base}-${occurrence}`, heading: current.heading,
      body: body.slice(0, 3600), links: markdownLinks(current.lines.join('\n'), path) })
  }
  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (!fence) fence = marker
      else if (fence === marker) fence = undefined
      continue
    }
    if (fence) continue
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u.exec(line)
    if (heading) { flush(); current = { heading: heading[2].trim(), lines: [] }; continue }
    ;(current?.lines ?? preface).push(line)
  }
  flush()
  return { repo, path, sections, links: markdownLinks(preface.join('\n'), path) }
}

/** Scan an explicit multi-repository manifest into one bounded append-safe graph.
 * Package and Markdown extraction is deterministic and local; no repository code
 * is executed, no symlink is followed and no model or network service is used. */
export async function scanEcosystem(manifestPath: string, options: EcosystemScanOptions = {}): Promise<EcosystemScan> {
  assert(typeof manifestPath === 'string' && manifestPath.length > 0, 'Ecosystem manifest path is required.')
  const maxRepositories = options.maxRepositories ?? 32, maxFiles = options.maxFiles ?? 128, maxDepth = options.maxDepth ?? 8
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024, maxFileBytes = options.maxFileBytes ?? 256 * 1024
  const maxRecords = options.maxRecords ?? 128, observedAt = options.observedAt ?? Math.floor(Date.now() / 1000)
  assert(Number.isSafeInteger(maxRepositories) && maxRepositories >= 1 && maxRepositories <= 32, 'Ecosystem scan allows 1 to 32 repositories.')
  assert(Number.isSafeInteger(maxFiles) && maxFiles >= 1 && maxFiles <= 512, 'Ecosystem scan allows 1 to 512 files.')
  assert(Number.isSafeInteger(maxDepth) && maxDepth >= 0 && maxDepth <= 16, 'Ecosystem scan depth must be 0 to 16.')
  assert(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 32 * 1024 * 1024, 'Ecosystem scan byte budget must be 1024 to 33554432 bytes.')
  assert(Number.isSafeInteger(maxFileBytes) && maxFileBytes >= 1024 && maxFileBytes <= 1024 * 1024 && maxFileBytes <= maxBytes, 'Ecosystem file budget must be 1024 to 1048576 bytes and no larger than the total budget.')
  assert(Number.isSafeInteger(maxRecords) && maxRecords >= 1 && maxRecords <= 128, 'Ecosystem scan allows 1 to 128 records.')
  assert(Number.isSafeInteger(observedAt) && observedAt >= 0, 'Ecosystem scan observation time is invalid.')
  const manifestInfo = await lstat(manifestPath).catch(() => undefined)
  assert(manifestInfo?.isFile() && !manifestInfo.isSymbolicLink(), 'Ecosystem manifest must be a regular file, not a symlink.')
  const canonicalManifest = await realpath(manifestPath)
  const manifestRead = await readBounded(canonicalManifest, 256 * 1024)
  let raw: unknown
  try { raw = JSON.parse(manifestRead.text) } catch { throw new Error('Invalid ecosystem manifest JSON.') }
  const manifest = parseManifest(raw)
  assert(manifest.repositories.length <= maxRepositories, `Ecosystem manifest exceeds the ${maxRepositories}-repository limit.`)
  assert(maxRecords >= manifest.repositories.length, 'Record budget is too small to retain every ecosystem repository.')
  const base = await realpath(dirname(canonicalManifest))
  const roots = new Map<string, string>()
  for (const repo of manifest.repositories) {
    const requested = resolve(base, ...repo.path.split('/'))
    const info = await lstat(requested).catch(() => undefined)
    assert(info?.isDirectory() && !info.isSymbolicLink(), `Repository ${repo.id} is not a regular directory.`)
    const canonical = await realpath(requested)
    assert(contained(base, canonical), `Repository ${repo.id} escapes the ecosystem directory.`)
    assert(![...roots.values()].includes(canonical), 'Ecosystem repositories must resolve to distinct directories.')
    roots.set(repo.id, canonical)
  }

  const packages: PackageCandidate[] = [], documents: DocumentCandidate[] = []
  let filesScanned = 0, filesSkipped = 0, bytesRead = 0
  for (const [repo, root] of roots) {
    async function visit(directory: string, depth: number): Promise<void> {
      const entries = []
      for await (const entry of await opendir(directory)) entries.push(entry)
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        const path = join(directory, entry.name)
        const info = await lstat(path).catch(() => undefined)
        if (!info || info.isSymbolicLink()) { if (info?.isSymbolicLink()) filesSkipped++; continue }
        if (info.isDirectory()) {
          if (depth < maxDepth && !entry.name.startsWith('.') && !ignored.has(entry.name)) await visit(path, depth + 1)
          continue
        }
        if (!info.isFile() || entry.name !== 'package.json' && !/\.md$/iu.test(entry.name)) continue
        if (filesScanned >= maxFiles || info.size > maxFileBytes || bytesRead + info.size > maxBytes) { filesSkipped++; continue }
        try {
          const read = await readBounded(path, maxFileBytes)
          if (bytesRead + read.bytes > maxBytes) { filesSkipped++; continue }
          const relativePath = normal(root, path)
          if (source(repo, relativePath).length > 1000) { filesSkipped++; continue }
          filesScanned++; bytesRead += read.bytes
          if (entry.name === 'package.json') { const found = parsePackage(read.text, repo, relativePath); if (found) packages.push(found); else filesSkipped++ }
          else documents.push(parseMarkdown(read.text, repo, relativePath))
        } catch { filesSkipped++ }
      }
    }
    await visit(root, 0)
  }
  packages.sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path))
  documents.sort((a, b) => a.repo.localeCompare(b.repo) || a.path.localeCompare(b.path))
  const candidates: Candidate[] = []
  for (const repo of [...roots.keys()].sort()) candidates.push({ type: 'repository', key: `repository\0${repo}`, repo, path: '', text: `Repository ${repo}.`, source: source(repo) })
  for (const pkg of packages) {
    const qualifiers = pkg.version ? ` version ${pkg.version}` : ''
    candidates.push({ type: 'package', key: `package\0${pkg.repo}\0${pkg.path}`, repo: pkg.repo, path: pkg.path,
      text: `Package ${pkg.name}${qualifiers}.${pkg.description ? ` ${pkg.description}` : ''}`.slice(0, 4000), source: source(pkg.repo, pkg.path), dependencies: pkg.dependencies })
  }
  for (const doc of documents) candidates.push({ type: 'document', key: `document\0${doc.repo}\0${doc.path}`, repo: doc.repo, path: doc.path,
    text: `Markdown document ${doc.path}.`, source: source(doc.repo, doc.path), links: doc.links })
  for (const doc of documents) for (const section of doc.sections) {
    const fragment = `#${encodeURIComponent(section.anchor)}`
    if (source(doc.repo, doc.path, fragment).length > 1000) { filesSkipped++; continue }
    candidates.push({ type: 'section', key: `section\0${doc.repo}\0${doc.path}\0${section.anchor}`, repo: doc.repo, path: doc.path,
      text: `${section.heading}.${section.body ? ` ${section.body}` : ''}`.slice(0, 4000), source: source(doc.repo, doc.path, fragment),
      links: section.links, parent: `document\0${doc.repo}\0${doc.path}` })
  }
  const retained = candidates.slice(0, maxRecords)
  const retainedIds = new Map(retained.map(candidate => [candidate.key, id(candidate.key)]))
  const repos = new Map([...roots.keys()].map(repo => [repo, retainedIds.get(`repository\0${repo}`)!]))
  const docs = new Map(retained.filter(candidate => candidate.type === 'document').map(candidate => [`${candidate.repo}\0${candidate.path}`, retainedIds.get(candidate.key)!]))
  const packageNames = new Map<string, string[]>()
  for (const pkg of packages) packageNames.set(pkg.name, [...(packageNames.get(pkg.name) ?? []), `package\0${pkg.repo}\0${pkg.path}`])
  const records = retained.map((candidate): ContextRecord => {
    const relations: ContextRelation[] = []
    const add = (to: string | undefined, kind: ContextRelation['kind']) => { if (to && to !== retainedIds.get(candidate.key) && !relations.some(link => link.to === to && link.kind === kind)) relations.push({ to, kind }) }
    if (candidate.type !== 'repository') add(repos.get(candidate.repo), 'relates-to')
    if (candidate.parent) add(retainedIds.get(candidate.parent), 'relates-to')
    for (const dependency of candidate.dependencies ?? []) { const targets = packageNames.get(dependency); if (targets?.length === 1) add(retainedIds.get(targets[0]), 'depends-on') }
    for (const link of candidate.links ?? []) add(docs.get(`${candidate.repo}\0${link}`), 'relates-to')
    const provenance = candidate.type === 'section'
      ? { derivation: 'extracted' as const, method: 'markdown-section', confidence: 90 }
      : candidate.type === 'package' ? { derivation: 'extracted' as const, method: 'package-manifest', confidence: 100 }
        : candidate.type === 'document' ? { derivation: 'extracted' as const, method: 'source-file', confidence: 100 }
          : { derivation: 'extracted' as const, method: 'ecosystem-manifest', confidence: 100 }
    return { id: retainedIds.get(candidate.key)!, kind: 'evidence', text: candidate.text, source: candidate.source, provenance,
      observedAt, ...(relations.length ? { relations: relations.slice(0, 16) } : {}) }
  })
  return { manifest: canonicalManifest, records, repositoriesScanned: roots.size, filesScanned, filesSkipped, bytesRead,
    packagesFound: packages.length, documentsFound: documents.length, sectionsFound: documents.reduce((sum, doc) => sum + doc.sections.length, 0),
    recordsOmitted: candidates.length - records.length }
}
