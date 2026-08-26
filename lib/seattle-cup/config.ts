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
// The matchSlots team-vs-team ordering is taken from the 2025 GG scopes (same
// four teams, double round-robin) — the only concrete schedule evidence we
// have. When 2026 scopes populate, real data replaces these slots. The slots
// exist so pre-play (TBD) rendering shows the correct structure, NOT so they
// override real GG pairings. Workbook ids (46256...) are NEVER used as GG ids.
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

export interface RoundDef {
  round: RoundNumber
  format: Format
  course: string
  ggEventId: string
  ggRoundId: string
  date: string                 // ISO date — GG round date is authoritative; this is a fallback/hint
  matchCount: number
  matchSlots: MatchSlot[]      // team-vs-team ordering (TBD slots when GG has no scopes)
}

// The 2026 GG event id is locked: 12971191003644979032. Per-round round ids are
// locked from the resolved 2026 event (ground-truth report §1).
const GG_EVENT_ID = '12971191003644979032'

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
const SINGLES_SLOTS: MatchSlot[] = [
  { teamA: 'interbay', teamB: 'bill-wright' },
  { teamA: 'jackson-park', teamB: 'west-seattle' },
  { teamA: 'bill-wright', teamB: 'interbay' },
  { teamA: 'jackson-park', teamB: 'west-seattle' },
  { teamA: 'west-seattle', teamB: 'jackson-park' },
  { teamA: 'interbay', teamB: 'bill-wright' },
  { teamA: 'jackson-park', teamB: 'interbay' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
  { teamA: 'interbay', teamB: 'jackson-park' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
  { teamA: 'jackson-park', teamB: 'bill-wright' },
  { teamA: 'west-seattle', teamB: 'interbay' },
  { teamA: 'bill-wright', teamB: 'interbay' },
  { teamA: 'west-seattle', teamB: 'jackson-park' },
  { teamA: 'interbay', teamB: 'bill-wright' },
  { teamA: 'jackson-park', teamB: 'west-seattle' },
  { teamA: 'interbay', teamB: 'west-seattle' },
  { teamA: 'jackson-park', teamB: 'bill-wright' },
  { teamA: 'jackson-park', teamB: 'interbay' },
  { teamA: 'bill-wright', teamB: 'west-seattle' },
  { teamA: 'interbay', teamB: 'jackson-park' },
  { teamA: 'west-seattle', teamB: 'bill-wright' },
  { teamA: 'bill-wright', teamB: 'jackson-park' },
  { teamA: 'west-seattle', teamB: 'interbay' },
]

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
  },
}

export const ROUND_LIST: RoundDef[] = Object.values(SEATTLE_CUP_ROUNDS)

// matchNo is schedule-stable: R1 1-12, R2 13-24, R3 25-36, R4 37-60.
export function matchNoFor(round: RoundNumber, slotIndex: number): number {
  const base = round === 1 ? 0 : round === 2 ? 12 : round === 3 ? 24 : 36
  return base + slotIndex + 1
}

export function getRoundDef(round: number): RoundDef | null {
  return SEATTLE_CUP_ROUNDS[round as RoundNumber] ?? null
}