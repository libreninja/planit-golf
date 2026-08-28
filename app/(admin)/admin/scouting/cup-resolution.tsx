// Cup Resolution / Tiebreak — compact section in the authenticated Seattle Cup
// admin area (the parent page is guarded by requireAdmin). Everything shown is
// DERIVED from the normalized match data (lib/seattle-cup/resolution.ts); the
// only manual input is the out-of-band sudden-death fourball playoff result,
// recorded through validated server actions (app/seattle-cup-admin-actions.ts).

import { ROUND_LIST, SEATTLE_CUP_TEAMS } from '@/lib/seattle-cup/config'
import { getSeattleCupLive } from '@/lib/seattle-cup/live'
import { calculateSeattleCupTournamentResolution } from '@/lib/seattle-cup/resolution'
import { readSeattleCupPlayoffRecord } from '@/lib/seattle-cup/playoff-store'
import { recordSeattleCupPlayoff, clearSeattleCupPlayoff } from '@/app/seattle-cup-admin-actions'
import { Button } from '@/components/ui/button'
import type { SeattleCupTournamentResolution, TeamKey, TeamStanding } from '@/lib/seattle-cup/types'

function teamLabel(key: TeamKey): string {
  return SEATTLE_CUP_TEAMS[key]?.label ?? key
}

function pointsOf(standings: TeamStanding[], key: TeamKey): string {
  const value = standings.find((s) => s.teamKey === key)?.totalPoints
  return value != null ? String(value) : '—'
}

export async function CupResolutionSection() {
  let resolution: SeattleCupTournamentResolution
  let standings: TeamStanding[] = []
  try {
    const [snapshots, record] = await Promise.all([
      Promise.all(ROUND_LIST.map((definition) => getSeattleCupLive({ round: definition.round }))),
      readSeattleCupPlayoffRecord(),
    ])
    resolution = calculateSeattleCupTournamentResolution(snapshots, record)
    standings = snapshots.find((snapshot) => snapshot.overallStandings.length > 0)?.overallStandings ?? []
  } catch (err) {
    console.warn('[cup-resolution] live data unavailable:', (err as Error).message)
    return (
      <section className="rounded-md border border-border bg-white/80 p-4">
        <h2 className="mb-1 text-lg font-semibold">Cup resolution</h2>
        <p className="text-sm text-muted-foreground">
          Live tournament data is unavailable right now — resolution state will appear once it loads.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-md border border-border bg-white/80 p-4">
      <h2 className="mb-1 text-lg font-semibold">Cup resolution</h2>

      {resolution.status === 'active' && (
        <p className="text-sm text-muted-foreground">
          Tournament in progress — no official Cup winner yet. The winner is resolved automatically
          from final points (plus the published tiebreak rules) once all four rounds are final.
        </p>
      )}

      {resolution.status === 'points-winner' && (
        <p className="text-sm">
          <span className="font-semibold">{teamLabel(resolution.winnerTeamKey as TeamKey)}</span>{' '}
          wins the Seattle Cup — <span className="text-muted-foreground">Resolved by points</span>.
        </p>
      )}

      {resolution.status === 'head-to-head-winner' && (
        <div className="text-sm">
          <p className="mb-1">
            Tied on final points:{' '}
            {resolution.tiedTeamKeys.map((key) => `${teamLabel(key)} (${pointsOf(standings, key)})`).join(' · ')}
          </p>
          <p className="mb-1">
            Head-to-head match wins:{' '}
            {resolution.tiedTeamKeys
              .map((key) => `${teamLabel(key)} ${resolution.headToHeadWins?.[key] ?? 0}`)
              .join(' · ')}
          </p>
          <p>
            <span className="font-semibold">{teamLabel(resolution.winnerTeamKey as TeamKey)}</span>{' '}
            wins the Seattle Cup — <span className="text-muted-foreground">Resolved by head-to-head match wins</span>.
          </p>
        </div>
      )}

      {(resolution.status === 'playoff-required' || resolution.status === 'playoff-winner') && (
        <div className="text-sm">
          <p className="mb-1 font-semibold">TIEBREAK REQUIRED — sudden-death fourball playoff</p>
          <p className="mb-2">
            Tied on final points:{' '}
            {resolution.tiedTeamKeys.map((key) => `${teamLabel(key)} (${pointsOf(standings, key)})`).join(' · ')}
          </p>
          {resolution.status === 'playoff-winner' ? (
            <div>
              <p>
                <span className="font-semibold">{teamLabel(resolution.winnerTeamKey as TeamKey)}</span>{' '}
                wins the Seattle Cup — <span className="text-muted-foreground">Resolved by the recorded playoff result</span>.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Recorded {resolution.playoff?.resolvedAt ? new Date(resolution.playoff.resolvedAt).toLocaleString() : '—'}
                {resolution.playoff?.notes ? ` · ${resolution.playoff.notes}` : ''}
              </p>
              <form action={clearSeattleCupPlayoff} className="mt-2">
                <Button type="submit" variant="outline" size="sm">Delete recorded result</Button>
              </form>
            </div>
          ) : (
            <form action={recordSeattleCupPlayoff} className="space-y-2">
              <select
                name="winnerTeamKey"
                required
                defaultValue=""
                className="w-full rounded-md border border-border px-3 py-2"
              >
                <option value="" disabled>
                  Select the playoff winner…
                </option>
                {resolution.tiedTeamKeys.map((key) => (
                  <option key={key} value={key}>{teamLabel(key)}</option>
                ))}
              </select>
              <input
                name="notes"
                type="text"
                placeholder="Notes (optional) — e.g. players, hole"
                className="w-full rounded-md border border-border px-3 py-2"
              />
              <Button type="submit" size="sm">Record playoff winner</Button>
            </form>
          )}
        </div>
      )}
    </section>
  )
}