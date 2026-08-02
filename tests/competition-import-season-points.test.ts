import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importOccurrence } from '../lib/competition/reconcile/import.ts'

function fakeGg(opts: { results: Record<string, any> }) {
  return async (endpoint: string) => {
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

// Minimal scopes payload so normalizeTournament produces entries; the season
// points come from event.season_points (sibling of event.scopes).
function scope(over: Partial<any> = {}) {
  return { name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', points: '50', member_cards: [{ member_card_id_str: 'mc-1' }], gross_scores: [5], net_scores: [4], to_par_net: [-1], to_par_gross: [0], totals: { gross_scores: { out: 5 } } }] }
}

function db() {
  const writes: any[] = []
  return {
    writes,
    upsertEvent: async () => ({ ok: true }),
    upsertPerformances: async () => ({ ok: true }),
    upsertResults: async () => ({ ok: true }),
    setDurableImported: async () => ({ ok: true }),
    upsertSeasonPointEntries: async (rows: any[]) => { writes.push(rows); return { ok: true } },
  }
}

test('completed round: captures event.season_points summed across gross+net into one entry per member', async () => {
  const results = {
    g1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '40' }] } },
    n1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '10' }] } },
  }
  const d = db()
  const gg = fakeGg({ results })
  const summary = await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: gg, db: d as any, nowIso: '2026-07-28T22:05:00Z' })
  assert.equal(summary.seasonPointEntries, 1, 'one entry per member per round')
  assert.equal(d.writes.length, 1)
  const row = d.writes[0][0]
  assert.equal(row.league_key, 'mens')
  assert.equal(row.week_number, 18)
  assert.equal(row.member_card_id, 'mc-1')
  assert.equal(row.total_points, 50, 'gross 40 + net 10 summed')
})

test('two members: one entry each, summed across competitions', async () => {
  const results = {
    g1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '40' }, { member_card_id: 'mc-2', total_points: '30' }] } },
    n1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '10' }, { member_card_id: 'mc-2', total_points: '20' }] } },
  }
  const d = db()
  const gg = fakeGg({ results })
  await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: gg, db: d as any, nowIso: '2026-07-28T22:05:00Z' })
  const byMember = new Map((d.writes[0] as any[]).map((r) => [r.member_card_id, Number(r.total_points)]))
  assert.equal(byMember.get('mc-1'), 50)
  assert.equal(byMember.get('mc-2'), 50, '30 + 20')
})

test('not-completed round: no season_point_entries written', async () => {
  const results = {
    g1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '40' }] } },
    n1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '10' }] } },
  }
  const d = db()
  const gg = fakeGg({ results })
  const summary = await importOccurrence({ competitionKey: 'mens-league', resolved: resolved({ upstreamStatus: 'in_progress', sourceFinalizedAt: null }), adapterConfig, ggClient: gg, db: d as any, nowIso: '2026-07-28T18:00:00Z' })
  assert.equal(d.writes.length, 0, 'no entries captured for an in-progress round')
  assert.equal(summary.seasonPointEntries, 0)
})

test("women's-style empty season_points: no-op (no entries, no error)", async () => {
  const results = {
    g1: { event: { scopes: [scope()], season_points: [] } },
    n1: { event: { scopes: [scope()], season_points: [] } },
  }
  const d = db()
  const gg = fakeGg({ results })
  const summary = await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: gg, db: d as any, nowIso: '2026-07-28T22:05:00Z' })
  assert.equal(d.writes.length, 0)
  assert.equal(summary.seasonPointEntries, 0)
})

test('missing upsertSeasonPointEntries (optional): capture skipped, no throw, 19B-compatible', async () => {
  const results = {
    g1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '40' }] } },
    n1: { event: { scopes: [scope()], season_points: [{ member_card_id: 'mc-1', total_points: '10' }] } },
  }
  // Fake WITHOUT upsertSeasonPointEntries — mirrors the 19B test fake.
  const d: any = {
    upsertEvent: async () => ({ ok: true }),
    upsertPerformances: async () => ({ ok: true }),
    upsertResults: async () => ({ ok: true }),
    setDurableImported: async () => ({ ok: true }),
  }
  const gg = fakeGg({ results })
  const summary = await importOccurrence({ competitionKey: 'mens-league', resolved: resolved(), adapterConfig, ggClient: gg, db: d, nowIso: '2026-07-28T22:05:00Z' })
  assert.equal(summary.seasonPointEntries, 1, 'entries computed even when db cannot persist them')
  // No throw — optional chaining skips the write.
})
