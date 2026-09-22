// Pure formatting + mobile presentation logic for the leaderboard, extracted
// from ScorecardRow so the portrait stat-strip invariants are unit-testable
// without rendering React/Tailwind. Relative imports (no @/ alias) so
// `node --test` can load this module directly, matching the other
// competition helpers (leaderboard-cols, leaderboard-purse, flight-color).
//
// The portrait mobile strip MUST communicate, in order:
//   Pos · To Par · Gross|Net (per selected scoring) · Thru · Points
// Player identity (entry.name) is rendered by the component itself — it is
// primary and never derived here. This module owns only the numeric strip.

import { scorecardRoundHoles, WEEKLY_ROUND_HOLES } from '../../lib/igc/weekly-results-helpers.ts'

import type {
  Scorecard as ScorecardT,
  ResultEntry,
  ScoringMode,
} from '../../lib/competition/types.ts'

export function formatToPar(n: number | null): string {
  if (n === null) return '—'
  if (n === 0) return 'E'
  return n > 0 ? `+${n}` : `${n}`
}

// Completion belongs to the player's round, regardless of event status.
export function formatThru(holesCompleted: number, requiredHoles = WEEKLY_ROUND_HOLES): string {
  if (holesCompleted <= 0) return '—'
  return requiredHoles > 0 && holesCompleted >= requiredHoles ? 'F' : `thru ${holesCompleted}`
}

export function formatPoints(n: number | null): string {
  if (n === null) return '—'
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

// Tailwind class for a to-par value. Exported as a literal-only mapping so the
// JIT sees every class; callers must use the returned string verbatim.
export function toParClass(n: number | null): string {
  if (n === null || n === 0) return 'text-muted-foreground'
  return n < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

export interface MobileStat {
  label: string
  value: string
  valueClass?: string
}

// The five labeled stats shown beneath a player's name on the portrait mobile
// leaderboard strip. The score (Gross/Net) label and value follow the selected
// scoring mode — the core invariant: the number a golfer sees must match the
// Gross/Net toggle they selected. THRU uses only player round progress.
export function buildMobileStats(
  entry: ResultEntry,
  card: ScorecardT | null,
  scoringMode: ScoringMode,
): MobileStat[] {
  const isGross = scoringMode === 'gross'
  const toPar = isGross ? card?.toParGross ?? null : card?.toParNet ?? null
  const total = isGross ? card?.grossTotal ?? null : card?.netTotal ?? null
  const holesCompleted = card?.holesCompleted ?? 0
  return [
    { label: 'Pos', value: entry.positionLabel ?? '—' },
    { label: 'To Par', value: formatToPar(toPar), valueClass: toParClass(toPar) },
    { label: isGross ? 'Gross' : 'Net', value: total === null ? '—' : String(total) },
    { label: 'Thru', value: formatThru(holesCompleted, scorecardRoundHoles(card)) },
    { label: 'Points', value: formatPoints(entry.points) },
  ]
}
