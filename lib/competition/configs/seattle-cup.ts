import type { CompetitionConfig } from '../types.ts'
import { SEATTLE_CUP_ROUNDS } from '../../seattle-cup/config.ts'

// Seattle Cup 2026 registry entry. The match-play specifics (teams, formats,
// match slots, colors) live in lib/seattle-cup/config.ts — the SINGLE source of
// truth. This CompetitionConfig exists so the shared live-auth + visibility
// machinery treats 'seattle-cup' as a known PUBLIC competition, and so the
// specialOccurrences carry the locked GG event/round ids for discovery. The
// league-oriented adapterConfig fields (seasonId/categoryId/roundResolution) are
// NOT used by the seattle-cup live reader (it has its own fetchRoundRaw); they
// are present only to satisfy the shared CompetitionConfig shape.
export const seattleCupConfig: CompetitionConfig = {
  key: 'seattle-cup',
  label: 'Seattle Cup 2026',
  adapter: 'golfgenius',
  adapterConfig: {
    seasonId: '',
    categoryId: '',
    eventFilter: 'seattle',
    tenantKey: 'seattle-cup',
    teamFormatOverrides: [],
    roundResolution: 'byDateWindow',
    // The four rounds — weekNumber is the round number (1-4) used as the
    // occurrence id. GG event/round ids are the locked 2026 values.
    specialOccurrences: Object.values(SEATTLE_CUP_ROUNDS).map((r) => ({
      weekNumber: r.round,
      label: `Round ${r.round} — ${r.format}`,
      date: r.date || '',
      ggEventId: r.ggEventId,
      ggRoundId: r.ggRoundId,
      championshipKey: 'seattle-cup',
      championshipRound: r.round,
    })),
  },
  navigation: { occurrenceNoun: 'round', queryParam: 'round', labelRule: { kind: 'numberPrefix', noun: 'Round' } },
  capabilities: {
    views: ['weekly'],
    scoring: { modes: ['net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  liveGroupingPolicy: 'available-while-live',
  // seattlecup.golf is a public site — anonymous reads are allowed at the live
  // API boundary (golfers share the link; most have no Planit account). Same
  // model as the IGC league leaderboards. See live-auth.ts.
  visibility: 'public',
  schedule: { timezone: 'America/Los_Angeles', playDay: 6, windowHours: 6, playStartLocal: '08:00' },
}