// Pure sort for the finalized Men's "All" grouping view. Sort order is
// position ascending, then flight ASCENDING — e.g. 1/Flight 1, 1/Flight 2,
// 1/Flight 3, 2/Flight 1, 2/Flight 2, 2/Flight 3. Within a tied position the
// lower-numbered flight is listed first.
//   1. Position ascending (lower/better position numbers first)
//   2. Flight ASCENDING as the tie-breaker (Flight 1 before Flight 2 before 3)
//
// This rule is a product requirement, NOT a derivation from any example: when
// positions are otherwise equal, Flight 1 contestants appear before Flight 2,
// and Flight 2 before Flight 3. It must NOT silently flip back to descending.
// The explicit ASC assertion in competition-leaderboard-sort.test.ts guards
// against that regression. Deterministic — uses the normalized `positionOrder`
// (already a numeric sort key from positionOrder()) and the raw `flight` value
// on each ResultEntry, never rendered/positional text. The specific-flight sort
// is untouched; this only applies when the grouping filter is set to "All".
// See FIX 2 / P1-4 (revised: flight ASC).
//
// Relative import (no @/ alias) so `node --test` can load this module.

import type { ResultEntry } from '../../lib/competition/types.ts'

// Trailing integer in a flight label ("Flight 3" → 3, "A" → null). Null/empty
// flight → null. Used so "Flight 10" sorts above "Flight 2" numerically rather
// than lexicographically (where "Flight 10" < "Flight 2").
function flightNumber(flight: string | null): number | null {
  if (!flight) return null
  const m = flight.match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}

// Ascending flight comparison: lower flight numbers first; non-numeric labels
// fall back to string-ascending ("A" before "B" before "C"); null/empty always
// sorts LAST. Kept as a primitive for callers/tests that want ascending order.
export function compareFlightAscending(a: string | null, b: string | null): number {
  const an = flightNumber(a)
  const bn = flightNumber(b)
  if (an !== null && bn !== null) return an - bn // both numeric → ascending
  if (an !== null) return -1                      // numeric sorts above non-numeric
  if (bn !== null) return 1
  if (!a && !b) return 0
  if (!a) return 1                                  // null/empty sorts last
  if (!b) return -1
  return a.localeCompare(b)                        // string-ascending fallback
}

// Descending flight comparison: HIGHER flight numbers first (Flight 3 before
// Flight 2 before Flight 1); non-numeric labels fall back to string-descending;
// null/empty always sorts LAST (an unflighted row sits below the flighted rows
// regardless of direction). Numeric always sorts above non-numeric.
export function compareFlightDescending(a: string | null, b: string | null): number {
  const an = flightNumber(a)
  const bn = flightNumber(b)
  if (an !== null && bn !== null) return bn - an // both numeric → descending (higher first)
  if (an !== null) return -1                       // numeric sorts above non-numeric
  if (bn !== null) return 1
  if (!a && !b) return 0
  if (!a) return 1                                   // null/empty sorts last
  if (!b) return -1
  return b.localeCompare(a)                         // string-descending fallback
}

// Returns a NEW array; does not mutate the input. Only the "All" view uses
// this — a specific flight keeps the server's positionOrder-then-name sort.
export function sortAllViewEntries(entries: ResultEntry[]): ResultEntry[] {
  return [...entries].sort((a, b) => {
    if (a.positionOrder !== b.positionOrder) return a.positionOrder - b.positionOrder
    return compareFlightAscending(a.flight, b.flight)
  })
}
