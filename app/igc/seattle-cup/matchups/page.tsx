import Link from 'next/link'
import { requireScoutingAccess } from '@/lib/scouting-access'
import * as ai from '@/lib/planit-ai/client'
import { buildEvidenceMap, type PlayerEvidence } from '@/lib/seattle-cup/evidence'
import { Button } from '@/components/ui/button'
import { ScoutingUnavailable } from '@/components/scouting/scouting-unavailable'
import { MatchupRoom } from './matchup-room'

export const dynamic = 'force-dynamic'

// Seattle Cup Matchup Room: the captain's decision-support workspace. Shows the
// locked roster, the round's format/course/handicap formula, the draft slots for
// the selected (team, round), every legal candidate pair, and the deterministic
// handicap consequence of each assignment — computed by planit-ai, never in the
// browser. Captains assign pairs, set put-up/response + rationale, and lock a
// round. The roster values are locked tournament facts; nothing here recomputes
// them. See docs (planit-ai) for the engine + draft-state API.
export default async function MatchupRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; round?: string }>
}) {
  await requireScoutingAccess()

  const sp = await searchParams
  const roundNum = (() => {
    const n = Number(sp.round ?? 1)
    return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1
  })()

  let roster: ai.RosterSnapshot | null = null
  let rounds: ai.RoundDescriptor[] = []
  let slots: ai.MatchupSlot[] = []
  let lineup: ai.RoundLineup | null = null
  let board: ai.ScoutingBoardRow[] = []
  try {
    ;[roster, rounds, slots, lineup, board] = await Promise.all([
      ai.getRoster(),
      ai.getRounds(),
      // team defaults to Interbay (the drafting team we scout for).
      ai.getMatchups(sp.team ?? 'Interbay', roundNum),
      ai.getRoundLineup(sp.team ?? 'Interbay', roundNum),
      ai.getBoard(),
    ])
  } catch (err) {
    if (ai.isBackendUnavailable(err)) {
      console.warn('[matchups] backend unavailable:', (err as Error).message)
      return <ScoutingUnavailable />
    }
    console.error('[matchups] load failed:', err)
    throw err
  }

  const teams = Array.from(new Set((roster?.players ?? []).map((p) => p.team)))
  const team = teams.includes(sp.team ?? 'Interbay') ? sp.team ?? 'Interbay' : teams[0] ?? 'Interbay'
  const round = rounds.find((r) => r.round === roundNum) ?? rounds[0] ?? null
  // Real Men's League + Seattle Cup evidence, keyed by planit-ai playerId. Roster
  // players join via resolvedPlayerId; unmatched players have no link (shown as
  // "no linked history" — an honest gap, never fabricated). See evidence.ts.
  const evidence = buildEvidenceMap(board)

  if (!round || !roster) {
    return (
      <div className="py-6">
        <h1 className="font-display text-2xl">Seattle Cup · Matchup Room</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          No locked roster snapshot found. Import the tournament spreadsheet first.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl leading-none">Seattle Cup · Matchup Room</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            2026 · {team} · Round {round.round} · {round.format} @ {round.courseLabel}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/igc/seattle-cup/scouting">Scouting board</Link>
        </Button>
      </div>

      <MatchupRoom
        roster={roster}
        rounds={rounds}
        slots={slots}
        lineup={lineup}
        team={team}
        teams={teams}
        round={round}
        evidence={evidence}
      />
    </div>
  )
}