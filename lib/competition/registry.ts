import type { CompetitionConfig, SpecialOccurrence } from './types.ts'
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

// Look up a configured special occurrence (outside the weekly cadence, e.g. a
// Club Championship round) by its storage week_number. Returns null when the
// competition has no special-occurrence spec for that number — i.e. it is a
// normal weekly occurrence that resolves from a persisted row / the points
// index. Used by the live reader (date + GG id hints when no DB row) and the
// occurrence nav list (merge spec-derived occurrences in). See SpecialOccurrence.
export function getSpecialOccurrence(competitionKey: string, weekNumber: number): SpecialOccurrence | null {
  const config = REGISTRY[competitionKey]
  if (!config) return null
  return config.adapterConfig.specialOccurrences?.find((o) => o.weekNumber === weekNumber) ?? null
}
