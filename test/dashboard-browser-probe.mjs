// Optional local browser acceptance. Reuses an explicitly selected Playwright
// installation and its existing Chromium; adds no runtime/browser dependency.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { WorkspaceStore, initialiseWorkspaceStore } from '../packages/context-tools/dist/workspace-store.js'
import { discoverWorkspace, gitEnvironment } from '../packages/context-tools/dist/workspace-catalogue.js'
import { RepositoryCoordination } from '../packages/context-tools/dist/repository-coordination.js'
import { RepositoryNavigation } from '../packages/context-tools/dist/repository-navigation.js'
import { serveWorkspaceDashboard } from '../packages/context-tools/dist/workspace-dashboard.js'
import { buildPacketFromSpec } from '../packages/context-tools/dist/source-packet.mjs'
import { saveHandoverRecord } from '../packages/context-tools/dist/task-handover.mjs'

const [playwrightPath, evidencePath, axePath] = process.argv.slice(2)
assert.ok(playwrightPath && evidencePath, 'Supply Playwright module and existing private evidence directory')
const evidence = await realpath(evidencePath)
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'z1p-dashboard-browser-')))
let server, browser, store
try {
  const workspace = join(temporary, 'workspace'), root = join(workspace, 'context'), cache = join(temporary, 'cache'), base = join(temporary, 'handovers')
  await mkdir(root, { recursive: true }); await mkdir(base, { mode: 0o700 })
  await writeFile(join(root, 'queue.ts'), 'export const privateSourceMarker = 7\n')
  const git = args => execFileSync('git', ['-C', root, ...args], { env: gitEnvironment(), stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  await initialiseWorkspaceStore(cache); store = new WorkspaceStore(cache)
  await discoverWorkspace(workspace, store)
  const agents = []
  const entries = [
    ['Codex / implementation', 'Fix queued-job cancellation', 'working', ['src/queue.ts']],
    ['Claude / regression', 'Verify FIFO and cancellation behaviour', 'reviewing', ['src/']],
    ['Ollama / host-mediated', 'Document retry bounds', 'blocked', ['docs/retries.md']],
    ['Kimi / review', 'Inspect the checkpoint contract', 'reviewing', ['test/checkpoint.ts']],
    ['Codex / previous task', 'Queue <script>globalThis.injected=true</script>', 'done', ['src/other.ts']],
  ]
  for (let index = 0; index < entries.length; index++) {
    const [label, task, state, paths] = entries[index]
    const coordination = new RepositoryCoordination(store)
    agents.push((await coordination.update({ expectedRoot: root, slot: 'task-' + index, label, task, state, paths, expectedRevision: 0, ttlSeconds: 900 })).agent)
  }
  await new RepositoryNavigation(root, undefined, store).refresh()
  store.close(); store = undefined
  const directory = join(base, createHash('sha256').update(root).digest('hex'))
  await mkdir(directory, { mode: 0o700 })
  const packet = await buildPacketFromSpec({ root, spec: { version: 1, task: 'Queue cancellation review', acceptanceChecks: ['FIFO and cancelled jobs verified'], allowedFiles: ['queue.ts'], sources: [{ path: 'queue.ts', startLine: 1, endLine: 1 }], exclusions: [], unresolvedQuestions: [] } })
  await saveHandoverRecord({ root, packet, out: join(directory, 'queue-checkpoint.json'), state: { version: 1, status: 'in_progress', completed: ['Implementation prepared'], decisions: [], checks: [{ index: 0, outcome: 'passed', evidence: 'Synthetic browser fixture assertion' }], unresolvedQuestions: [], pendingEffects: [], nextAction: 'Review the exact patch before acceptance' } })
  const links = join(temporary, 'girnel.json')
  await writeFile(links, JSON.stringify({ version: 1, cards: [
    ...agents.slice(0, 2).map(agent => ({ checkoutRoot: root, agentId: agent.agentId, appUrl: 'https://girnel.example/app/', boardId: 'queue-board', cardId: 'cancel-ticket', title: 'Keep cancelled jobs out of the queue', column: 'In progress', observedAt: Date.now() })),
    { checkoutRoot: root, agentId: null, appUrl: 'https://girnel.example/app/', boardId: 'queue-board', cardId: 'next-ticket', title: 'Plan the next queue improvement', column: 'Backlog', observedAt: Date.now() },
  ] }), { mode: 0o600 })
  server = await serveWorkspaceDashboard(workspace, cache, { repositoryRoot: root, girnelLinks: links, handoverBase: base })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1512, height: 1100 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const errors = [], requests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => requests.push(request.url()))
  await page.goto(server.url)
  await page.getByRole('heading', { name: 'Keep cancelled jobs out of the queue', exact: true }).waitFor()
  assert.equal(await page.locator('article.ticket').count(), 5)
  assert.match(await page.locator('[data-lane="inactive"]').innerText(), /Plan the next queue improvement/)
  assert.equal(await page.locator('.ticket').filter({ hasText: 'Keep cancelled jobs out' }).locator('.agent').count(), 2)
  const overlapText = await page.locator('#overlaps').innerText()
  assert.match(overlapText, /Codex/); assert.match(overlapText, /Claude/)
  assert.match(await page.locator('#context').innerText(), /Selected checkout: current/)
  await page.getByText('queue-checkpoint.json', { exact: true }).click()
  assert.match(await page.locator('#checkpoints').innerText(), /Review the exact patch before acceptance/)
  assert.equal(await page.locator('.ticket').filter({ hasText: 'Keep cancelled jobs out' }).getByRole('link', { name: 'Open card in Girnel' }).getAttribute('href'), 'https://girnel.example/app/#/b/queue-board/c/cancel-ticket')
  assert.equal(await page.evaluate(() => globalThis.injected), undefined)
  assert.ok(!(await page.locator('body').innerText()).includes('privateSourceMarker'))
  if (axePath) {
    const { default: AxeBuilder } = await import(pathToFileURL(axePath).href)
    const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    await writeFile(join(evidence, 'accessibility.json'), JSON.stringify(accessibility, null, 2), { mode: 0o600 })
    assert.deepEqual(accessibility.violations.map(item => ({ id: item.id, impact: item.impact })), [])
  }
  await page.screenshot({ path: join(evidence, 'dashboard-desktop.png'), fullPage: true })
  await page.getByLabel('Find work or an agent').fill('ollama')
  assert.equal(await page.locator('article.ticket').count(), 1)
  await page.getByLabel('Find work or an agent').fill('no matching ticket')
  assert.equal(await page.locator('article.ticket').count(), 0)
  await page.getByLabel('Find work or an agent').fill('')
  await page.getByLabel('Project', { exact: true }).selectOption(root)
  assert.equal(await page.locator('article.ticket').count(), 5)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(evidence, 'dashboard-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, offenders: Array.from(document.querySelectorAll('body *')).filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width })) }))
  assert.equal(overflow.scrollWidth <= overflow.width, true, JSON.stringify(overflow))
  // A failed refresh leaves old data visibly stale; retry recovers without reload.
  await page.route('**/snapshot', route => route.fulfill({ status: 503, body: 'unavailable' }))
  await page.getByRole('button', { name: 'Refresh observations' }).click()
  await page.getByRole('alert').waitFor({ state: 'visible' })
  assert.match(await page.getByRole('alert').innerText(), /may be stale/)
  await page.unroute('**/snapshot')
  await page.getByRole('button', { name: 'Refresh observations' }).click()
  await page.getByRole('alert').waitFor({ state: 'hidden' })
  assert.equal(errors.length, 0, errors.join('\n'))
  assert.ok(requests.every(url => new URL(url).origin === new URL(server.url).origin), 'no external browser requests')
  await writeFile(join(evidence, 'browser-results.json'), JSON.stringify({ fixture: 'synthetic published activity, not actual host model executions', desktop: '1512x1100', mobile: '390x844', assertions: ['Girnel grouping and exact stable link', 'all four host labels shown as supplied data', 'shared path warning', 'explicit selected-repo freshness', 'checkpoint next action', 'source excluded and DOM injection refused', 'search/empty state/project filter', 'mobile without horizontal page overflow', 'failed refresh visibly stale and retry recovered', 'no external requests or page errors'], passed: true }, null, 2), { mode: 0o600 })
  console.log('Dashboard browser acceptance passed; desktop/mobile evidence saved.')
} finally {
  if (browser) await browser.close()
  if (server) await server.close()
  if (store) store.close()
  await rm(temporary, { recursive: true, force: true })
}
