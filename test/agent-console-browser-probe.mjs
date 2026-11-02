import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { consoleFixture } from './agent-console-fixture.mjs'
import { claudeConsoleFixture } from './claude-console-fixture.mjs'
import { serveWorkspaceDashboard } from '../packages/context-tools/dist/workspace-dashboard.js'
const [playwrightPath, evidence, axePath, host = 'codex'] = process.argv.slice(2)
const { chromium } = await import(pathToFileURL(playwrightPath))
const f = await (host === 'claude' ? claudeConsoleFixture : consoleFixture)(join(process.cwd(), 'packages/context-tools/dist'))
let server, browser
try {
  server = await serveWorkspaceDashboard(f.workspace, f.cache, { controlDirectory: f.control, ...(host === 'claude' ? { claudeExecutable: f.executable } : { codexExecutable: f.executable }), maxRunSeconds: 90 })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(server.url)
  await page.getByRole('combobox', { name: 'Checkout', exact: true }).selectOption(f.root)
  await page.getByRole('combobox', { name: 'Host', exact: true }).selectOption(host)
  await page.getByLabel('Task title', { exact: true }).fill('Make the fixture change and verify it')
  await page.getByLabel('What should the agent do?', { exact: true }).fill('ask-question file-preview then change source.txt and run a regression.')
  await page.getByRole('button', { name: 'Save task', exact: true }).click()
  await page.getByRole('button', { name: 'Run task', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Run task', exact: true }).click()
  await page.getByLabel('Which verification should I run?', { exact: true }).waitFor({ timeout: 20000 })
  await page.getByLabel('Which verification should I run?', { exact: true }).fill('Run the regression test.')
  await page.getByRole('button', { name: 'Send answers', exact: true }).click()
  await page.getByRole('button', { name: 'Allow this request', exact: true }).waitFor()
  assert.match(await page.locator('#task-detail').innerText(), host === 'claude' ? /Requested tool: Write/ : /Proposed file changes/)
  assert.match(await page.locator('#task-detail').innerText(), host === 'claude' ? /after/ : /regression.test.mjs/)
  await page.screenshot({ path: join(evidence, 'console-approval-desktop.png'), fullPage: true })
  if (axePath) {
    const { default: AxeBuilder } = await import(pathToFileURL(axePath))
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    await writeFile(join(evidence, 'console-accessibility.json'), JSON.stringify(result, null, 2))
    assert.deepEqual(result.violations.map(item => ({ id: item.id, impact: item.impact })), [])
  }
  await page.getByRole('button', { name: 'Allow this request', exact: true }).click()
  await page.getByRole('button', { name: 'Accept reviewed result', exact: true }).waitFor({ timeout: 20000 })
  assert.match(await page.locator('#task-detail').innerText(), /New file: regression.test.mjs/)
  await page.locator('#task-detail details summary').click()
  assert.match(await page.locator('#task-detail').innerText(), host === 'claude' ? /# pass 1/ : /exit 0/)
  await page.screenshot({ path: join(evidence, 'console-review-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(evidence, 'console-review-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth, offenders: Array.from(document.querySelectorAll('body *')).filter(e => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(e => ({ tag: e.tagName, id: e.id, class: e.className, width: e.getBoundingClientRect().width })) }))
  assert.equal(overflow.actual <= overflow.width, true, JSON.stringify(overflow))
  await page.getByRole('button', { name: 'Accept reviewed result', exact: true }).click()
  await page.getByText('Accepted locally', { exact: true }).waitFor()
  await page.reload()
  await page.getByRole('button', { name: /Make the fixture change and verify it · (Claude · )?Accepted locally/ }).click()
  await page.getByText('Accepted locally', { exact: true }).waitFor()
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile(join(evidence, 'console-browser-results.json'), JSON.stringify({ host, fixture: 'deterministic stdio host double; no model inference', create: true, launch: true, question: true, approval: true, editAndRegression: true, exactResultReview: true, accept: true, reload: true, desktop: '1440x1000', mobile: '390x844', errors }, null, 2))
  console.log('Console browser journey passed: create/run/question/approval/real fixture edit+test/review/accept/reload and phone layout.')
} finally { if (browser) await browser.close(); if (server) await server.close(); await f.cleanup() }
