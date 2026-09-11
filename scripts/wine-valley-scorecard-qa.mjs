import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
const access = JSON.parse(await readFile('/private/tmp/wine-valley-scorecard/access.json', 'utf8'))
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(access.url)
  await page.getByRole('heading', { name: 'Hole 1', exact: true }).waitFor()
  assert.equal(page.url(), 'http://localhost:4318/scorecard')
  assert.equal(await page.getByRole('navigation', { name: 'Primary' }).count(), 0)
  assert.equal(await page.getByRole('link', { name: /sign in|account/i }).count(), 0)
  await page.getByText('Friday PM · 12:30 PM').waitFor()
  const names = await page.locator('label').allTextContents()
  console.log('Real group shown:', names)
  assert.equal(names.length, 4)
  const josh = page.getByRole('textbox', { name: 'Josh Benner gross score' })
  await josh.fill('3')
  await page.getByRole('button', { name: 'Save & Next', exact: true }).click()
  await page.getByRole('heading', { name: 'Hole 2', exact: true }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Hole 1', exact: true }).waitFor()
  assert.equal(await josh.inputValue(), '3')
  assert.equal(await page.getByText('Not scored', { exact: true }).count(), 3)
  await josh.fill('4')
  await page.getByRole('button', { name: 'Save & Next', exact: true }).click()
  await page.getByRole('heading', { name: 'Hole 2', exact: true }).waitFor()
  await page.getByRole('button', { name: '← Previous', exact: true }).click()
  await page.getByText('Saved 4 · revision 2').waitFor()
  await page.screenshot({ path: '/private/tmp/wine-valley-scorecard/mobile.png', fullPage: true })
  const readCard = async () => (await context.request.get('http://localhost:4318/api/scorecard')).json()
  const card = await readCard()
  const player = card.players.find((p) => p.name === 'Josh Benner')
  const command = { ...access.scope, participantId: player.id, hole: 1, gross: 5, expectedRevision: 2, requestId: crypto.randomUUID() }
  const post = (body, origin = 'http://localhost:4318') => context.request.post('http://localhost:4318/api/scorecard', {
    headers: { origin, 'Content-Type': 'application/json' }, data: body,
  })
  // Another scorer commits after this phone read revision two.
  assert.equal((await post(command)).status(), 200)
  await josh.fill('6')
  await page.getByRole('button', { name: 'Save & Next', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Another scorer changed' }).waitFor()
  assert.equal(await josh.inputValue(), '6')
  await page.getByRole('button', { name: 'Review latest scores' }).click()
  await page.getByText('Saved 5 · revision 3').waitFor()
  assert.equal(await josh.inputValue(), '6')
  await page.getByRole('button', { name: 'Save & Next', exact: true }).click()
  await page.getByRole('heading', { name: 'Hole 2', exact: true }).waitFor()
  assert.equal((await readCard()).scores.find((s) => s.participantId === player.id && s.hole === 1).revision, 4)
  assert.equal((await post({ ...command, requestId: crypto.randomUUID(), groupId: crypto.randomUUID() })).status(), 403)
  assert.equal((await post({ ...command, requestId: crypto.randomUUID(), roundId: crypto.randomUUID() })).status(), 403)
  assert.equal((await post({ ...command, requestId: crypto.randomUUID(), participantId: access.outsider })).status(), 403)
  assert.equal((await post({ ...command, actorRef: 'admin' })).status(), 400)
  assert.equal((await post(command, 'https://evil.example')).status(), 403)
  const unauthenticated = await browser.newContext()
  assert.equal((await unauthenticated.request.get('http://localhost:4318/api/scorecard')).status(), 401)
  await unauthenticated.close()
  // Network failure preserves an unsaved value and permits retry with same intent.
  await josh.fill('4')
  await page.route('**/api/scorecard', (route) => route.request().method() === 'POST' ? route.abort() : route.continue())
  await page.getByRole('button', { name: 'Save & Next', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await josh.inputValue(), '4')
  await page.unroute('**/api/scorecard')
  await page.getByRole('button', { name: 'Save & Next', exact: true }).click()
  await page.getByRole('heading', { name: 'Hole 3', exact: true }).waitFor()
  assert.equal(errors.length, 0, errors.join('\n'))
  await writeFile('/private/tmp/wine-valley-scorecard/browser-evidence.json', JSON.stringify({
    group: '13048595300564887052', names, initial: '3 → 4, revision 2',
    concurrent: '5 revision 3 → reviewed 6 revision 4', partial: true,
    outsideGroup: 403, outsideRound: 403, outsider: 403, injectedActor: 400,
    crossOrigin: 403, anonymous: 401, networkRetry: 'pass', runtimeErrors: errors,
  }, null, 2))
  console.log('Mobile entry, reload, correction, conflict review, partial card, scope rejection and network retry passed.')
} finally { await browser.close() }
