// Pure, alias-free helpers shared by the weekly-results view model and the
// competition adapter's GG normalization. Extracted from weekly-results.ts so
// they can be imported under `node --test` (Node's built-in runner has no
// tsconfig path-alias resolver, and weekly-results.ts carries top-level `@/lib`
// imports for its server functions). No `@/` imports here — this module must
// stay loadable in any context. weekly-results.ts re-exports these for
// backward compatibility.

// One hole on a player's scorecard.
export interface HoleScore {
  hole: number; // 1..18
  par: number | null;
  gross: number | null;
  net: number | null;
  toPar: number | null; // net to-par for THIS hole (delta)
  toParGross: number | null; // gross to-par for THIS hole (delta) — D1 parity
  cumulativeToPar: number | null; // running net to-par through this hole
}

const BOTTOM = Number.MAX_SAFE_INTEGER;

// Finishing position from GG's `position` ("1", "T2", "--"). `rank` is only a
// within-flight list index and is NOT the position, so callers must pass
// `position`. Unplaced players sort to the bottom.
export function positionOrder(position: unknown): number {
  if (position === null || position === undefined || position === "") return BOTTOM;
  const s = String(position).trim();
  if (s === "--" || s === "-" || s.toLowerCase() === "nc") return BOTTOM;
  const n = parseInt(s.replace(/^T/i, ""), 10);
  return Number.isFinite(n) ? n : BOTTOM;
}

export function positionLabelOf(position: unknown): string | null {
  if (position === null || position === undefined || position === "") return null;
  const s = String(position).trim();
  if (s === "--" || s === "") return null;
  return s;
}

// Stable per-player key for joining a result membership to its scorecard.
// Aggregates carry member_card_id; fall back to a name key if absent so a
// scorecard is still reachable (and still deduped) without duplicating the
// hole-by-hole data across the two competitions.
export function playerKey(memberCardId: string | null | undefined, name: string): string {
  return memberCardId ? memberCardId : `name:${name}`;
}

// Build the hole-by-hole scorecard from the per-hole arrays. Par is derived as
// gross - gross-to-par (both stored); the running net to-par is the cumulative
// sum of the per-hole net-to-par deltas. Holes beyond what the player has
// reached are still listed (for a 9-hole league the back 9 are null) so the
// card has consistent length — callers trim to the round's real hole count
// via trimScorecardsToRoundHoles before display.
export function buildHoles(
  grossScores: (number | null)[] | null,
  netScores: (number | null)[] | null,
  toParNet: (number | null)[] | null,
  toParGross: (number | null)[] | null,
): HoleScore[] {
  const len = Math.max(
    grossScores?.length ?? 0,
    netScores?.length ?? 0,
    toParNet?.length ?? 0,
    toParGross?.length ?? 0,
    0,
  );
  const holes: HoleScore[] = [];
  let running = 0;
  let hasAny = false;
  for (let i = 0; i < len; i++) {
    const gross = grossScores?.[i] ?? null;
    const net = netScores?.[i] ?? null;
    const tpn = toParNet?.[i] ?? null;
    const tpg = toParGross?.[i] ?? null;
    const par =
      gross !== null && tpg !== null ? gross - tpg
      : net !== null && tpn !== null && tpg === null ? null
      : null;
    if (tpn !== null) { running += tpn; hasAny = true; }
    holes.push({
      hole: i + 1,
      par,
      gross,
      net,
      toPar: tpn,
      toParGross: tpg,
      cumulativeToPar: hasAny && tpn !== null ? running : null,
    });
  }
  return holes;
}

// A card is still in progress when it has started but not reached the round's
// real hole count. Used to (re)derive the in-progress flag after trimming to
// the course length, so a finished 9-hole card reads "F" (not "thru 9").
export function isPartialRound(holesCompleted: number, totalHoles: number): boolean {
  return holesCompleted > 0 && holesCompleted < totalHoles;
}

// The round's real hole count, derived from the cards themselves: the largest
// leading non-null prefix any player reached. On a finished card holesCompleted
// equals the course length, so the max across the field is the round's actual
// hole count (9 for an Interbay league round, 18 for a full course). GG returns
// 18-slot arrays padded with trailing nulls for shorter rounds and does not
// expose an explicit course hole count on the results payload, so this is the
// strongest available source. It is exact for every completed round and for
// live rounds once any player has finished; it is a safe fallback otherwise.
export function roundHoleCount<T extends { holesCompleted: number }>(cards: T[]): number {
  return cards.reduce((m, c) => Math.max(m, c.holesCompleted), 0);
}

// Canonical hole-count trim, shared by the generic competition path (server
// readers + live discovery) and the legacy weekly-results path so there is ONE
// implementation. Removes trailing null holes so every scorecard carries ONLY
// the holes that belong to the occurrence: a 9-hole round renders 9 holes (not
// 18 with trailing empties), an 18-hole round renders 18. This fixes the
// scorecard SHAPE (card.holes is the round's real length) — it is not a JSX
// hide. Mutates the cards in place (they are freshly built per request).
//
// `recomputeLive`: re-derive isLive against the real course length. Pass true
// for the live path (a finished 9-hole card becomes "F", not "thru 9"); pass
// false for historical/final cards so finished cards stay "F" (isLive already
// false). Totals (netTotal/grossTotal/toPar*) are GG-provided and stored
// separately, so trimming the holes array never changes them.
export function trimScorecardsToRoundHoles<T extends { holes: HoleScore[]; holesCompleted: number; isLive: boolean }>(
  cards: T[],
  recomputeLive: boolean,
): void {
  const roundHoles = roundHoleCount(cards);
  if (roundHoles <= 0) return;
  for (const c of cards) {
    if (c.holes.length > roundHoles) c.holes = c.holes.slice(0, roundHoles);
    if (recomputeLive) c.isLive = isPartialRound(c.holesCompleted, roundHoles);
  }
}
