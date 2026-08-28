// Seattle Cup 2026 configuration — the SINGLE source of truth for the
// competition structure. The workbook schedule + 2025 GG evidence established:
//   R1 Fourball  matches 1-12  (12)  Jackson Park   (2026-08-22)
//   R2 Scramble  matches 13-24 (12)  Bill Wright    (2026-08-23)
//   R3 Chapman   matches 25-36 (12)  West Seattle   (2026-08-29)
//   R4 Singles    matches 37-60 (24)  Interbay       (2026-08-30)
//   Round ids + courses below are the authoritative GG 2026 round list
//   (queried from /events/<eventId>/rounds), not the 2025-evidence guess.
//   total 60 matches / 60 points.
//
// R1-R3 matchSlots team-vs-team ordering is taken from the 2025 GG scopes (same
// four teams, double round-robin). R4 is different: its official 2026 Weekend 2
// pairing sheet explicitly publishes competitive opponents for matches 37-60,
// so that schedule is authoritative before GG Singles scopes populate. Once GG
// scopes contain competitive sides, GG replaces the published schedule as the
// live/final authority. Workbook ids (46256...) are NEVER used as GG ids.
//
// GG is authoritative for: match scopes, sides/players, team identity,
// per-hole gross/net, handicap dots, running match state, final result, awarded
// points, team-point totals. Planit normalizes + enriches identity + derives
// live state as fallback + cross-checks. See ground-truth report §3/§5.

import type { TeamKey, Format, RoundNumber } from './types.ts'

export interface TeamDef {
  key: TeamKey
  label: string                 // short display name ("Interbay")
  affiliation: string           // GG affiliation ("Interbay Golf Club")
  color: string                 // primary
  colorDark: string             // gradient end
  // Substrings in a GG aggregate `name` prefix or `affiliation` that identify
  // this team. The name prefix is the part before "(", e.g. "Jackson Park (...)".
  nameMatches: string[]
}

export const SEATTLE_CUP_TEAMS: Record<TeamKey, TeamDef> = {
  interbay: {
    key: 'interbay', label: 'Interbay', affiliation: 'Interbay Golf Club',
    color: '#2563eb', colorDark: '#1d4ed8',
    nameMatches: ['interbay'],
  },
  'jackson-park': {
    key: 'jackson-park', label: 'Jackson Park', affiliation: "Jackson Park Men's Golf Club",
    color: '#059669', colorDark: '#047857',
    nameMatches: ['jackson park', 'jacksonpark'],
  },
  'bill-wright': {
    key: 'bill-wright', label: 'Bill Wright', affiliation: 'Bill Wright Golf Course',
    color: '#d97706', colorDark: '#b45309',
    nameMatches: ['bill wright', 'billwright'],
  },
  'west-seattle': {
    key: 'west-seattle', label: 'West Seattle', affiliation: "West Seattle Golf Course",
    color: '#7c3aed', colorDark: '#6d28d9',
    nameMatches: ['west seattle', 'westseattle'],
  },
}

export const TEAM_LIST: TeamDef[] = Object.values(SEATTLE_CUP_TEAMS)

// Resolve a GG aggregate (name prefix + affiliation) to a team key. GG `team_id`
// is per-match-scoped and NOT a stable team identifier (Interbay appears as
// 5/6/12/14/18/21 across matches) — so we match on the human team name, never id.
export function resolveTeamKey(namePrefix: string | null, affiliation: string | null): TeamKey | null {
  const hay = `${namePrefix ?? ''} ${affiliation ?? ''}`.toLowerCase()
  for (const t of TEAM_LIST) {
    if (t.nameMatches.some((m) => hay.includes(m))) return t.key
  }
  return null
}

export interface MatchSlot {
  teamA: TeamKey
  teamB: TeamKey
}

export interface PublishedMatchPlayerDef {
  name: string
  teamKey: TeamKey
  // Optional stable GG identity. The 2026 sheet publishes names/teams; these
  // card ids reconcile those official identities to the 2026 GG tee metadata.
  // They enrich identity/logistics only and never define opponents.
  ggMemberCardId?: string
}

export interface PublishedMatchDef {
  matchNo: number
  playerA: PublishedMatchPlayerDef
  playerB: PublishedMatchPlayerDef
}

