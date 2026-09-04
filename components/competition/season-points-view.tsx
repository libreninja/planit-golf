// Season Points view — the cumulative season-points table. The Season Points /
// Weekly-Live switch is hoisted into the server wrapper (ViewTabs), and the
// weekly occurrence selector is intentionally NOT rendered here: Season Points
// is a single cumulative standings table, not a per-week occurrence, so
// selecting "Week 24 Season Points" as if it were a weekly leaderboard does not
// make sense (P1/P4). The table is bounded to the viewport with a sticky header
// so the page does not become an enormous vertical document — controls stay
// accessible while the standings scroll within a fixed-height region (P2).

import type { SeasonPointsRow } from '@/lib/competition/reconcile/season-points'
import Link from 'next/link'
import { playerDetailHref } from '@/lib/players/links'

export function SeasonPointsView({
  rows,
  golferIdsByMemberCard,
}: {
  rows: SeasonPointsRow[]
  golferIdsByMemberCard: Record<string, string>
}) {
  return (
    <section className="space-y-4">
      <div className="overflow-hidden rounded-md border border-border">
        {/* Bounded, viewport-aware scroll region: the standings scroll while the
            header (and the controls above) stay put. max-h keeps the page from
            growing unbounded; no players are hidden or paginated. */}
        <div className="max-h-[60vh] overflow-y-auto">
          <div className="sticky top-0 z-10 grid grid-cols-[3rem_1fr_6rem_5rem_5rem] gap-2 border-b border-border bg-muted/85 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
            <div>Pos</div>
            <div>Player</div>
            <div className="text-right">Points</div>
            <div className="text-right">Prev</div>
            <div className="text-right">Played</div>
          </div>
          <div className="divide-y divide-border">
            {rows.map((r) => {
              const golferId = golferIdsByMemberCard[r.member_card_id]
              return (
                <div key={r.member_card_id} className="grid grid-cols-[3rem_1fr_6rem_5rem_5rem] gap-2 px-3 py-1.5 text-sm">
                  <div className="font-medium tabular-nums">{r.position}</div>
                  <div className="truncate">
                    {golferId ? (
                      <Link
                        className="font-medium underline-offset-4 hover:text-primary hover:underline"
                        href={playerDetailHref({ golferId, returnTo: '/igc/mens-league?view=season' })}
                      >
                        {r.player_name ?? r.member_card_id}
                      </Link>
                    ) : (r.player_name ?? r.member_card_id)}
                  </div>
                  <div className="text-right tabular-nums">{r.total_points.toFixed(2)}</div>
                  <div className="text-right tabular-nums text-muted-foreground">{r.previous_position ?? '—'}</div>
                  <div className="text-right tabular-nums text-muted-foreground">{r.events_played}</div>
                </div>
              )
            })}
            {rows.length === 0 && (
              <div className="px-3 py-4 text-sm text-muted-foreground">No season standings yet.</div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
