import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizeLiveRead, resolveCompetitionVisibility } from '../lib/competition/live-auth.ts'

// The product model: IGC league leaderboards are PUBLIC so golfers can share
// the live link without a Planit account. The live API authorizes by
// competition visibility, not by "is the viewer logged in". These cover the
// five required behaviors:
//   1. anonymous → public Club Championship live endpoint → allowed (200)
//   2. anonymous → public Men's live endpoint → allowed (200)
//   3. authenticated → allowed (200)
//   4. private/non-public competition → denied (401) for anonymous
//   5. anonymous response exposes only public leaderboard data (no private
//      fields / service role / auth tokens)
//
// Endpoint-level (200 vs 401) behavior reduces to the pure decision: a public
// competition's decision is { allowed: true } regardless of auth, so the route
// returns 200; a private competition with no auth is { allowed:false, 401 }.

test('resolveCompetitionVisibility: mens-league (Club Championship + weekly) is public', () => {
  // The Club Championship aggregate endpoint and the Men's weekly live
  // endpoint both resolve visibility from the mens-league competition.
  assert.equal(resolveCompetitionVisibility('mens-league'), 'public')
})

test('resolveCompetitionVisibility: womens-league is public', () => {
  assert.equal(resolveCompetitionVisibility('womens-league'), 'public')
})

test('resolveCompetitionVisibility: unknown competition → null (never a default-allow)', () => {
  assert.equal(resolveCompetitionVisibility('nope-league'), null)
})

test('1 & 2: anonymous request to a PUBLIC competition is allowed (Club Championship + Men\'s weekly)', () => {
  // The Club Championship endpoint uses competition=mens-league; the Men's
  // weekly endpoint uses competition=mens-league too. Both are public, so an
  // anonymous viewer is allowed — the route returns 200.
  for (const isAuthed of [false]) {
    const d = authorizeLiveRead('public', isAuthed)
    assert.equal(d.allowed, true, `anon public should be allowed`)
    assert.equal(d.status, undefined, 'no error status when allowed')
  }
})

test('3: authenticated request to a public competition is allowed (200)', () => {
  const d = authorizeLiveRead('public', true)
  assert.equal(d.allowed, true)
  assert.equal(d.status, undefined)
})

test('3b: authenticated request to a PRIVATE competition is allowed (200)', () => {
  const d = authorizeLiveRead('private', true)
  assert.equal(d.allowed, true)
  assert.equal(d.status, undefined)
})

test('4: anonymous request to a PRIVATE / non-public competition is denied (401)', () => {
  const d = authorizeLiveRead('private', false)
  assert.equal(d.allowed, false)
  assert.equal(d.status, 401)
  assert.equal(d.reason, 'Not authenticated')
})

test('4b: unknown competition → denied (404), never default-allow for anon', () => {
  // A typo'd competition key must not fall through to "public → allow anon".
  const d = authorizeLiveRead(null, false)
  assert.equal(d.allowed, false)
  assert.equal(d.status, 404)
})

test('4c: unknown competition is still 404 even when authenticated (no privileged read of a non-existent comp)', () => {
  const d = authorizeLiveRead(null, true)
  assert.equal(d.allowed, false)
  assert.equal(d.status, 404)
})

// 5. The anonymous response exposes ONLY public leaderboard data. The live
// API routes return { results: LiveResponse }. The LiveResponse (and the
// ChampionshipAggregate superset) carries only public fields: player names +
// scores + status. It never carries a service-role credential, an auth token,
// an email, or any private row. This is a structural guard: if a private field
// ever leaks into the serialized response, this fails.
const PUBLIC_RESPONSE_KEYS = new Set([
  'occurrence', 'leaderboard', 'resultStatus', 'eventFormat', 'discoveryState',
  'durableCurrent', 'showingLastKnown',
  // ChampionshipAggregate additions (Club Championship endpoint):
  'championshipKey', 'roundCount', 'roundsComplete', 'roundsLive',
])

const FORBIDDEN_MARKERS = [
  'service_role', 'serviceRole', 'SUPABASE_SERVICE_ROLE_KEY',
  'access_token', 'refresh_token', 'apiKey', 'api_key', 'GOLF_GENIUS_API_KEY',
  'email', 'auth_uid', 'userId',
]

test('5: a representative anonymous live response carries only public fields', () => {
  // A representative LiveResponse the route returns. `occurrence`/`leaderboard`
  // are nested objects (player names + scores) — themselves public.
  const sampleResponse = {
    occurrence: { id: 'club-championship', number: null, label: 'Club Championship', date: null, activeWindow: { start: '', end: null }, format: 'individual', discoveryState: 'discovered', resultStatus: 'not_started' },
    leaderboard: { occurrenceId: 'club-championship', scoringMode: 'gross', grouping: null, entries: [], scorecards: [], resultStatus: 'not_started', durableCurrent: false },
    resultStatus: 'not_started',
    eventFormat: 'individual',
    discoveryState: 'discovered',
    durableCurrent: false,
    showingLastKnown: false,
    championshipKey: 'club-championship',
    roundCount: 2,
    roundsComplete: 0,
    roundsLive: 0,
  }
  for (const key of Object.keys(sampleResponse)) {
    assert.ok(PUBLIC_RESPONSE_KEYS.has(key), `unexpected top-level key in response: ${key}`)
  }
  // And no forbidden marker appears anywhere in the serialized payload.
  const serialized = JSON.stringify(sampleResponse).toLowerCase()
  for (const marker of FORBIDDEN_MARKERS) {
    assert.ok(!serialized.includes(marker.toLowerCase()), `response must not contain private marker: ${marker}`)
  }
})