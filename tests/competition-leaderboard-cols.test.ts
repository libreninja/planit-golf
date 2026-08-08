import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickLeaderboardCols } from '../components/competition/leaderboard-cols.ts'

// The grid column count must match the number of rendered cells for each
// variant, or the row grid misaligns. These strings are also the verbatim
// literals Tailwind's JIT must see — keep them stable.

function colCount(template: string): number {
  // Count the space-separated track sizes inside the [...] arbitrary value.
  const m = template.match(/\[([^\]]+)\]/)
  assert.ok(m, `no arbitrary value in ${template}`)
  return m![1].split('_').length
}

test('no flight, no purse → 6 cols (Pos, Player, par, Thru, total, Points)', () => {
  const c = pickLeaderboardCols(false, false)
  assert.equal(colCount(c.base), 6)
  assert.equal(colCount(c.sm), 6)
  assert.equal(c.base, 'grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem]')
  assert.equal(c.sm, 'sm:grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem]')
})

test('no flight, purse → 7 cols (+ Purse)', () => {
  const c = pickLeaderboardCols(false, true)
  assert.equal(colCount(c.base), 7)
  assert.equal(colCount(c.sm), 7)
  assert.equal(c.base, 'grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]')
  assert.equal(c.sm, 'sm:grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]')
})

test('flight, no purse → base 6 cols (no Flight on mobile), sm 7 cols (+ Flight)', () => {
  const c = pickLeaderboardCols(true, false)
  // Flight is sm+ only → base (mobile) never carries it.
  assert.equal(colCount(c.base), 6)
  assert.equal(colCount(c.sm), 7)
  assert.equal(c.base, 'grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem]')
  assert.equal(c.sm, 'sm:grid-cols-[2.5rem_1fr_5rem_4rem_3rem_4rem_4rem]')
})

test('flight, purse → base 7 cols, sm 8 cols (Flight + Purse)', () => {
  const c = pickLeaderboardCols(true, true)
  assert.equal(colCount(c.base), 7)
  assert.equal(colCount(c.sm), 8)
  assert.equal(c.base, 'grid-cols-[2.5rem_1fr_4rem_3rem_4rem_4rem_5rem]')
  assert.equal(c.sm, 'sm:grid-cols-[2.5rem_1fr_5rem_4rem_3rem_4rem_4rem_5rem]')
})

test('base never includes a Flight column, regardless of showFlight', () => {
  // Flight is an sm+ column only; the mobile grid must stay Flight-free.
  for (const showPurse of [false, true]) {
    const c = pickLeaderboardCols(true, showPurse)
    assert.ok(!c.base.includes('5rem_4rem_3rem'), `base accidentally has Flight: ${c.base}`)
  }
})

test('no-flight sm == base (Flight is the only sm-only addition when absent)', () => {
  for (const showPurse of [false, true]) {
    const c = pickLeaderboardCols(false, showPurse)
    assert.equal(c.base, c.sm.replace('sm:', ''), `base should equal sm minus prefix: ${c.base} vs ${c.sm}`)
  }
})