// Pure client-side gate for the Purse column. Purse is per-competition prize
// money; not every round carries it. The Club Championship is two independent
// 9-hole league rounds — Monday (points only, NO purse) and Tuesday (points +
// money). A no-money round must not render an empty Purse column, so the column
// is shown only when at least one entry on the leaderboard actually has a
// purse. This is data-driven and occurrence-level (Monday's all-null field →
// hidden; Tuesday's money round → shown), never a hardcoded "club championship"
// route/name check. Season Points entries carry no purse, so the column is
// hidden there too.
//
// Relative import (no @/ alias) so node --test can load it.

import type { ResultEntry } from '../../lib/competition/types.ts'

export function shouldShowPurse(entries: ResultEntry[]): boolean {
  if (entries.length === 0) return false
  return entries.some((e) => e.purse !== null && e.purse !== '')
}