// Per-competition scoring-mode preference. The localStorage key is
// competition-scoped (`standings:${competitionKey}:scoring`) and any stored
// value is validated against the occurrence's available modes before use.
// A preference from one competition never selects a mode in another. The
// storage interface mirrors localStorage so this is unit-testable with a Map.
// See design spec §8 (revision 7).

import type { ScoringMode } from './types.ts'

export interface ScoringStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function scoringKey(competitionKey: string): string {
  return `standings:${competitionKey}:scoring`
}

export interface ResolveScoringInput {
  competitionKey: string
  urlValue: ScoringMode | null
  available: ScoringMode[]
  defaultMode: ScoringMode
  store: ScoringStorage
}

export function resolveScoring(input: ResolveScoringInput): ScoringMode {
  const valid = (m: ScoringMode | null | undefined): m is ScoringMode =>
    !!m && input.available.includes(m)
  if (valid(input.urlValue)) return input.urlValue as ScoringMode
  const stored = input.store.getItem(scoringKey(input.competitionKey)) as ScoringMode | null
  if (valid(stored)) return stored as ScoringMode
  return input.defaultMode
}

export function writeScoringPref(competitionKey: string, mode: ScoringMode, store: ScoringStorage): void {
  store.setItem(scoringKey(competitionKey), String(mode))
}