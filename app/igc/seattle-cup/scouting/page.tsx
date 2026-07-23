import Link from 'next/link'
import { requireScoutingAccess } from '@/lib/scouting-access'
import * as ai from '@/lib/planit-ai/client'
import { addCandidateAction } from './actions'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

function Hcap({ h }: { h: ai.ScoutingBoardRow['currentHandicap'] }) {
  const sourceLabel =
    h.source === 'ghin' ? 'GHIN' : h.source === 'golf_genius' ? 'Golf Genius' : h.source === 'manual' ? 'manual' : h.source ?? '—'
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium">{h.value != null ? h.value.toFixed(1) : '—'}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{sourceLabel}</span>
      {h.isStale && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">stale</span>}
    </span>
  )
}

export default async function ScoutingBoardPage() {
  const user = await requireScoutingAccess()
  const [board, distribution, addable] = await Promise.all([
    ai.getBoard(),
    ai.getDistribution(),
    ai.getAddablePlayers(),
  ])

  return (
    <main className="min-h-screen">
      <div className="sticky top-0 z-30 border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <p className="font-display text-2xl leading-none">Seattle Cup · Scouting</p>
            <p className="text-xs text-background/70">2026 candidates · {board.length} players</p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10 hover:text-background">
              <Link href="/">Back</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <p className="text-sm text-muted-foreground">
          Signed in as {user.email}. Candidate board data is Golf Genius standings + GHIN/GG handicaps. Scouting notes are
          attributable human observations — record who supplied each.
        </p>

        {/* Distribution */}
        {distribution.length > 0 && (
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-2 text-sm font-semibold">Handicap distribution</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              {distribution.map((b) => (
                <div key={b.label} className="flex items-center gap-1">
                  <span className="font-medium">{b.count}</span>
                  <span className="text-muted-foreground">{b.label}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Board */}
        <section className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2 text-right">Points</th>
                <th className="px-3 py-2 text-right">Events</th>
                <th className="px-3 py-2 text-right">Wins</th>
                <th className="px-3 py-2">Handicap</th>
                <th className="px-3 py-2">Tags</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r) => (
                <tr key={r.playerId} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 text-muted-foreground">{r.currentRank ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Link href={`/igc/seattle-cup/scouting/players/${r.playerId}`} className="font-medium hover:underline">
                      {r.displayName ?? 'Unknown'}
                    </Link>
                    <div className="text-xs text-muted-foreground">GHIN {r.ghinNumber ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-right">{r.totalPoints != null ? r.totalPoints.toFixed(1) : '—'}</td>
                  <td className="px-3 py-2 text-right">{r.numberOfEvents ?? '—'}</td>
                  <td className="px-3 py-2 text-right">{r.numberOfWins ?? '—'}</td>
                  <td className="px-3 py-2"><Hcap h={r.currentHandicap} /></td>
                  <td className="px-3 py-2">{r.tags?.length ? r.tags.join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* Add candidate */}
        {addable.length > 0 && (
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-2 text-sm font-semibold">Add a candidate</h2>
            <form action={addCandidateAction} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Player</label>
                <select name="sourceMemberCardId" className="rounded-md border border-border px-3 py-2">
                  {addable.map((p) => (
                    <option key={p.sourceMemberCardId} value={p.sourceMemberCardId}>
                      {p.displayName ?? p.sourceMemberCardId}
                      {p.currentRank != null ? ` (rank ${p.currentRank})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm">Add candidate</Button>
            </form>
          </section>
        )}
      </div>
    </main>
  )
}