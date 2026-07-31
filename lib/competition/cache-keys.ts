// Cache key composition. Every key is tenant- AND competition-scoped so no
// tenant or competition reads another's cache. Results rows include the
// scoring mode; discovery rows do not. Callers use the structured cache API
// in cache.ts (readCachedResult/writeCachedResult) and never compose these
// keys directly. See design spec §4 cache schema + revision 8.

import type { ScoringMode } from './types.ts'

export interface ResultsKeyInput {
  tenantKey: string
  competitionKey: string
  occurrenceId: string
  scoring: ScoringMode
}
export interface DiscoveryKeyInput {
  tenantKey: string
  competitionKey: string
  occurrenceId: string
}

export function resultsCacheKey(input: ResultsKeyInput): string {
  return `results:${input.tenantKey}:${input.competitionKey}:${input.occurrenceId}:${input.scoring}`
}

export function discoveryCacheKey(input: DiscoveryKeyInput): string {
  return `discovery:${input.tenantKey}:${input.competitionKey}:${input.occurrenceId}`
}