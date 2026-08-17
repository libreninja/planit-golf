// Server-side client for the planit-ai scouting backend (HTTP API).
// planit.golf calls this from Server Components / Server Actions only — never
// from the browser — so the shared secret and captain identity stay
// server-side. See docs/planit-ai-http-api.md (in the planit-ai repo).
//
// Auth: PLANIT_AI_API_SECRET is sent as x-planit-api-secret on every call.
// Actor: write calls include x-planit-actor (the authenticated captain's
// email) so planit-ai records the recorder (author/recorded_by) per ADR-0008.

const BASE = process.env.PLANIT_AI_API_URL || 'http://localhost:3001'
const SECRET = process.env.PLANIT_AI_API_SECRET || ''

export interface ScoutingBoardAvailability {
  perSession: { sessionId: string; status: string | null }[]
  fullyAvailableCount: number
  partiallyAvailableCount: number
  unavailableCount: number
  pendingCount: number
  noResponseCount: number
  responded: boolean
}

export interface ScoutingBoardRow {
  playerId: string
  displayName: string | null
  ghinNumber: string | null
  entrySource: string
  sourceRank: number | null
  currentRank: number | null
  totalPoints: number | null
  numberOfEvents: number | null
  numberOfWins: number | null
  topTenFinishes: number | null
  currentHandicap: { value: number | null; source: string | null; effectiveDate: string | null; isStale: boolean }
  stage?: string | null
  candidateState: string
  availability: ScoutingBoardAvailability
  tags?: string[]
  // Evidence fields (present in the board JSON; used by the Matchup Room to
  // surface real Men's League + Seattle Cup history with sample sizes).
  seattleCupCount?: number | null
  seattleCupYears?: string[] | null
  pointsBehindLeader?: number | null
}

export interface ScoutingSession {
  id: string
  sessionDate: string | null
  format: string | null
  course: string | null
}

export interface ScoutingNote {
  id: string
  category: string | null
  body: string
  author: string | null
  attributedTo: string | null
  source: string
  updatedAt: string
}

export interface ScoutingCard {
  playerId: string
  displayName: string | null
  ghinNumber: string | null
  email: string | null
  currentLeague: {
    currentRank: number | null
    totalPoints: number | null
    numberOfEvents: number | null
    numberOfWins: number | null
    topTenFinishes: number | null
    pointsBehindLeader: number | null
    lastSyncedAt: string
  } | null
  currentHandicap: { value: number | null; source: string | null; effectiveDate: string | null; isStale: boolean; observations: Array<{ id: string; source: string; handicapIndex: number | null; membershipStatus: string | null; currentYearScoreCount: number | null; effectiveDate: string | null }> }
  baseline: { determinable: boolean; active: boolean | null; currentYearScoreCount: number | null; meetsMinimum: boolean | null }
  seattleCupHistory: { count: number; years: string[]; registrations: Array<{ eventName: string | null; seasonName: string | null }> }
  availability: {
    sessions: Array<{ sessionId: string; date: string | null; format: string | null; course: string | null; status: string | null }>
    summary: { fully: number; partial: number; unavailable: number; pending: number; none: number }
  }
  notes: ScoutingNote[]
  tags: string[]
  candidateState: string
  provenance: { asOf: string; sources: string[] }
}

export interface AddablePlayer {
  sourceMemberCardId: string
  displayName: string | null
  currentRank: number | null
}

// ---- Seattle Cup roster + matchup draft ----
// These mirror the JSON shapes returned by planit-ai's /roster, /rounds and
// /matchups endpoints. The locked roster snapshot and the deterministic handicap
// consequence are read verbatim; the engine arithmetic lives in planit-ai and is
// never recomputed in the browser.

export type MatchStatus = 'matched' | 'unmatched' | 'ambiguous' | 'name_mismatch'

export interface RosterImportRecord {
  id: string
  competitionId: string
  seasonName: string
  sourceFile: string | null
  sourceHash: string | null
  rowCount: number
  summary: unknown
  status: 'ready' | 'needs_review' | 'failed'
  importedAt: string
  importedBy: string | null
}

