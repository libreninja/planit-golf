import { recordSeattleCupPlayoffResult } from '@/app/seattle-cup-admin-actions'
import { Button } from '@/components/ui/button'
import { ROUND_LIST, SEATTLE_CUP_TEAMS } from '@/lib/seattle-cup/config'
import { getSeattleCupLive } from '@/lib/seattle-cup/live'
import { readSeattleCupPlayoffRecord } from '@/lib/seattle-cup/playoff-store'
import { calculateSeattleCupTournamentResolution } from '@/lib/seattle-cup/resolution'
import { createServiceClient } from '@/lib/supabase/service'
import type { SeattleCupPlayoffRecord } from '@/lib/seattle-cup/playoff-store'
import type { SeattleCupRoundSnapshot, SeattleCupTournamentResolution, TeamKey } from '@/lib/seattle-cup/types'

function label(teamKey: TeamKey): string {
  return SEATTLE_CUP_TEAMS[teamKey].label
}

function pointsFor(
  snapshots: SeattleCupRoundSnapshot[],
  teamKey: TeamKey,
): number | null {
  const standings = [...snapshots]
    .sort((a, b) => {
      const totalA = a.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      const totalB = b.overallStandings.reduce((sum, standing) => sum + standing.totalPoints, 0)
      return totalB - totalA || b.fetchedAt - a.fetchedAt
    })[0]?.overallStandings
  return standings?.find((standing) => standing.teamKey === teamKey)?.totalPoints ?? null
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

async function actorLabels(record: SeattleCupPlayoffRecord | null): Promise<Map<string, string>> {
  const ids = [...new Set([record?.recordedByUserId, record?.updatedByUserId].filter((id): id is string => Boolean(id)))]
  if (ids.length === 0) return new Map()
  const service = createServiceClient()
  const { data } = await service.from('profiles').select('id, display_name, email').in('id', ids)
  return new Map((data ?? []).map((profile) => [
    profile.id as string,
    (profile.display_name || profile.email || profile.id) as string,
  ]))
}

function PlayoffForm({
  resolution,
  record,
  correction = false,
}: {
  resolution: SeattleCupTournamentResolution
  record: SeattleCupPlayoffRecord | null
  correction?: boolean
}) {
  return (
    <form action={recordSeattleCupPlayoffResult} className="mt-4 max-w-xl space-y-3">
      <div>
        <label htmlFor={correction ? 'correct-winner' : 'playoff-winner'} className="mb-1 block text-sm font-medium">
          Winning team
        </label>
        <select
          id={correction ? 'correct-winner' : 'playoff-winner'}
          name="winnerTeamKey"
          required
          defaultValue={record?.winnerTeamKey ?? ''}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        >
          <option value="" disabled>Select the playoff winner…</option>
          {resolution.tiedTeamKeys.map((teamKey) => (
            <option key={teamKey} value={teamKey}>{label(teamKey)}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={correction ? 'correct-notes' : 'playoff-notes'} className="mb-1 block text-sm font-medium">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id={correction ? 'correct-notes' : 'playoff-notes'}
          name="notes"
          maxLength={2000}
          rows={3}
          defaultValue={record?.notes ?? ''}
          placeholder="Players, playoff hole, or short result description"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <Button type="submit" variant={correction ? 'outline' : 'default'}>
        {correction ? 'Save corrected playoff result' : 'Record playoff result'}
      </Button>
    </form>
  )
}

export async function TournamentResolutionAdmin() {
  let snapshots: SeattleCupRoundSnapshot[]
  let record: SeattleCupPlayoffRecord | null
  try {
    ;[snapshots, record] = await Promise.all([
      Promise.all(ROUND_LIST.map((round) => getSeattleCupLive({ round: round.round }))),
      readSeattleCupPlayoffRecord(),
    ])
  } catch (error) {
    console.error('[admin/seattle-cup] tournament resolution load failed:', error)
    return (
      <section className="rounded-md border border-border bg-white/80 p-4">
        <h2 className="font-semibold">Tournament resolution</h2>
        <p className="mt-1 text-sm text-destructive">Resolution status is temporarily unavailable.</p>
      </section>
    )
  }

  const resolution = calculateSeattleCupTournamentResolution(snapshots, record)
  const actors = await actorLabels(record)
  const storedRecordIsApplicable = resolution.status === 'playoff-winner'

  return (
    <section className="rounded-md border border-border bg-white/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Seattle Cup</p>
          <h2 className="text-lg font-semibold">Tournament resolution</h2>
        </div>
        {resolution.status === 'playoff-required' ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Tiebreak required</span>
        ) : resolution.status === 'playoff-winner' ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">Resolved</span>
        ) : null}
      </div>

      {resolution.status === 'active' ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Competition is still active. No tournament tiebreak action is available.
        </p>
      ) : null}

      {resolution.status === 'points-winner' ? (
        <div className="mt-3 text-sm">
          <p><span className="font-medium">Winner:</span> {label(resolution.winnerTeamKey!)}</p>
          <p className="text-muted-foreground">Resolved by final tournament points. No tiebreak required.</p>
        </div>
      ) : null}

      {resolution.tiedTeamKeys.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {resolution.tiedTeamKeys.map((teamKey) => (
            <span key={teamKey}><span className="font-medium">{label(teamKey)}</span> {pointsFor(snapshots, teamKey) ?? '—'}</span>
          ))}
        </div>
      ) : null}

      {resolution.headToHeadWins ? (
        <div className="mt-4 max-w-sm">
          <h3 className="text-sm font-semibold">Head-to-head match wins</h3>
          <dl className="mt-1 space-y-1 text-sm">
            {resolution.tiedTeamKeys.map((teamKey) => (
              <div key={teamKey} className="flex justify-between gap-4">
                <dt>{label(teamKey)}</dt>
                <dd className="font-semibold tabular-nums">{resolution.headToHeadWins?.[teamKey] ?? 0}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {resolution.status === 'head-to-head-winner' ? (
        <div className="mt-4 text-sm">
          <p><span className="font-medium">Winner:</span> {label(resolution.winnerTeamKey!)}</p>
          <p className="text-muted-foreground">Resolved by head-to-head match wins. No manual selection is permitted.</p>
        </div>
      ) : null}

      {resolution.status === 'playoff-required' ? (
        <div className="mt-4">
          <h3 className="font-semibold">Sudden-death fourball playoff</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Record the winning team only after the official out-of-band playoff is complete.
          </p>
          <PlayoffForm resolution={resolution} record={null} />
        </div>
      ) : null}

      {resolution.status === 'playoff-winner' && record ? (
        <div className="mt-4 text-sm">
          <p className="text-base"><span className="font-semibold">Winner:</span> {label(resolution.winnerTeamKey!)}</p>
          <p className="text-muted-foreground">Resolved by sudden-death fourball playoff.</p>
          {record.notes ? <p className="mt-2 whitespace-pre-wrap">{record.notes}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Recorded {formatDate(record.resolvedAt)} by {record.recordedByUserId ? actors.get(record.recordedByUserId) ?? record.recordedByUserId : 'unknown user'}.
            {record.updatedAt !== record.createdAt
              ? ` Last corrected by ${record.updatedByUserId ? actors.get(record.updatedByUserId) ?? record.updatedByUserId : 'unknown user'} on ${formatDate(record.updatedAt)}.`
              : ''}
          </p>
          <details className="mt-4 rounded-md border border-border p-3">
            <summary className="cursor-pointer font-medium">Correct recorded playoff result</summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Use only to correct an entry mistake. This cannot override Golf Genius points or the official head-to-head rule.
            </p>
            <PlayoffForm resolution={resolution} record={record} correction />
          </details>
        </div>
      ) : null}

      {record && !storedRecordIsApplicable ? (
        <p className="mt-4 text-xs text-amber-800">
          A stored playoff record exists but is not applied because the current rules-derived state does not require the same playoff.
        </p>
      ) : null}
    </section>
  )
}
