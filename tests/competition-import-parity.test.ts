import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importOccurrence } from '../lib/competition/reconcile/import.ts'

// Golden-fixture parity test (D1). Hand-computed expected values from the
// fixture data below — a true golden assertion, NOT a tautology. Breaks if the
// perf/result row shape regresses away from the original sync's write shape.
//
// Fixture: 2 players, 3 holes, one flight ("Flight 1"). Course par = [4,4,4].
// Hans Olson (mc-1): gross finishing position "1", net finishing position "T2"
//   (DIFFERENT → proves net-wins on the perf row).
// Greta Fast (mc-2): finishing position "--" in both → asserts the 9999
//   weekly_position sentinel for unplaced players.
// Distinct gross vs net scores and distinct to_par_net vs to_par_gross so the
// test can prove they are NOT collapsed.

function fakeGg(opts: { results: Record<string, any>; courses: any }) {
  return async (endpoint: string) => {
    if (endpoint.endsWith('/courses')) return opts.courses
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results[tId] ?? { event: { scopes: [] } }
  }
}

const adapterConfig = { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }

function resolved(over: Partial<any> = {}) {
  return {
    weekNumber: 18, ggEventId: 'E', ggRoundId: 'R1',
    grossTournamentId: 'g1', netTournamentId: 'n1',
    upstreamStatus: 'completed', roundDate: '2026-07-28', eventName: 'Mens League',
    sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9',
    ...over,
  }
}

// Course par payload (GET /events/E/courses). par = [4,4,4].
const coursesPayload = {
  courses: [{ tees: [{ hole_data: { par: [4, 4, 4] } }] }],
}

// Hans: identical scorecard facts across gross+net (same round); only the
// finishing placement differs (gross "1" vs net "T2") to prove net-wins.
const hansAggregate = {
  name: 'Hans Olson',
  member_cards: [{ member_card_id_str: 'mc-1' }],
  gross_scores: [5, 7, 5],
  net_scores: [3, 6, 4],
  to_par_net: [-1, 2, 0],
  to_par_gross: [1, 3, 1],
  totals: {
    net_scores: { out: 13 },
    gross_scores: { out: 17 },
    to_par_net: { out: 1 },
    to_par_gross: { out: 5 },
  },
  scorecard_statuses: [{ status: 'completed' }],
}
const hansGross = { ...hansAggregate, position: '1', points: '50', purse: '$55.00' }
const hansNet = { ...hansAggregate, position: 'T2', points: '30', purse: '$22.00' }

// Greta: unplaced ("--") in both competitions. net [6,7,6] vs par [4,4,4] →
// 3 double-bogeys, 0 birdies.
const gretaAggregate = {
  name: 'Greta Fast',
  member_cards: [{ member_card_id_str: 'mc-2' }],
  gross_scores: [6, 7, 6],
  net_scores: [6, 7, 6],
  to_par_net: [2, 3, 2],
  to_par_gross: [2, 3, 2],
  totals: {
    net_scores: { out: 19 },
    gross_scores: { out: 19 },
    to_par_net: { out: 7 },
    to_par_gross: { out: 7 },
  },
  scorecard_statuses: [{ status: 'completed' }],
}
const gretaGross = { ...gretaAggregate, position: '--', points: null, purse: null }
const gretaNet = { ...gretaAggregate, position: '--', points: null, purse: null }

const results = {
  g1: { event: { scopes: [{ name: 'Flight 1', aggregates: [hansGross, gretaGross] }] } },
  n1: { event: { scopes: [{ name: 'Flight 1', aggregates: [hansNet, gretaNet] }] } },
}

function makeDb() {
  const writes: any[] = []
  const db = {
    upsertEvent: async (row: any) => { writes.push({ kind: 'event', row }); return { ok: true, id: 'ev-1' } },
    upsertPerformances: async (rows: any[]) => { writes.push({ kind: 'perf', rows }); return { ok: true } },
    upsertResults: async (rows: any[]) => { writes.push({ kind: 'res', rows }); return { ok: true } },
    setDurableImported: async (week: number, atIso: string, sourceVersion: string | null) => { writes.push({ kind: 'durable', week, atIso, sourceVersion }); return { ok: true } },
  }
  return { writes, db }
}

const nowIso = '2026-07-28T22:05:00Z'

