// Season Points view — renders the cumulative season-points table inside the
// shared shell's navigation. Receives only generic SeasonPointsRow[] (no
// igc_league_* field names). Reuses OccurrenceNav for week navigation. The
// server wrapper renders this instead of the weekly/live workspace when the
// competition's views include 'season' and the selected view is 'season'.
// See task 26E.

import type { SeasonPointsRow } from '@/lib/competition/reconcile/season-points'
import { OccurrenceNav } from './occurrence-nav'

export function SeasonPointsView({
  competitionKey: _competitionKey,
  occurrences,
  selectedOccurrenceId,
  queryParam,
  rows,
}: {
  competitionKey: string
  occurrences: { id: string; label: string }[]
  selectedOccurrenceId: string | null
  queryParam: string
  rows: SeasonPointsRow[]
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <OccurrenceNav occurrences={occurrences} selectedId={selectedOccurrenceId} queryParam={queryParam} />
      </div>
      <div className="overflow-hidden rounded-md border border-border">
        <div className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <div>Pos</div>
          <div>Player</div>
          <div>Points</div>
          <div>Prev</div>
          <div>Played</div>
        </div>
        <div className="divide-y divide-border">
          {rows.map((r) => (
            <div key={r.member_card_id} className="grid grid-cols-[3rem_1fr_5rem_5rem_5rem] gap-2 px-3 py-2 text-sm">
              <div className="font-medium tabular-nums">{r.position}</div>
              <div className="truncate">{r.player_name ?? r.member_card_id}</div>
              <div className="tabular-nums">{r.total_points.toFixed(2)}</div>
              <div className="tabular-nums text-muted-foreground">{r.previous_position ?? '—'}</div>
              <div className="tabular-nums text-muted-foreground">{r.events_played}</div>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="px-3 py-4 text-sm text-muted-foreground">No season standings yet.</div>
          )}
        </div>
      </div>
    </section>
  )
}
