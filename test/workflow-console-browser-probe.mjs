import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { probeWorkflowConsole } from './workflow-console-package-probe.mjs'

const [playwrightPath, evidence, axePath] = process.argv.slice(2), { chromium, expect: baseExpect } = await import(pathToFileURL(playwrightPath))
const expect = baseExpect.configure({ timeout: 20000 }), browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [], accessibility = []
page.on('pageerror', error => errors.push(error.message))
try {
  const results = await probeWorkflowConsole(process.env.Z1P_WORKFLOW_PROBE_CLI ?? join(process.cwd(), 'packages/context-tools/bin/encrypted-context.mjs'), async (stage, f) => {
    if (stage === 'create') {
      await page.goto(f.server.url); await page.getByText('New task plan', { exact: true }).click()
      await page.getByLabel('Plan title', { exact: true }).fill(f.title)
      await page.getByRole('combobox', { name: 'Plan checkout', exact: true }).selectOption(f.root)
      await page.getByRole('combobox', { name: 'Maximum concurrent steps', exact: true }).selectOption('2')
      for (let index = 0; index < 2; index++) {
        if (index) await page.getByRole('button', { name: 'Add step', exact: true }).click()
        const name = 'Step ' + (index + 1), node = f.input.plan.nodes[index]
        await page.getByLabel(name + ' title', { exact: true }).fill(node.title)
        await page.getByRole('combobox', { name: name + ' host', exact: true }).selectOption('codex')
        await page.getByLabel(name + ' instructions', { exact: true }).fill(node.task)
        await page.getByLabel(name + ' source files (one per line, up to eight)', { exact: true }).fill(node.paths.join('\n'))
        await page.getByLabel(name + ' required checks (one per line, up to eight)', { exact: true }).fill('regression test')
        if (index) await page.getByRole('checkbox', { name: 'Step 1', exact: true }).check()
      }
      let dropped = false
      await page.route('**/console/action', async route => { if (!dropped && route.request().postDataJSON().action === 'plan-create') { dropped = true; await route.fetch(); await route.abort('failed') } else await route.continue() })
      await page.getByRole('button', { name: 'Save task plan', exact: true }).click()
      await page.getByRole('button', { name: 'Retry unconfirmed plan save', exact: true }).click()
      await expect(page.locator('#plan-detail h3')).toHaveText(f.title)
      await page.unroute('**/console/action')
      const snapshot = await f.read('snapshot'); assert.equal(snapshot.plans.length, 1); assert.equal(snapshot.tasks.length, 2)
      return f.read('plan/' + snapshot.plans[0].id)
    }
    if (stage === 'created') {
      assert.equal(await page.locator('#task-plans img').count(), 0); assert.equal(await page.evaluate(() => window.__planInjected), undefined)
      await page.getByRole('button', { name: 'Open step step-2', exact: true }).click()
      await expect(page.locator('#task-detail')).toContainText('Waiting for accepted result: step-1')
      await expect(page.getByRole('button', { name: 'Run task', exact: true })).toBeDisabled()
    }
    if (stage === 'review') {
      await page.getByRole('button', { name: 'Open step step-' + (f.index + 1), exact: true }).click()
      await page.getByLabel('regression test evidence', { exact: true }).fill('Actual fixture command event: node --test regression.test.mjs exit 0')
      await page.getByLabel('Owner review evidence', { exact: true }).fill('Reviewed exact diff, generated regression and passing command receipt')
      await page.getByRole('combobox', { name: 'regression test outcome', exact: true }).selectOption('passed')
      await page.getByRole('button', { name: 'Accept reviewed result', exact: true }).click()
      await expect(page.locator('#task-detail')).toContainText('Accepted locally')
      return true
    }
    if (stage === 'restart') {
      await page.goto(f.server.url); await page.getByRole('navigation', { name: 'Saved task plans' }).getByRole('button', { name: f.title, exact: true }).click()
      await expect(page.locator('#plan-detail')).toContainText('Ready steps: step-2')
    }
    if (stage === 'accepted' || stage === 'finished') {
      await expect(page.locator('#plan-detail')).toContainText(stage === 'finished' ? 'Every step has an accepted local result.' : 'Ready steps: step-2')
      await page.screenshot({ path: join(evidence, 'workflow-' + stage + '-desktop.png'), fullPage: true })
      if (axePath) { const { default: AxeBuilder } = await import(pathToFileURL(axePath)); const result = await new AxeBuilder({ page }).analyze(); await writeFile(join(evidence, 'workflow-' + stage + '-axe.json'), JSON.stringify(result, null, 2)); assert.equal(result.violations.length, 0); accessibility.push({ stage, violations: result.violations.length }) }
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(evidence, 'workflow-' + stage + '-mobile.png'), fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
  })
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'workflow-browser-results.json'), JSON.stringify({ ...results, browser: browser.version(), errors, accessibility, mobileOverflow: false }, null, 2))
} catch (error) {
  await page.screenshot({ path: join(evidence, 'workflow-browser-failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(evidence, 'workflow-browser-failure.json'), JSON.stringify({ error: String(error), errors, snapshot: await page.locator('body').ariaSnapshot().catch(() => ''), html: await page.locator('#task-plans').innerHTML().catch(() => '') }, null, 2))
  throw error
} finally { await context.close(); await browser.close() }
