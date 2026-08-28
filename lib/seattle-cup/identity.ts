// Identity enrichment — upgrades a normalized player's identityStatus from
// gg-only → resolved by joining the GG member_card_id to Planit's roster
// (igc_league_members, keyed by member_card_id). Seattle Cup players span four
// clubs; many are NOT IGC league members, so they stay 'gg-only' (still a real,
// named player resolved from GG's own individual_results / tee sheet). Only a
// MISSING name (not found in GG or Planit) is 'unresolved' — a diagnostic,
// never a silently-guessed identity. See ground-truth report §3.
//
// Defensive by design: any lookup failure leaves the GG-derived identity
// intact and never blocks the snapshot. The batched lookup is INJECTABLE so
// the pure normalizer's behavior is unit-tested without Supabase, and this
// enricher is tested with a fake lookup.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Match, MatchPlayer, SeattleCupRoundSnapshot, IdentityStatus } from './types.ts'

export interface RosterEntry {
  name: string | null
  handicapIndex: string | null
  // additional stable ids if available
  ghin?: string | null
}

export type RosterBatchLookup = (
  memberCardIds: readonly string[],
) => Promise<ReadonlyMap<string, RosterEntry>>

// Resolve identities for an entire snapshot in place. Collects the unique card
// ids and issues a single batched lookup (one round-trip) when a real lookup is
// wired; with the default no-op lookup this is a passthrough. Per-player
// enrichment is best-effort and never throws.
export async function enrichIdentities(
  snapshot: SeattleCupRoundSnapshot,
  lookup: RosterBatchLookup | null,
): Promise<SeattleCupRoundSnapshot> {
  if (!lookup) return snapshot
  const ids = new Set<string>()
  for (const m of snapshot.matches) {
    for (const p of [...m.playersA, ...m.playersB]) {
      if (p.ggMemberCardId) ids.add(p.ggMemberCardId)
    }
  }
  if (!ids.size) return snapshot
  let cache: ReadonlyMap<string, RosterEntry>
  try {
    cache = await lookup([...ids])
  } catch {
    cache = new Map()
  }
  for (const m of snapshot.matches) {
    m.playersA = m.playersA.map((p) => applyRoster(p, cache.get(p.ggMemberCardId ?? '') ?? null))
    m.playersB = m.playersB.map((p) => applyRoster(p, cache.get(p.ggMemberCardId ?? '') ?? null))
  }
  return snapshot
}

function applyRoster(p: MatchPlayer, entry: RosterEntry | null): MatchPlayer {
  if (!entry) return p
  // Upgrade gg-only → resolved when a Planit roster row exists. An unresolved
  // (no GG name) player that the roster CAN name gets a name + becomes resolved;
  // otherwise unresolved stays diagnostic.
  let identityStatus: IdentityStatus = p.identityStatus
  if (entry.name) {
    identityStatus = 'resolved'
    return { ...p, name: entry.name, identityStatus, ghin: entry.ghin ?? null }
  }
  if (p.identityStatus === 'gg-only') identityStatus = 'resolved' // roster row exists, name still from GG
  return { ...p, identityStatus }
}

// Build a real batched roster lookup against igc_league_members (service role).
// Seattle Cup is not a league_key value, so lookup spans both league rosters.
// Ordering makes the unlikely same-card-in-both-leagues case deterministic;
// the first league_key row wins, matching the old "one matching row" shape.
export function makeSupabaseRosterBatchLookup(supabase: SupabaseClient): RosterBatchLookup {
  return async (memberCardIds) => {
    const uniqueIds = [...new Set(memberCardIds.filter((id) => id.length > 0))]
    if (!uniqueIds.length) return new Map()

    const { data, error } = await supabase.from('igc_league_members')
      .select('league_key, member_card_id, name, handicap_index')
      .in('member_card_id', uniqueIds)
      .order('league_key', { ascending: true })
    if (error) {
      throw new Error(`Unable to batch-read Seattle Cup roster identities (${error.code ?? 'unknown'})`)
    }

    const requested = new Set(uniqueIds)
    const entries = new Map<string, RosterEntry>()
    for (const row of data ?? []) {
      const memberCardId = typeof row.member_card_id === 'string' ? row.member_card_id : ''
      if (!requested.has(memberCardId) || entries.has(memberCardId)) continue
      entries.set(memberCardId, {
        name: row.name ?? null,
        handicapIndex: row.handicap_index ?? null,
      })
    }
    return entries
  }
}

export async function createRosterBatchLookup(): Promise<RosterBatchLookup | null> {
  try {
    const { createServiceClient } = await import('../supabase/service.ts')
    return makeSupabaseRosterBatchLookup(createServiceClient())
  } catch {
    return null
  }
}

// Re-export for tests that want to count identity statuses across a snapshot.
export function identitySummary(snapshot: SeattleCupRoundSnapshot): Record<IdentityStatus, number> {
  const counts: Record<IdentityStatus, number> = { resolved: 0, 'gg-only': 0, ambiguous: 0, unresolved: 0, tbd: 0 }
  for (const m of snapshot.matches) {
    if (m.playersA.length === 0 && m.playersB.length === 0) { counts.tbd++; continue }
    for (const p of [...m.playersA, ...m.playersB]) counts[p.identityStatus]++
  }
  return counts
}

export type { Match }
