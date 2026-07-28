import type { SeasonPointsRow } from '@/lib/igc/weekly-results'

// Men's cumulative season-points race, read from the persisted
// igc_league_season_points snapshot (derived by the sync from the
// event.season_points array — GG exposes no standings endpoint). Shows rank,
// rank movement vs the previous round, player, rounds played, wins, total
// points, and points behind the leader. Birdie/double aggregates are not a
// season-points concept and are deliberately not shown here.
export function SeasonPointsTable({ rows }: { rows: SeasonPointsRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No season points standings available yet.
      </p>
    )
  }

  const leaderPoints = rows.find((r) => r.rank === 1)?.totalPoints ?? null

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 w-16">#</th>
            <th className="px-3 py-2">Player</th>
            <th className="px-3 py-2 text-right">Rounds</th>
            <th className="px-3 py-2 text-right">Wins</th>
            <th className="px-3 py-2 text-right">Points</th>
            <th className="px-3 py-2 text-right">Behind</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const behind =
              s.pointsBehind !== null && leaderPoints !== null
                ? leaderPoints - (s.totalPoints ?? 0)
                : null
            const isLeader = s.rank === 1
            return (
              <tr key={s.playerName ?? i} className="border-t border-border">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5 tabular-nums">
                    <span className="text-muted-foreground">{s.rank ?? '—'}</span>
                    <MovementBadge movement={s.movement} previousRank={s.previousRank} />
                  </div>
                </td>
                <td className={`px-3 py-2 font-medium ${isLeader ? '' : ''}`}>
                  {s.playerName ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {s.eventsPlayed || '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {s.wins > 0 ? s.wins : '—'}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {s.totalPoints != null ? formatPoints(s.totalPoints) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {behind !== null && behind > 0 ? `-${formatPoints(behind)}` : isLeader ? '—' : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MovementBadge({
  movement,
  previousRank,
}: {
  movement: SeasonPointsRow['movement']
  previousRank: number | null
}) {
  if (movement === 'up') {
    return (
      <span className="text-emerald-600 dark:text-emerald-400" title={`Up from #${previousRank}`}>
        ▲
      </span>
    )
  }
  if (movement === 'down') {
    return (
      <span className="text-rose-600 dark:text-rose-400" title={`Down from #${previousRank}`}>
        ▼
      </span>
    )
  }
  if (movement === 'new') {
    return (
      <span className="text-xs text-muted-foreground" title="New to the standings">
        new
      </span>
    )
  }
  return null
}

function formatPoints(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}