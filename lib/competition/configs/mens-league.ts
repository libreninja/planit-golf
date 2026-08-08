import type { CompetitionConfig } from '../types.ts'

export const mensLeagueConfig: CompetitionConfig = {
  key: 'mens-league',
  label: "Men's League",
  adapter: 'golfgenius',
  adapterConfig: {
    seasonId: process.env.IGC_MENS_SEASON_ID || '',
    categoryId: process.env.IGC_MENS_CATEGORY_ID || '',
    seasonPointsCategoryId: process.env.IGC_MENS_POINTS_CATEGORY_ID || '',
    eventFilter: 'mens',
    tenantKey: 'igc',
    teamFormatOverrides: [],                       // populate with known scramble week numbers
    roundResolution: 'pointsRoundIndex',
    // Club Championship: two independent 9-hole rounds on consecutive days
    // (Mon 8/17 + Tue 8/18), played outside the weekly points index. Each spec
    // carries its GG event/round ids + date so live discovery resolves it from
    // config alone — WITHOUT a persisted igc_league_events row (the Standings
    // live-discovery contract). week_number 101/102 are STORAGE ids only and are
    // never shown to users; the nav label is the spec label. The durable
    // reconcile path later upserts matching rows idempotently (Task 84).
    // Round 1 (Mon) is a no-money points round → the data-driven Purse column
    // auto-hides (shouldShowPurse); Round 2 (Tue) carries purse.
    specialOccurrences: [
      {
        weekNumber: 101,
        label: 'Club Championship - Round 1',
        date: '2026-08-17',
        ggEventId: '12263651301715371717',
        ggRoundId: '12263658868441114147',
        championshipKey: 'club-championship',
        championshipRound: 1,
      },
      {
        weekNumber: 102,
        label: 'Club Championship - Round 2',
        date: '2026-08-18',
        ggEventId: '12263651301715371717',
        ggRoundId: '12263654969047016987',
        championshipKey: 'club-championship',
        championshipRound: 2,
      },
    ],
  },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'weekDate', noun: 'Week', separator: ' - ' } },
  capabilities: {
    views: ['season', 'weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  liveGroupingPolicy: 'hide-until-final',
  schedule: { timezone: 'America/Los_Angeles', playDay: 2, windowHours: 8, playStartLocal: '16:00' },
}
