// Copied into an independent tarball installation by the package smoke test and
// run as: node host-startup-package-probe.mjs ABS_INSTALLED_CLI (cwd = installation).
// Exercises the installed `setup` command only: no models, tools discovery,
// user-home writes or parent workspace scans.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, lstatSync, symlinkSync, linkSync, realpathSync, rmSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

const cli = process.argv[2]
assert.ok(cli && isAbsolute(cli), 'usage: node host-startup-package-probe.mjs ABS_INSTALLED_CLI')
const START = '<!-- z1p-context:start -->', END = '<!-- z1p-context:end -->'
const root = realpathSync(mkdtempSync(join(process.cwd(), 'host-startup-probe-')))

try {
  // A fixture home keeps any accidental default resolution away from the real user home.
  const home = join(root, 'home'); mkdirSync(home)
  const env = { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, TMPDIR: root, LANG: 'C', NO_COLOR: '1' }
  const run = args => JSON.parse(execFileSync(process.execPath, [cli, 'setup', ...args], { cwd: process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }))
  const fails = (args, pattern) => {
    let error
    try { execFileSync(process.execPath, [cli, 'setup', ...args], { cwd: process.cwd(), env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }) } catch (caught) { error = caught }
    assert.ok(error, `setup ${args.join(' ')} should fail`)
    assert.notEqual(error.status, 0)
    assert.match(String(error.stderr) + String(error.message), pattern)
  }
  // Snapshot names, bytes and mtimes so previews and rejections prove no writes.
  const snapshot = dir => {
    const out = {}
    const walk = (path, rel) => {
      for (const name of readdirSync(path).sort()) {
        const full = join(path, name), key = rel + '/' + name, info = lstatSync(full)
        if (info.isDirectory()) { out[key] = 'dir'; walk(full, key) }
        else out[key] = [info.isSymbolicLink() ? 'link' : 'file', info.mtimeMs, info.isFile() ? readFileSync(full).toString('base64') : '']
      }
    }
    walk(dir, '')
    return JSON.stringify(out)
  }
  const fixture = (name, skill = true) => {
    const dir = join(root, name); mkdirSync(dir)
    if (skill) { mkdirSync(join(dir, 'skills', 'z1p-context'), { recursive: true }); writeFileSync(join(dir, 'skills', 'z1p-context', 'SKILL.md'), '---\nname: z1p-context\ndescription: probe fixture\n---\n\nFixture skill.\n') }
    return dir
  }
  const fileName = { codex: 'AGENTS.md', claude: 'CLAUDE.md', kimi: 'AGENTS.md' }
  // Unrelated bytes: CRLF, non-ASCII, trailing spaces and no final newline.
  const prefix = '# Personal rules\r\n\r\nKeep “quotes” and ünïcode — exactly.  \r\n\tTabbed line without final newline'
  const suffix = '\n\n## Later notes\nUnrelated trailing bytes.\n'

  for (const host of ['codex', 'claude', 'kimi']) {
    const dir = fixture(host), file = join(dir, fileName[host]), skillPath = join(dir, 'skills', 'z1p-context', 'SKILL.md')
    writeFileSync(file, prefix)
    const cache = join(root, host + '-cache'); mkdirSync(cache)

    // Preview makes no writes, even with a cache directory.
    const before = snapshot(dir)
    const preview = run([host, '--config-dir', dir, '--cache-dir', cache])
    assert.equal(snapshot(dir), before)
    assert.equal(preview.applied, false); assert.equal(preview.action, 'install'); assert.equal(preview.path, file)
    assert.ok(preview.block.startsWith(START) && preview.block.endsWith(END))
    assert.ok(preview.block.includes(JSON.stringify(skillPath)))
    assert.ok(preview.block.includes("'connect' 'ROOT' '--cache-dir' " + "'" + cache + "'"))
    assert.ok(preview.block.includes("'" + cli + "'") || preview.block.includes("'" + realpathSync(cli) + "'"))

    // Apply writes exactly the original bytes followed by the managed block.
    const applied = run([host, '--config-dir', dir, '--cache-dir', cache, '--apply'])
    assert.equal(applied.applied, true); assert.equal(applied.action, 'install')
    assert.equal(readFileSync(file, 'utf8'), prefix + preview.block)
    assert.deepEqual(readdirSync(dir).sort(), [fileName[host], 'skills'].sort(), 'no lock or temporary files remain')

    // Idempotent: a second apply reports current and changes nothing.
    const settled = snapshot(dir)
    const again = run([host, '--config-dir', dir, '--cache-dir', cache, '--apply'])
    assert.equal(again.action, 'current'); assert.equal(again.applied, false)
    assert.equal(snapshot(dir), settled)

    // Bytes added after the block survive an update and a remove.
    writeFileSync(file, prefix + preview.block + suffix)
    const updated = run([host, '--config-dir', dir, '--apply'])
    assert.equal(updated.action, 'update'); assert.equal(updated.applied, true)
    const text = readFileSync(file, 'utf8')
    assert.ok(text.startsWith(prefix) && text.endsWith(suffix))
    assert.equal(text, prefix + updated.block + suffix)
    assert.ok(updated.block.includes('activity needs an explicitly configured shared cache'))

    const removePreview = run([host, '--config-dir', dir, '--remove'])
    assert.equal(removePreview.action, 'remove'); assert.equal(removePreview.applied, false)
    assert.equal(readFileSync(file, 'utf8'), text)
    const removed = run([host, '--config-dir', dir, '--remove', '--apply'])
    assert.equal(removed.applied, true)
    assert.equal(readFileSync(file, 'utf8'), prefix + suffix)
    assert.equal(run([host, '--config-dir', dir, '--remove', '--apply']).action, 'absent')
  }

  // A fresh host directory gets a new private instruction file.
  {
    const dir = fixture('claude-fresh'), file = join(dir, 'CLAUDE.md')
    const result = run(['claude', '--config-dir', dir, '--apply'])
    assert.equal(result.action, 'install'); assert.equal(result.beforeSha256, null)
    assert.equal(readFileSync(file, 'utf8'), result.block)
    assert.equal(statSync(file).mode & 0o777, 0o600)
  }

  // Codex: a non-empty AGENTS.override.md is the effective file; whitespace-only is not.
  {
    const dir = fixture('codex-override'), base = join(dir, 'AGENTS.md'), override = join(dir, 'AGENTS.override.md')
    writeFileSync(base, 'base rules\n'); writeFileSync(override, 'override rules\n')
    const result = run(['codex', '--config-dir', dir, '--apply'])
    assert.equal(result.path, override)
    assert.equal(readFileSync(override, 'utf8'), 'override rules\n' + result.block)
    assert.equal(readFileSync(base, 'utf8'), 'base rules\n')
    const blank = fixture('codex-blank-override'), blankBase = join(blank, 'AGENTS.md')
    writeFileSync(blankBase, 'base rules\n'); writeFileSync(join(blank, 'AGENTS.override.md'), ' \n\t\n')
    const fallback = run(['codex', '--config-dir', blank, '--apply'])
    assert.equal(fallback.path, blankBase)
    assert.equal(readFileSync(join(blank, 'AGENTS.override.md'), 'utf8'), ' \n\t\n')
  }

  // Rejections leave every fixture byte unchanged.
  {
    const dir = fixture('codex-later-override'), base = join(dir, 'AGENTS.md'), override = join(dir, 'AGENTS.override.md')
    writeFileSync(base, 'original base rules\n')
    run(['codex', '--config-dir', dir, '--apply'])
    writeFileSync(override, 'new override rules\n')
    fails(['codex', '--config-dir', dir, '--apply'], /inactive AGENTS.md/)
    const removed = run(['codex', '--config-dir', dir, '--remove', '--apply'])
    assert.equal(removed.path, base); assert.equal(removed.action, 'remove')
    assert.equal(readFileSync(base, 'utf8'), 'original base rules\n')
    assert.equal(readFileSync(override, 'utf8'), 'new override rules\n')
  }

  // Rejections leave every fixture byte unchanged.
  {
    const dir = fixture('rejections'), before = snapshot(dir)
    fails(['ollama', '--config-dir', dir, '--apply'], /setup requires codex, claude or kimi/)
    fails(['--config-dir', dir, '--apply'], /setup requires codex, claude or kimi/)
    fails(['claude', '--config-dir', 'relative/dir', '--apply'], /absolute/)
    assert.equal(snapshot(dir), before)

    const target = join(root, 'link-target.md'); writeFileSync(target, 'target bytes\n')
    const symlinked = fixture('symlinked'); symlinkSync(target, join(symlinked, 'CLAUDE.md'))
    const symBefore = snapshot(symlinked)
    fails(['claude', '--config-dir', symlinked], /links are not supported/)
    fails(['claude', '--config-dir', symlinked, '--apply'], /links are not supported/)
    assert.equal(snapshot(symlinked), symBefore)

    const hardlinked = fixture('hardlinked'); linkSync(target, join(hardlinked, 'AGENTS.md'))
    fails(['kimi', '--config-dir', hardlinked, '--apply'], /links are not supported/)
    fails(['codex', '--config-dir', hardlinked, '--remove', '--apply'], /links are not supported/)
    assert.equal(readFileSync(target, 'utf8'), 'target bytes\n')

    const noSkill = fixture('no-skill', false)
    fails(['claude', '--config-dir', noSkill, '--apply'], /ENOENT|install the shared z1p-context skill/)
    assert.equal(existsSync(join(noSkill, 'CLAUDE.md')), false)

    const duplicate = fixture('duplicate-markers'), dupFile = join(duplicate, 'CLAUDE.md'), dupText = `a\n${START}\n${END}\n${START}\n${END}\n`
    writeFileSync(dupFile, dupText)
    fails(['claude', '--config-dir', duplicate, '--apply'], /malformed or duplicate/)
    assert.equal(readFileSync(dupFile, 'utf8'), dupText)
  }

  // The fixture home was never written.
  assert.deepEqual(readdirSync(home), [])
  process.stdout.write('host-startup package probe passed\n')
} finally {
  rmSync(root, { recursive: true, force: true })
}
