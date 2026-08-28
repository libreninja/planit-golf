// Persistence for the Seattle Cup out-of-band playoff resolution — the ONLY
// tournament-resolution fact Planit stores (everything else is derived in
// lib/seattle-cup/resolution.ts). Backed by the seattle_cup_tournament_results
// table via the service-role client (RLS: no public policies, same convention
// as competition_live_cache). Injectable store for tests; in-memory fallback
// when no service-role key is available — persistence is an optimization for
// READS here only in the sense that a failed write THROWS (an admin recording
// a playoff result must not silently vanish), while a failed read degrades to
// "no playoff recorded" and the derived resolution still renders.

import { SEATTLE_CUP_EVENT_ID, SEATTLE_CUP_SEASON_YEAR } from './config.ts'
import type { SeattleCupPlayoffRecord } from './resolution.ts'
import type { TeamKey } from './types.ts'

const COMPETITION_KEY = 'seattle-cup'

export interface SeattleCupPlayoffStore {
  read(): Promise<SeattleCupPlayoffRecord | null>
  write(record: SeattleCupPlayoffRecord): Promise<void>
  remove(): Promise<void>
}

export const COMPETITION_KEY_SEATTLE_CUP = COMPETITION_KEY
export const SEATTLE_CUP_RESOLUTION_IDENTITY = {
  competitionKey: COMPETITION_KEY,
  seasonYear: SEATTLE_CUP_SEASON_YEAR,
  ggEventId: SEATTLE_CUP_EVENT_ID,
} as const

// Injectable DB layer (real = service client; tests inject an in-memory store).
export function makeMemoryPlayoffStore() {
  let record: SeattleCupPlayoffRecord | null = null
  return {
    store: {
      async read() { return record },
      async write(next) { record = next },
      async remove() { record = null },
    } satisfies SeattleCupPlayoffStore,
  }
}

let _dbStore: SeattleCupPlayoffStore | null = null
async function dbStore(): Promise<SeattleCupPlayoffStore> {
  if (_dbStore) return _dbStore
  const { createServiceClient } = await import('../supabase/service.ts')
  const supabase = createServiceClient()
  const table = 'seattle_cup_tournament_results'
  _dbStore = {
    async read() {
      const { data } = await supabase.from(table).select('*')
        .eq('competition_key', COMPETITION_KEY)
        .eq('gg_event_id', SEATTLE_CUP_EVENT_ID)
        .maybeSingle()
      if (!data) return null
      return {
        competitionKey: data.competition_key as string,
        seasonYear: data.season_year as number,
        ggEventId: data.gg_event_id as string,
        winnerTeamKey: data.winner_team_key as TeamKey,
        tiedTeamKeys: (data.tied_team_keys ?? []) as TeamKey[],
        notes: (data.notes as string | null) ?? null,
        resolvedAt: data.resolved_at as string,
        resolvedBy: (data.resolved_by as string | null) ?? null,
      } satisfies SeattleCupPlayoffRecord
    },
    async write(record) {
      const { error } = await supabase.from(table).upsert(
        {
          competition_key: record.competitionKey,
          season_year: record.seasonYear,
          gg_event_id: record.ggEventId,
          winner_team_key: record.winnerTeamKey,
          tied_team_keys: record.tiedTeamKeys,
          notes: record.notes,
          resolved_at: record.resolvedAt,
          resolved_by: record.resolvedBy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'competition_key,gg_event_id' },
      )
      if (error) throw error
    },
    async remove() {
      const { error } = await supabase.from(table)
        .delete()
        .eq('competition_key', COMPETITION_KEY)
        .eq('gg_event_id', SEATTLE_CUP_EVENT_ID)
      if (error) throw error
    },
  }
  return _dbStore
}

async function resolveStore(store?: SeattleCupPlayoffStore): Promise<SeattleCupPlayoffStore> {
  if (store) return store
  try {
    return await dbStore()
  } catch {
    // No service-role key / client misconfigured → degrade to in-memory.
    return makeMemoryPlayoffStore().store
  }
}

// Best-effort read for the public API route: a persistence failure must never
// break the live response — it degrades to "no playoff recorded" and the
// derived resolution stands.
export async function readSeattleCupPlayoffRecord(store?: SeattleCupPlayoffStore): Promise<SeattleCupPlayoffRecord | null> {
  try {
    return await (await resolveStore(store)).read()
  } catch {
    return null
  }
}

// Authoritative write for the admin action: failures propagate so a recorded
// result is never lost silently.
export async function writeSeattleCupPlayoffRecord(record: SeattleCupPlayoffRecord, store?: SeattleCupPlayoffStore): Promise<void> {
  await (await resolveStore(store)).write(record)
}

// Explicit authenticated correction: remove a mistaken playoff result.
export async function deleteSeattleCupPlayoffRecord(store?: SeattleCupPlayoffStore): Promise<void> {
  await (await resolveStore(store)).remove()
}