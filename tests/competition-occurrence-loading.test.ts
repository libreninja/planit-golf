import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isLatestResultsDisabled,
  isOccurrenceNavigationPending,
  selectedOccurrenceContextId,
} from '../components/competition/occurrence-loading.ts'

test('changing occurrence immediately enters loading until destination props arrive', () => {
  assert.equal(isOccurrenceNavigationPending('20', '21'), true)
  assert.equal(isOccurrenceNavigationPending('21', '21'), false)
  assert.equal(isOccurrenceNavigationPending('20', null), false)
})

test('pending occurrence immediately becomes the control-panel context', () => {
  assert.equal(selectedOccurrenceContextId('20', '21'), '21')
  assert.equal(selectedOccurrenceContextId('20', null), '20')
  assert.equal(selectedOccurrenceContextId(null, '21'), '21')
})

test('Latest results is disabled on latest and enabled on history', () => {
  assert.equal(isLatestResultsDisabled('21', '21'), true)
  assert.equal(isLatestResultsDisabled('20', '21'), false)
  assert.equal(isLatestResultsDisabled('20', null), true)
})
