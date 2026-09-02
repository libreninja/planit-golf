import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teeSheetProjectionParticipants } from '../lib/competition/adapters/golfgenius/tee-sheet-flights.ts'

test('tee sheet adapter reads round indexes, preserves valid negatives/zero, and deduplicates identities', () => {
  const participants = teeSheetProjectionParticipants([
    { pairing_group: { players: [
      { name: 'Plus Player', member_card_id: 1, handicap_index: '-1.2' },
      { name: 'Scratch Player', member_card_id: 2, handicap_index: '0' },
      { name: 'Missing Player', member_card_id: 3, handicap_index: '' },
    ] } },
    { pairing_group: { players: [
      { name: 'Duplicate Scratch', member_card_id: 2, handicap_index: '9.9' },
      { name: 'Bad Player', member_card_id: 4, handicap_index: '12abc' },
    ] } },
  ])
  assert.deepEqual(participants, [
    { key: '1', handicapIndex: -1.2 },
    { key: '2', handicapIndex: 0 },
    { key: '3', handicapIndex: null },
    { key: '4', handicapIndex: null },
  ])
})

test('tee sheet adapter supports wrapped response shapes and name fallback keys', () => {
  const participants = teeSheetProjectionParticipants({
    pairing_groups: [{ pairing_group: { players: [{ name: 'Name Only', handicap_index: 8.4 }] } }],
  })
  assert.deepEqual(participants, [{ key: 'name:Name Only', handicapIndex: 8.4 }])
})

test('tee sheet adapter prefers the lossless string member-card id', () => {
  const participants = teeSheetProjectionParticipants([{ pairing_group: { players: [{
    name: 'Exact ID',
    member_card_id: 10860026554696624000,
    member_card_id_str: '10860026554696623653',
    handicap_index: '4.2',
  }] } }])
  assert.equal(participants[0].key, '10860026554696623653')
})
