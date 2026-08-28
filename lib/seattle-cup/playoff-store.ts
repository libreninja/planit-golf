import { createServiceClient } from '../supabase/service.ts'
import { SEATTLE_CUP_EVENT } from './config.ts'
import {
  calculateSeattleCupTournamentResolution,
  validatePlayoffWinner,
  type SeattleCupPlayoffFact,
  type SeattleCupResolutionInput,
} from './resolution.ts'
import type { SeattleCupTournamentResolution, TeamKey } from './types.ts'

export interface SeattleCupPlayoffRecord extends SeattleCupPlayoffFact {
  season: number
  ggEventId: string
  notes: string | null
  resolvedAt: string
  recordedByUserId: string | null
  createdAt: string
  updatedByUserId: string | null
  updatedAt: string
}

export interface SaveSeattleCupPlayoffInput {
  snapshots: SeattleCupResolutionInput[]
  winnerTeamKey: TeamKey
  notes: string | null
  actorUserId: string
}

interface PlayoffStore {
  read(): Promise<SeattleCupPlayoffRecord | null>
  save(input: {
    tiedTeamKeys: TeamKey[]
    winnerTeamKey: TeamKey
    notes: string | null
    actorUserId: string
  }): Promise<SeattleCupPlayoffRecord>
}

type PlayoffRow = {
  event_key: string
  season: number
  gg_event_id: string
  tied_team_keys: string[]
  winner_team_key: string
  notes: string | null
  resolved_at: string
  recorded_by: string | null
  created_at: string
  updated_by: string | null
  updated_at: string
}

function rowToRecord(row: PlayoffRow): SeattleCupPlayoffRecord {
  return {
    eventKey: row.event_key,
    season: row.season,
    ggEventId: row.gg_event_id,
    tiedTeamKeys: row.tied_team_keys as TeamKey[],
    winnerTeamKey: row.winner_team_key as TeamKey,
    notes: row.notes,
    resolvedAt: row.resolved_at,
    recordedByUserId: row.recorded_by,
    createdAt: row.created_at,
    updatedByUserId: row.updated_by,
    updatedAt: row.updated_at,
  }
}

function createSupabasePlayoffStore(): PlayoffStore {
  const service = createServiceClient()
  return {
    async read() {
      const { data, error } = await service
        .from('seattle_cup_playoff_resolutions')
        .select('*')
        .eq('event_key', SEATTLE_CUP_EVENT.key)
        .maybeSingle()
      if (error) throw new Error(`Unable to read Seattle Cup playoff result: ${error.message}`)
      return data ? rowToRecord(data as PlayoffRow) : null
    },

    async save(input) {
      const existing = await this.read()
      const now = new Date().toISOString()
      if (existing) {
        const { data, error } = await service
          .from('seattle_cup_playoff_resolutions')
          .update({
            tied_team_keys: input.tiedTeamKeys,
            winner_team_key: input.winnerTeamKey,
            notes: input.notes,
            updated_by: input.actorUserId,
            updated_at: now,
          })
          .eq('event_key', SEATTLE_CUP_EVENT.key)
          .select('*')
          .single()
        if (error) throw new Error(`Unable to correct Seattle Cup playoff result: ${error.message}`)
        return rowToRecord(data as PlayoffRow)
      }

      const { data, error } = await service
        .from('seattle_cup_playoff_resolutions')
        .insert({
          event_key: SEATTLE_CUP_EVENT.key,
          season: SEATTLE_CUP_EVENT.season,
          gg_event_id: SEATTLE_CUP_EVENT.ggEventId,
          tied_team_keys: input.tiedTeamKeys,
          winner_team_key: input.winnerTeamKey,
          notes: input.notes,
          resolved_at: now,
          recorded_by: input.actorUserId,
          created_at: now,
          updated_by: input.actorUserId,
          updated_at: now,
        })
        .select('*')
        .single()
      if (error) throw new Error(`Unable to record Seattle Cup playoff result: ${error.message}`)
      return rowToRecord(data as PlayoffRow)
    },
  }
}

export async function readSeattleCupPlayoffRecord(
  store: PlayoffStore = createSupabasePlayoffStore(),
): Promise<SeattleCupPlayoffRecord | null> {
  return store.read()
}

export async function getSeattleCupTournamentResolution(
  snapshots: SeattleCupResolutionInput[],
  store: PlayoffStore = createSupabasePlayoffStore(),
): Promise<SeattleCupTournamentResolution> {
  const record = await store.read()
  return calculateSeattleCupTournamentResolution(snapshots, record)
}

export async function saveSeattleCupPlayoffResult(
  input: SaveSeattleCupPlayoffInput,
  store: PlayoffStore = createSupabasePlayoffStore(),
): Promise<SeattleCupPlayoffRecord> {
  // Re-derive from current normalized Golf Genius state immediately before the
  // write. Existing manual data is intentionally excluded so an update cannot
  // turn into a generic winner override.
  const rulesDerived = calculateSeattleCupTournamentResolution(input.snapshots)
  validatePlayoffWinner(rulesDerived, input.winnerTeamKey)

  const notes = input.notes?.trim() || null
  if (notes && notes.length > 2000) throw new Error('Playoff notes must be 2000 characters or fewer')

  return store.save({
    tiedTeamKeys: rulesDerived.tiedTeamKeys,
    winnerTeamKey: input.winnerTeamKey,
    notes,
    actorUserId: input.actorUserId,
  })
}

export type { PlayoffStore }
