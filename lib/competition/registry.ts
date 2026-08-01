import type { CompetitionConfig } from './types.ts'
import { mensLeagueConfig } from './configs/mens-league.ts'
import { womensLeagueConfig } from './configs/womens-league.ts'

const REGISTRY: Record<string, CompetitionConfig> = {
  'mens-league': mensLeagueConfig,
  'womens-league': womensLeagueConfig,
}

export function getCompetitionConfig(key: string): CompetitionConfig | null {
  return REGISTRY[key] ?? null
}

export function allCompetitionConfigs(): CompetitionConfig[] {
  return Object.values(REGISTRY)
}
