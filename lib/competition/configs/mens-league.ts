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
  },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'composite', noun: 'Week', separator: ' – ' } },
  capabilities: {
    views: ['season', 'weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  liveGroupingPolicy: 'hide-until-final',
  schedule: { timezone: 'America/Los_Angeles', playDay: 2, windowHours: 8, playStartLocal: '16:00' },
}
