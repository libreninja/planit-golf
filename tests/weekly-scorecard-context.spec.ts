import { expect, test } from '@playwright/test'
import { weeklyScorecardFixtures } from './fixtures/weekly-scorecard-context'

const fmt = (n: number) => n === 0 ? 'E' : n > 0 ? `+${n}` : String(n)

for (const width of [1440, 390]) {
  for (const fixture of weeklyScorecardFixtures) {
    test(`${fixture.league} ${width}px: expansion follows the Gross/Net control`, async ({ page }) => {
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
        const strokes = card.getByLabel(`${label} strokes`, { exact: true })
        const deltas = card.getByLabel(`${label} to par`, { exact: true })
        await expect(strokes).toHaveText(fixture[mode].map(String))
        await expect(deltas).toHaveText(fixture[`${mode}ToPar`].map(fmt))
        expect((await deltas.allTextContents()).reduce((sum, text) => sum + (text === 'E' ? 0 : Number(text)), 0)).toBe(fixture[`${mode}Par`])
        await card.scrollIntoViewIfNeeded()
        await page.screenshot({ path: test.info().outputPath(`${mode}.png`) })
        if (width === 390) {
          const ninth = card.getByRole('group', { name: 'Hole 9', exact: true })
          await ninth.scrollIntoViewIfNeeded()
          await expect(ninth).toBeInViewport()
        }
      }
      expect(errors).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    })
  }

  test(`${width}px: partial Women's card stays through four in both scoring contexts`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 844 })
    for (const mode of ['gross', 'net'] as const) {
      const label = mode === 'gross' ? 'Gross' : 'Net'
      await page.goto(`/igc/womens-league?view=weekly&week=3&scoring=${mode}&q=Marnie%20Hendrix`)
      await page.getByRole('button', { name: 'Show Marnie Hendrix scorecard', exact: true }).click()
      const card = page.getByRole('group', { name: `${label} scorecard`, exact: true })
      await expect(card).toBeVisible()
      await expect(card.locator('..')).toContainText('thru 4')
      await expect(card.getByRole('group', { name: /^Hole / })).toHaveCount(9)
      const strokes = await card.getByLabel(`${label} strokes`, { exact: true }).allTextContents()
      const deltas = await card.getByLabel(`${label} to par`, { exact: true }).allTextContents()
      expect(strokes.slice(4)).toEqual(Array(5).fill('—'))
      expect(deltas.slice(4)).toEqual(Array(5).fill('—'))
      const total = strokes.slice(0, 4).reduce((sum, text) => sum + Number(text), 0)
      const toPar = deltas.slice(0, 4).reduce((sum, text) => sum + (text === 'E' ? 0 : Number(text)), 0)
      await expect(card).toContainText(`${label} ${total} (${fmt(toPar)})`)
    }
  })
}
