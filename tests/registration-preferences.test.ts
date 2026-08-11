import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInitialEventOverrides,
  getEffectiveTimes,
  type EventPref,
} from '../lib/registration-preferences.ts'

const AUG11 = '360561ae-774d-42b1-8b97-da194cfcefca-placeholder'
const AUG17 = '360561ae-774d-42b1-8b97-da194cfcefca'
const AUG18 = '5204f84f-49d1-4a42-ab9b-48ecb6f6d0fc'
const DEFAULTS = ['7:00 AM', '8:00 AM', '9:00 AM']

// Case 5: persistent default_preferences survive as the fallback.
test('getEffectiveTimes: no override falls back to default_preferences', () => {
  assert.deepEqual(getEffectiveTimes(DEFAULTS, undefined), DEFAULTS)
})

test('getEffectiveTimes: skip_registration override yields no times', () => {
  assert.deepEqual(getEffectiveTimes(DEFAULTS, { times: [], skipRegistration: true }), [])
})

test('getEffectiveTimes: an override with times uses the override, not defaults', () => {
  assert.deepEqual(getEffectiveTimes(DEFAULTS, { times: ['10:00 AM'], skipRegistration: false }), ['10:00 AM'])
})

// Case 6: historical event_preferences survive in the override map (not deleted).
test('buildInitialEventOverrides: historical Aug 11 row is retained in the map', () => {
  const eventPrefs: EventPref[] = [{ event_id: AUG11, tee_time_preferences: ['6:30 AM'], skip_registration: false }]
  const overrides = buildInitialEventOverrides(eventPrefs)
  assert.deepEqual(overrides[AUG11], { times: ['6:30 AM'], skipRegistration: false })
})

// Case 7: old Aug 11 event_preferences cannot become Aug 17/18 preferences.
test('an Aug 11 override does not bleed into Aug 17 or Aug 18 (keyed by event_id)', () => {
  const eventPrefs: EventPref[] = [
    { event_id: AUG11, tee_time_preferences: ['6:30 AM'], skip_registration: false },
  ]
  const overrides = buildInitialEventOverrides(eventPrefs)
  // Aug 17 and Aug 18 have no override → effective times are the defaults,
  // never the Aug 11 row.
  assert.deepEqual(getEffectiveTimes(DEFAULTS, overrides[AUG17]), DEFAULTS)
  assert.deepEqual(getEffectiveTimes(DEFAULTS, overrides[AUG18]), DEFAULTS)
  // The Aug 11 row maps ONLY to Aug 11.
  assert.deepEqual(getEffectiveTimes(DEFAULTS, overrides[AUG11]), ['6:30 AM'])
})

test('multiple per-event overrides are resolved independently by event_id', () => {
  const eventPrefs: EventPref[] = [
    { event_id: AUG17, tee_time_preferences: ['7:30 AM'], skip_registration: false },
    { event_id: AUG18, tee_time_preferences: [], skip_registration: true },
  ]
  const overrides = buildInitialEventOverrides(eventPrefs)
  assert.deepEqual(getEffectiveTimes(DEFAULTS, overrides[AUG17]), ['7:30 AM'])
  assert.deepEqual(getEffectiveTimes(DEFAULTS, overrides[AUG18]), [])
})