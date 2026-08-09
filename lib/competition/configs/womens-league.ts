import type { CompetitionConfig } from '../types.ts'

export const womensLeagueConfig: CompetitionConfig = {
  key: 'womens-league',
  label: "Women's League",
  adapter: 'golfgenius',
  adapterConfig: {
    seasonId: process.env.IGC_WOMENS_SEASON_ID || '',
    categoryId: process.env.IGC_WOMENS_CATEGORY_ID || '',
    eventFilter: 'womens',
    tenantKey: 'igc',
    teamFormatOverrides: [],
    roundResolution: 'pointsRoundIndex',
  },
  navigation: { occurrenceNoun: 'week', queryParam: 'week', labelRule: { kind: 'weekDate', noun: 'Week', separator: ' - ' } },
  capabilities: {
    views: ['weekly'],
    scoring: { modes: ['gross', 'net'] },
    supportsLiveResults: true,
    supportsEventNavigation: true,
  },
  liveGroupingPolicy: 'hide-until-final',
  visibility: 'public',
  schedule: { timezone: 'America/Los_Angeles', playDay: 3, windowHours: 8, playStartLocal: '16:00' },
}