export interface RosterPlayer {
  id: string
  importId: string
  competitionId: string
  seasonName: string
  team: string
  ghinNumber: string | null
  displayName: string
  sourceName: string
  isPro: boolean
  handicapIndex: number | null
  interbayHdcp: number | null
  jacksonParkHdcp: number | null
  billWrightHdcp: number | null
  westSeattleHdcp: number | null
  chapL: number | null
  chapH: number | null
  resolvedPlayerId: string | null
  resolvedSourceKey: string | null
  matchStatus: MatchStatus
  sourceRowNumber: number | null
  sourceRowJson: unknown
  createdAt: string
}

export interface RosterSnapshot {
  importRecord: RosterImportRecord | null
  players: RosterPlayer[]
}

export interface RoundDescriptor {
  round: number
  format: string
  course: string
  courseLabel: string
  date: string
  teamSize: 1 | 2
  slots: number
  formula: string
  handicapField: 'interbayHdcp' | 'jacksonParkHdcp' | 'billWrightHdcp' | 'westSeattleHdcp'
}

// A club's selected round lineup — the 12 amateurs they field for a paired
// round (R1–R3). `playerIds` are roster_player ids; `complete` is true iff the
// lineup holds exactly `required` (12) players. A provisional (<12) lineup is
// allowed for planning; the matchup draft requires a complete lineup.
export interface RoundLineup {
  team: string
  round: number
  playerIds: string[]
  required: number
  complete: boolean
}

export type PutUp = 'us' | 'them'

export interface MatchupPlayerRef {
  rosterPlayerId: string
  ghin: string | null
  name: string
}

export interface MatchupSlot {
  id: string
  competitionId: string
  seasonName: string
  team: string
  round: number
  position: number
  format: string
  course: string
  our: MatchupPlayerRef[]
  opponentTeam: string | null
  opponent: MatchupPlayerRef[] | null
  putUp: PutUp | null
  selectionOrder: number | null
  rationale: string | null
  locked: boolean
  updatedAt: string
  updatedBy: string | null
}

export interface PlayerStrokeResult {
  player: { id: string; displayName: string; ghinNumber: string | null; isPro: boolean }
  courseHandicap: number | null
  strokesReceived: number | null
  gives: boolean
}

export interface SideStrokeResult {
  members: { player: { id: string; displayName: string; ghinNumber: string | null; isPro: boolean }; courseHandicap: number | null }[]
  teamHandicap: number | null
  strokesReceived: number | null
  gives: boolean
}

export interface MatchHandicapResult {
  round: { round: number; format: string; course: string; teamSize: 1 | 2 }
  mode: 'per_player' | 'per_side'
  players: PlayerStrokeResult[]
  sides: SideStrokeResult[]
  lowest: number | null
  complete: boolean
  note: string | null
}

export interface MatchupDraftInput {
  team: string
  round: number
  position: number
  ourPlayerIds: string[]
  opponentTeam?: string | null
  opponentPlayerIds?: string[] | null
  putUp?: PutUp | null
  selectionOrder?: number | null
  rationale?: string | null
  locked?: boolean
}

export interface SavedMatchup {
  slot: MatchupSlot
  consequence: MatchHandicapResult | null
}

// ---- Seattle Cup RESPOND analysis (deterministic, exhaustive) ----
// The opponent exposes a pair; the backend enumerates every legal pair from our
// remaining lineup with the exact signed handicap consequence, ordered
// most-favorable-first. Evidence is attached for display only; it never reorders.

export interface RespondPlayerRef {
  rosterPlayerId: string
  displayName: string
  ghinNumber: string | null
  isPro: boolean
  courseHandicap: number | null
  resolvedPlayerId: string | null
}

export interface RespondAnalysisCandidate {
  our: RespondPlayerRef[]
  consequence: number | null
  direction: { direction: 'receive' | 'even' | 'give'; strokes: number; label: string } | null
  ourValue: number | null
  theirValue: number | null
  internalSpread: number | null
}

export interface RespondAnalysis {
  team: string
  round: number
  opponentTeam: string
  theirExposed: RespondPlayerRef[]
  theirValue: number | null
  ourRemainingCount: number
  candidates: RespondAnalysisCandidate[]
}

// ---- Seattle Cup PUT-UP analysis (deterministic, exhaustive, minimax) ----
// We put up a pair; the opponent counters from their remaining lineup. For each
// put-up pair the backend enumerates every legal opponent counter, preserves the
// full counter matrix, and summarizes exploitability. Ordered by maximin
// (worst-case robustness); no synthetic score, no win probabilities.

