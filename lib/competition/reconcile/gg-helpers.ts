// Pure helpers ported verbatim from scripts/sync-igc-league.mjs (lines ~75-132).
// Mechanical port to TypeScript with minimal type annotations; runtime logic,
// control flow, regexes, and names are unchanged so parity with the existing
// sync script holds. Kept alias- and Supabase-free so it loads under `node --test`.

// Side/skill comps ("Closest to the Pin", "KP HOLE #n") and TEAM events
// ("Net/Gross Team Scramble") are excluded from the individual pick — team
// weeks have no individual scorecards.
export function isSideOrTeamCompetition(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('closest to the pin') || n.includes('kp hole') || n.includes('team') || n.includes('scramble');
}

// Pick the league's INDIVIDUAL competition tournaments. Returns the canonical
// flat {id, name} tournament shape: { gross: {id,name}|null, net: {id,name}|null }.
export function pickIndividualTournaments(tournaments: any[]): { gross: { id: string; name: string } | null; net: { id: string; name: string } | null } {
  const named = tournaments.map((t) => t.event).filter((e) => e && e.id && e.name);
  const individual = named.filter((e) => !isSideOrTeamCompetition(e.name));
  const gross = individual.find((e) => /gross/i.test(e.name)) || null;
  const net = individual.find((e) => /net/i.test(e.name))
    || (individual.length === 1 ? individual[0] : null);
  return { gross, net };
}

export function parseNum(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

// Authoritative finishing position from GG's `position` field ("1", "T2",
// "--" for ineligible/guest/no-card). Returns null for unplaced players so
// they sort to the bottom and never count as a flight win.
export function parsePosition(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  if (s === '--' || s === '-' || s.toLowerCase() === 'nc') return null;
  const n = parseInt(s.replace(/^T/i, ''), 10);
  return Number.isFinite(n) ? n : null;
}

// Counts non-null entries in the gross scorecard. (The existing script's
// signature takes a single `scores` array; an optional second argument is
// accepted here only so TS permits the parity test's two-argument call site
// — the second array is intentionally ignored, matching script behavior.)
export function countCompletedHoles(scores: any[], _netScores?: any): number {
  if (!Array.isArray(scores)) return 0;
  return scores.filter((x) => x !== null && x !== undefined).length;
}

export function totalOut(totals: any, key: string): number | null {
  return totals?.[key]?.out ?? totals?.[key]?.total ?? null;
}

// Integer coerce (parity with the original sync's parseIntOrNull). GG totals are
// integers; Math.trunc is a defensive coerce, never a rounding that changes data.
export function parseIntOrNull(value: unknown): number | null {
  const n = parseNum(value)
  return n === null ? null : Math.trunc(n)
}

// Secondary birdie/double-bogey counts from net scores vs course par (parity with
// the original sync lines 317–324). parData is the per-hole course par array from
// /events/{id}/courses; when absent/short, affected holes are skipped (counts stay
// 0, matching the original sync's `parData.length > 0` guard).
export function countBirdiesDoubles(netScores: (number | null)[], parData: (number | null)[]): { birdies: number; doubleBogeys: number } {
  let birdies = 0, doubleBogeys = 0
  if (!Array.isArray(parData) || parData.length === 0) return { birdies, doubleBogeys }
  for (let i = 0; i < netScores.length && i < parData.length; i++) {
    if (netScores[i] !== null && parData[i] !== null) {
      if (netScores[i]! >= parData[i]! + 2) doubleBogeys++
      if (netScores[i]! === parData[i]! - 1) birdies++
    }
  }
  return { birdies, doubleBogeys }
}
