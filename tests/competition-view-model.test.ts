import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStandingsViewModel, type ViewModelInput } from '../components/competition/standings-view-model.ts'

function base(over: Partial<ViewModelInput>): ViewModelInput {
  return {
    competitionKey: 'mens-league',
    occurrences: [{ id: '18', number: 18, label: 'Week 18', date: '2026-07-28', activeWindow: { start: '', end: null }, format: 'individual', discoveryState: 'discovered', resultStatus: 'live' }],
    selectedOccurrenceId: '18',
    urlState: { view: 'weekly', scoring: null, grouping: null },
    availableScoringModes: ['gross', 'net'],
    storedScoring: null,
    availableGroupings: { kind: 'none' },
    resultStatus: 'live',
    liveGroupingPolicy: 'hide-until-final',
    configViews: ['season', 'weekly'],
    supportsLiveResults: true,
    supportsEventNavigation: true,
    ...over,
  }
}

test('resolves scoring from URL > stored > default, validated against available', () => {
  const vm = buildStandingsViewModel(base({ urlState: { view: 'weekly', scoring: 'gross', grouping: null }, availableScoringModes: ['gross', 'net'], storedScoring: 'net' }))
  assert.equal(vm.scoring, 'gross')
})

test('falls back to stored pref when URL absent', () => {
  const vm = buildStandingsViewModel(base({ urlState: { view: 'weekly', scoring: null, grouping: null }, storedScoring: 'net' }))
  assert.equal(vm.scoring, 'net')
})

test('men\'s live + hide-until-final → groupings none', () => {
  const vm = buildStandingsViewModel(base({ resultStatus: 'live', availableGroupings: { kind: 'multi', groupings: [{ key: 'A', label: 'Flight A' }], defaultAll: true } }))
  assert.equal(vm.capabilities.groupings.kind, 'none')
})

test('men\'s final → groupings multi', () => {
  const vm = buildStandingsViewModel(base({ resultStatus: 'final', availableGroupings: { kind: 'multi', groupings: [{ key: 'A', label: 'Flight A' }], defaultAll: true } }))
  assert.equal(vm.capabilities.groupings.kind, 'multi')
})

test('women\'s single view → tabs hidden (views length 1)', () => {
  const vm = buildStandingsViewModel(base({ configViews: ['weekly'], resultStatus: 'live', availableGroupings: { kind: 'single', grouping: { key: 'overall', label: 'Overall' } } }))
  assert.equal(vm.capabilities.views.length, 1)
  assert.equal(vm.capabilities.groupings.kind, 'single')
})

// ---- §2: default view (no URL view) — Weekly/Live is the primary view ----

test('men\'s default view (no URL view) → weekly even off-season with no live/final occurrence', () => {
  // Off-season: a scheduled-but-not-played week, no results. Weekly/Live is
  // still the primary standings view — the default is NOT conditioned on
  // whether a live/final occurrence exists.
  const vm = buildStandingsViewModel(base({
    urlState: { view: null, scoring: null, grouping: null },
    occurrences: [{ id: '1', number: 1, label: 'Week 1', date: '2026-08-11', activeWindow: { start: '', end: null }, format: 'individual', discoveryState: 'pending', resultStatus: 'not_started' }],
    resultStatus: 'not_started',
    configViews: ['season', 'weekly'],
  }))
  assert.equal(vm.view, 'weekly')
})

test('men\'s default view with a live occurrence present → weekly', () => {
  const vm = buildStandingsViewModel(base({ urlState: { view: null, scoring: null, grouping: null } }))
  assert.equal(vm.view, 'weekly')
})

test('women\'s single-view league default → weekly (its only view)', () => {
  const vm = buildStandingsViewModel(base({
    urlState: { view: null, scoring: null, grouping: null },
    configViews: ['weekly'],
    availableGroupings: { kind: 'single', grouping: { key: 'overall', label: 'Overall' } },
  }))
  assert.equal(vm.view, 'weekly')
})

test('explicit URL view always wins over the weekly default', () => {
  const vm = buildStandingsViewModel(base({ urlState: { view: 'season', scoring: null, grouping: null } }))
  assert.equal(vm.view, 'season')
})
