import { afterEach, expect, it } from 'vitest'
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setupHost, runHostSetup } from './host-startup.js'

const scratch: string[] = []
afterEach(async () => { for (const path of scratch.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'z1p-startup-'))); scratch.push(root)
  await mkdir(join(root, 'skills', 'z1p-context'), { recursive: true })
  await writeFile(join(root, 'skills', 'z1p-context', 'SKILL.md'), '---\nname: z1p-context\n---\nContext workflow\n')
  return { root, options: { host: 'codex' as const, configDirectory: root, command: ['/node', "/cli with 'quotes'/cli.mjs"] } }
}

it('previews without writes, applies idempotently, and removes only its own bytes', async () => {
  const { root, options } = await fixture(), path = join(root, 'AGENTS.md')
  const original = '\ufeff# Existing instructions\r\n\r\nKeep café, approvals and existing settings. No final newline'
  await writeFile(path, original); await chmod(path, 0o640)
  const preview = await setupHost(options)
  expect(preview.action).toBe('install'); expect(preview.applied).toBe(false)
  expect(await readFile(path, 'utf8')).toBe(original)
  expect(await readdir(root)).toEqual(['AGENTS.md', 'skills'])
  const installed = await setupHost({ ...options, apply: true })
  expect(installed.applied).toBe(true); expect(installed.beforeSha256).toBe(preview.beforeSha256)
  expect(await readFile(path, 'utf8')).toBe(original + preview.block)
  expect((await lstat(path)).mode & 0o777).toBe(0o640)
  expect((await setupHost({ ...options, apply: true })).action).toBe('current')
  await writeFile(path, original + preview.block + '\nOwner appended another rule.\n')
  await setupHost({ ...options, remove: true, apply: true })
  expect(await readFile(path, 'utf8')).toBe(original + '\nOwner appended another rule.\n')
  expect((await setupHost({ ...options, remove: true })).action).toBe('absent')
})

it('tells the agent to call retrieval tools directly and stays short without its shell command', async () => {
  const { root, options } = await fixture()
  const cache = join(root, 'cache'); await mkdir(cache)
  for (const block of [(await setupHost(options)).block, (await setupHost({ ...options, cacheDirectory: cache })).block]) {
    expect(block).toContain('do not call repository_status or repository_refresh first')
    expect(block).toContain('Call repository_refresh only before repository_search')
    expect(block).toContain(JSON.stringify(join(root, 'skills', 'z1p-context', 'SKILL.md')))
    expect(block).not.toContain('read repository_status'); expect(block).not.toContain('call repository_status and')
    expect(block).not.toContain('At the start of project work'); expect(block).not.toContain('load the shared z1p-context skill')
    // The managed section is resent every session, so the quoted command, which varies by machine, is outside the budget.
    const withoutCommand = block.replace(/(shell connection: ).*?(\. Substitute)/s, '$1$2')
    expect(withoutCommand.length).toBeLessThan(block.length)
    expect(Buffer.byteLength(withoutCommand)).toBeLessThan(2000)
  }
})

it('targets the effective Codex override and leaves the base untouched', async () => {
  const { root, options } = await fixture()
  await writeFile(join(root, 'AGENTS.md'), '# Base\n')
  await writeFile(join(root, 'AGENTS.override.md'), '# Temporary override\n')
  const result = await setupHost({ ...options, apply: true })
  expect(result.path).toBe(join(root, 'AGENTS.override.md'))
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Base\n')
  expect(await readFile(result.path, 'utf8')).toContain(result.block)
  expect((await setupHost({ ...options, apply: true })).action).toBe('current')
  const removed = await setupHost({ ...options, remove: true, apply: true })
  expect(removed.path).toBe(result.path)
  expect(await readFile(result.path, 'utf8')).toBe('# Temporary override\n')
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe('# Base\n')
})

it('preserves group-write permissions rather than applying the current umask to an existing file', async () => {
  const { root, options } = await fixture(), path = join(root, 'AGENTS.md')
  await writeFile(path, '# Shared user instructions\n'); await chmod(path, 0o660)
  await setupHost({ ...options, apply: true })
  expect((await lstat(path)).mode & 0o777).toBe(0o660)
})

it('does not turn an empty Codex override into a shadow of existing instructions', async () => {
  const { root, options } = await fixture()
  await writeFile(join(root, 'AGENTS.override.md'), '')
  expect((await setupHost({ ...options, apply: true })).path).toBe(join(root, 'AGENTS.md'))
  expect(await readFile(join(root, 'AGENTS.override.md'), 'utf8')).toBe('')
})

it('removes its dormant base section when a Codex override was added after installation', async () => {
  const { root, options } = await fixture(), base = join(root, 'AGENTS.md'), override = join(root, 'AGENTS.override.md')
  await writeFile(base, '# Original user instructions\n')
  await setupHost({ ...options, apply: true })
  await writeFile(override, '# Newly selected override\n')
  const result = await setupHost({ ...options, remove: true, apply: true })
  expect(result.action).toBe('remove'); expect(result.path).toBe(base)
  expect(await readFile(base, 'utf8')).toBe('# Original user instructions\n')
  expect(await readFile(override, 'utf8')).toBe('# Newly selected override\n')
})

