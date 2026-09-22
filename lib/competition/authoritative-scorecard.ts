import { buildHoles } from '../igc/weekly-results-helpers.ts'
import type { Scorecard } from './types.ts'

// A tournament's embedded opposite-mode fields are not authoritative for that
// other competition. Assemble the shared card from each mode's own payload.
export function authoritativeScorecard(
  gross: Scorecard | null | undefined,
  net: Scorecard | null | undefined,
): Scorecard | null {
  const identity = gross ?? net
  if (!identity) return null
  if (gross && net && (gross.key !== net.key || gross.name !== net.name)) {
    throw new Error('Cannot combine Gross and Net scorecards with different identities')
  }
  const holes = buildHoles(
    gross?.holes.map((hole) => hole.gross) ?? null,
    net?.holes.map((hole) => hole.net) ?? null,
    net?.holes.map((hole) => hole.toPar) ?? null,
    gross?.holes.map((hole) => hole.toParGross) ?? null,
  )
  // A Net-only response still establishes par from its own strokes/delta;
  // it does not need the other tournament's Gross facts to display the hole.
  for (const hole of holes) {
    if (hole.par === null && hole.net !== null && hole.toPar !== null) {
      hole.par = hole.net - hole.toPar
    }
  }
  return {
    ...identity,
    grossTotal: gross?.grossTotal ?? null,
    toParGross: gross?.toParGross ?? null,
    netTotal: net?.netTotal ?? null,
    toParNet: net?.toParNet ?? null,
    holes,
    holesCompleted: holes.filter((hole) => hole.gross !== null || hole.net !== null).length,
    isLive: !!(gross?.isLive || net?.isLive),
  }
}
