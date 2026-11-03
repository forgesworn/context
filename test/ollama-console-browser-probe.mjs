import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { ollamaConsoleFixture } from './ollama-console-fixture.mjs'
import { serveWorkspaceDashboard } from '../packages/context-tools/dist/workspace-dashboard.js'
const [playwrightPath, evidence, axePath] = process.argv.slice(2)
const { chromium } = await import(pathToFileURL(playwrightPath)), f = await ollamaConsoleFixture(join(process.cwd(), 'packages/context-tools/dist'))
let server, browser
try {
  server = await serveWorkspaceDashboard(f.workspace, f.cache, { controlDirectory: f.control, ollamaProfile: f.profile, maxRunSeconds: 60 })
  browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message)); await page.goto(server.url)
  await page.getByRole('combobox', { name: 'Checkout', exact: true }).selectOption(f.root); await page.getByRole('combobox', { name: 'Host', exact: true }).selectOption('ollama')
  await page.getByLabel('Task title', { exact: true }).fill('Review bounded Ollama changes'); await page.getByLabel('What should the agent do?', { exact: true }).fill('Update the selected source and propose a regression.')
  await page.locator('#task-paths').fill('source.mjs\nregression.test.mjs'); await page.getByRole('button', { name: 'Save task', exact: true }).click(); await page.getByRole('button', { name: 'Run task', exact: true }).click()
  for (const tool of ['Send bounded worker packet', 'Apply exact worker replacements', 'Run configured verification']) {
    await page.getByRole('heading', { name: 'Requested tool: ' + tool, exact: true }).waitFor({ timeout: 20000 })
    if (tool === 'Apply exact worker replacements') {
      assert.match(await page.locator('#task-detail').innerText(), /export const value = 'after'/)
      await page.screenshot({ path: join(evidence, 'worker-replacement-desktop.png'), fullPage: true })
      if (axePath) { const { default: AxeBuilder } = await import(pathToFileURL(axePath)), result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze(); await writeFile(join(evidence, 'worker-accessibility.json'), JSON.stringify(result)); assert.deepEqual(result.violations.map(v => v.id), []) }
    }
    await page.getByRole('button', { name: 'Allow this request', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Accept reviewed result', exact: true }).waitFor({ timeout: 20000 })
  assert.match(await page.locator('#task-detail').innerText(), /Configured verification passed/)
  await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: join(evidence, 'worker-review-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Accept reviewed result', exact: true }).click(); await page.getByText('Accepted locally', { exact: true }).waitFor(); await page.reload()
  await page.getByRole('button', { name: 'Review bounded Ollama changes · Ollama · Accepted locally', exact: true }).click(); await page.getByText('Accepted locally', { exact: true }).waitFor()
  await server.close(); server = undefined; await writeFile(f.mode, 'no-models'); server = await serveWorkspaceDashboard(f.workspace, f.cache, { controlDirectory: f.control, ollamaProfile: f.profile, maxRunSeconds: 60 }); await page.goto(server.url)
  await page.waitForFunction(() => document.querySelector('#task-host option[value=ollama]')?.textContent.includes('unavailable'))
  assert.equal(await page.locator('#task-host option[value=ollama]').evaluate(option => option.disabled), true); assert.match(await page.locator('#console-bound').innerText(), /not listed/)
  assert.deepEqual(errors, []); await writeFile(join(evidence, 'worker-browser-results.json'), JSON.stringify({ helper: 'deterministic double; no inference', approvals: 3, actualEditAndTest: true, acceptAndReload: true, phoneOverflow: false, unavailableModelDisabled: true, errors }, null, 2))
} finally { if (browser) await browser.close(); if (server) await server.close(); await f.cleanup() }
