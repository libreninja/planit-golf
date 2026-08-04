// Async server component: resolves the competition config + initial data and
// renders either the weekly/live workspace or the season-points view. The
// client shell receives only plain serializable props — no CompetitionConfig
// object crosses the server/client boundary. See task 26D/26E/26F.

import { getCompetitionConfig } from '@/lib/competition/registry'
import { getLiveResults } from '@/lib/competition/live'
import { isOccurrenceActive } from '@/lib/competition/active-window'
import { buildStandingsViewModel } from './standings-view-model'
import { normalizeUrlState } from './url-state'
import { StandingsWorkspace } from './standings-workspace'
import { SeasonPointsView } from './season-points-view'
import { ViewTabs } from './view-tabs'
import { decideInitialRender } from './initial-render-decision'
import {
  buildHistoricalLiveResponse,
  resolveAvailableGroupings,
  resolveHasPostedGolf,
  resolveOccurrences,
  resolveSeasonPoints,
  resolveWeeksWithResults,
} from '@/lib/competition/adapters/golfgenius/server-readers'
import { defaultOccurrenceId } from '@/lib/competition/adapters/golfgenius/mapping'
import type { ResultStatus, ScoringMode } from '@/lib/competition/types'

// Today's calendar date (YYYY-MM-DD) in the league timezone — used to identify
// the play-day occurrence ("Tuesday's event") for the initial-selection rule.
function todayDateInTz(nowIso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowIso))
}

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

  const nowIso = new Date().toISOString()
  const tz = config.schedule?.timezone ?? 'America/Los_Angeles'
  const defaultScoring = (config.capabilities.scoring.modes[0] ?? 'net') as ScoringMode
  const scoring: ScoringMode = (urlState.scoring as ScoringMode | null) ?? defaultScoring

  // ---- Direct evidence for the product-rule initial selection (§3/§4) ----
  // DIRECT evidence — never source_finalized_at / resultStatus (absent for
  // legacy imports). `hasResults` = occurrence ids with stored result rows;
  // `todayId` = the occurrence dated today (the play-day event); `postedGolf`
  // = today's event has any completed scorecard in the DB.
  const weekNumbers = occurrences.map((o) => Number(o.id)).filter((n) => Number.isFinite(n))
  const hasResults = await resolveWeeksWithResults(competitionKey, weekNumbers)
  const todayDate = todayDateInTz(nowIso, tz)
  const todayOccurrence = occurrences.find((o) => o.date === todayDate) ?? null
  const todayId = todayOccurrence?.id ?? null
  const todayHasPostedGolf = todayId ? await resolveHasPostedGolf(competitionKey, Number(todayId)) : false

  // For TODAY's event, also consult the LIVE path (GG) for posted golf — the
  // direct scorecard evidence that golf is happening right now — but ONLY when
  // the adapter is configured (seasonId present). The result is reused as the
  // live initial when today is selected. Skipped in unconfigured envs (no GG
  // call, no latency) where DB evidence alone suffices.
  const ggConfigured = !!config.adapterConfig.seasonId
  const todayLive = (todayId && ggConfigured && config.capabilities.supportsLiveResults)
    ? await getLiveResults({ competitionKey, occurrenceId: todayId, scoring, nowIso })
    : null
  const todayLiveHasGolf = !!(todayLive?.leaderboard?.scorecards.some((c) => c.holesCompleted > 0))

  const selectedId = urlState.occurrenceId ?? defaultOccurrenceId(occurrences, {
    todayId,
    todayHasPostedGolf: todayHasPostedGolf || todayLiveHasGolf,
    hasResults,
  })
  const selected = occurrences.find((o) => o.id === selectedId) ?? null

  // ---- Historical-vs-live render decision (P0) ----
  // Always read the STORED results first; route to live ONLY for today's
  // in-window event with no stored results yet. This makes a completed
  // historical week render its actual leaderboard instead of an empty live
  // fetch (the P0 regression: resultStatus was never 'final' because
  // source_finalized_at is null on legacy imports, so every week took the
  // live path and rendered empty).
  const historical = selected ? await buildHistoricalLiveResponse(competitionKey, selected, scoring) : null
  const hasStoredResults = !!(historical?.leaderboard?.entries?.length && historical.leaderboard.entries.length > 0)
  const todayActive = !!(selected && isOccurrenceActive(selected.activeWindow, nowIso, false))
  const dec = decideInitialRender({
    hasStoredResults,
    todayActive,
    selectedIsToday: selected?.id === todayId,
  })
  const initial = dec.useLivePath
    ? (selected?.id === todayId && todayLive ? todayLive : historical)
    : historical
  const pollUrl = dec.useLivePath && selected
    ? `/api/competition/live?competition=${encodeURIComponent(competitionKey)}&occurrence=${encodeURIComponent(selected.id)}`
    : null

  const vm = buildStandingsViewModel({
    competitionKey,
    occurrences,
    selectedOccurrenceId: selectedId,
    urlState: { view: urlState.view, scoring: urlState.scoring, grouping: urlState.grouping },
    availableScoringModes: config.capabilities.scoring.modes as ScoringMode[],
    storedScoring: null, // server has no localStorage; client resolves stored pref on mount
    availableGroupings: await resolveAvailableGroupings(competitionKey, selectedId),
    // effectiveStatus uses DIRECT evidence (hasStoredResults), so a completed
    // historical week exposes multi-flight grouping capabilities even though
    // its source_finalized_at bookkeeping is null.
    resultStatus: dec.effectiveStatus as ResultStatus,
    liveGroupingPolicy: config.liveGroupingPolicy,
    configViews: config.capabilities.views,
    supportsLiveResults: config.capabilities.supportsLiveResults,
    supportsEventNavigation: config.capabilities.supportsEventNavigation,
  })

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
      initialIsHistoricalFinal={dec.initialIsHistoricalFinal}
    />
  )

  return (
    <section className="space-y-4">
      <ViewTabs views={config.capabilities.views} selectedView={vm.view} />
      {body}
    </section>
  )
}
