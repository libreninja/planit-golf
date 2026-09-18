import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createReconcileOps, reconcileCompetition, reconcileOccurrenceOnDemand } from '../lib/competition/reconcile/reconcile.ts'

// Exercise production candidate reads, discovery, the existing importer, and
// season rebuild together. Only the database transport and GG HTTP are faked.
function database() {
  const tables: Record<string, any[]> = {
    igc_league_events: [{ id: 'event', league_key: 'mens', week_number: 22, event_name: 'Week 22', event_date: '2026-09-08',
      event_format: 'individual', discovery_state: 'discovered', gg_event_id: 'E', gg_round_id: 'R',
      gg_gross_tournament_id: 'G', gg_net_tournament_id: 'N', source_finalized_at: null, durable_imported_at: null }],
    igc_league_results: [], igc_league_performances: [], igc_league_season_point_entries: [], igc_league_season_points: [],
    igc_league_members: [],
  }
  let failure: { table: string; operation: string } | null = null
  const writes: string[] = []
  let nextId = 0
  const client = {
    rpc: async () => ({ error: null }),
    from(table: string) {
      let operation = 'read', payload: any, keys: string[] = [], first = false, start = 0, end = Infinity
      const filters: Array<(row: any) => boolean> = []
      const query: any = {
        select() { return query }, order() { return query }, limit(n: number) { end = n - 1; return query },
        range(a: number, b: number) { start = a; end = b; return query },
        eq(k: string, v: any) { filters.push((r) => r[k] === v); return query },
        in(k: string, v: any[]) { filters.push((r) => v.includes(r[k])); return query },
        lt(k: string, v: any) { filters.push((r) => r[k] < v); return query },
        match(values: Record<string, any>) { for (const [k, v] of Object.entries(values)) query.eq(k, v); return query },
        maybeSingle() { first = true; return query }, single() { first = true; return query },
        update(p: any) { operation = 'update'; payload = p; return query },
        upsert(p: any[], opts: any) { operation = 'upsert'; payload = p; keys = opts.onConflict.split(','); return query },
        insert(p: any) { operation = 'insert'; payload = Array.isArray(p) ? p : [p]; return query },
        delete() { operation = 'delete'; return query },
        then(resolve: any, reject: any) {
          return Promise.resolve().then(() => {
            if (failure?.table === table && failure.operation === operation) return { data: null, error: { message: 'injected failure' } }
            const matches = (r: any) => filters.every((f) => f(r))
            let rows = tables[table].filter(matches)
            if (operation !== 'read') writes.push(`${table}:${operation}`)
            if (operation === 'update') rows.forEach((r) => Object.assign(r, payload))
            if (operation === 'delete') tables[table] = tables[table].filter((r) => !matches(r))
            if (operation === 'upsert' || operation === 'insert') {
              rows = payload.map((p: any) => {
                const old = operation === 'upsert' && tables[table].find((r) => keys.every((k) => r[k] === p[k]))
                if (old) { Object.assign(old, p); return old }
                const row = { id: String(++nextId), ...p }; tables[table].push(row); return row
              })
            }
            const data = rows.slice(start, end + 1).map((r) => ({ ...r }))
            return { data: first ? data[0] ?? null : data, error: null }
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
  return { client, tables, writes, fail: (table: string, operation: string) => { failure = { table, operation } }, recover: () => { failure = null } }
}

function tournament(mode: 'gross' | 'net', phase: string) {
  const scored = phase === 'awards' || (phase === 'gross-only' && mode === 'gross')
  const cash = scored && phase !== 'points-only'
  const scopes = [1, 2, 3].map((flight) => ({ name: phase === 'scores' ? 'Overall' : `Flight ${flight}`,
    aggregates: [0, 1].map((player) => {
      const id = `${flight}-${player}`, winner = mode === 'gross' ? player === 0 : player === 1
      return { name: `Player ${id}`, member_cards: [{ member_card_id_str: id }],
        position: scored ? winner ? '1' : null : player + 1,
        points: scored && winner ? 500 : null, purse: cash && winner ? '$50.00' : null,
        gross_scores: Array(9).fill(4), net_scores: Array(9).fill(3),
        scorecard_statuses: [{ status: 'completed' }],
      }
    }) }))
  return { event: { scopes, season_points: scored ? [1, 2, 3].map((f) => ({ member_card_id: `${f}-${mode === 'gross' ? 0 : 1}`, total_points: 500 })) : [] } }
}

async function harness() {
  const db = database()
  let phase = 'scores', calls = 0
  const ops = await createReconcileOps({ supabase: db.client, ggClient: async (endpoint) => {
    calls++
    if (endpoint.endsWith('/rounds')) return [{ round: { id: 'R', date: '2026-09-08' } }]
    if (endpoint.endsWith('/tournaments')) return [{ id: 'G', name: 'Individual Gross' }, { id: 'N', name: 'Individual Net' }]
    if (endpoint.endsWith('/courses')) return {}
    if (endpoint.endsWith('/G.json')) return tournament('gross', phase)
    if (endpoint.endsWith('/N.json')) return tournament('net', phase)
    throw new Error(`unexpected endpoint ${endpoint}`)
  } })
  // Special rows are unrelated to this bounded lifecycle.
  ops.precreateSpecialOccurrences = undefined
  let minute = 0
  const run = () => reconcileCompetition({ competitionKey: 'mens-league', deadlineMs: Date.now() + 60_000,
    nowIso: `2026-09-18T12:${String(minute += 2).padStart(2, '0')}:00Z`, ops })
  return { db, ops, run, setPhase: (p: string) => { phase = p }, calls: () => calls }
}

test('scores -> official flights -> pending awards -> later awards and placements -> complete without rewrites', async () => {
  const h = await harness()
  assert.equal((await h.run()).imported, 1)
  assert.equal((await h.ops.listEvents('mens-league'))[0].awaiting_official_flights, true)
  h.setPhase('flights')
  assert.equal((await h.run()).imported, 1)
  let e = (await h.ops.listEvents('mens-league'))[0]
  assert.equal(e.awaiting_official_flights, false)
  assert.equal(e.awaiting_awards, true)
  assert.equal((await h.run()).imported, 1, 'official flights without awards remain eligible')
  h.setPhase('gross-only')
  await h.run()
  assert.equal((await h.ops.listEvents('mens-league'))[0].awaiting_awards, true, 'one scoring mode cannot close the week')
  h.setPhase('awards')
  const repaired = await reconcileOccurrenceOnDemand('mens-league', 22, '2026-09-18T12:12:00Z', h.ops)
  assert.equal(repaired.action, 'imported')
  e = (await h.ops.listEvents('mens-league'))[0]
  assert.equal(e.awaiting_awards, false)
  assert.equal(h.db.tables.igc_league_results.length, 12)
  assert.equal(h.db.tables.igc_league_performances.length, 6)
  assert.equal(h.db.tables.igc_league_season_point_entries.length, 6)
  assert.equal(h.db.tables.igc_league_season_points.reduce((sum, r) => sum + r.total_points, 0), 3000)
  const nonwinner = h.db.tables.igc_league_results.find((r) => r.member_card_id === '1-1' && r.competition === 'gross')
  assert.equal(nonwinner.position_label, null, 'late authoritative placement replaces early score ranking')
  assert.equal(nonwinner.points, null, 'non-winner null preserved')
  const before = JSON.stringify(h.db.tables), calls = h.calls(), writes = h.db.writes.length
  assert.equal((await h.run()).skipped, 1)
  assert.equal(h.calls(), calls)
  assert.equal(h.db.writes.length, writes)
  assert.equal(JSON.stringify(h.db.tables), before)
})

for (const [table, operation] of [['igc_league_season_point_entries', 'upsert'], ['igc_league_season_points', 'insert'], ['igc_league_season_points', 'delete'], ['igc_league_events', 'update'], ['igc_league_performances', 'read'], ['igc_league_results', 'read']]) {
  test(`failed ${table} ${operation} does not falsely complete awards and is retryable`, async () => {
    const h = await harness()
    h.setPhase('flights'); await h.run()
    const durable = h.db.tables.igc_league_events[0].durable_imported_at
    h.setPhase('awards'); h.db.fail(table, operation)
    if (table === 'igc_league_results' && operation === 'read') await assert.rejects(h.run, /injected failure/)
    else assert.equal((await h.run()).errors.length, 1)
    assert.equal(h.db.tables.igc_league_events[0].durable_imported_at, durable)
    h.db.recover()
    assert.equal((await h.run()).imported, 1)
    assert.equal((await h.ops.listEvents('mens-league'))[0].awaiting_awards, false)
    assert.equal((await h.run()).skipped, 1)
  })
}

test('on-demand eligibility reads only its requested week', async () => {
  const h = await harness()
  h.db.tables.igc_league_events.push({ ...h.db.tables.igc_league_events[0], id: 'other', week_number: 21 })
  assert.deepEqual((await h.ops.listEvents('mens-league', [22])).map((e) => e.week_number), [22])
  assert.deepEqual(await h.ops.listEvents('mens-league', [999]), [])
})
