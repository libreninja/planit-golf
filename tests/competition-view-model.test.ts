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
