import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { probeExternalConsole } from './external-console-package-probe.mjs'

const [playwrightPath, evidence, axePath] = process.argv.slice(2)
const { chromium, expect: baseExpect } = await import(pathToFileURL(playwrightPath))
// The controller polls every five seconds and the browser every three. The
// bound includes those two cycles and local metadata I/O, not native reading.
const expect = baseExpect.configure({ timeout: 25000 })
const browser = await chromium.launch({ headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = []
page.on('pageerror', error => errors.push(error.stack ?? error.message))
const field = text => page.locator('#external-detail fieldset').filter({ hasText: text })
try {
  const result = await probeExternalConsole(process.env.Z1P_EXTERNAL_PROBE_CLI ?? join(process.cwd(), 'packages/context-tools/bin/encrypted-context.mjs'), async (stage, f) => {
    const { server, root, peers, linked, read, act, wait, call } = f
    if (stage === 'registered') {
      await page.goto(server.url)
      await expect(page.locator('#new-task')).toBeHidden()
      await page.getByText('Link an existing agent', { exact: true }).click()
      await page.getByRole('combobox', { name: 'External agent project', exact: true }).selectOption(root)
      await page.getByRole('combobox', { name: 'Registered agent', exact: true }).selectOption(peers[0].activity.agentId)
      await page.getByRole('button', { name: 'Link selected agent', exact: true }).click()
      await page.getByRole('region', { name: 'Selected external agent', exact: true }).getByRole('heading', { name: 'Codex external fixture', exact: true }).waitFor()
      assert.equal(await page.locator('#external-detail button').filter({ hasText: /Run task|Stop run|Allow this request|Continue saved/ }).count(), 0)
    } else if (stage === 'inbox') {
      await page.getByRole('navigation', { name: 'Linked external agents' }).getByRole('button', { name: /^Codex external fixture/ }).click()
      await page.getByText('PRIVATE reply from Codex', { exact: true }).waitFor()
      const inert = 'PRIVATE <img src=x onerror="window.__externalInjected=1">'
      await call(peers[0], 'repository_message', { slot: peers[0].slot, recipientAgentId: linked[0].address, messageId: randomUUID(), text: inert })
      await page.getByText(inert, { exact: true }).waitFor(); assert.equal(await page.locator('#external-detail img').count(), 0)
      assert.equal(await page.evaluate(() => window.__externalInjected), undefined)
      let committed = false
      await page.route('**/console/action', async route => {
        const body = route.request().postDataJSON()
        if (!committed && body.action === 'external-note') { committed = true; await route.fetch(); await route.abort('failed') }
        else await route.continue()
      })
      const lostText = 'PRIVATE browser note after lost response'
      await page.getByLabel('Note to this external agent', { exact: true }).fill(lostText)
      await page.getByRole('button', { name: 'Send external note', exact: true }).click()
      await expect(page.locator('#external-message')).toContainText('Previous note confirmed saved locally')
      const sent = await wait(linked[0].id, value => value.notes.some(note => note.text === lostText && note.deliveredAt))
      const lost = sent.notes.find(note => note.text === lostText)
      assert.equal(sent.notes.filter(note => note.text === lostText).length, 1)
      await call(peers[0], 'repository_message', { slot: peers[0].slot, recipientAgentId: linked[0].address, messageId: randomUUID(), text: 'ACK ' + lost.id })
      await expect(field(lostText)).toContainText('Acknowledged by agent')
      await page.unroute('**/console/action')
      const attempts = []; let dropped = false
      await page.route('**/console/action', async route => {
        const body = route.request().postDataJSON()
        if (body.action === 'external-note') { attempts.push(body.requestId); if (!dropped) { dropped = true; await route.abort('failed'); return } }
        await route.continue()
      })
      const retryText = 'PRIVATE browser explicit retry'
      await page.getByLabel('Note to this external agent', { exact: true }).fill(retryText)
      await page.getByRole('button', { name: 'Send external note', exact: true }).click()
      await page.getByRole('button', { name: 'Retry unconfirmed request', exact: true }).click()
      await expect(field(retryText)).toContainText('Stored in shared inbox')
      assert.equal(attempts.length, 2); assert.equal(attempts[0], attempts[1])
      const received = await call(peers[0], 'repository_coordination', { maxBytes: 65536 })
      assert.equal(received.messages.filter(note => note.messageId === attempts[0]).length, 1)
      await page.unroute('**/console/action')

      // An older refresh must not undo a newer read acknowledgement for the
      // same selected link. Force a newer UI refresh while the first is held.
      let held, release, releaseLater, requests = 0
      const capturedPromise = new Promise(resolve => held = resolve), releasePromise = new Promise(resolve => release = resolve), laterPromise = new Promise(resolve => releaseLater = resolve)
      await page.route('**/console/external/' + linked[0].id, async route => {
        requests++
        if (requests > 2) { await laterPromise; return route.continue() }
        if (requests === 2) return route.continue()
        const response = await route.fetch(); held(); await releasePromise
        await route.fulfill({ response, headers: { ...response.headers(), 'x-z1p-fixture-late': '1' } })
      })
      await capturedPromise
      const current = await read('external/' + linked[0].id)
      for (const note of current.notes.filter(note => note.from !== 'owner' && !note.ownerAcknowledgedAt)) await act(linked[0].id, 'external-read', { messageId: note.id })
      await page.getByRole('navigation', { name: 'Linked external agents' }).getByRole('button', { name: /^Codex external fixture/ }).click()
      await expect(page.getByRole('button', { name: 'Mark agent note read', exact: true })).toHaveCount(0)
      const late = page.waitForResponse(response => response.headers()['x-z1p-fixture-late'] === '1')
      try {
        release(); await (await late).finished(); await page.waitForTimeout(100)
        await expect(page.getByRole('button', { name: 'Mark agent note read', exact: true })).toHaveCount(0)
      } finally { releaseLater(); await page.unrouteAll({ behavior: 'wait' }) }
    } else if (stage === 'restart') {
      await page.goto(server.url)
      await page.getByRole('navigation', { name: 'Linked external agents' }).getByRole('button', { name: /^Codex external fixture/ }).click()
      await page.getByText('PRIVATE browser note after lost response', { exact: true }).waitFor()
      assert.equal((await read('snapshot')).active, 0)
      assert.equal(await page.getByRole('button', { name: 'Run task', exact: true }).count(), 0)
    } else if (stage === 'before-remove') {
      page.once('dialog', dialog => dialog.accept())
      await page.getByRole('button', { name: 'Remove link and local notes', exact: true }).click()
      await expect(page.getByRole('navigation', { name: 'Linked external agents' }).getByRole('button', { name: /^Codex external fixture/ })).toHaveCount(0)
    }
    if (axePath && stage !== 'before-remove') {
      const { default: AxeBuilder } = await import(pathToFileURL(axePath)), scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
      await writeFile(join(evidence, 'external-' + stage + '-axe.json'), JSON.stringify(scan)); assert.deepEqual(scan.violations.map(item => item.id), [])
    }
    await page.screenshot({ path: join(evidence, 'external-' + stage + '-desktop.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: join(evidence, 'external-' + stage + '-mobile.png'), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 })
  })
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'external-browser-results.json'), JSON.stringify({ ...result, browserVersion: browser.version(), browserErrors: errors, initialLink: true, lostResponseReconciled: true, explicitRetrySameUUID: true, supersededReadIgnored: true, removalViaUI: true, mobileOverflow: false }, null, 2))
} catch (error) {
  await writeFile(join(evidence, 'external-browser-failure.html'), await page.content()); await page.screenshot({ path: join(evidence, 'external-browser-failure.png'), fullPage: true }); throw error
} finally { await browser.close() }
