import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileCompetition, reconcileOccurrenceOnDemand } from '../lib/competition/reconcile/reconcile.ts'

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

// Failure-propagation contract (weeks-17/18 regression): when import throws
// (a required write failed, or a completed round built 0 performances), the
// reconcile loop must surface it in errors[] and NOT count the week as
// imported, and must not run the season-points rebuild for that week.
test('importOccurrence failure → surfaced in errors[], not counted as imported, no rebuild', async () => {
  const ops = makeOps({ events: baseEvents([
    { week_number: 17, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: null },
  ]), completedWeeks: [17] })
  // Override importOccurrence to throw (mirrors the production importDb rethrow
  // or the zero-perf guard firing).
  ;(ops as any).importOccurrence = async (_ck: string, week: number) => {
    throw new Error(`wk${week}: completed round produced 0 performance rows (gross=g1 net=n1)`)
  }
  const summary = await reconcileCompetition({
    competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000, nowIso: '2026-07-28T22:00:00Z', ops: ops as any,
  })
  assert.equal(summary.imported, 0, 'a failed import must not be counted as imported')
  assert.equal(summary.seasonPointsRebuilds, 0, 'rebuild must not run after a failed import')
  assert.equal(summary.errors.length, 1)
  assert.match(summary.errors[0], /wk17: completed round produced 0 performance rows/)
  assert.ok(!ops.calls.includes('points'), 'season-points rebuild skipped for the failed week')
})

// ---- reconcileOccurrenceOnDemand: the on-view read-through ----
// Reuses selectReconciliationCandidates (durable-skip + staleness gate) and the
// discover→import→rebuild sequence for ONE occurrence. Best-effort: never throws.

const NOW = '2026-07-28T20:00:00Z'

test('on-demand: finalized-not-durable + not stale → discover + import + rebuild', async () => {
  const ops = makeOps({
    events: baseEvents([
      { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: null, durable_imported_at: null /* discovered_at absent → not gated */ },
    ]),
    completedWeeks: [18],
  })
  const res = await reconcileOccurrenceOnDemand('mens-league', 18, NOW, ops as any)
  assert.equal(res.action, 'imported')
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(ops.calls.includes('import:18'))
  assert.ok(ops.calls.includes('points'), 'season-points snapshot rebuilt so Season view is current')
})

test('on-demand: already durable (old-current) → skipped-durable, no GG call', async () => {
  const ops = makeOps({
    events: baseEvents([
      { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'completed', durable_imported_at: '2026-07-28T17:00:00Z' },
    ]),
    completedWeeks: [18],
  })
  const res = await reconcileOccurrenceOnDemand('mens-league', 18, NOW, ops as any)
  assert.equal(res.action, 'skipped-durable')
  assert.equal(ops.calls.length, 0, 'durable round → zero discover/import calls (5 days/week steady state)')
})

test('on-demand: discovered <60s ago → skipped-stale (re-read at most once/min)', async () => {
  // Would classify as 'active' (discover), but discovered 30s ago → staleness gate → skip.
  const ops = makeOps({
    events: baseEvents([
      { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: null, durable_imported_at: null, discovered_at: '2026-07-28T19:59:30Z' },
    ]),
    completedWeeks: [18],
  })
  const res = await reconcileOccurrenceOnDemand('mens-league', 18, NOW, ops as any)
  assert.equal(res.action, 'skipped-stale')
  assert.equal(ops.calls.length, 0, 'fresh discovery → no re-read this view')
})

test('on-demand: in-progress + not stale → discover only, no import', async () => {
  const ops = makeOps({
    events: baseEvents([
      { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: 'in_progress', durable_imported_at: null },
    ]),
    completedWeeks: [],   // discovery returns in_progress
  })
  const res = await reconcileOccurrenceOnDemand('mens-league', 18, NOW, ops as any)
  assert.equal(res.action, 'discovered')
  assert.ok(ops.calls.includes('discover:18'))
  assert.ok(!ops.calls.includes('import:18'), 'not completed → no import')
  assert.ok(!ops.calls.includes('points'))
})

test('on-demand: requested week absent from events → skipped-absent', async () => {
  const ops = makeOps({ events: baseEvents([{ week_number: 18 }]), completedWeeks: [] })
  const res = await reconcileOccurrenceOnDemand('mens-league', 99, NOW, ops as any)
  assert.equal(res.action, 'skipped-absent')
  assert.equal(ops.calls.length, 0)
})

test('on-demand: GG failure is swallowed → action error, render does not break', async () => {
  const ops = makeOps({
    events: baseEvents([
      { week_number: 18, event_format: 'individual', discovery_state: 'discovered', upstream_status: null, durable_imported_at: null },
    ]),
    completedWeeks: [18],
  })
  ;(ops as any).discoverAndPersist = async () => { throw new Error('GG 503') }
  const res = await reconcileOccurrenceOnDemand('mens-league', 18, NOW, ops as any)
  assert.equal(res.action, 'error')
  assert.match(res.error ?? '', /GG 503/)
})
