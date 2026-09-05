import type { PlayerResultFact, PlayerRound } from './player-detail.ts'

export type PlayerResultFocus = 'gross' | 'net'

const EMPTY_POSITION = /^(?:—|--|-)?$/

export function hasActualResultMembership(result: PlayerResultFact | null): boolean {
  if (!result) return false
  const position = result.positionLabel?.trim() ?? ''
  return (position !== '' && !EMPTY_POSITION.test(position)) || result.points !== null
}

export function resolvePlayerResultFocus(
  round: PlayerRound,
  requested: PlayerResultFocus | null,
): PlayerResultFocus {
  if (requested) return requested
  if (hasActualResultMembership(round.grossResult)) return 'gross'
  if (hasActualResultMembership(round.netResult)) return 'net'
  if (round.grossTotal !== null || round.toParGrossTotal !== null) return 'gross'
  return 'net'
}

export function playerRoundPresentation(
  round: PlayerRound,
  requested: PlayerResultFocus | null,
): {
  competition: PlayerResultFocus
  total: number | null
  toPar: number | null
  result: PlayerResultFact | null
} {
  const competition = resolvePlayerResultFocus(round, requested)
  const result = competition === 'gross' ? round.grossResult : round.netResult
  return {
    competition,
    total: competition === 'gross' ? round.grossTotal : round.netTotal,
    toPar: competition === 'gross' ? round.toParGrossTotal : round.toParNetTotal,
    result: hasActualResultMembership(result) ? result : null,
  }
}
