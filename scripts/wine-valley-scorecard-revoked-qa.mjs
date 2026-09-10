import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
const access = JSON.parse(await readFile('/private/tmp/wine-valley-scorecard/access.json', 'utf8'))
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto(access.url)
  await page.getByRole('alert').filter({ hasText: 'expired or is no longer available' }).waitFor()
  assert.equal(await page.getByRole('textbox').count(), 0)
  // Simulate a previously exchanged cookie as well as reopening the raw link.
  const headers = { Cookie: `planit_scorecard=${access.token}`, Origin: 'http://localhost:4318' }
  const read = await context.request.get('http://localhost:4318/api/scorecard', { headers })
  const write = await context.request.post('http://localhost:4318/api/scorecard', {
    headers, data: { ...access.scope, participantId: access.outsider, hole: 1, gross: 3, expectedRevision: 0, requestId: crypto.randomUUID() },
  })
  assert.equal(read.status(), 401)
  assert.equal(write.status(), 401)
  await page.screenshot({ path: '/private/tmp/wine-valley-scorecard/revoked.png', fullPage: true })
  await writeFile('/private/tmp/wine-valley-scorecard/revoked-evidence.json', JSON.stringify({ reopenedLink: 'denied', previousCookieRead: 401, previousCookieWrite: 401 }, null, 2))
  console.log('Revoked link: reopening denied; existing cookie reads and writes both 401.')
} finally { await browser.close() }