it('requires removal before moving guidance into an override and rejects sections in both files', async () => {
  const { root, options } = await fixture(), base = join(root, 'AGENTS.md'), override = join(root, 'AGENTS.override.md')
  const installed = await setupHost({ ...options, apply: true })
  await writeFile(override, '# Override\n')
  await expect(setupHost({ ...options, apply: true })).rejects.toThrow(/inactive AGENTS.md/)
  expect(await readFile(base, 'utf8')).toBe(installed.block)
  await writeFile(override, '# Override\n' + installed.block)
  await expect(setupHost({ ...options, remove: true, apply: true })).rejects.toThrow(/both Codex/)
  expect(await readFile(base, 'utf8')).toBe(installed.block)
  expect(await readFile(override, 'utf8')).toBe('# Override\n' + installed.block)
})

it('honours each configured host home, installs private files and ignores unrelated configuration', async () => {
  const { root } = await fixture()
  for (const [host, key, filename] of [['codex', 'CODEX_HOME', 'AGENTS.md'], ['claude', 'CLAUDE_CONFIG_DIR', 'CLAUDE.md'], ['kimi', 'KIMI_CODE_HOME', 'AGENTS.md']] as const) {
    const config = join(root, host); await mkdir(config)
    await symlink(join(root, 'skills'), join(config, 'skills'))
    await writeFile(join(config, 'config.toml'), 'unrelated settings\n')
    const result = await runHostSetup([host, '--apply'], ['/node', '/cli'], { [key]: config })
    expect(result.path).toBe(join(config, filename)); expect(result.applied).toBe(true)
    expect((await lstat(result.path)).mode & 0o777).toBe(0o600)
    expect(await readFile(join(config, 'config.toml'), 'utf8')).toBe('unrelated settings\n')
    expect(await readdir(config)).toEqual([filename, 'config.toml', 'skills'].sort())
  }
})

it('updates configured shell storage without changing text outside the managed section', async () => {
  const { root, options } = await fixture(), path = join(root, 'AGENTS.md')
  const before = await setupHost({ ...options, apply: true })
  await writeFile(path, 'prefix\n' + before.block + '\nsuffix')
  const cache = join(root, "cache with 'quote'"); await mkdir(cache)
  const result = await setupHost({ ...options, cacheDirectory: cache, handoverBase: root, apply: true })
  expect(result.action).toBe('update')
  expect(await readFile(path, 'utf8')).toBe('prefix\n' + result.block + '\nsuffix')
  expect(result.block).toContain("'\\''")
  expect(result.block).toContain('--cache-dir'); expect(result.block).toContain('--handover-base')
})

it('rejects duplicate or malformed markers without modifying the file', async () => {
  const { root, options } = await fixture(), path = join(root, 'AGENTS.md')
  for (const original of ['<!-- z1p-context:start -->', '<!-- z1p-context:end -->', '<!-- z1p-context:end --><!-- z1p-context:start -->', '<!-- z1p-context:start --><!-- z1p-context:start --><!-- z1p-context:end -->']) {
    await writeFile(path, original)
    await expect(setupHost({ ...options, apply: true })).rejects.toThrow(/markers/)
    expect(await readFile(path, 'utf8')).toBe(original)
  }
})

it('refuses symlinks, hard links, oversized and invalid UTF-8 instructions', async () => {
  const { root, options } = await fixture(), path = join(root, 'AGENTS.md'), other = join(root, 'owner.md')
  await writeFile(other, '# Owner\n')
  for (const make of [() => symlink(other, path), () => link(other, path)]) {
    await make(); await expect(setupHost({ ...options, apply: true })).rejects.toThrow(/links/)
    expect(await readFile(other, 'utf8')).toBe('# Owner\n'); await rm(path)
  }
  for (const bytes of [Buffer.alloc(131073, 65), Buffer.from([255])]) {
    await writeFile(path, bytes)
    await expect(setupHost({ ...options, apply: true })).rejects.toThrow()
    expect(await readFile(path)).toEqual(bytes)
  }
})

it('refuses an existing installer lock and can remove the block after a skill is uninstalled', async () => {
  const { root, options } = await fixture(), path = join(root, 'AGENTS.md')
  await writeFile(path + '.z1p.lock', 'another operation')
  await expect(setupHost({ ...options, apply: true })).rejects.toThrow(/inspect the owning operation/)
  await expect(lstat(path)).rejects.toHaveProperty('code', 'ENOENT')
  expect(await readFile(path + '.z1p.lock', 'utf8')).toBe('another operation')
  await rm(path + '.z1p.lock')
  await setupHost({ ...options, apply: true }); await rm(join(root, 'skills'), { recursive: true })
  await setupHost({ ...options, remove: true, apply: true })
  expect(await readFile(path, 'utf8')).toBe('')
})

it('keeps one valid block when installers compete for a new destination', async () => {
  const { root, options } = await fixture()
  const results = await Promise.allSettled([setupHost({ ...options, apply: true }), setupHost({ ...options, apply: true })])
  expect(results.some(result => result.status === 'fulfilled' && result.value.applied)).toBe(true)
  const current = await setupHost(options)
  expect(current.action).toBe('current')
  expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe(current.block)
  expect(await readdir(root)).toEqual(['AGENTS.md', 'skills'])
})

it('requires an installed skill, an absolute existing directory and a supported host', async () => {
  const { root, options } = await fixture()
  await expect(setupHost({ ...options, configDirectory: '.' })).rejects.toThrow(/absolute/)
  await expect(setupHost({ ...options, cacheDirectory: join(root, 'missing') })).rejects.toThrow()
  await expect(runHostSetup(['ollama', '--apply'], ['/node', '/cli'])).rejects.toThrow(/host adapter/)
  await expect(runHostSetup(['codex', '--unknown'], ['/node', '/cli'])).rejects.toThrow()
  await rm(join(root, 'skills'), { recursive: true })
  await expect(setupHost(options)).rejects.toThrow()
})
