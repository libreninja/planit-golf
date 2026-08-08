// Flight color mapping for the finalized Men's multi-flight views (P1-3).
// Maps a flight label ("Flight 1", "Flight 2", …) to a subtle, deterministic
// Tailwind color palette so the flight filter tabs and the matching leaderboard
// rows/badges share one color per flight. "All" and non-numeric labels stay
// neutral; women's (single Overall) and live (unflighted) never reach here.
//
// Tailwind JIT needs literal class strings, so each palette entry is a bundle of
// full class names (no dynamic `bg-${color}-50` construction). Indexing is by
// the trailing flight number, cycling through the palette for leagues with more
// flights than entries. Relative import (no @/ alias) so `node --test` loads it.

export interface FlightColor {
  // Subtle row tint + hover for leaderboard rows in the "All" view.
  row: string
  rowHover: string
  // Flight filter tab — idle and active (selected) states.
  tabIdle: string
  tabActive: string
  // Small pill badge for the Flight cell in a row.
  badge: string
}

const PALETTE: FlightColor[] = [
  {
    row: 'bg-sky-50/60',
    rowHover: 'hover:bg-sky-100/70',
    // bg+text only — no border, no radius. The SegmentedControl pill owns the
    // single border + rounding; per-segment borders would double up (FIX 3).
    tabIdle: 'bg-sky-50 text-sky-700 hover:bg-sky-100',
    tabActive: 'bg-sky-100 text-sky-800',
    badge: 'bg-sky-100 text-sky-700',
  },
  {
    row: 'bg-emerald-50/60',
    rowHover: 'hover:bg-emerald-100/70',
    tabIdle: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
    tabActive: 'bg-emerald-100 text-emerald-800',
    badge: 'bg-emerald-100 text-emerald-700',
  },
  {
    row: 'bg-amber-50/60',
    rowHover: 'hover:bg-amber-100/70',
    tabIdle: 'bg-amber-50 text-amber-700 hover:bg-amber-100',
    tabActive: 'bg-amber-100 text-amber-800',
    badge: 'bg-amber-100 text-amber-700',
  },
  {
    row: 'bg-violet-50/60',
    rowHover: 'hover:bg-violet-100/70',
    tabIdle: 'bg-violet-50 text-violet-700 hover:bg-violet-100',
    tabActive: 'bg-violet-100 text-violet-800',
    badge: 'bg-violet-100 text-violet-700',
  },
  {
    row: 'bg-rose-50/60',
    rowHover: 'hover:bg-rose-100/70',
    tabIdle: 'bg-rose-50 text-rose-700 hover:bg-rose-100',
    tabActive: 'bg-rose-100 text-rose-800',
    badge: 'bg-rose-100 text-rose-700',
  },
]

// Trailing integer in a flight label ("Flight 3" → 3). Non-numeric labels
// (e.g. a one-off "Championship") and null/empty → null (neutral / uncolored).
function flightNumber(flight: string | null): number | null {
  if (!flight) return null
  const m = flight.match(/(\d+)\s*$/)
  return m ? parseInt(m[1], 10) : null
}

// Returns the color bundle for a flight, or null when the flight has no numeric
// label (neutral). Same label always maps to the same palette entry, so the
// filter tab and the row/badge for a flight always match.
export function flightColor(flight: string | null): FlightColor | null {
  const n = flightNumber(flight)
  if (n === null) return null
  return PALETTE[(n - 1) % PALETTE.length]!
}