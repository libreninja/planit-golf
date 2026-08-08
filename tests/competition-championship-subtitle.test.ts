import { test } from 'node:test'
import assert from 'node:assert/strict'
import { championshipSubtitle, type RoundScheduleItem } from '../lib/competition/championship-subtitle.ts'

// Real Club Championship schedule (Mon 8/17 + Tue 8/18), derived from the
// mens-league config specialOccurrences.
const SCHED: RoundScheduleItem[] = [
  { round: 1, weekdayShort: 'Mon', weekdayLong: 'Monday', dateShort: '8/17', dateLong: 'Aug 17' },
  { round: 2, weekdayShort: 'Tue', weekdayLong: 'Tuesday', dateShort: '8/18', dateLong: 'Aug 18' },
]

test('before play (not_started) → "Starts Monday, Aug 17"', () => {
  const s = championshipSubtitle({ resultStatus: 'not_started', roundsComplete: 0, roundsLive: 0, roundCount: 2 }, SCHED)
  assert.equal(s, 'Starts Monday, Aug 17')
})

test('Round 1 in progress → "LIVE · Round 1 in progress"', () => {
  const s = championshipSubtitle({ resultStatus: 'live', roundsComplete: 0, roundsLive: 1, roundCount: 2 }, SCHED)
  assert.equal(s, 'LIVE · Round 1 in progress')
})

test('Round 1 complete, Round 2 in progress → "LIVE · Round 2 in progress"', () => {
  const s = championshipSubtitle({ resultStatus: 'live', roundsComplete: 1, roundsLive: 1, roundCount: 2 }, SCHED)
  assert.equal(s, 'LIVE · Round 2 in progress')
})

test('final → "FINAL"', () => {
  const s = championshipSubtitle({ resultStatus: 'final', roundsComplete: 2, roundsLive: 0, roundCount: 2 }, SCHED)
  assert.equal(s, 'FINAL')
})

test('neutral (a round complete, none live, not final) → the format descriptor', () => {
  // Monday final, Tuesday not yet teed off: roundsComplete=1, roundsLive=0, still 'live' overall.
  const s = championshipSubtitle({ resultStatus: 'live', roundsComplete: 1, roundsLive: 0, roundCount: 2 }, SCHED)
  assert.equal(s, '18-hole aggregate · Round 1 Mon 8/17 + Round 2 Tue 8/18')
})

test('format descriptor uses roundCount * 9 holes', () => {
  const s = championshipSubtitle({ resultStatus: 'live', roundsComplete: 1, roundsLive: 0, roundCount: 2 }, SCHED)
  assert.match(s, /^18-hole aggregate /)
})

test('empty schedule + not_started falls back to the format descriptor', () => {
  const s = championshipSubtitle({ resultStatus: 'not_started', roundsComplete: 0, roundsLive: 0, roundCount: 2 }, [])
  assert.equal(s, '18-hole aggregate · ')
})