export interface RoundDef {
  round: RoundNumber
  format: Format
  course: string
  ggEventId: string
  ggRoundId: string
  date: string                 // ISO date — GG round date is authoritative; this is a fallback/hint
  matchCount: number
  matchSlots: MatchSlot[]      // team-vs-team ordering (TBD slots when GG has no scopes)
  officialPublishedMatches?: readonly PublishedMatchDef[]
}

// The 2026 GG event id is locked: 12971191003644979032. Per-round round ids are
// locked from the resolved 2026 event (ground-truth report §1).
const GG_EVENT_ID = '12971191003644979032'

// Season/event identity for out-of-band records (e.g. the persisted playoff
// resolution). The event id is the locked 2026 GG event; the season year is
// the competition year this config describes.
export const SEATTLE_CUP_EVENT_ID = GG_EVENT_ID
export const SEATTLE_CUP_SEASON_YEAR = 2026

// Team-vs-team schedule ordering per round, extracted from the 2025 GG scopes
// (same four teams, double round-robin). Each team plays 6 matches in the paired
// rounds (Fourball/Scramble/Chapman) and 12 in Singles.
const FOURBALL_SLOTS: MatchSlot[] = [
  { teamA: 'jackson-park', teamB: 'interbay' },
  { teamA: 'bill-wright', teamB: 'jackson-park' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'interbay' },
  { teamA: 'bill-wright', teamB: 'interbay' },
  { teamA: 'west-seattle', teamB: 'jackson-park' },
  { teamA: 'interbay', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'jackson-park' },
  { teamA: 'interbay', teamB: 'west-seattle' },
  { teamA: 'interbay', teamB: 'jackson-park' },
  { teamA: 'bill-wright', teamB: 'jackson-park' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
]
const SCRAMBLE_SLOTS: MatchSlot[] = [
  { teamA: 'jackson-park', teamB: 'interbay' },
  { teamA: 'bill-wright', teamB: 'jackson-park' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'interbay' },
  { teamA: 'bill-wright', teamB: 'interbay' },
  { teamA: 'jackson-park', teamB: 'west-seattle' },
  { teamA: 'bill-wright', teamB: 'interbay' },
  { teamA: 'jackson-park', teamB: 'west-seattle' },
  { teamA: 'west-seattle', teamB: 'interbay' },
  { teamA: 'interbay', teamB: 'jackson-park' },
  { teamA: 'jackson-park', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
]
const CHAPMAN_SLOTS: MatchSlot[] = [
  { teamA: 'interbay', teamB: 'jackson-park' },
  { teamA: 'jackson-park', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'interbay' },
  { teamA: 'interbay', teamB: 'bill-wright' },
  { teamA: 'jackson-park', teamB: 'west-seattle' },
  { teamA: 'interbay', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'jackson-park' },
  { teamA: 'interbay', teamB: 'west-seattle' },
  { teamA: 'jackson-park', teamB: 'interbay' },
  { teamA: 'bill-wright', teamB: 'jackson-park' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
]
// Official Seattle Cup 2026 Weekend 2 pairing sheet — Singles, Sunday
// 2026-08-30 at Interbay. This is published pre-play competitive truth, not GG
// derived data and never inferred from the four-player logistical tee groups.
export const OFFICIAL_2026_SINGLES_MATCH_SCHEDULE: readonly PublishedMatchDef[] = [
  { matchNo: 37, playerA: { teamKey: 'bill-wright', name: 'Kyuss Lis', ggMemberCardId: '12980026844442027708' }, playerB: { teamKey: 'jackson-park', name: 'Matt Lipe', ggMemberCardId: '8753204795398973396' } },
  { matchNo: 38, playerA: { teamKey: 'west-seattle', name: 'Colin Gants', ggMemberCardId: '7701317062181807796' }, playerB: { teamKey: 'interbay', name: 'Josh Scothorne', ggMemberCardId: '9805781587667740618' } },
  { matchNo: 39, playerA: { teamKey: 'jackson-park', name: 'Jeff LeCompte', ggMemberCardId: '12980010952089953881' }, playerB: { teamKey: 'bill-wright', name: 'Dan Dummer', ggMemberCardId: '7701317057417078435' } },
  { matchNo: 40, playerA: { teamKey: 'interbay', name: 'Hans Olson', ggMemberCardId: '6535737682927052566' }, playerB: { teamKey: 'west-seattle', name: 'Brendan Hopps', ggMemberCardId: '12980029250596791997' } },
  { matchNo: 41, playerA: { teamKey: 'west-seattle', name: 'Dan Barker', ggMemberCardId: '5570423914129024523' }, playerB: { teamKey: 'interbay', name: 'James Truckle', ggMemberCardId: '6433845826530863067' } },
  { matchNo: 42, playerA: { teamKey: 'bill-wright', name: 'William Weld', ggMemberCardId: '11912450738623637018' }, playerB: { teamKey: 'jackson-park', name: 'Dave Foreman', ggMemberCardId: '5570402346246105083' } },
  { matchNo: 43, playerA: { teamKey: 'west-seattle', name: 'Matt Labella', ggMemberCardId: '12980032517053638335' }, playerB: { teamKey: 'bill-wright', name: 'Stephen Carranza', ggMemberCardId: '7701317054296516248' } },
  { matchNo: 44, playerA: { teamKey: 'interbay', name: 'Luke Sulpizio', ggMemberCardId: '2925267424997566093' }, playerB: { teamKey: 'jackson-park', name: 'Jeb Garcia', ggMemberCardId: '7245868956982994703' } },
  { matchNo: 45, playerA: { teamKey: 'bill-wright', name: 'Cameron Reister', ggMemberCardId: '8753205012965910486' }, playerB: { teamKey: 'west-seattle', name: 'Kellen Sundin', ggMemberCardId: '11912458725450868256' } },
  { matchNo: 46, playerA: { teamKey: 'jackson-park', name: 'Tom Thorson', ggMemberCardId: '8753204792681064400' }, playerB: { teamKey: 'interbay', name: 'Jason Schumaker', ggMemberCardId: '2925267445700650771' } },
  { matchNo: 47, playerA: { teamKey: 'west-seattle', name: 'Aron DeFaccio', ggMemberCardId: '6645230696476468890' }, playerB: { teamKey: 'jackson-park', name: 'Kyle Miller', ggMemberCardId: '8797125602776737689' } },
  { matchNo: 48, playerA: { teamKey: 'interbay', name: 'Kevin Frary', ggMemberCardId: '9396527206504622060' }, playerB: { teamKey: 'bill-wright', name: 'Aaron Czyzewski', ggMemberCardId: '6645230698623952543' } },
  { matchNo: 49, playerA: { teamKey: 'bill-wright', name: 'Mark Than', ggMemberCardId: '7701317057685513892' }, playerB: { teamKey: 'jackson-park', name: 'Ryan Gutierrez', ggMemberCardId: '5570584009034982932' } },
  { matchNo: 50, playerA: { teamKey: 'west-seattle', name: 'Pat DiStefano', ggMemberCardId: '5570422733717661194' }, playerB: { teamKey: 'interbay', name: 'Sean Brill', ggMemberCardId: '3288116518511994529' } },
  { matchNo: 51, playerA: { teamKey: 'jackson-park', name: 'Cecil Grant', ggMemberCardId: '10860015694435608095' }, playerB: { teamKey: 'bill-wright', name: 'Michael Grummer', ggMemberCardId: '5570584008598775315' } },
  { matchNo: 52, playerA: { teamKey: 'interbay', name: 'Sean Dowling', ggMemberCardId: '10968682049690429261' }, playerB: { teamKey: 'west-seattle', name: 'Joey Bates', ggMemberCardId: '10860027740208260646' } },
  { matchNo: 53, playerA: { teamKey: 'bill-wright', name: 'Cameron Duncan', ggMemberCardId: '9805781613102000103' }, playerB: { teamKey: 'interbay', name: 'Josh Benner', ggMemberCardId: '2925267413723276873' } },
  { matchNo: 54, playerA: { teamKey: 'jackson-park', name: 'Mark Ohrenschall', ggMemberCardId: '10860010827767899673' }, playerB: { teamKey: 'west-seattle', name: 'Brian Sherick', ggMemberCardId: '6645230698355517086' } },
  { matchNo: 55, playerA: { teamKey: 'west-seattle', name: 'Milo Stover', ggMemberCardId: '10860024479254341154' }, playerB: { teamKey: 'bill-wright', name: 'Matthew Palmer', ggMemberCardId: '7701317056007792286' } },
  { matchNo: 56, playerA: { teamKey: 'interbay', name: 'Bart Sanderson', ggMemberCardId: '5460679727872239426' }, playerB: { teamKey: 'jackson-park', name: 'Dylan Fitzgerald', ggMemberCardId: '10860012332684174875' } },
  { matchNo: 57, playerA: { teamKey: 'bill-wright', name: 'Ted Provins', ggMemberCardId: '7701317056846653089' }, playerB: { teamKey: 'west-seattle', name: 'Nisvet Talic', ggMemberCardId: '5570430729000609297' } },
  { matchNo: 58, playerA: { teamKey: 'jackson-park', name: 'Adam Fierro', ggMemberCardId: '12980010874377889367' }, playerB: { teamKey: 'interbay', name: 'Henry Mills', ggMemberCardId: '2925267429225424553' } },
  { matchNo: 59, playerA: { teamKey: 'west-seattle', name: 'Mark Sullivan', ggMemberCardId: '7701317060839630511' }, playerB: { teamKey: 'jackson-park', name: 'Grant Waterman', ggMemberCardId: '7367709487051859929' } },
  { matchNo: 60, playerA: { teamKey: 'interbay', name: 'Nathan DePinto', ggMemberCardId: '11446434376800298672' }, playerB: { teamKey: 'bill-wright', name: 'Tyson Than', ggMemberCardId: '10868631878961751933' } },
]

const SINGLES_SLOTS: MatchSlot[] = OFFICIAL_2026_SINGLES_MATCH_SCHEDULE.map((match) => ({
  teamA: match.playerA.teamKey,
  teamB: match.playerB.teamKey,
}))

export const SEATTLE_CUP_ROUNDS: Record<RoundNumber, RoundDef> = {
  1: {
    round: 1, format: 'fourball', course: 'Jackson Park',
    ggEventId: GG_EVENT_ID, ggRoundId: '12971191129037891140',
    date: '2026-08-22', matchCount: 12, matchSlots: FOURBALL_SLOTS,
  },
  2: {
    round: 2, format: 'scramble', course: 'Bill Wright',
    ggEventId: GG_EVENT_ID, ggRoundId: '12971191132628215365',
    date: '2026-08-23', matchCount: 12, matchSlots: SCRAMBLE_SLOTS,
  },
  3: {
    round: 3, format: 'chapman', course: 'West Seattle',
    ggEventId: GG_EVENT_ID, ggRoundId: '12971191135178352198',
    date: '2026-08-29', matchCount: 12, matchSlots: CHAPMAN_SLOTS,
  },
  4: {
    round: 4, format: 'singles', course: 'Interbay',
    ggEventId: GG_EVENT_ID, ggRoundId: '12971191137325835847',
    date: '2026-08-30', matchCount: 24, matchSlots: SINGLES_SLOTS,
    officialPublishedMatches: OFFICIAL_2026_SINGLES_MATCH_SCHEDULE,
  },
}

export const ROUND_LIST: RoundDef[] = Object.values(SEATTLE_CUP_ROUNDS)

// Every Seattle Cup match awards exactly one tournament point. These values
// are derived from the authoritative 2026 match graph so the tournament-wide
// pool (60) and single-team ceiling (30) cannot drift apart.
export const TOTAL_TOURNAMENT_POINTS = ROUND_LIST.reduce(
  (total, round) => total + round.matchSlots.length,
  0,
)

export const MAX_TEAM_POINTS = TEAM_LIST.reduce((maximum, team) => {
  const matches = ROUND_LIST.reduce(
    (total, round) => total + round.matchSlots.filter(
      (slot) => slot.teamA === team.key || slot.teamB === team.key,
    ).length,
    0,
  )
  return Math.max(maximum, matches)
}, 0)

// matchNo is schedule-stable: R1 1-12, R2 13-24, R3 25-36, R4 37-60.
export function matchNoFor(round: RoundNumber, slotIndex: number): number {
  const base = round === 1 ? 0 : round === 2 ? 12 : round === 3 ? 24 : 36
  return base + slotIndex + 1
}

export function getRoundDef(round: number): RoundDef | null {
  return SEATTLE_CUP_ROUNDS[round as RoundNumber] ?? null
}
