import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { makeGolfGeniusRequestOptional } from '@/lib/gg/client'
import { buildHistoricalLiveResponse } from './adapters/golfgenius/server-readers'
import { readWeeklyScorecardFacts } from './weekly-scorecard-facts'
import type { Occurrence, ScoringMode } from './types'

// Supplemental read only: stored scores, awards, ordering and progress remain
// owned by the historical reader. Nothing is written to imported league data.
export async function readHistoricalWeeklyScorecards(competitionKey: string, selected: Occurrence, scoring: ScoringMode) {
  const response = await buildHistoricalLiveResponse(competitionKey, selected, scoring)
  if (!response?.leaderboard) return response
  const supabase = await createClient()
  const { data } = await supabase.from('igc_league_events')
    .select('gg_event_id, gg_round_id')
    .eq('league_key', competitionKey === 'mens-league' ? 'mens' : 'womens')
    .eq('week_number', Number(selected.id)).maybeSingle()
  const scorecards = await readWeeklyScorecardFacts({
    cards: response.leaderboard.scorecards, tenantKey: 'igc', competitionKey, occurrenceId: selected.id,
    ggEventId: data?.gg_event_id ?? null, ggRoundId: data?.gg_round_id ?? null,
    ggClient: endpoint => makeGolfGeniusRequestOptional({ endpoint }),
  })
  return { ...response, leaderboard: { ...response.leaderboard, scorecards } }
}
