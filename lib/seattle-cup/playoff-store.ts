// Persistence for the Seattle Cup out-of-band playoff resolution — the ONLY
// tournament-resolution fact Planit stores (everything else is derived in
// lib/seattle-cup/resolution.ts). Backed by the seattle_cup_tournament_results
// table via the service-role client (RLS: no public policies, same convention
// as competition_live_cache). Injectable store for tests. Failure contract:
// a failed write THROWS (an admin recording a playoff result must not silently
// vanish — there is NO in-memory fallback on the server path), while a read
// returns null only for a genuine no-row result or the narrowly recognized
// missing-table rollout condition; every other read failure propagates to the
// caller (the live route logs it and 502s; the admin section renders its
// unavailable state) so a database failure can never silently masquerade as
// "no playoff recorded".

import type { SupabaseClient } from '@supabase/supabase-js'
import { SEATTLE_CUP_EVENT_ID, SEATTLE_CUP_SEASON_YEAR } from './config.ts'
import type { SeattleCupPlayoffRecord } from './resolution.ts'
import type { TeamKey } from './types.ts'

const COMPETITION_KEY = 'seattle-cup'
const ACTIVE_TABLE = 'seattle_cup_tournament_results'

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

// Explicit in-memory store for tests / explicit local development. It is ONLY
// reachable through explicit injection (see resolveStore) — never as an
// automatic fallback, so it can never mask a production persistence failure.
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

// Additive-rollout safety, deliberately narrow: a code deploy briefly
// preceding the backing-table migration must degrade the READ to "no playoff
// recorded" — but ONLY for the exact missing-table/schema-cache condition
// naming the active table. Permission/auth/network/duplicate-key errors, and
// missing-table errors for any other table, must propagate.
export function isMissingPlayoffTable(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? ''
  if (!message.includes(ACTIVE_TABLE)) return false
  return error.code === '42P01'
    || error.code === 'PGRST205'
    || /does not exist|schema cache|Could not find/i.test(message)
}

// Injectable supabase-backed store (extracted so tests can drive the
// query-builder contract without a live database).
export function makeSupabasePlayoffStore(supabase: SupabaseClient): SeattleCupPlayoffStore {
  return {
    async read() {
      const { data, error } = await supabase.from(ACTIVE_TABLE).select('*')
        .eq('competition_key', COMPETITION_KEY)
        .eq('gg_event_id', SEATTLE_CUP_EVENT_ID)
        .maybeSingle()
      if (error) {
        if (isMissingPlayoffTable(error)) return null
        throw new Error(`Unable to read Seattle Cup playoff result (${error.code ?? 'unknown'}): ${error.message}`)
      }
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
      const { error } = await supabase.from(ACTIVE_TABLE).upsert(
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
      const { error } = await supabase.from(ACTIVE_TABLE)
        .delete()
        .eq('competition_key', COMPETITION_KEY)
        .eq('gg_event_id', SEATTLE_CUP_EVENT_ID)
      if (error) throw error
    },
  }
}

let _dbStore: SeattleCupPlayoffStore | null = null
async function dbStore(): Promise<SeattleCupPlayoffStore> {
  if (_dbStore) return _dbStore
  // Fail loudly on misconfiguration BEFORE any query: the service client would
  // otherwise be built against undefined credentials and every query would
  // fail with an opaque auth error instead of a diagnosable one.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Seattle Cup playoff persistence unavailable: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured',
    )
  }
  const { createServiceClient } = await import('../supabase/service.ts')
  _dbStore = makeSupabasePlayoffStore(createServiceClient())
  return _dbStore
}

// Store resolution is deliberately NOT guarded: there is no in-memory fallback.
// If the persistent store cannot be constructed, every caller fails loudly —
// a recorded playoff result must never silently vanish into process memory.
async function resolveStore(store?: SeattleCupPlayoffStore): Promise<SeattleCupPlayoffStore> {
  if (store) return store
  return dbStore()
}

// Public read: degrades to null ONLY for a genuine no-row result or the
// narrow active-table-missing rollout condition (handled inside the supabase
// store). Any other persistence failure propagates to the caller — the live
// API route logs it and returns 502; the admin section renders its
// unavailable state.
export async function readSeattleCupPlayoffRecord(store?: SeattleCupPlayoffStore): Promise<SeattleCupPlayoffRecord | null> {
  return (await resolveStore(store)).read()
}

// Authoritative write for the admin action: failures propagate so a recorded
// result is never lost silently — including when the persistent store cannot
// be constructed (no silent in-memory fallback).
export async function writeSeattleCupPlayoffRecord(record: SeattleCupPlayoffRecord, store?: SeattleCupPlayoffStore): Promise<void> {
  await (await resolveStore(store)).write(record)
}

// Explicit authenticated correction: remove a mistaken playoff result.
export async function deleteSeattleCupPlayoffRecord(store?: SeattleCupPlayoffStore): Promise<void> {
  await (await resolveStore(store)).remove()
}