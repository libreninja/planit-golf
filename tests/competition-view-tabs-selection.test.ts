import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabSelectionState } from '../components/competition/view-tabs-selection.ts'

// active should be true for EXACTLY one tab at any time. pending is true only
// on the in-flight tab. Verifies the segmented control never shows two
// selected tabs during a navigation (FIX 3).

function exactlyOneActive(state: { active: boolean }[]): boolean {
  return state.filter((s) => s.active).length === 1
}

test('season→weekly click: weekly is the sole selected tab immediately (server still says season)', () => {
  // User clicked weekly; server has not re-rendered yet (selectedView still
  // season, pendingView weekly). weekly must be the sole active tab.
  const season = tabSelectionState('season', 'weekly', 'season')
  const weekly = tabSelectionState('season', 'weekly', 'weekly')
  assert.equal(season.active, false, 'old season tab loses fill immediately')
  assert.equal(weekly.active, true, 'clicked weekly tab is filled')
  assert.equal(weekly.pending, true, 'spinner on weekly')
  assert.equal(season.pending, false)
  assert.ok(exactlyOneActive([season, weekly]), 'exactly one active tab')
})

test('weekly→season click: season is the sole selected tab immediately', () => {
  const weekly = tabSelectionState('weekly', 'season', 'weekly')
  const season = tabSelectionState('weekly', 'season', 'season')
  assert.equal(weekly.active, false)
  assert.equal(season.active, true)
  assert.equal(season.pending, true)
  assert.ok(exactlyOneActive([weekly, season]))
})

test('server confirmation clears pending: selectedView catches up to pendingView → no in-flight, sole server selection', () => {
  // Server re-rendered; selectedView is now weekly (matches pendingView).
  // inFlight is false → active follows selectedView; pending is false.
  const season = tabSelectionState('weekly', 'weekly', 'season')
  const weekly = tabSelectionState('weekly', 'weekly', 'weekly')
  assert.equal(weekly.active, true)
  assert.equal(season.active, false)
  assert.equal(weekly.pending, false, 'spinner gone once server confirms')
  assert.equal(season.pending, false)
  assert.ok(exactlyOneActive([season, weekly]))
})

test('clicking the already-selected tab is a no-op: no pending state, sole selection unchanged', () => {
  // Before any click: pendingView null → active follows selectedView.
  const season = tabSelectionState('season', null, 'season')
  const weekly = tabSelectionState('season', null, 'weekly')
  assert.equal(season.active, true)
  assert.equal(weekly.active, false)
  assert.equal(season.pending, false)
  assert.equal(weekly.pending, false)
  assert.ok(exactlyOneActive([season, weekly]))
})

test('a slower previous navigation response cannot visually restore the wrong selection', () => {
  // User clicked weekly (pendingView=weekly). A stale earlier response for
  // season arrives but selectedView is STILL season (or trickles back to
  // season) — regardless, while pendingView is weekly and differs from the
  // server view, the display is driven by pendingView, so weekly stays the
  // sole selection. The stale season response must NOT flip selection back.
  const season = tabSelectionState('season', 'weekly', 'season')
  const weekly = tabSelectionState('season', 'weekly', 'weekly')
  assert.equal(weekly.active, true, 'pending weekly stays selected despite stale season server state')
  assert.equal(season.active, false, 'stale season does not regain fill')
  assert.ok(exactlyOneActive([season, weekly]))
})

test('with three views, still exactly one active tab during a navigation', () => {
  // season / weekly / live — click live while server is on season.
  const views = ['season', 'weekly', 'live']
  const states = views.map((v) => tabSelectionState('season', 'live', v))
  assert.deepEqual(
    states.map((s) => s.active),
    [false, false, true],
    'only the clicked (live) tab is active',
  )
  assert.deepEqual(
    states.map((s) => s.pending),
    [false, false, true],
    'only the clicked tab is pending',
  )
  assert.ok(exactlyOneActive(states))
})
