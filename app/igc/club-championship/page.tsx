import { getCompetitionConfig } from '@/lib/competition/registry'
import { getChampionshipAggregate } from '@/lib/competition/aggregate-reader'
import { resolveScoring } from '@/lib/competition/scoring-prefs'
import { ClubChampionshipView } from '@/components/competition/club-championship-view'
import type { ChampionshipAggregate } from '@/lib/competition/aggregate-reader'
import type { ScoringMode } from '@/lib/competition/types'

export const dynamic = 'force-dynamic'

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

  const pollUrl = `/api/competition/championship?competition=${encodeURIComponent(competitionKey)}&championship=${encodeURIComponent(championshipKey)}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold leading-tight sm:text-4xl">{label}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Combined standings across both championship rounds.
        </p>
      </div>
      <ClubChampionshipView
        competitionKey={competitionKey}
        scoringModes={scoringModes}
        initialScoring={scoring}
        initialByScoring={initialByScoring}
        pollUrl={pollUrl}
      />
    </div>
  )
}