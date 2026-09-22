import { expect, test } from '@playwright/test'
import { weeklyScorecardFixtures } from './fixtures/weekly-scorecard-context'

const fmt = (n: number) => n === 0 ? 'E' : n > 0 ? `+${n}` : String(n)
const mark = (n: number) => n <= -2 ? 'double-circle' : n === -1 ? 'circle' : n === 0 ? 'plain' : n === 1 ? 'square' : 'double-square'

for (const width of [1440, 390]) {
  for (const fixture of weeklyScorecardFixtures) {
    test(`${fixture.league} ${width}px: actual scores stay fixed across Gross→Net→Gross`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      const response = await page.goto(`/igc/${fixture.league}-league?view=weekly&week=${fixture.week}&scoring=gross&q=${encodeURIComponent(fixture.name)}`)
      expect(response?.status()).toBe(200)
      for (const mode of ['gross', 'net', 'gross'] as const) {
        const label = mode === 'gross' ? 'Gross' : 'Net'
        const alternate = mode === 'gross' ? 'Net' : 'Gross'
        await page.getByRole('button', { name: label, exact: true }).click()
        await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await page.getByRole('button', { name: `Show ${fixture.name} scorecard`, exact: true }).click()
        const card = page.getByRole('group', { name: `${label} scorecard`, exact: true })
        await expect(card).toBeVisible()
        await expect(card).toContainText(`${label} ${fixture[`${mode}Total`]} (${fmt(fixture[`${mode}Par`])})`)
        await expect(card).not.toContainText(alternate)
        const scores = card.locator('[data-score-hole]')
        await expect(scores).toHaveText(fixture.gross.map(String))
        expect(await scores.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-score-mark')))).toEqual(fixture[`${mode}ToPar`].map(mark))
        if (mode === 'net') {
          for (let index = 0; index < 9; index++) {
            await expect(card.getByRole('columnheader', { name: `Hole ${index + 1}, ${fixture.handicapStrokes[index]} handicap strokes`, exact: true })).toBeVisible()
          }
        } else {
          expect(await card.locator('thead').textContent()).not.toContain('•')
        }
        await card.scrollIntoViewIfNeeded()
        await expect(card.locator('[data-score-hole="9"]')).toBeInViewport()
        expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        await page.screenshot({ path: test.info().outputPath(`${mode}.png`) })
      }
      expect(errors).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test(`${width}px: partial Women's card retains nine columns and through four`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 844 })
    let actual: string[] | undefined
    for (const mode of ['gross', 'net', 'gross'] as const) {
      const label = mode === 'gross' ? 'Gross' : 'Net'
      await page.goto(`/igc/womens-league?view=weekly&week=3&scoring=${mode}&q=Marnie%20Hendrix`)
      await page.getByRole('button', { name: 'Show Marnie Hendrix scorecard', exact: true }).click()
      const card = page.getByRole('group', { name: `${label} scorecard`, exact: true })
      await expect(card).toBeVisible()
      await expect(card.locator('..')).toContainText('thru 4')
      const scores = card.locator('[data-score-hole]')
      await expect(scores).toHaveCount(9)
      const texts = await scores.allTextContents()
      expect(texts.slice(4)).toEqual(Array(5).fill(''))
      expect(await scores.evaluateAll(nodes => nodes.slice(4).map(n => n.getAttribute('data-score-mark')))).toEqual(Array(5).fill('plain'))
      if (actual) expect(texts).toEqual(actual)
      else actual = texts
      await card.scrollIntoViewIfNeeded()
      await page.screenshot({ path: test.info().outputPath(`${mode}-partial.png`) })
    }
  })

  test(`${width}px: Jeff receives four strokes on 1,5,6,7`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/igc/mens-league?view=weekly&week=23&scoring=net&q=Jeff%20Morgan')
    await page.getByRole('button', { name: 'Show Jeff Morgan scorecard', exact: true }).click()
    const card = page.getByRole('group', { name: 'Net scorecard', exact: true })
    for (let hole = 1; hole <= 9; hole++) {
      await expect(card.getByRole('columnheader', { name: `Hole ${hole}, ${[1,5,6,7].includes(hole) ? 1 : 0} handicap strokes`, exact: true })).toBeVisible()
    }
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('jeff.png') })
  })
}

for (const sample of [
  { league: 'mens', week: 24, name: 'Joe Myxter' },
  { league: 'womens', week: 22, name: 'Victoria Lea' },
]) {
  for (const width of [1440, 390]) {
    test(`${sample.league} current/latest ${width}px: live API and rendered actual scores agree`, async ({ page, request }) => {
      test.setTimeout(150_000)
      await page.setViewportSize({ width, height: 844 })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      const views = []
      for (const mode of ['gross', 'net'] as const) {
        const response = await request.get(`/api/competition/live?competition=${sample.league}-league&occurrence=${sample.week}&scoring=${mode}`, { timeout: 90_000 })
        expect(response.status()).toBe(200)
        const body = await response.json()
        const card = body.results.leaderboard.scorecards.find((c: { name: string }) => c.name.split(', ').reverse().join(' ') === sample.name)
        expect(card).toBeTruthy()
        expect(card.holes).toHaveLength(9)
        expect(card.holes.every((h: { handicapStrokes?: number | null }) => typeof h.handicapStrokes === 'number')).toBe(true)
        views.push(card)
      }
      expect(views[0].holes.map((h: { actualStrokes: number | null }) => h.actualStrokes)).toEqual(views[1].holes.map((h: { actualStrokes: number | null }) => h.actualStrokes))
      await page.goto(`/igc/${sample.league}-league?view=weekly&week=${sample.week}&scoring=gross&q=${encodeURIComponent(sample.name)}`)
      for (const mode of ['gross','net','gross'] as const) {
        const label = mode === 'gross' ? 'Gross' : 'Net'
        await page.getByRole('button', { name: label, exact: true }).click()
        await page.getByRole('button', { name: `Show ${sample.name} scorecard`, exact: true }).click()
        const card = page.getByRole('group', { name: `${label} scorecard`, exact: true })
        await expect(card.locator('[data-score-hole]')).toHaveText(views[0].holes.map((h: { actualStrokes: number | null }) => h.actualStrokes === null ? '' : String(h.actualStrokes)))
        await card.scrollIntoViewIfNeeded()
        await expect(card.locator('[data-score-hole="9"]')).toBeInViewport()
        if (mode === 'net') await page.screenshot({ path: test.info().outputPath('current-net.png') })
      }
      expect(errors).toEqual([])
    })
  }
}
