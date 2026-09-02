import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importOccurrence } from '../lib/competition/reconcile/import.ts'

function fakeGg(opts: { results: Record<string, any> }) {
  return async (endpoint: string) => {
    // Import fetches only the per-tournament results .json (ids come from
    // `resolved`, not from a tournament list).
    const tId = endpoint.split('/').slice(-1)[0].replace('.json', '')
    return opts.results[tId] ?? { event: { scopes: [] } }
  }
}

const adapterConfig = { seasonId: 'S', categoryId: 'C', eventFilter: 'mens', tenantKey: 'igc', roundResolution: 'pointsRoundIndex' as const }

// The ResolvedOccurrence discovery would have produced for week 18.
const resolved = {
  weekNumber: 18, ggEventId: 'E', ggRoundId: 'R1',
  grossTournamentId: 'g1', netTournamentId: 'n1',
  upstreamStatus: 'completed' as const, roundDate: '2026-07-28', eventName: 'Mens League',
  sourceFinalizedAt: '2026-07-28T22:00:00Z', sourceVersion: 'v9',
}

test('importOccurrence writes both gross+net results and is idempotent on re-run', async () => {
  const results = {
    g1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', points: '50', member_cards: [{ member_card_id_str: 'mc-1' }], gross_scores: [5,6,5], net_scores: [4,5,4], to_par_net: [-1,0,-1], to_par_gross: [0,0,0], totals: { gross_scores: { out: 16 } } }] }] } },
    n1: { event: { scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Hans Olson', position: '1', points: '50', member_cards: [{ member_card_id_str: 'mc-1' }], gross_scores: [5,6,5], net_scores: [4,5,4], to_par_net: [-1,0,-1], to_par_gross: [0,0,0], totals: { net_scores: { out: 13 } } }] }] } },
  }
  const writes: any[] = []
  const db = {
    upsertPerformances: async (rows: any[]) => { writes.push({ kind: 'perf', rows }); return { ok: true } },
    upsertResults: async (rows: any[]) => { writes.push({ kind: 'res', rows }); return { ok: true } },
    upsertEvent: async (row: any) => { writes.push({ kind: 'event', row }); return { ok: true } },
    setDurableImported: async (week: number, atIso: string, sourceVersion: string | null) => { writes.push({ kind: 'durable', week, atIso, sourceVersion }); return { ok: true } },
  }
  const gg = fakeGg({ results })
  const a1 = await importOccurrence({ competitionKey: 'mens-league', resolved, adapterConfig, ggClient: gg, db, nowIso: '2026-07-28T22:05:00Z' })
  const w1 = writes.length
  const a2 = await importOccurrence({ competitionKey: 'mens-league', resolved, adapterConfig, ggClient: gg, db, nowIso: '2026-07-28T22:06:00Z' })
  // Idempotent: same number of write operations on re-run (upserts overwrite).
  assert.equal(a2.performances, a1.performances)
  assert.equal(a2.results, a1.results)
  assert.equal(writes.length - w1, 4, 're-run wrote the same 4 buckets (event, perf, res, durable)')
  // Both competitions present in the results upsert.
  const resRows = writes.filter((w) => w.kind === 'res').flatMap((w) => w.rows)
  const competitions = new Set(resRows.map((r: any) => r.competition))
  assert.ok(competitions.has('gross') && competitions.has('net'), 'both gross+net written')
  // The event upsert carries the resolved ids + source version — no placeholders.
  const ev = writes.find((w) => w.kind === 'event')!.row
  assert.equal(ev.gg_event_id, 'E')
  assert.equal(ev.gg_round_id, 'R1')
  assert.equal(ev.gg_gross_tournament_id, 'g1')
  assert.equal(ev.gg_net_tournament_id, 'n1')
  assert.equal(ev.source_version, 'v9')
  assert.equal(ev.source_finalized_at, '2026-07-28T22:00:00Z')
  // The durable write records the source version it captured.
  const durable = writes.find((w) => w.kind === 'durable')!
  assert.equal(durable.sourceVersion, 'v9')
})

test('a refreshed authoritative snapshot prunes stale performance, result, and season-point rows', async () => {
  const results = {
    g1: { event: { season_points: [{ member_card_id: 'current', total_points: 1 }], scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Current Player', position: '1', member_cards: [{ member_card_id_str: 'current' }], gross_scores: [5], net_scores: [4], to_par_net: [0], to_par_gross: [1] }] }] } },
    n1: { event: { season_points: [{ member_card_id: 'current', total_points: 2 }], scopes: [{ name: 'Flight 1', aggregates: [{ name: 'Current Player', position: '1', member_cards: [{ member_card_id_str: 'current' }], gross_scores: [5], net_scores: [4], to_par_net: [0], to_par_gross: [1] }] }] } },
  }
  const prunes: any[] = []
  const db = {
    upsertEvent: async () => ({ ok: true }),
    upsertPerformances: async () => ({ ok: true }),
    upsertResults: async () => ({ ok: true }),
    prunePerformances: async (week: number, names: string[]) => { prunes.push({ kind: 'perf', week, names }); return { ok: true } },
    pruneResults: async (week: number, importedAtIso: string, competitions: string[]) => { prunes.push({ kind: 'results', week, importedAtIso, competitions }); return { ok: true } },
    upsertSeasonPointEntries: async () => ({ ok: true }),
    pruneSeasonPointEntries: async (week: number, memberIds: string[]) => { prunes.push({ kind: 'points', week, memberIds }); return { ok: true } },
    setDurableImported: async () => ({ ok: true }),
  }
  const nowIso = '2026-09-02T20:00:00Z'
  await importOccurrence({ competitionKey: 'mens-league', resolved, adapterConfig, ggClient: fakeGg({ results }), db, nowIso })
  assert.deepEqual(prunes, [
    { kind: 'perf', week: 18, names: ['Current Player'] },
    { kind: 'results', week: 18, importedAtIso: nowIso, competitions: ['gross', 'net'] },
    { kind: 'points', week: 18, memberIds: ['current'] },
  ])
})
