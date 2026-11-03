import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { probeConcurrentConsole } from './concurrent-console-package-probe.mjs'
const [playwrightPath, evidence, axePath] = process.argv.slice(2)
const { chromium } = await import(pathToFileURL(playwrightPath)), browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  const result = await probeConcurrentConsole(join(process.cwd(), 'packages/context-tools/bin/encrypted-context.mjs'), async (stage, { server, f, tasks, action, act, wait }) => {
    await page.goto(server.url)
    if (stage === 'handover') {
      const queued = await action({ action: 'create', requestId: randomUUID(), root: f.root, host: 'codex', isolation: 'worktree', title: 'Waiting for capacity', objective: 'file-preview verify the fixture.', paths: ['source.txt'] })
      await page.getByRole('button', { name: /^Waiting for capacity/ }).waitFor()
      await page.getByRole('button', { name: /^Waiting for capacity/ }).click()
      await page.waitForFunction(() => document.querySelector('#task-detail button')?.disabled === true)
      await act(tasks[0].id, 'stop'); await wait(tasks[0].id, task => task.status === 'cancelled')
      await page.waitForFunction(() => document.querySelector('#task-detail button')?.textContent === 'Run task' && document.querySelector('#task-detail button')?.disabled === false)
      await act(tasks[0].id, 'run', { message: 'file-preview Resume the scoped fixture after the capacity check.' }); await wait(tasks[0].id, task => task.status === 'waiting')
      await page.getByRole('button', { name: /^Concurrent claude/ }).click()
      await page.getByText('Acknowledged by agent', { exact: true }).waitFor()
      assert.match(await page.locator('#console-bound').innerText(), /2\/2 active runs/)
      await page.getByLabel('Send a note to this task', { exact: true }).fill('Browser owner note: preserve the separate review.')
      await page.getByRole('button', { name: 'Send task note', exact: true }).click()
      await page.getByText('Browser owner note: preserve the separate review.', { exact: true }).waitFor()
      await page.getByRole('combobox', { name: 'Show tasks', exact: true }).selectOption('inbox')
      assert.equal(await page.locator('#task-list button').count(), 1)
      await page.getByRole('button', { name: 'Mark note read', exact: true }).first().click()
    } else if (stage === 'restart') {
      await page.getByRole('button', { name: /^Concurrent claude/ }).click()
      await page.getByText('Needs reconciliation', { exact: true }).waitFor()
      assert.match(await page.locator('#task-detail').innerText(), /Handover: keep the source change/)
      assert.match(await page.locator('#console-bound').innerText(), /0\/2 active runs/)
    } else {
      await page.getByRole('combobox', { name: 'Show tasks', exact: true }).selectOption('attention')
      assert.equal(await page.locator('#task-list button').count(), 2)
      await page.getByRole('button', { name: /^Concurrent codex/ }).click()
      await page.getByRole('button', { name: 'Accept reviewed result', exact: true }).waitFor()
      assert.match(await page.locator('#task-detail').innerText(), new RegExp(tasks[0].id))
      await page.screenshot({ path: join(evidence, 'concurrent-review-desktop.png'), fullPage: true })
    }
    if (axePath) { const { default: AxeBuilder } = await import(pathToFileURL(axePath)); const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze(); await writeFile(join(evidence, 'concurrent-' + stage + '-accessibility.json'), JSON.stringify(result)); assert.deepEqual(result.violations.map(item => item.id), []) }
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: join(evidence, 'concurrent-' + stage + '-mobile.png'), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 })
  })
  assert.deepEqual(errors, []); await writeFile(join(evidence, 'concurrent-browser-results.json'), JSON.stringify({ ...result, browserErrors: errors, mobileOverflow: false, ownerNote: true, noteRead: true, reviewFilter: true, capacityButtonsRefresh: true }, null, 2))
} catch (error) { await writeFile(join(evidence, 'concurrent-browser-failure.html'), await page.content()); await page.screenshot({ path: join(evidence, 'concurrent-browser-failure.png'), fullPage: true }); throw error }
finally { await browser.close() }
