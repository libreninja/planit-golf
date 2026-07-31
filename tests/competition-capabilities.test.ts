import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveOccurrenceCapabilities, type CapabilityInput } from '../lib/competition/capabilities.ts'

const mensBase: CapabilityInput = {
  configViews: ['season', 'weekly'],
  scoringModes: ['gross', 'net'],
  supportsLiveResults: true,
  supportsEventNavigation: true,
  availableGroupings: { kind: 'none' },
  resultStatus: 'live',
  liveGroupingPolicy: 'hide-until-final',
}

test('men\'s live with hide-until-final: groupings none even if durable groupings present', () => {
  const c = deriveOccurrenceCapabilities({
    ...mensBase,
    resultStatus: 'live',
    availableGroupings: { kind: 'multi', groupings: [
      { key: 'A', label: 'Flight A' }, { key: 'B', label: 'Flight B' }, { key: 'C', label: 'Flight C' },
    ], defaultAll: true },
  })
  assert.equal(c.groupings.kind, 'none')
  assert.deepEqual(c.views, ['season', 'weekly'])
  assert.deepEqual(c.scoring.modes, ['gross', 'net'])
})

test('men\'s final with hide-until-final: groupings multi (All/A/B/C)', () => {
  const c = deriveOccurrenceCapabilities({
    ...mensBase,
    resultStatus: 'final',
    availableGroupings: { kind: 'multi', groupings: [
      { key: 'A', label: 'Flight A' }, { key: 'B', label: 'Flight B' }, { key: 'C', label: 'Flight C' },
    ], defaultAll: true },
  })
  assert.equal(c.groupings.kind, 'multi')
})

test('available-while-live policy: groupings shown even while live', () => {
  const c = deriveOccurrenceCapabilities({
    ...mensBase,
    resultStatus: 'live',
    liveGroupingPolicy: 'available-while-live',
    availableGroupings: { kind: 'multi', groupings: [{ key: 'A', label: 'Bracket A' }], defaultAll: true },
  })
  assert.equal(c.groupings.kind, 'multi')
})

test('women\'s: single view → views length 1 (UI hides tab bar); single grouping → no control', () => {
  const c = deriveOccurrenceCapabilities({
    configViews: ['weekly'],
    scoringModes: ['gross', 'net'],
    supportsLiveResults: true,
    supportsEventNavigation: true,
    availableGroupings: { kind: 'single', grouping: { key: 'overall', label: 'Overall' } },
    resultStatus: 'live',
    liveGroupingPolicy: 'hide-until-final',
  })
  assert.equal(c.views.length, 1)
  assert.equal(c.groupings.kind, 'single')
})