test('perf row matches the original sync shape: NOT NULL populated, position_label is finishing position, to_par_net !== to_par_gross, net-wins placement', async () => {
  const { writes, db } = makeDb()
  await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: fakeGg({ results, courses: coursesPayload }), db, nowIso })
  const perfRows = writes.find((w) => w.kind === 'perf')!.rows as any[]
  // One perf row per player (keyed by player_name — net collapses with gross).
  assert.equal(perfRows.length, 2, 'one perf row per player (net + gross collapse)')
  const byName = new Map(perfRows.map((r) => [r.player_name as string, r]))

  // ---- Hans: golden deep-equal of the FULL perf row (net-wins placement) ----
  const hans = byName.get('Hans Olson')!
  // Hand-computed from the fixture: gross_scores [5,7,5], net [3,6,4],
  // to_par_net [-1,2,0], to_par_gross [1,3,1] (DISTINCT, not collapsed),
  // birdies=1 (net 3 vs par 4), double_bogeys=1 (net 6 vs par 4),
  // net-wins placement carries NET's position_label='T2', flight_position=2,
  // points=30, purse='$22.00'. weekly_position is ALSO overwritten on the net
  // pass (parity with the original sync's full-row upsert, where net's parsed
  // position won), so it carries net's parsed position (2) — consistent with
  // position_label/flight_position, and the NOT NULL column is populated.
  // event_name + weekly_position both populated (the D1 contract).
  assert.deepEqual(hans, {
    league_key: 'mens', week_number: 18, event_id: 'ev-1',
    player_name: 'Hans Olson', member_card_id: 'mc-1',
    flight_name: 'Flight 1',
    position_label: 'T2',          // net-wins, NOT 'Finished' / scorecard status
    flight_position: 2,             // parsePosition('T2') = 2 (net-wins)
    points: 30,                     // net's points (net-wins)
    gross_scores: [5, 7, 5],
    to_par_net: [-1, 2, 0],
    to_par_gross: [1, 3, 1],        // DISTINCT from to_par_net (not collapsed)
    net_total: 13,
    gross_total: 17,
    to_par_net_total: 1,
    to_par_gross_total: 5,
    purse: '$22.00',                // net's purse (net-wins)
    holes_completed: 3,
    scorecard_status: 'completed',
    event_name: 'Mens League',      // NOT NULL contract — populated
    event_date: '2026-07-28',
    double_bogeys: 1, birdies: 1,
    weekly_position: 2,            // NOT NULL — net-wins: parsePosition('T2') = 2 (consistent with position_label/flight_position)
    net_scores: [3, 6, 4],
  })

  // Explicit NOT-NULL-contract assertions (the production bug D1 fixed).
  assert.equal(hans.event_name, 'Mens League', 'event_name populated (was missing → NOT NULL violation)')
  assert.ok(hans.weekly_position !== null && hans.weekly_position !== undefined, 'weekly_position populated (was missing → NOT NULL violation)')
  // position_label is the finishing position, NOT the scorecard status string.
  assert.notEqual(hans.position_label, 'completed')
  assert.notEqual(hans.position_label, 'Finished')
  assert.equal(hans.position_label, 'T2')
  // to_par_net and to_par_gross are distinct arrays (gross to-par NOT discarded).
  assert.notDeepEqual(hans.to_par_net, hans.to_par_gross, 'gross to-par must not be collapsed into net')
  // Net-wins: perf row carries NET's placement, not gross's "1".
  assert.notEqual(hans.position_label, '1', 'net-wins — gross position must not survive on the perf row')
  assert.equal(hans.flight_position, 2)
  assert.equal(hans.points, 30)

  // ---- Greta: unplaced player → 9999 sentinel, null placement ----
  const greta = byName.get('Greta Fast')!
  assert.equal(greta.position_label, null, 'unplaced player position_label null (positionLabelOf("--") = null)')
  assert.equal(greta.flight_position, null, 'parsePosition(null) = null')
  assert.equal(greta.weekly_position, 9999, 'unplaced player sentinel (NOT NULL column, must not be 0/null)')
  assert.equal(greta.birdies, 0)
  assert.equal(greta.double_bogeys, 3, 'net [6,7,6] vs par [4,4,4] → 3 doubles')
  assert.equal(greta.points, null)
  assert.equal(greta.purse, null)
  assert.equal(greta.event_name, 'Mens League')
})

