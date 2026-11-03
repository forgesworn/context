import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { probePlanRevisions } from './plan-revisions-package-probe.mjs'

const [playwrightPath, evidence, axePath] = process.argv.slice(2), { chromium, expect: baseExpect } = await import(pathToFileURL(playwrightPath))
const expect = baseExpect.configure({ timeout: 25000 }), browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [], accessibility = []
page.on('pageerror', error => errors.push(error.message))
try {
  const result = await probePlanRevisions(process.env.Z1P_REVISION_PROBE_CLI ?? join(process.cwd(), 'packages/context-tools/bin/encrypted-context.mjs'), async (stage, f) => {
    if (stage === 'revise') {
      await page.goto(f.server.url)
      await page.getByRole('navigation', { name: 'Saved task plans' }).getByRole('button', { name: f.input.title, exact: true }).click()
      await page.getByRole('button', { name: 'Open step step-1', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Allow this request', exact: true })).toBeEnabled()
      let release, captured, allowLater, held = false, blockFuture = false
      const capturedPromise = new Promise(resolve => { captured = resolve }), gate = new Promise(resolve => { release = resolve }), later = new Promise(resolve => { allowLater = resolve })
      await page.route('**/console/task/' + f.oldId, async route => {
        if (!held) { held = true; const response = await route.fetch(); captured(); await gate; await route.fulfill({ response, headers: { ...response.headers(), 'x-z1p-revision-late': '1' } }) }
        else { if (blockFuture) await later; await route.continue() }
      })
      const saves = []; let lost = false
      await page.route('**/console/action', async route => {
        const body = route.request().postDataJSON()
        if (body.action === 'plan-revise') { saves.push(body); if (!lost) { lost = true; await route.fetch(); await route.abort('failed'); return } }
        await route.continue()
      })
      try {
        await page.getByRole('button', { name: 'Open step step-1', exact: true }).click(); await capturedPromise
        await page.getByRole('button', { name: 'Revise requirements', exact: true }).click()
        await expect(page.getByRole('combobox', { name: 'Plan checkout', exact: true })).toBeDisabled()
        await page.getByLabel('Reason for this requirements revision', { exact: true }).fill(f.reason)
        await page.getByLabel('Step 1 instructions', { exact: true }).fill(f.next.nodes[0].task)
        await page.getByLabel('Step 1 required checks (one per line, up to eight)', { exact: true }).fill(f.next.nodes[0].checks.join('\n'))
        await page.getByRole('button', { name: 'Save task plan', exact: true }).click()
        await page.getByRole('button', { name: 'Retry unconfirmed plan save', exact: true }).click()
        await expect(page.locator('#plan-detail')).toContainText('Requirements revision 2')
        await expect(page.locator('#task-detail')).toContainText('Previous requirements revision.')
        await expect(page.getByRole('button', { name: 'Allow this request', exact: true })).toBeDisabled()
        assert.equal(saves.length, 2); assert.deepEqual(saves[0], saves[1])
        blockFuture = true
        const late = page.waitForResponse(response => response.headers()['x-z1p-revision-late'] === '1')
        release(); await (await late).finished(); await page.waitForTimeout(100)
        await expect(page.getByRole('button', { name: 'Allow this request', exact: true })).toBeDisabled()
        await expect(page.locator('#task-detail')).toContainText('Previous requirements revision.')
        assert.equal(await page.locator('#task-plans img').count(), 0); assert.equal(await page.evaluate(() => window.__revisionInjected), undefined)
        const snapshot = await f.read('snapshot'); assert.equal(snapshot.plans.length, 2); assert.equal(snapshot.tasks.length, 4)
        return f.read('plan/' + snapshot.plans.find(plan => plan.supersedes === f.parent.id).id)
      } finally { release(); allowLater(); await page.unrouteAll({ behavior: 'wait' }) }
    }
    if (stage === 'notified') {
      await expect(page.locator('#plan-detail')).toContainText('Acknowledged by registered agent')
      await expect(page.locator('#plan-detail')).toContainText('Affected steps: step-1, step-2')
      await page.screenshot({ path: join(evidence, 'revision-notified-desktop.png'), fullPage: true })
    }
    if (stage === 'restart') {
      await page.goto(f.server.url)
      await page.getByRole('navigation', { name: 'Saved task plans' }).getByRole('button', { name: f.input.title + ' · revision 2', exact: true }).click()
      await expect(page.locator('#plan-detail')).toContainText('Acknowledged by registered agent')
      await expect(page.getByRole('navigation', { name: 'Saved task plans' }).getByRole('button')).toHaveCount(1)
      await page.getByRole('combobox', { name: 'Show plan revisions', exact: true }).selectOption('all')
      await expect(page.getByRole('navigation', { name: 'Saved task plans' }).getByRole('button')).toHaveCount(2)
      await page.getByRole('button', { name: 'View previous revision', exact: true }).click()
      await expect(page.locator('#plan-detail')).toContainText('Previous revision. Results and check receipts here are historical')
      await page.getByRole('button', { name: 'Open newer revision', exact: true }).click()
      await expect(page.locator('#plan-detail')).toContainText('Requirements revision 2')
    }
    if (stage === 'review') {
      await page.getByRole('button', { name: 'Open step ' + f.step.id, exact: true }).click()
      for (const check of f.step.checks) {
        await page.getByLabel(check.check + ' evidence', { exact: true }).fill('Actual current-revision fixture test event: node --test regression.test.mjs exit0')
        await page.getByRole('combobox', { name: check.check + ' outcome', exact: true }).selectOption('passed')
      }
      await page.getByLabel('Owner review evidence', { exact: true }).fill('Reviewed current requirements, branch and executed check receipt')
      await page.getByRole('button', { name: 'Accept reviewed result', exact: true }).click()
      await expect(page.locator('#task-detail')).toContainText('Accepted locally'); return true
    }
    if (stage === 'finished') {
      await expect(page.locator('#plan-detail')).toContainText('Every step has an accepted local result.')
      if (axePath) { const { default: AxeBuilder } = await import(pathToFileURL(axePath)); const axe = await new AxeBuilder({ page }).analyze(); await writeFile(join(evidence, 'revision-final-axe.json'), JSON.stringify(axe, null, 2)); assert.equal(axe.violations.length, 0); accessibility.push({ stage, violations: 0 }) }
      await page.screenshot({ path: join(evidence, 'revision-final-desktop.png'), fullPage: true })
      await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(evidence, 'revision-final-mobile.png'), fullPage: true }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    }
  })
  assert.deepEqual(errors, []); await writeFile(join(evidence, 'revision-browser-results.json'), JSON.stringify({ ...result, browser: browser.version(), errors, accessibility, mobileOverflow: false, staleReadRejected: true, lostRevisionSaveReconciled: true }, null, 2))
} catch (error) {
  await page.screenshot({ path: join(evidence, 'revision-browser-failure.png'), fullPage: true }).catch(() => {})
  await writeFile(join(evidence, 'revision-browser-failure.json'), JSON.stringify({ error: String(error), errors, snapshot: await page.locator('body').ariaSnapshot().catch(() => '') }, null, 2)); throw error
} finally { await context.close(); await browser.close() }