export interface PutUpPlayerRef {
  rosterPlayerId: string
  displayName: string
  ghinNumber: string | null
  isPro: boolean
  courseHandicap: number | null
  resolvedPlayerId: string | null
}

export interface PutUpCounterRef {
  their: PutUpPlayerRef[]
  consequence: number | null
  theirValue: number | null
}

export interface PutUpAnalysisCandidate {
  our: PutUpPlayerRef[]
  ourValue: number | null
  responseCount: number
  bestForUs: number | null
  worstForUs: number | null
  worstCounter: PutUpPlayerRef[] | null
  median: number | null
  rangeMin: number | null
  rangeMax: number | null
  counts: { receive: number; even: number; give: number; receive2plus: number; give2plus: number }
  pcts: { receive: number; even: number; give: number; receive2plus: number; give2plus: number }
  responses: PutUpCounterRef[]
}

export interface PutUpAnalysis {
  team: string
  round: number
  opponentTeam: string
  ourRemainingCount: number
  oppRemainingCount: number
  candidates: PutUpAnalysisCandidate[]
}

// Error thrown by every planit-ai call that does not resolve cleanly. Carries
// enough metadata for callers to distinguish the expected "backend not
// reachable / not configured" case (which degrades to a friendly notice) from
// real programming defects (which should surface so they stay visible in logs).
export class PlanitAiError extends Error {
  readonly status?: number
  readonly unreachable?: boolean
  constructor(message: string, opts?: { status?: number; unreachable?: boolean }) {
    super(message)
    this.name = 'PlanitAiError'
    this.status = opts?.status
    this.unreachable = opts?.unreachable
  }
}

// True when the scouting backend could not be reached or explicitly reports it
// is down. This is the expected, non-alarming state when PLANIT_AI_API_URL is
// unset (BASE defaults to localhost:3001 → connection refused) or the backend
// is not yet deployed/reachable. HTTP-level defects (4xx/500, JSON parse
// failures) are NOT "unavailable" — callers let those throw so real defects
// stay visible in server logs rather than being masked as "temporarily down".
export function isBackendUnavailable(err: unknown): boolean {
  if (!(err instanceof PlanitAiError)) return false
  if (err.unreachable) return true
  // 502/503/504 = gateway/upstream down = transient, treat as unavailable.
  return err.status === 502 || err.status === 503 || err.status === 504
}

// True when the backend responded that the resource does not exist (e.g. an
// unknown player id). Distinct from "unavailable" — the backend is fine.
export function isNotFound(err: unknown): boolean {
  return err instanceof PlanitAiError && err.status === 404
}

