import type { SupabaseClient } from '@supabase/supabase-js'
import type { Scorecard } from '../competition/types.ts'
import { aggregateLeaderboard } from '../competition/aggregate.ts'

export interface RecordGrossScore {
  eventEditionId: string
  roundId: string
  groupId: string
  participantId: string
  hole: number
  gross: number
  expectedRevision: number // 0 = first score; correction uses last-read revision
  requestId: string // stable across retries, new for a new intent/correction
}

// Supplied by a trusted server caller, never by a model or browser payload.
// Actor identifies the human/capability/service responsible, not just "Seve".
export interface ScoreRecorder {
  actorRef: string
  source: 'manual' | 'voice' | 'import'
}

export interface ScoreReceipt {
  request_id: string
  event_edition_id: string
  round_id: string
  group_id: string
  participant_id: string
  golfer_id: string
  hole: number
  gross: number
  previous_gross: number | null
  revision: number
  actor_ref: string
  source: ScoreRecorder['source']
  recorded_at: string
}

export interface EventScoringState {
  edition: {
    id: string; seriesSlug: string; name: string; year: number
    status: 'draft' | 'active' | 'archived'
    visibility: 'public' | 'club_members' | 'invite_only'
    startsOn: string | null; endsOn: string | null; locationName: string | null
    golfGeniusEventId: string | null
    golfGeniusPortalId?: string | null
  }
  participants: Array<{
    id: string; golferId: string | null; name: string | null
    type: 'player' | 'spectator' | 'organizer' | null
    status: 'invited' | 'registered' | 'confirmed' | 'cancelled' | null
    golfGeniusRosterId?: string | null
    golfGeniusMemberCardId?: string | null
    golfGeniusDisplayName?: string | null
  }>
  rounds: Array<{
    id: string; number: number; name: string; courseName: string; startsOn: string
    status: 'draft' | 'open' | 'closed'
    purpose?: 'replay' | 'competition'
    golfGeniusStatus?: string | null
    countsTowardCompetition: boolean
    scoreAuthority: 'planit' | 'golf_genius'
    golfGeniusRoundId: string | null
    golfGeniusCourseId?: string | null
    participantIds: string[]
    participations?: Array<{
      participantId: string
      groupId: string | null
      competitionEligible: boolean
      golfGeniusPlayerRoundId: string | null
    }>
    holes: Array<{ hole: number; par: number }>
    groups: Array<{
      id: string; name: string; startsAt: string | null; startingHole: number | null
      golfGeniusGroupId: string | null
      participantIds: string[]
    }>
  }>
  scores: ScoreReceipt[] // latest per participant/round/hole; history stays in DB
}

export class EventScoringError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'EventScoringError'
    this.code = code
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function requireUuid(value: string) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new EventScoringError('22023', 'Expected a Planit UUID')
  }
}

// Inject the existing service-role Supabase client. No in-memory fallback,
// arbitrary table writer, GG dependency, or LLM dependency. SQL owns domain
// validation and atomic persistence; this rejects malformed transport values
// before PostgreSQL/PostgREST can coerce e.g. a fractional stroke to an integer.
export function createEventScoringService(db: Pick<SupabaseClient, 'rpc'>) {
  return {
    async recordGrossScore(command: RecordGrossScore, recorder: ScoreRecorder): Promise<ScoreReceipt> {
      for (const id of [command.eventEditionId, command.roundId, command.groupId,
        command.participantId, command.requestId]) requireUuid(id)
      if (!Number.isInteger(command.hole) || command.hole < 1 || command.hole > 18
        || !Number.isInteger(command.gross) || command.gross < 1 || command.gross > 99
        || !Number.isInteger(command.expectedRevision) || command.expectedRevision < 0
        || command.expectedRevision >= 2147483647
        || typeof recorder.actorRef !== 'string' || !recorder.actorRef.trim()
        || recorder.actorRef.length > 200
        || !['manual', 'voice', 'import'].includes(recorder.source)) {
        throw new EventScoringError('22023', 'Invalid score input')
      }
      const { data, error } = await db.rpc('record_event_gross_score', {
        p_event_edition_id: command.eventEditionId,
        p_round_id: command.roundId,
        p_group_id: command.groupId,
        p_participant_id: command.participantId,
        p_hole: command.hole,
        p_gross: command.gross,
        p_expected_revision: command.expectedRevision,
        p_request_id: command.requestId,
        p_actor_ref: recorder.actorRef,
        p_source: recorder.source,
      })
      if (error) throw new EventScoringError(error.code, error.message)
      if (!data) throw new EventScoringError('unavailable', 'Scoring operation returned no receipt')
      return data as ScoreReceipt
    },

    async readEvent(eventEditionId: string) {
      requireUuid(eventEditionId)
      const { data, error } = await db.rpc('read_event_scoring_state', { p_event_edition_id: eventEditionId })
      if (error) throw new EventScoringError(error.code, error.message)
      if (data === null) return null // genuinely absent edition
      const state = data as EventScoringState
      return { ...state, standings: projectEventGrossStandings(state) }
    },
  }
}

