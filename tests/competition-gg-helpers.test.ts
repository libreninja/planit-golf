import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePosition, parseNum, countCompletedHoles, totalOut, pickIndividualTournaments } from '../lib/competition/reconcile/gg-helpers.ts'

test('parsePosition: "1" → 1, "T2" → 2, "--" → null', () => {
  assert.equal(parsePosition('1'), 1)
  assert.equal(parsePosition('T2'), 2)
  assert.equal(parsePosition('--'), null)
})

test('parseNum: numeric strings → numbers, blanks → null', () => {
  assert.equal(parseNum('50'), 50)
  assert.equal(parseNum(''), null)
  assert.equal(parseNum(null), null)
})

test('countCompletedHoles: counts non-null gross/net entries', () => {
  assert.equal(countCompletedHoles([5, 6, null, 4], [4, 5, null, 3]), 3)
})

test('totalOut: out falls back to total', () => {
  assert.equal(totalOut({ net_scores: { out: 13 } }, 'net_scores'), 13)
  assert.equal(totalOut({ net_scores: { total: 39 } }, 'net_scores'), 39)
  assert.equal(totalOut({}, 'net_scores'), null)
})

test('pickIndividualTournaments: separates gross/net by name, drops side/team games (canonical flat {id,name})', () => {
  // GG returns tournaments as {event:{id,name}}; pickIndividualTournaments
  // normalizes each to the canonical flat {id,name} shape used everywhere
  // (19A parity, discovery, import, existing-script port). Side/team games
  // are dropped — only qualifying individual competitions are returned.
  const ts = [
    { event: { id: 'g1', name: 'Gross Regular Season' } },
    { event: { id: 'n1', name: 'Net Regular Season' } },
    { event: { id: 's1', name: 'Closest to the Pin' } },
    { event: { id: 't1', name: 'Team Scramble' } },
  ]
  const r = pickIndividualTournaments(ts)
  assert.equal(r.gross?.id, 'g1')
  assert.equal(r.net?.id, 'n1')
})