async function req<T = unknown>(path: string, opts: RequestInit = {}, actor?: string): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  }
  if (SECRET) headers['x-planit-api-secret'] = SECRET
  if (actor) headers['x-planit-actor'] = actor
  if (opts.body) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${BASE}/api/scouting${path}`, {
      ...opts,
      headers,
      cache: 'no-store',
    })
  } catch (e) {
    // Network-level failure (DNS, connection refused, timeout) — no HTTP
    // response was received. This is the expected state when the backend URL
    // is unset or the service is not deployed/reachable.
    throw new PlanitAiError(`planit-ai ${path} -> unreachable (${(e as Error).message})`, {
      unreachable: true,
    })
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new PlanitAiError(`planit-ai ${path} -> ${res.status} ${text}`, {
      status: res.status,
    })
  }
  return res.json() as Promise<T>
}

// ---- Reads ----
export const getBoard = () => req<ScoutingBoardRow[]>('/board')
export const getSessions = () => req<ScoutingSession[]>('/sessions')
export const getDistribution = () => req<{ label: string; count: number }[]>('/distribution')
export const getNoteCategories = () => req<string[]>('/note-categories')
export const getAddablePlayers = () => req<AddablePlayer[]>('/addable-players')
export const getCard = (id: string) => req<ScoutingCard>(`/players/${encodeURIComponent(id)}`)
// Seattle Cup roster + rounds + matchup draft reads.
export const getRoster = (season?: string) =>
  req<RosterSnapshot>(`/roster${season ? `?season=${encodeURIComponent(season)}` : ''}`)
export const getRounds = () => req<RoundDescriptor[]>('/rounds')
export const getMatchups = (team: string, round: number) =>
  req<MatchupSlot[]>(`/matchups?team=${encodeURIComponent(team)}&round=${round}`)
export const getRoundLineup = (team: string, round: number) =>
  req<RoundLineup>(`/lineup?team=${encodeURIComponent(team)}&round=${round}`)

// ---- Writes (actor = authenticated captain email) ----
export function createNote(playerId: string, input: { body: string; category?: string | null; attributedTo?: string | null; context?: string | null }, actor: string) {
  return req(`/players/${encodeURIComponent(playerId)}/notes`, { method: 'POST', body: JSON.stringify(input) }, actor)
}
export function updateNote(noteId: string, input: { body: string; category?: string | null; attributedTo?: string | null; context?: string | null }, actor: string) {
  return req(`/notes/${encodeURIComponent(noteId)}`, { method: 'PATCH', body: JSON.stringify(input) }, actor)
}
export function deleteNote(noteId: string, actor: string) {
  return req(`/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' }, actor)
}
export function addTag(playerId: string, tag: string, actor: string) {
  return req(`/players/${encodeURIComponent(playerId)}/tags`, { method: 'POST', body: JSON.stringify({ tag }) }, actor)
}
export function removeTag(playerId: string, tag: string, actor: string) {
  return req(`/players/${encodeURIComponent(playerId)}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }, actor)
}
export function setAvailability(playerId: string, sessionId: string, status: string, actor: string) {
  return req(`/players/${encodeURIComponent(playerId)}/availability`, { method: 'PUT', body: JSON.stringify({ sessionId, status }) }, actor)
}
export function clearAvailability(playerId: string, sessionId: string, actor: string) {
  return req(`/players/${encodeURIComponent(playerId)}/availability`, { method: 'DELETE', body: JSON.stringify({ sessionId }) }, actor)
}
export function setCandidateState(playerId: string, state: string, actor: string) {
  return req(`/players/${encodeURIComponent(playerId)}/candidate-state`, { method: 'PUT', body: JSON.stringify({ state }) }, actor)
}
export function addCaptainCandidate(sourceMemberCardId: string, actor: string) {
  return req('/candidates', { method: 'POST', body: JSON.stringify({ sourceMemberCardId }) }, actor)
}

// ---- Seattle Cup matchup draft writes (actor = authenticated captain email) ----
export function saveMatchup(input: MatchupDraftInput, actor: string) {
  return req<SavedMatchup>('/matchups', { method: 'POST', body: JSON.stringify(input) }, actor)
}
export function previewMatchup(team: string, round: number, ourPlayerIds: string[], opponentPlayerIds: string[] | null) {
  return req<{ consequence: MatchHandicapResult | null }>('/matchups/preview', {
    method: 'POST',
    body: JSON.stringify({ team, round, ourPlayerIds, opponentPlayerIds }),
  })
}
export function getRespondAnalysis(team: string, round: number, opponentTeam: string, theirExposedPlayerIds: string[]) {
  return req<RespondAnalysis>('/respond', {
    method: 'POST',
    body: JSON.stringify({ team, round, opponentTeam, theirExposedPlayerIds }),
  })
}
export function getPutUpAnalysis(team: string, round: number, opponentTeam: string) {
  return req<PutUpAnalysis>('/putup', {
    method: 'POST',
    body: JSON.stringify({ team, round, opponentTeam }),
  })
}
export function lockRound(team: string, round: number, actor: string) {
  return req<{ locked: number }>('/matchups/lock', { method: 'POST', body: JSON.stringify({ team, round }) }, actor)
}
export function clearMatchup(team: string, round: number, position: number, actor: string) {
  return req<{ ok: true }>(`/matchups?team=${encodeURIComponent(team)}&round=${round}&position=${position}`, { method: 'DELETE' }, actor)
}

// ---- Seattle Cup round lineup writes (actor = authenticated captain email) ----
// Replaces the stored lineup for (team, round) with `playerIds`. The backend
// enforces the eligibility rule (head pros Singles-only) and team membership.
export function setRoundLineup(team: string, round: number, playerIds: string[], actor: string) {
  return req<RoundLineup>('/lineup', { method: 'POST', body: JSON.stringify({ team, round, playerIds }) }, actor)
}
export function clearRoundLineup(team: string, round: number, actor: string) {
  return req<{ ok: true }>(`/lineup?team=${encodeURIComponent(team)}&round=${round}`, { method: 'DELETE' }, actor)
}