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
  availabilitySummary?: { fully: number; partial: number; unavailable: number; pending: number; none: number } | null
  tags?: string[]
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
  provenance: { asOf: string; sources: string[] }
}

export interface AddablePlayer {
  sourceMemberCardId: string
  displayName: string | null
  currentRank: number | null
}

async function req<T = unknown>(path: string, opts: RequestInit = {}, actor?: string): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  }
  if (SECRET) headers['x-planit-api-secret'] = SECRET
  if (actor) headers['x-planit-actor'] = actor
  if (opts.body) headers['content-type'] = 'application/json'

  const res = await fetch(`${BASE}/api/scouting${path}`, {
    ...opts,
    headers,
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`planit-ai ${path} -> ${res.status} ${text}`)
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
export function addCaptainCandidate(sourceMemberCardId: string, actor: string) {
  return req('/candidates', { method: 'POST', body: JSON.stringify({ sourceMemberCardId }) }, actor)
}