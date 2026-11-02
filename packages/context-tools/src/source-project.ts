import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

/** Explicit, root-confined configuration. Never use TypeScript's filesystem host. */
export async function loadSourceProject(root: string, project: string) {
  const manifest: { path: string; sha256: string }[] = []
  const seen = new Set<string>()
  function fail(): never { throw new Error('Source project configuration is invalid, unsupported or outside the selected root.') }
  const inside = (absolute: string) => {
    const rel = relative(root, absolute)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail()
    return rel.split(sep).join('/')
  }
  async function bytes(absolute: string) {
    const rel = inside(absolute)
    let current = root
    for (const part of rel.split('/')) {
      current = join(current, part)
      if ((await lstat(current)).isSymbolicLink()) fail()
    }
    const file = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const before = await file.stat()
      if (!before.isFile() || before.size > 131072) fail()
      const data = Buffer.alloc(before.size)
      const read = await file.read(data, 0, data.length, 0)
      const after = await file.stat()
      if (read.bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || await realpath(absolute) !== absolute) fail()
      return data
    } finally { await file.close() }
  }
  async function load(absolute: string): Promise<ts.CompilerOptions> {
    const rel = inside(absolute)
    if (seen.has(rel) || seen.size >= 8 || !rel.endsWith('.json')) fail()
    seen.add(rel)
    const data = await bytes(absolute)
    manifest.push({ path: rel, sha256: createHash('sha256').update(data).digest('hex') })
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data) } catch { return fail() }
    const parsed = ts.parseConfigFileTextToJson(rel, text)
    if (parsed.error || !parsed.config || typeof parsed.config !== 'object' || parsed.config.references?.length) fail()
    let inherited: ts.CompilerOptions = {}
    if (parsed.config.extends !== undefined) {
      if (typeof parsed.config.extends !== 'string' || !parsed.config.extends.startsWith('.')) fail()
      let target = resolve(dirname(absolute), parsed.config.extends)
      if (!target.endsWith('.json')) target += '.json'
      inherited = await load(target)
    }
    const raw = parsed.config.compilerOptions ?? {}
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail()
    // Resolve aliases only. No plugins, type acquisition, project builds or emit.
    const virtualDir = '/' + relative(root, dirname(absolute)).split(sep).join('/')
    const converted = ts.convertCompilerOptionsFromJson(raw, virtualDir)
    if (converted.errors.length) fail()
    const options = { ...inherited, ...converted.options }
    if (raw.paths !== undefined && !raw.baseUrl && !inherited.baseUrl) options.baseUrl = virtualDir
    if (raw.baseUrl !== undefined) inside(resolve(dirname(absolute), raw.baseUrl, '__scope_check__'))
    if (raw.paths) for (const targets of Object.values(raw.paths) as unknown[]) {
      if (!Array.isArray(targets)) fail()
      for (const target of targets as unknown[]) {
        if (typeof target !== 'string' || isAbsolute(target) || target.includes('\\')) fail()
        const base = resolve(root, '.' + (options.baseUrl ?? virtualDir))
        inside(resolve(base, target.replaceAll('*', '__wildcard__')))
      }
    }
    return options
  }
  if (typeof project !== 'string' || isAbsolute(project) || project.includes('\\')) fail()
  try {
    const path = inside(resolve(root, project))
    const compilerOptions = await load(resolve(root, project))
    const selected = manifest.find(item => item.path === path)!
    return { compilerOptions, evidence: { ...selected, manifest, method: 'explicit-root-confined-typescript-config' as const },
      verify: async () => {
        for (const item of manifest) if (createHash('sha256').update(await bytes(resolve(root, item.path))).digest('hex') !== item.sha256) fail()
      } }
  } catch { return fail() }
}
