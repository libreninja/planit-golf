import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeWeeklyTeeSheet,
  initialTeeSheetView,
  personalizeTeeSheetGroups,
  selectCurrentWeeklyTeeSheetOccurrence,
} from '../lib/competition/weekly-tee-sheet.ts'

const raw = [
  { pairing_group: { id: 'later', tee_time: ' 5:14 PM', hole: 1, date: '2026-09-08', players: [
    { name: 'Partner, Pat', first_name: 'Pat', last_name: 'Partner', member_card_id: 'card-partner' },
    { name: 'Followed, Fran', first_name: 'Fran', last_name: 'Followed', member_card_id: 'card-followed-a' },
    { name: 'Followed, Finn', first_name: 'Finn', last_name: 'Followed', member_card_id: 'card-followed-b' },
  ] } },
  { pairing_group: { id: 'own', tee_time: ' 4:42 PM', hole: 1, date: '2026-09-08', players: [
    { name: 'Viewer, Vera', first_name: 'Vera', last_name: 'Viewer', member_card_id: 'card-self' },
    { name: 'Ordinary, Olivia', first_name: 'Olivia', last_name: 'Ordinary', member_card_id: 'card-ordinary' },
  ] } },
  { pairing_group: { id: 'earlier-follow', tee_time: ' 4:35 PM', hole: 1, date: '2026-09-08', players: [
    { name: 'Followed, Felix', first_name: 'Felix', last_name: 'Followed', member_card_id: 'card-followed-c' },
    { name: 'Unresolved, Uma', first_name: 'Uma', last_name: 'Unresolved', member_card_id: 'card-unresolved' },
  ] } },
]

test('normalizer preserves complete authoritative groups and orders them chronologically', () => {
  const groups = normalizeWeeklyTeeSheet(raw)
  assert.deepEqual(groups.map((group) => group.id), ['earlier-follow', 'own', 'later'])
  assert.equal(groups[0]?.startingTee, '1')
  assert.deepEqual(groups.find((group) => group.id === 'later')?.players.map((player) => player.sourceName), [
    'Partner, Pat', 'Followed, Fran', 'Followed, Finn',
  ])
})

test('personalized tee sheet puts the viewer group first and remaining followed groups chronologically', () => {
  const result = personalizeTeeSheetGroups({
    groups: normalizeWeeklyTeeSheet(raw),
    golferIdsByMemberCard: {
      'card-self': 'golfer-self',
      'card-followed-a': 'golfer-followed-a',
      'card-followed-b': 'golfer-followed-b',
      'card-followed-c': 'golfer-followed-c',
      'card-partner': 'golfer-partner',
      'card-ordinary': 'golfer-ordinary',
    },
    followState: {
      signedIn: true,
      followedGolferIds: ['golfer-followed-a', 'golfer-followed-b', 'golfer-followed-c'],
      selfGolferIds: ['golfer-self'],
    },
  })

  assert.deepEqual(result.personalizedGroups.map((group) => group.id), ['own', 'earlier-follow', 'later'])
  assert.equal(result.personalizedGroups.filter((group) => group.id === 'later').length, 1)
  assert.deepEqual(result.personalizedGroups.find((group) => group.id === 'later')?.players.map((player) => player.sourceName), [
    'Partner, Pat', 'Followed, Fran', 'Followed, Finn',
  ])
})

test('unresolved identities never trigger personalization and empty relevance falls back cleanly', () => {
  const result = personalizeTeeSheetGroups({
    groups: normalizeWeeklyTeeSheet(raw),
    golferIdsByMemberCard: {},
    followState: { signedIn: true, followedGolferIds: ['unknown-golfer'], selfGolferIds: ['unknown-self'] },
  })
  assert.equal(result.personalizedGroups.length, 0)
  assert.equal(result.fullGroups.length, 3)
  assert.equal(initialTeeSheetView(result.personalizedGroups.length), 'full')
})

test('following still personalizes without a trustworthy self identity', () => {
  const result = personalizeTeeSheetGroups({
    groups: normalizeWeeklyTeeSheet(raw),
    golferIdsByMemberCard: { 'card-followed-c': 'golfer-followed-c' },
    followState: { signedIn: true, followedGolferIds: ['golfer-followed-c'], selfGolferIds: [] },
  })

  assert.deepEqual(result.personalizedGroups.map((group) => group.id), ['earlier-follow'])
  assert.equal(result.personalizedGroups[0]?.containsSelf, false)
  assert.equal(result.personalizedGroups[0]?.players.length, 2)
})

test('current tee-sheet selection uses the next regular occurrence and excludes specials', () => {
  const selected = selectCurrentWeeklyTeeSheetOccurrence([
    { week_number: 101, event_name: 'Special', event_date: '2026-09-06', gg_event_id: 's', gg_round_id: 's' },
    { week_number: 23, event_name: 'Later', event_date: '2026-09-15', gg_event_id: 'b', gg_round_id: 'b' },
    { week_number: 22, event_name: 'Next', event_date: '2026-09-08', gg_event_id: 'a', gg_round_id: 'a' },
  ], '2026-09-05')
  assert.equal(selected?.week_number, 22)
})
