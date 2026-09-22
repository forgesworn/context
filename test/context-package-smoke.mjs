// Install real tarballs outside the workspace. No symlink or source-tree fallback.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, realpathSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const checkout = process.cwd()
const temp = mkdtempSync(join(tmpdir(), 'context-package-check-'))
const npm = (args, cwd = checkout) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
function pack(name) {
  const result = JSON.parse(npm(['pack', '--workspace', name, '--json', '--pack-destination', temp]))[0]
  assert.ok(result.files.some(f => f.path === 'dist/index.d.ts'))
  assert.ok(result.files.some(f => f.path === 'LICENSE'))
  assert.ok(result.files.some(f => f.path === 'THIRD_PARTY_NOTICES.md'))
  assert.ok(result.files.every(f => !f.path.startsWith('src/') && !f.path.includes('node_modules')))
  return join(temp, result.filename)
}
function install(name, tarballs) {
  const dir = join(temp, name); mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, private: true, type: 'module' }))
  npm(['install', '--prefer-offline', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], dir)
  return dir
}
function checkNotices(consumer, name) {
  const installed = join(consumer, 'node_modules', name)
  assert.match(readFileSync(join(installed, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026 TheCryptoDonkey/)
  const notices = readFileSync(join(installed, 'THIRD_PARTY_NOTICES.md'), 'utf8')
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  for (const [dependency, version] of Object.entries(manifest.dependencies)) {
    assert.ok(notices.includes(`${dependency}@${version}`), `Missing notice for ${dependency}@${version}`)
  }
  assert.match(notices, /nostr-wasm@0\.1\.0/)
  if (name === '@forgesworn/context') assert.match(notices, /Copyright \(c\) 2013 Pieter Wuille/)
}
try {
  const core = pack('@forgesworn/context')
  const tools = pack('@forgesworn/context-tools')
  const consumer = install('core-consumer', [core])
  checkNotices(consumer, '@forgesworn/context')
  const source = `import { ContextVault, type ContextIdentity } from '@forgesworn/context'
import { createNostrIdentity } from '@forgesworn/context/nostr'
const identity: ContextIdentity = createNostrIdentity(new Uint8Array(32).fill(9))
export const vault = new ContextVault({ identity })
export const view = await vault.create({ title: 'Independent consumer', scope: 'kith' })
`
  writeFileSync(join(consumer, 'consumer.mts'), source)
  execFileSync(resolve('node_modules/.bin/tsc'), ['consumer.mts', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--skipLibCheck'], { cwd: consumer, stdio: 'pipe' })
  // Browser bundling fails on accidental Node imports; resolution starts in the
  // isolated installation, not this repository's node_modules.
  execFileSync(resolve('node_modules/.bin/esbuild'), ['consumer.mts', '--bundle', '--platform=browser', '--format=esm', '--outfile=browser.mjs', '--metafile=browser-meta.json'], { cwd: consumer, stdio: 'pipe' })
  const bundle = JSON.parse(readFileSync(join(consumer, 'browser-meta.json'), 'utf8'))
  assert.ok(Object.keys(bundle.inputs).every(input => !input.includes('nostr-wasm')), 'Core browser consumer unexpectedly bundles nostr-wasm')
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    for (const name of ['kithmoot', '@modelcontextprotocol/sdk', 'zod']) assert.throws(() => require.resolve(name))
    globalThis.fetch = () => { throw new Error('Unexpected network access') }
    const { canonicalEnvelopeName } = await import('@forgesworn/context/blossom')
    assert.equal(canonicalEnvelopeName('a'.repeat(179) + '😀.txt'), 'a'.repeat(179))
    const { vault, view } = await import('./consumer.mjs')
    assert.equal(vault.read(view.id).title, 'Independent consumer')
    const cache = await vault.save()
    assert.ok(!cache.includes('Independent consumer'))
    await vault.restore(cache)
    const browser = await import('./browser.mjs')
    assert.equal(browser.vault.read(browser.view.id).title, 'Independent consumer')
  `], { cwd: consumer, stdio: 'pipe' })
  const toolsConsumer = install('tools-consumer', [core, tools])
  checkNotices(toolsConsumer, '@forgesworn/context-tools')
  const cli = join(toolsConsumer, 'node_modules/@forgesworn/context-tools/bin/encrypted-context.mjs')
  assert.match(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }), /encrypted-context mcp/)
  // Exercise the installed stdio server: no checkout scripts or source imports.
  const packetRoot = join(toolsConsumer, 'packet-repository')
  mkdirSync(packetRoot)
  writeFileSync(join(packetRoot, 'example.ts'), 'export function example() {\n  return 1\n}\n')
  const git = args => execFileSync('git', ['-C', packetRoot, ...args], { stdio: 'pipe', env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))) })
  git(['init', '--quiet'])
  git(['add', 'example.ts'])
  git(['-c', 'user.name=Context package test', '-c', 'user.email=package-test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Fixture'])
  const doctor = JSON.parse(execFileSync(process.execPath, [cli, 'doctor', packetRoot, '--term', 'example'], { encoding: 'utf8', timeout: 30000 }))
  assert.equal(doctor.ok, true)
  assert.equal(doctor.clientAcceptance, 'not-tested')
  assert.equal(doctor.binding.command, process.execPath)
  assert.deepEqual(doctor.binding.args, [realpathSync(cli), 'navigate', doctor.root])
  assert.deepEqual(doctor.tools.slice().sort(), ['repository_packet', 'repository_refresh', 'repository_search', 'repository_status'])
  assert.equal(doctor.evidence.path, 'example.ts')
  assert.equal(doctor.evidence.line, 1)
  assert.ok(!JSON.stringify(doctor).includes('export function'))
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { writeFile } from 'node:fs/promises'
    import { Client } from '@modelcontextprotocol/sdk/client/index.js'
    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
    const cli = process.argv[1], root = process.argv[2]
    const spec = { version: 1, task: 'Inspect example', acceptanceChecks: ['Complete function returned'], allowedFiles: ['example.ts'], sources: [{ path: 'example.ts', line: 2 }], exclusions: [], unresolvedQuestions: [] }
    const text = result => result.content.find(item => item.type === 'text').text
    async function open() {
      const client = new Client({ name: 'packed-packet-check', version: '1' })
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'navigate', root], stderr: 'pipe' }))
      return client
    }
    let client = await open()
    try {
      const packetTool = (await client.listTools()).tools.find(tool => tool.name === 'repository_packet')
      assert.ok(packetTool)
      assert.equal(packetTool.inputSchema.type, 'object')
      assert.deepEqual(Object.keys(packetTool.inputSchema.properties).sort(), ['expectedGeneration', 'maxBytes', 'mode', 'spec'])
      assert.deepEqual([...packetTool.inputSchema.required].sort(), ['expectedGeneration', 'mode', 'spec'])
      assert.equal(packetTool.inputSchema.additionalProperties, false)
      const early = await client.callTool({ name: 'repository_packet', arguments: { mode: 'plan', expectedGeneration: 'unrefreshed', spec } })
      assert.equal(early.isError, true)
      let status = JSON.parse(text(await client.callTool({ name: 'repository_refresh', arguments: {} })))
      const get = generation => client.callTool({ name: 'repository_packet', arguments: { mode: 'plan', expectedGeneration: generation, spec, maxBytes: 65536 } })
      const result = await get(status.generation)
      assert.notEqual(result.isError, true, text(result))
      assert.ok(Buffer.byteLength(text(result), 'utf8') <= 65536)
      const value = JSON.parse(text(result))
      assert.equal(value.packet.gitHEAD.length, 40)
      assert.equal(value.packet.sources.length, 1)
      assert.equal(value.packet.sources[0].startLine, 1)
      assert.equal(value.packet.sources[0].endLine, 3)
      await writeFile(root + '/example.ts', 'export function example() {\\n  return 22\\n}\\n')
      assert.equal((await get(status.generation)).isError, true)
      const oldGeneration = status.generation
      status = JSON.parse(text(await client.callTool({ name: 'repository_refresh', arguments: {} })))
      assert.equal((await get(oldGeneration)).isError, true)
      assert.notEqual((await get(status.generation)).isError, true)
    } finally { await client.close() }
    client = await open()
    try {
      const status = JSON.parse(text(await client.callTool({ name: 'repository_status', arguments: {} })))
      assert.equal(status.freshness, 'unavailable')
      const refreshed = JSON.parse(text(await client.callTool({ name: 'repository_refresh', arguments: {} })))
      const result = await client.callTool({ name: 'repository_packet', arguments: { mode: 'plan', expectedGeneration: refreshed.generation, spec } })
      assert.notEqual(result.isError, true, text(result))
    } finally { await client.close() }
  `, cli, packetRoot], { cwd: toolsConsumer, stdio: 'pipe', timeout: 60000 })
  const ecosystem = join(toolsConsumer, 'ecosystem')
  mkdirSync(join(ecosystem, 'alpha'), { recursive: true }); mkdirSync(join(ecosystem, 'beta'), { recursive: true })
  writeFileSync(join(ecosystem, 'alpha/package.json'), JSON.stringify({ name: '@packed/alpha', dependencies: { '@packed/beta': '*' } }))
  writeFileSync(join(ecosystem, 'beta/package.json'), JSON.stringify({ name: '@packed/beta', dependencies: { '@packed/alpha': '*' } }))
  const scanned = JSON.parse(execFileSync(process.execPath, [cli, 'scan', ecosystem, '--observed-at', '1800000000'], { encoding: 'utf8' }))
  assert.equal(scanned.records.length, 2)
  assert.ok(scanned.records.every(record => record.source.startsWith('repo://') && !JSON.stringify(record).includes(ecosystem)))
  assert.equal(scanned.records[0].relations[0].to, scanned.records[1].id)
  mkdirSync(join(ecosystem, 'source'), { recursive: true })
  writeFileSync(join(ecosystem, 'source/a.ts'), 'export function alpha() { return 1 }')
  writeFileSync(join(ecosystem, 'source/b.ts'), "import { alpha } from './a.js'\nexport function beta() { return alpha() }")
  const sourceGraph = JSON.parse(execFileSync(process.execPath, [cli, 'scan-source', ecosystem, '--observed-at', '1800000000'], { encoding: 'utf8' }))
  assert.equal(sourceGraph.filesScanned, 2)
  assert.ok(sourceGraph.records.every(record => /^[0-9a-f]{64}$/.test(record.id) && !JSON.stringify(record).includes(ecosystem)))
  assert.ok(sourceGraph.records.some(record => record.relations?.some(relation => relation.kind === 'imports')))
  assert.ok(sourceGraph.records.some(record => record.relations?.some(relation => relation.kind === 'calls')))
  writeFileSync(join(toolsConsumer, 'test-key'), '09'.repeat(32), { mode: 0o600 })
  const pubkey = execFileSync(process.execPath, ['--input-type=module', '-e', "import {createNostrIdentity} from '@forgesworn/context/nostr'; process.stdout.write(createNostrIdentity(new Uint8Array(32).fill(9)).pubkey)"], { cwd: toolsConsumer, encoding: 'utf8' })
  const args = ['--identity', join(toolsConsumer, 'test-key'), '--expect-pubkey', pubkey, '--state', join(toolsConsumer, 'state.json'), '--personal']
  const call = (name, input) => JSON.parse(execFileSync(process.execPath, [cli, 'call', name, ...args], { input: JSON.stringify(input), encoding: 'utf8' }))
  const created = call('context_create', { title: 'Packed CLI state', scope: 'personal' })
  const appended = call('context_append', { collection: created.id, expectedHead: created.head, kind: 'fact', text: 'The packed CLI can persist records.', source: 'fixture://packaging', observedAt: 1800000000 })
  assert.equal(call('context_read', { collection: created.id }).head, appended.head)
  const retrieved = call('context_retrieve', { collection: created.id, query: 'packed CLI', maxBytes: 2048 })
  assert.equal(retrieved.head, appended.head)
  assert.equal(retrieved.records[0].source, 'fixture://packaging')
  assert.equal(Buffer.byteLength(JSON.stringify(retrieved)), retrieved.bytesUsed)
  assert.ok(retrieved.bytesUsed <= 2048)
  const related = call('context_append', { collection: created.id, expectedHead: appended.head, kind: 'fact', text: 'The packed graph adapter depends on persistence.', source: 'fixture://graph', observedAt: 1800000000,
    relations: [{ to: appended.records[0].id, kind: 'depends-on' }] })
  const graph = call('context_graph', { collection: created.id, query: 'graph adapter', maxBytes: 4096, maxDepth: 1 })
  assert.deepEqual(graph.nodes.map(node => node.id), [related.records[1].id, appended.records[0].id])
  assert.deepEqual(graph.edges, [{ from: related.records[1].id, to: appended.records[0].id, kind: 'depends-on' }])
  assert.equal(Buffer.byteLength(JSON.stringify(graph)), graph.bytesUsed)
  const path = call('context_graph_path', { collection: created.id, from: appended.records[0].id, to: related.records[1].id })
  assert.equal(path.found, true)
  assert.equal(path.nodes.length, 2)
  const cycleA = '0a'.repeat(32), cycleB = '0b'.repeat(32)
  const batched = call('context_append_batch', { collection: created.id, expectedHead: related.head, records: [
    { id: cycleA, kind: 'evidence', text: 'Cycle package A', source: 'repo://a/package.json', observedAt: 1800000000, relations: [{ to: cycleB, kind: 'depends-on' }] },
    { id: cycleB, kind: 'evidence', text: 'Cycle package B', source: 'repo://b/package.json', observedAt: 1800000000, relations: [{ to: cycleA, kind: 'depends-on' }] },
  ] })
  assert.equal(call('context_graph_path', { collection: created.id, from: cycleA, to: cycleB }).found, true)
  assert.equal(batched.records.length, 4)
  assert.ok(!readFileSync(join(toolsConsumer, 'state.json'), 'utf8').includes('Packed CLI state'))
  execFileSync(process.execPath, ['--input-type=module', '-e', "import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; assert.throws(()=>createRequire(import.meta.url).resolve('kithmoot'))"], { cwd: toolsConsumer, stdio: 'pipe' })
  console.log('Packed core: independent Node import, declarations and browser bundle passed.')
  console.log('Packed Node tools: independent CLI create, append and restart recovery passed.')
  console.log('Packed repository MCP: complete source packet, stale rejection, refresh and restart passed.')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
