// Pure event-format classification. Maps discovered tournaments + an explicit
// occurrence-level config override to (EventFormat, DiscoveryState). Rules
// (spec §3 + side-game correction):
//   - An occurrence is `individual` if ANY qualifying individual competition
//     exists (metadataFormat='individual' OR a gross/net/individual name).
//   - Side games (metadataFormat='side' / nameKind='side') are IGNORED when
//     determining the primary format — a round may have Gross + Net + Closest
//     to the Pin and is still individual.
//   - `team` only when (explicit metadataFormat='team' OR an occurrence-level
//     config override) AND no qualifying individual competition exists. A
//     name that merely looks team-like is a HINT and yields unknown/
//     inconclusive — never team. The occurrence-level override is the only
//     way an individual-bearing round becomes team.
//   - Otherwise 'unknown': 'pending' (no tournaments) or 'inconclusive'
//     (tournaments exist but none qualify, e.g. side games only / ambiguous).
// Persisted tournament ids are NOT classified here — the caller must
// fetch/verify their metadata/results before classification (discovery.ts).

export type NameKind = 'individual' | 'team' | 'side' | 'unknown'

export interface DiscoveredTournament {
  id: string
  name: string
  metadataFormat: 'individual' | 'team' | 'side' | null  // explicit upstream metadata; null if absent
  nameKind: NameKind                                     // hint derived from name
  // GG result scoping. 'rs_field' = the field-wide AGGREGATE (e.g. the overall
  // Club Championship tournament that spans every round — it appears, with the
  // SAME id, in every constituent round's tournament list). 'rs_flight' = a
  // single flight/round competition. For a per-round live read we want the
  // rs_flight tournament, never the rs_field aggregate (which would double the
  // Planit aggregate with GG's own cross-round totals). Optional: omitted by
  // unit-test fixtures (classify doesn't use it); listTournaments always sets it.
  resultScope?: 'rs_field' | 'rs_flight' | null
}

export interface ClassifyInput {
  tournaments: DiscoveredTournament[]
  teamOverride: boolean               // occurrence-level override (known scramble week)
}

export interface ClassifyResult {
  eventFormat: 'individual' | 'team' | 'unknown'
  discoveryState: 'pending' | 'discovered' | 'inconclusive' | 'failed'
}

// Name → hint. Names are hints only; never the sole basis for 'team'.
export function nameKind(name: string): NameKind {
  const n = name.toLowerCase()
  if (/team|scramble/.test(n)) return 'team'
  if (/closest to the pin|longest drive|kp hole/.test(n)) return 'side'
  if (/gross|net|individual/.test(n)) return 'individual'
  return 'unknown'
}

// A "qualifying individual competition" — explicit individual metadata OR a
// gross/net/individual name (those ARE individual competitions by GG
// convention). Side games never qualify.
function isQualifyingIndividual(t: DiscoveredTournament): boolean {
  return t.metadataFormat === 'individual' || t.nameKind === 'individual'
}

export function classifyEventFormat(input: ClassifyInput): ClassifyResult {
  const { tournaments, teamOverride } = input

  // Occurrence-level override forces team (explicit positive evidence) — the
  // only way an individual-bearing round is classified team.
  if (teamOverride) return { eventFormat: 'team', discoveryState: 'discovered' }

  // Any qualifying individual competition → individual (side games ignored).
  if (tournaments.some(isQualifyingIndividual)) {
    return { eventFormat: 'individual', discoveryState: 'discovered' }
  }

  // No individual: explicit team metadata (NOT side) makes it team.
  const hasTeamMeta = tournaments.some((t) => t.metadataFormat === 'team')
  if (hasTeamMeta) return { eventFormat: 'team', discoveryState: 'discovered' }

  // No individual, no team metadata: side games alone / ambiguous / empty.
  if (tournaments.length === 0) return { eventFormat: 'unknown', discoveryState: 'pending' }
  return { eventFormat: 'unknown', discoveryState: 'inconclusive' }
}