import test from 'node:test'
import assert from 'node:assert/strict'
import { weeklyParticipationForCard } from '../components/competition/leaderboard-participation.ts'
import type { Scorecard } from '../lib/competition/types.ts'

const card = (over: Partial<Scorecard> = {}): Scorecard => ({
  key: 'card-1', memberCardId: 'card-1', name: 'Player', netTotal: null, grossTotal: null,
  toParNet: null, toParGross: null, holesCompleted: 0, scorecardStatus: 'no_holes', isLive: false, holes: [],
  ...over,
})
const teeSheet = {
  occurrence: null,
  status: 'published' as const,
  groups: [{
    id: 'g1', date: '2026-09-08', teeTime: '4:42 PM', startingTee: '1', course: null,
    rotation: null, groupLabel: null, sortOrder: 0,
    players: [{ sourceName: 'Player', firstName: null, lastName: null, memberCardId: 'card-1', teamName: null }],
  }],
}

test('scheduled no-score golfer shows the authoritative tee time', () => {
  assert.deepEqual(weeklyParticipationForCard(card(), teeSheet), {
    kind: 'scheduled', label: 'Tee time 4:42 PM', teeTime: '4:42 PM',
  })
})

test('authoritative tee-sheet absence is not presented as Not started', () => {
  const state = weeklyParticipationForCard(card({ memberCardId: 'not-entered' }), teeSheet)
  assert.equal(state.kind, 'not_playing')
  assert.equal(state.label, 'Not playing this week')
})

test('missing participation evidence fails closed instead of inferring not signed up', () => {
  const state = weeklyParticipationForCard(card(), { ...teeSheet, status: 'unavailable', groups: [] })
  assert.equal(state.kind, 'unknown')
  assert.equal(state.label, 'Entry status unavailable')
})

test('authoritative DNS and WD dispositions win over generic no-score state', () => {
  assert.equal(weeklyParticipationForCard(card({ scorecardStatus: 'no_show' }), teeSheet).kind, 'dns')
  assert.equal(weeklyParticipationForCard(card({ scorecardStatus: 'withdrawn' }), teeSheet).kind, 'wd')
})
