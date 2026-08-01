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
// card has consistent length.
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
      cumulativeToPar: hasAny && tpn !== null ? running : null,
    });
  }
  return holes;
}