// Scores from different rounds never share a hole array. Existing aggregate
// arithmetic ranks to-par and handles ties and unstarted players. These are
// provisional gross standings, not official results or net/handicap scoring.
export function projectEventGrossStandings(state: EventScoringState) {
  const rounds = state.rounds.filter((round) => round.scoreAuthority === 'planit').map((round) => {
    const memberIds = new Set(round.participations
      ? round.participations
        .filter((membership) => !round.countsTowardCompetition || membership.competitionEligible)
        .map((membership) => membership.participantId)
      : round.participantIds)
    const cards: Scorecard[] = state.participants
      .filter((p) => memberIds.has(p.id) && p.golferId !== null && p.type === 'player'
        && (p.status === 'registered' || p.status === 'confirmed'))
      .map((participant) => {
        const facts = new Map(state.scores
          .filter((score) => score.round_id === round.id && score.participant_id === participant.id)
          .map((score) => [score.hole, score]))
        let cumulative = 0
        const holes = [...round.holes].sort((a, b) => a.hole - b.hole).map(({ hole, par }) => {
          const gross = facts.get(hole)?.gross ?? null
          const toParGross = gross === null ? null : gross - par
          if (toParGross !== null) cumulative += toParGross
          return { hole, par, gross, net: null, toPar: null, toParGross,
            cumulativeToPar: gross === null ? null : cumulative }
        })
        const played = holes.filter((hole) => hole.gross !== null)
        const complete = holes.length > 0 && played.length === holes.length
        return {
          key: participant.golferId!, memberCardId: null, name: participant.name ?? '',
          grossTotal: played.length ? played.reduce((sum, hole) => sum + hole.gross!, 0) : null,
          netTotal: null, toParNet: null,
          toParGross: played.length ? cumulative : null,
          holesCompleted: played.length,
          scorecardStatus: complete ? 'completed' : played.length ? 'in_progress' : 'not_started',
          isLive: round.status === 'open' && !complete,
          holes,
        }
      })
    const ranked = aggregateLeaderboard([{ occurrenceId: round.id, scorecards: cards, entries: [] }], 'gross')
    return { occurrenceId: round.id, countsTowardCompetition: round.countsTowardCompetition,
      scorecards: cards, entries: ranked.entries }
  })
  const competitionRounds = rounds.filter((round) => round.countsTowardCompetition)
  const unavailableRoundIds = state.rounds
    .filter((round) => round.countsTowardCompetition && round.scoreAuthority !== 'planit')
    .map((round) => round.id)
  return {
    provisional: true as const, rounds, unavailableRoundIds,
    // Never silently publish a partial native-only competition if an included
    // round is GG-owned. A future upstream reader must supply those facts.
    overall: unavailableRoundIds.length ? null : aggregateLeaderboard(competitionRounds, 'gross'),
  }
}
