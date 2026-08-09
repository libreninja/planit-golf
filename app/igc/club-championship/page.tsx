import { getCompetitionConfig } from '@/lib/competition/registry'
import { championshipRounds, getChampionshipAggregate } from '@/lib/competition/aggregate-reader'
import { resolveScoring } from '@/lib/competition/scoring-prefs'
import { ClubChampionshipView } from '@/components/competition/club-championship-view'
import type { RoundScheduleItem } from '@/lib/competition/championship-subtitle'
import type { ChampionshipAggregate } from '@/lib/competition/aggregate-reader'
import type { ScoringMode } from '@/lib/competition/types'

export const dynamic = 'force-dynamic'

// Build the round schedule parts (weekday/date strings) for the subtitle.
// Dates are parsed as UTC midnight and formatted in UTC so the weekday is
// stable regardless of the server's local timezone.
function buildSchedule(specs: { championshipRound?: number; date: string }[]): RoundScheduleItem[] {
  return [...specs]
    .sort((a, b) => (a.championshipRound ?? 0) - (b.championshipRound ?? 0))
    .map((s) => {
      const d = new Date(`${s.date}T00:00:00Z`)
      const weekdayShort = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d)
      const weekdayLong = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(d)
      const dateShort = new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(d)
      const dateLong = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d)
      return { round: s.championshipRound ?? 0, weekdayShort, weekdayLong, dateShort, dateLong }
    })
}

interface ClubChampionshipPageProps {
  searchParams: Promise<{ scoring?: string }>
}

// Club Championship aggregate: Monday Round 1 + Tuesday Round 2, summed across
// two occurrences into one leaderboard. This is a cross-occurrence view, so it
// lives at its own route (not inside the occurrence-nav-based standings shell).
// The aggregate is partial-live while Tuesday's scores arrive: Monday (final or
// live) + Tuesday (live) → live aggregate; once both final → final aggregate.
// Both scorings are preloaded server-side so the Gross/Net toggle is an instant
// client swap; the live poll keeps the selected scoring fresh.
export default async function ClubChampionshipPage({ searchParams }: ClubChampionshipPageProps) {
  const sp = await searchParams
  const competitionKey = 'mens-league'
  const championshipKey = 'club-championship'
  const config = getCompetitionConfig(competitionKey)

  if (!config) {
    return <p className="text-sm text-muted-foreground">Unknown competition.</p>
  }

  const scoringModes = config.capabilities.scoring.modes as ScoringMode[]
  const defaultScoring = (scoringModes[0] ?? 'gross') as ScoringMode
  const nowIso = new Date().toISOString()
  // Server can't read the localStorage scoring pref, so resolve from the URL
  // param or the competition default (gross for the championship). The client
  // view applies the stored pref on toggle.
  const scoring: ScoringMode = resolveScoring({
    competitionKey,
    urlValue: (sp.scoring as ScoringMode | undefined) ?? null,
    available: scoringModes,
    defaultMode: defaultScoring,
    store: { getItem: () => null, setItem: () => {} },
  })

  // Preload BOTH scorings so the Gross/Net toggle is instant (no server
  // round-trip). The two fetches are independent — run them concurrently.
  const byScoring = await Promise.all(
    scoringModes.map(async (m) => [m, await getChampionshipAggregate(competitionKey, championshipKey, m, nowIso)] as const),
  )
  const initialByScoring: Record<string, ChampionshipAggregate | null> = {}
  for (const [m, agg] of byScoring) initialByScoring[m] = agg

  const label = initialByScoring[scoring]?.occurrence.label ?? 'Club Championship'
  const { specs } = championshipRounds(competitionKey, championshipKey)
  const roundSchedule = buildSchedule(specs)

  const pollUrl = `/api/competition/championship?competition=${encodeURIComponent(competitionKey)}&championship=${encodeURIComponent(championshipKey)}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{label}</h1>
        {/* The format/status subtitle is rendered live by the view below — it
            reflects the aggregate state (pre-play / live / final) so it stays
            honest as Tuesday's scores arrive. */}
      </div>
      <ClubChampionshipView
        competitionKey={competitionKey}
        scoringModes={scoringModes}
        initialScoring={scoring}
        initialByScoring={initialByScoring}
        pollUrl={pollUrl}
        roundSchedule={roundSchedule}
      />
    </div>
  )
}