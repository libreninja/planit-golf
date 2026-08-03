// Async server component: resolves the competition config + initial data and
// renders either the weekly/live workspace or the season-points view. The
// client shell receives only plain serializable props — no CompetitionConfig
// object crosses the server/client boundary. See task 26D/26E/26F.

import { getCompetitionConfig } from '@/lib/competition/registry'
import { getLiveResults } from '@/lib/competition/live'
import { buildStandingsViewModel } from './standings-view-model'
import { normalizeUrlState } from './url-state'
import { StandingsWorkspace } from './standings-workspace'
import { SeasonPointsView } from './season-points-view'
import { ViewTabs } from './view-tabs'
import {
  buildHistoricalLiveResponse,
  resolveAvailableGroupings,
  resolveOccurrences,
  resolveSeasonPoints,
} from '@/lib/competition/adapters/golfgenius/server-readers'
import { defaultOccurrenceId } from '@/lib/competition/adapters/golfgenius/mapping'
import type { ScoringMode } from '@/lib/competition/types'

export async function StandingsWorkspaceServer({
  competitionKey,
  searchParams,
}: {
  competitionKey: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const config = getCompetitionConfig(competitionKey)
  if (!config) {
    return <p className="text-sm text-muted-foreground">Unknown competition.</p>
  }

  const occurrences = await resolveOccurrences(competitionKey)

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') params.set(k, v)
  }
  const urlState = normalizeUrlState(params, {
    occurrenceParam: config.navigation.queryParam,
    allowedViews: config.capabilities.views,
    allowedScoring: config.capabilities.scoring.modes as ScoringMode[],
  })

  // Default selection: the active (live) occurrence if we're in its window, else
  // the most recent finalized week, else the latest week overall (P3/P5).
  const nowIso = new Date().toISOString()
  const selectedId = urlState.occurrenceId ?? defaultOccurrenceId(occurrences, nowIso)
  const selected = occurrences.find((o) => o.id === selectedId) ?? null
  const initialIsHistoricalFinal = selected?.resultStatus === 'final'

  const defaultScoring = (config.capabilities.scoring.modes[0] ?? 'net') as ScoringMode
  const scoring: ScoringMode = (urlState.scoring as ScoringMode | null) ?? defaultScoring

  const initial = selected && config.capabilities.supportsLiveResults && !initialIsHistoricalFinal
    ? await getLiveResults({ competitionKey, occurrenceId: selected.id, scoring, nowIso })
    : selected
      ? await buildHistoricalLiveResponse(competitionKey, selected, scoring)
      : null

  const vm = buildStandingsViewModel({
    competitionKey,
    occurrences,
    selectedOccurrenceId: selectedId,
    urlState: { view: urlState.view, scoring: urlState.scoring, grouping: urlState.grouping },
    availableScoringModes: config.capabilities.scoring.modes as ScoringMode[],
    storedScoring: null, // server has no localStorage; client resolves stored pref on mount
    availableGroupings: await resolveAvailableGroupings(competitionKey, selectedId),
    resultStatus: selected?.resultStatus ?? 'unknown',
    liveGroupingPolicy: config.liveGroupingPolicy,
    configViews: config.capabilities.views,
    supportsLiveResults: config.capabilities.supportsLiveResults,
    supportsEventNavigation: config.capabilities.supportsEventNavigation,
  })

  const pollUrl = config.capabilities.supportsLiveResults && !initialIsHistoricalFinal && selected
    ? `/api/competition/live?competition=${encodeURIComponent(competitionKey)}&occurrence=${encodeURIComponent(selected.id)}`
    : null

  // ViewTabs are hoisted above the conditional body so the Season Points /
  // Weekly-Live switch is visible from BOTH views (P1). Returns null for a
  // single-view competition (women's).
  const body = vm.view === 'season' && config.capabilities.views.includes('season') ? (
    <SeasonPointsView rows={await resolveSeasonPoints(competitionKey)} />
  ) : (
    // Keyed by occurrence + scoring so navigating weeks (or toggling Gross/Net)
    // remounts the workspace with the new initial data — useLivePoll's
    // useState(initial) only seeds on mount, so without a key the old week's
    // leaderboard would stay mounted after navigation (P5 stale-data fix).
    <StandingsWorkspace
      key={`${vm.selectedOccurrenceId ?? 'none'}-${vm.scoring}`}
      competitionKey={competitionKey}
      occurrences={vm.occurrences}
      selectedOccurrenceId={vm.selectedOccurrenceId}
      queryParam={config.navigation.queryParam}
      scoring={vm.scoring}
      grouping={vm.grouping}
      capabilities={vm.capabilities}
      initial={initial}
      pollUrl={pollUrl}
      initialIsHistoricalFinal={initialIsHistoricalFinal}
    />
  )

  return (
    <section className="space-y-4">
      <ViewTabs views={config.capabilities.views} selectedView={vm.view} />
      {body}
    </section>
  )
}
