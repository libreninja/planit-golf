import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileCompetition } from '../lib/competition/reconcile/reconcile.ts'

// Fake ops: track discover/import calls. discoverAndPersist returns a
// ResolvedOccurrence (carried on `resolved`) whose upstreamStatus drives the
// import decision — mirroring the real discovery→import handoff (Correction 6).
function makeOps(opts: { events: any[]; completedWeeks: number[] }) {
  const calls: string[] = []
  const imported: any[] = []
  return {
    calls, imported,
    async listEvents() { return opts.events },
    async discoverAndPersist(_competitionKey: string, week: number, _nowIso: string) {
      calls.push(`discover:${week}`)
      return { resolved: {
        weekNumber: week, ggEventId: 'E', ggRoundId: 'R1',
        grossTournamentId: 'g1', netTournamentId: 'n1',
        upstreamStatus: opts.completedWeeks.includes(week) ? 'completed' : 'in_progress',
        roundDate: '2026-07-28', eventName: 'Mens League',
        sourceFinalizedAt: opts.completedWeeks.includes(week) ? '2026-07-28T22:00:00Z' : null,
        sourceVersion: opts.completedWeeks.includes(week) ? 'v9' : null,
      } }
    },
    async importOccurrence(_competitionKey: string, week: number, _nowIso: string, resolved: any) {
      calls.push(`import:${week}`); imported.push(resolved)
    },
    async rebuildSeasonPoints(_competitionKey: string) { calls.push('points') },
  }
}

const baseEvents = (over: Partial<any>[]) => over.map((o, i) => ({
  week_number: i + 1, event_date: '2026-07-28', upstream_status: null, durable_imported_at: null,
  event_format: 'unknown', discovery_state: 'pending', ...o,
}))

test('upstream-finalized → discover + import + rebuild; old-current → skip', async () => {
  const ops = makeOps({ events: baseEvents([
    { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: null },
    { week_number: 17, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: '2026-07-01T00:00:00Z' },
  ]), completedWeeks: [18] })
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000, nowIso: '2026-07-28T22:00:00Z', ops: ops as any,
  })
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(ops.calls.includes('import:18'))
  assert.ok(ops.calls.includes('points'))
  assert.ok(!ops.calls.includes('import:17'), 'old-current skipped import')
  assert.equal(summary.imported, 1)
  assert.equal(summary.skipped, 1)
  // Correction 6: the ResolvedOccurrence flowed discovery → import (no placeholders).
  assert.equal(ops.imported[0].ggEventId, 'E')
  assert.equal(ops.imported[0].grossTournamentId, 'g1')
})

test('unresolved candidate whose discovery returns completed → import + rebuild in the SAME run', async () => {
  // Candidate pre-classifies as unknown-unresolved (upstream_status null,
  // event_format unknown) → 'discover' action. But discovery finds the round
  // is now completed and returns resolved IDs. The same run imports + rebuilds.
  const ops = makeOps({ events: baseEvents([
    { week_number: 18, event_format: 'unknown', discovery_state: 'pending', upstream_status: null, durable_imported_at: null },
  ]), completedWeeks: [18] })
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000, nowIso: '2026-07-28T22:00:00Z', ops: ops as any,
  })
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(ops.calls.includes('import:18'), 'import fired when discovery found completed')
  assert.ok(ops.calls.includes('points'))
  assert.equal(summary.imported, 1)
})

test('played-awaiting-finalization (in_progress) → discover only, no import', async () => {
  const ops = makeOps({ events: baseEvents([
    { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress', durable_imported_at: null },
  ]), completedWeeks: [] })   // discovery returns in_progress
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000, nowIso: '2026-07-28T20:00:00Z', ops: ops as any,
  })
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(!ops.calls.includes('import:18'), 'not completed → no import')
  assert.equal(summary.imported, 0)
  assert.equal(summary.discovered, 1)
})

test('stops before the shared deadline and marks stoppedForBudget', async () => {
  // Many finalized weeks; tiny deadline so we stop early.
  const events = Array.from({ length: 50 }, (_, i) => ({
    week_number: i + 1, event_date: '2026-07-28', event_format: 'individual', discovery_state: 'discovered',
    upstream_status: 'completed', durable_imported_at: null,
  }))
  const ops = makeOps({ events, completedWeeks: events.map((e) => e.week_number) })
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 0, nowIso: '2026-07-28T22:00:00Z', ops: ops as any,
  })
  assert.equal(summary.stoppedForBudget, true)
})
