import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createEventScoringService, EventScoringError } from './scoring.ts'
import type { RecordGrossScore } from './scoring.ts'

export interface ParticipantScorecard {
  eventEditionId: string; eventName: string; roundId: string; roundName: string
  startsOn: string; groupId: string; startsAt: string | null; startingHole: number | null
  holes: Array<{ hole: number; par: number }>
  players: Array<{ id: string; name: string }>
  scores: Array<{ participantId: string; hole: number; gross: number; revision: number; recordedAt: string }>
}

export function scorecardTokenHash(token: string) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new EventScoringError('P1010', 'Scorecard link unavailable')
  }
  return createHash('sha256').update(token).digest('hex')
}

export function createParticipantScorecardService(db: Pick<SupabaseClient, 'rpc'>) {
  const scoring = createEventScoringService(db)
  return {
    // Trusted provisioning only; deliberately no public issuance/revocation API.
    async issue(scope: { eventEditionId: string; roundId: string; groupId: string }, expiresAt: Date) {
      const token = randomBytes(32).toString('base64url')
      const { data, error } = await db.rpc('issue_event_scorecard_access', {
        p_token_hash: scorecardTokenHash(token), p_event_edition_id: scope.eventEditionId,
        p_round_id: scope.roundId, p_group_id: scope.groupId, p_expires_at: expiresAt.toISOString(),
      })
      if (error) throw new EventScoringError(error.code, error.message)
      return { accessId: data as string, token, path: `/scorecard#${token}` }
    },
    async revoke(accessId: string) {
      const { error } = await db.rpc('revoke_event_scorecard_access', { p_access_id: accessId })
      if (error) throw new EventScoringError(error.code, error.message)
    },
    async read(token: string): Promise<ParticipantScorecard> {
      const { data, error } = await db.rpc('read_participant_scorecard', { p_token_hash: scorecardTokenHash(token) })
      if (error) throw new EventScoringError(error.code, error.message)
      if (!data) throw new EventScoringError('P1010', 'Scorecard link unavailable')
      return data as ParticipantScorecard
    },
    async recordGrossScore(token: string, input: unknown) {
      // No coercion, actor/source override, alternate scope, or extra RPC args.
      const keys = ['eventEditionId', 'roundId', 'groupId', 'participantId', 'hole', 'gross', 'expectedRevision', 'requestId']
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).length !== keys.length || Object.keys(input).some((key) => !keys.includes(key))) {
        throw new EventScoringError('22023', 'Invalid score input')
      }
      return scoring.recordGrossScore(input as RecordGrossScore, { participantAccessHash: scorecardTokenHash(token) })
    },
  }
}
