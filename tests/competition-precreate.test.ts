import { test } from 'node:test'
import assert from 'node:assert/strict'
import { precreateSpecialOccurrencesRows, precreateSpecialOccurrences } from '../lib/competition/reconcile/precreate.ts'

test('precreateSpecialOccurrencesRows builds the two Club Championship rows from the mens config', () => {
  const rows = precreateSpecialOccurrencesRows('mens-league')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].league_key, 'mens')
  assert.equal(rows[0].week_number, 101)
  assert.equal(rows[0].event_name, 'Club Championship - Round 1')
  assert.equal(rows[0].event_date, '2026-08-17')
  assert.equal(rows[0].gg_event_id, '12263651301715371717')
  assert.equal(rows[0].gg_round_id, '12263658868441114147')
  assert.equal(rows[0].event_format, 'individual')
  assert.equal(rows[0].discovery_state, 'pending')
  assert.equal(rows[1].week_number, 102)
  assert.equal(rows[1].event_date, '2026-08-18')
  assert.equal(rows[1].gg_round_id, '12263654969047016987')
})

test('precreateSpecialOccurrencesRows is empty for a competition with no special occurrences', () => {
  assert.deepEqual(precreateSpecialOccurrencesRows('womens-league'), [])
})

// Idempotent writer: a mock db recording upserts. `existing` is the set of
// "league:week" keys that already exist (inserted=false); everything else is
// inserted (inserted=true). A 23505 race is simulated by marking a key existing.
function mockDb(existing: Set<string>) {
  const calls: any[] = []
  return {
    calls,
    async upsertIgnoreDuplicates(row: any) {
      calls.push(row)
      const key = `${row.league_key}:${row.week_number}`
      if (existing.has(key)) return { inserted: false }
      existing.add(key) // subsequent calls for the same key see it as existing
      return { inserted: true }
    },
  }
}

test('precreateSpecialOccurrences inserts missing rows and returns the count', async () => {
  const db = mockDb(new Set())
  const n = await precreateSpecialOccurrences('mens-league', db as any)
  assert.equal(n, 2, 'both CC rows inserted')
  assert.equal(db.calls.length, 2)
  assert.equal(db.calls[0].week_number, 101)
  assert.equal(db.calls[1].week_number, 102)
})

test('precreateSpecialOccurrences is idempotent: existing rows are not re-inserted', async () => {
  const existing = new Set(['mens:101', 'mens:102'])
  const db = mockDb(existing)
  const n = await precreateSpecialOccurrences('mens-league', db as any)
  assert.equal(n, 0, 'both already existed → nothing inserted')
  assert.equal(db.calls.length, 2, 'still checked both rows')
})

test('precreateSpecialOccurrences inserts only the missing row (partial)', async () => {
  const existing = new Set(['mens:101']) // Round 1 already seeded, Round 2 missing
  const db = mockDb(existing)
  const n = await precreateSpecialOccurrences('mens-league', db as any)
  assert.equal(n, 1, 'only Round 2 inserted')
  assert.equal(db.calls[1].week_number, 102)
})