test('result rows: one per competition, carry event_id + synced_at + correct placement', async () => {
  const { writes, db } = makeDb()
  await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: fakeGg({ results, courses: coursesPayload }), db, nowIso })
  const resRows = writes.find((w) => w.kind === 'res')!.rows as any[]
  // 2 players × 2 competitions = 4 result rows.
  assert.equal(resRows.length, 4, 'one result row per player per competition')
  // Every result row carries event_id + synced_at (parity with original sync).
  for (const r of resRows) {
    assert.equal(r.event_id, 'ev-1', 'result row carries event_id')
    assert.equal(r.synced_at, nowIso, 'result row carries synced_at')
    assert.equal(r.league_key, 'mens')
    assert.equal(r.week_number, 18)
  }

  const hansGrossRow = resRows.find((r) => r.player_name === 'Hans Olson' && r.competition === 'gross')!
  const hansNetRow = resRows.find((r) => r.player_name === 'Hans Olson' && r.competition === 'net')!
  const gretaGrossRow = resRows.find((r) => r.player_name === 'Greta Fast' && r.competition === 'gross')!
  const gretaNetRow = resRows.find((r) => r.player_name === 'Greta Fast' && r.competition === 'net')!

  // Hans gross — exact golden shape.
  assert.deepEqual(hansGrossRow, {
    league_key: 'mens', week_number: 18, event_id: 'ev-1',
    member_card_id: 'mc-1', player_name: 'Hans Olson', competition: 'gross',
    flight_name: 'Flight 1', position_label: '1', flight_position: 1,
    points: 50, purse: '$55.00', synced_at: nowIso,
  })
  // Hans net — different placement (proves per-competition result rows, not collapsed).
  assert.deepEqual(hansNetRow, {
    league_key: 'mens', week_number: 18, event_id: 'ev-1',
    member_card_id: 'mc-1', player_name: 'Hans Olson', competition: 'net',
    flight_name: 'Flight 1', position_label: 'T2', flight_position: 2,
    points: 30, purse: '$22.00', synced_at: nowIso,
  })
  // Greta unplaced in BOTH competitions.
  assert.equal(gretaGrossRow.position_label, null)
  assert.equal(gretaGrossRow.flight_position, null)
  assert.equal(gretaGrossRow.points, null)
  assert.equal(gretaGrossRow.member_card_id, 'mc-2')
  assert.equal(gretaNetRow.competition, 'net')
  assert.equal(gretaNetRow.position_label, null)
})

test('birdies/double_bogeys derived from net scores vs course par', async () => {
  const { writes, db } = makeDb()
  await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: fakeGg({ results, courses: coursesPayload }), db, nowIso })
  const byName = new Map((writes.find((w) => w.kind === 'perf')!.rows as any[]).map((r) => [r.player_name as string, r]))
  // Hans: net [3,6,4] vs par [4,4,4] → hole 1 birdie (3==4-1), hole 2 double (6>=4+2).
  assert.equal(byName.get('Hans Olson')!.birdies, 1)
  assert.equal(byName.get('Hans Olson')!.double_bogeys, 1)
  // Greta: net [6,7,6] vs par [4,4,4] → 3 doubles, 0 birdies.
  assert.equal(byName.get('Greta Fast')!.birdies, 0)
  assert.equal(byName.get('Greta Fast')!.double_bogeys, 3)
})

test('par data not critical: missing courses payload → birdies/double_bogeys = 0 (no throw)', async () => {
  const { writes, db } = makeDb()
  // ggClient throws on /courses — import must swallow (parity: "par data not critical").
  const gg = async (endpoint: string) => {
    if (endpoint.endsWith('/courses')) throw new Error('boom')
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return results[tId] ?? { event: { scopes: [] } }
  }
  await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: gg as any, db, nowIso })
  const byName = new Map((writes.find((w) => w.kind === 'perf')!.rows as any[]).map((r) => [r.player_name as string, r]))
  assert.equal(byName.get('Hans Olson')!.birdies, 0, 'par data unavailable → 0 birdies')
  assert.equal(byName.get('Hans Olson')!.double_bogeys, 0, 'par data unavailable → 0 doubles')
  // Perf + result rows still written; event_id still populated.
  assert.ok(writes.find((w) => w.kind === 'perf')!.rows.length === 2)
  assert.ok(writes.find((w) => w.kind === 'res')!.rows.length === 4)
})
