// Durable discovery + classification persistence. Reuses the live-path
// discoverOccurrence (config-driven, positive evidence) and writes the
// verdict to igc_league_events: event_format, discovery_state, discovered_at,
// and source_finalized_at (set only when upstream status is completed).

import { discoverOccurrence } from '../adapters/golfgenius/discovery.ts'
import type { GolfGeniusAdapterConfig } from '../types.ts'
import type { GGClient } from '../adapters/golfgenius/discovery.ts'

export interface ClassifyDb {
  updateClassification(w: {
    league_key: string; week_number: number
    event_format: 'individual' | 'team' | 'unknown'
    discovery_state: 'pending' | 'discovered' | 'inconclusive' | 'failed'
    discovered_at: string
    source_finalized_at: string | null
    source_version: string | null
  }): Promise<{ ok: boolean }>
}

export interface DiscoverPersistInput {
  competitionKey: string
  weekNumber: number
  adapterConfig: GolfGeniusAdapterConfig
  ggClient: GGClient
  db: ClassifyDb
  nowIso: string
}

// Returns the DiscoverResult (carrying `resolved: ResolvedOccurrence`) so the
// orchestrator (Task 19F) can pass `resolved` straight into importOccurrence
// without re-discovering or placeholders.
export async function discoverAndPersistEventClassification(input: DiscoverPersistInput) {
  const r = await discoverOccurrence({
    competitionKey: input.competitionKey,
    tenantKey: input.adapterConfig.tenantKey,
    adapterConfig: input.adapterConfig,
    occurrenceContext: { number: input.weekNumber, date: null },
    persistedHints: null,                                   // durable path re-discovers fresh
    teamOverride: (input.adapterConfig.teamFormatOverrides ?? []).includes(input.weekNumber),
    ggClient: input.ggClient,
    scoringMode: 'net',
  })
  const finalized = r.resolved.upstreamStatus === 'completed' ? (r.resolved.sourceFinalizedAt ?? input.nowIso) : null
  await input.db.updateClassification({
    league_key: input.competitionKey === 'mens-league' ? 'mens' : 'womens',
    week_number: input.weekNumber,
    event_format: r.eventFormat,
    discovery_state: r.discoveryState,
    discovered_at: input.nowIso,
    source_finalized_at: finalized,
    source_version: r.resolved.sourceVersion,
  })
  return r
}
