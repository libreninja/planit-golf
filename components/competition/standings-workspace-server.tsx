// Async server component: resolves the competition config + initial data and
// hands a fully-preloaded, serializable prop bundle to the unified client shell
// (P1-1 / P1-2). The shell toggles Season Points ↔ Weekly/Live and Gross ↔ Net
// as pure client state — no server round-trip — so the server must preload both
// scorings for a finalized week and the season-points rows up front. The live
// path preloads only the current scoring (the shell prefetches the other).
//
// No CompetitionConfig object crosses the server/client boundary — only plain
// serializable props. See task 26D/26E/26F + P1-1/P1-2.

import { getCompetitionConfig } from '@/lib/competition/registry'
import { getLiveResults } from '@/lib/competition/live'
import { isOccurrenceActive } from '@/lib/competition/active-window'
import { reconcileOccurrenceOnDemand } from '@/lib/competition/reconcile/reconcile'
import { buildStandingsViewModel } from './standings-view-model'
import { normalizeUrlState } from './url-state'
import { StandingsShell } from './standings-shell'
import { decideInitialRender } from './initial-render-decision'
import {
  buildHistoricalLiveResponse,
  resolveAvailableGroupings,
  resolveHasPostedGolf,
  resolveOccurrences,
  resolveSeasonPoints,
  resolveWeeksWithResults,
} from '@/lib/competition/adapters/golfgenius/server-readers'
import { defaultOccurrenceId, latestNonFutureWeeks } from '@/lib/competition/adapters/golfgenius/mapping'
import type { LiveResponse, ResultStatus, ScoringMode } from '@/lib/competition/types'

// Today's calendar date (YYYY-MM-DD) in the league timezone — used to identify
// the play-day occurrence ("Tuesday's event") for the initial-selection rule.
function todayDateInTz(nowIso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowIso))
}

// The most recent occurrence whose play date has arrived (date <= today) is
// the round that SHOULD be the default view once it has results. The on-demand
// read-through keeps the latest PLAYED (completed) round current on view — see
// latestNonFutureWeeks (mapping.ts) for the bounded newest-first target list.

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

  const nowIso = new Date().toISOString()
  const tz = config.schedule?.timezone ?? 'America/Los_Angeles'

  let occurrences = await resolveOccurrences(competitionKey)

  const todayDate = todayDateInTz(nowIso, tz)

  // ---- Read-through: keep the latest PLAYED round current on view (no cron) ----
  // Try the most recent non-future weeks newest-first (bounded). The first one
  // GG now marks completed is imported + persisted, so every later view reads
  // from disk and the default selection picks up the freshly-stored round. This
  // also covers the "finalized round sits behind today's not-yet-posted round"
  // gap (Women's League): the newest non-future week may be today's unposted
  // round, so we walk back to the latest one that's actually completed. Gated by
  // supportsReconcile + a GG key; the staleness gate inside re-reads at most
  // once/min and skips once durable, so the 5 days/week nothing's pending costs
  // zero GG calls. Stop on the first import, or on a durable/absent week (older
  // weeks are then durable-or-unplayed too). Best-effort: a render never breaks
  // because a GG fetch failed.
  if (process.env.GOLF_GENIUS_API_KEY && config.capabilities.supportsReconcile) {
    // Exclude special occurrences (men's Club Championship 101/102) — they are
    // not weekly reconcile candidates and are kept current by their own path.
    const specialWeeks = new Set((config.adapterConfig.specialOccurrences ?? []).map((s) => s.weekNumber))
    let didImport = false
    for (const week of latestNonFutureWeeks(occurrences, todayDate, 4, specialWeeks)) {
      const res = await reconcileOccurrenceOnDemand(competitionKey, week, nowIso)
      if (res.action === 'imported') { didImport = true; break }
      if (res.action === 'skipped-durable' || res.action === 'skipped-absent' || res.action === 'error') break
      // 'discovered' (not completed yet — today's unposted round) or
      // 'skipped-stale' (re-read <60s ago): walk back to the next older week.
    }
    if (didImport) {
      occurrences = await resolveOccurrences(competitionKey)
    }
  }

  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === 'string') params.set(k, v)
  }
  const urlState = normalizeUrlState(params, {
    occurrenceParam: config.navigation.queryParam,
    allowedViews: config.capabilities.views,
    allowedScoring: config.capabilities.scoring.modes as ScoringMode[],
  })

  const defaultScoring = (config.capabilities.scoring.modes[0] ?? 'net') as ScoringMode
  const scoring: ScoringMode = (urlState.scoring as ScoringMode | null) ?? defaultScoring
  const scoringModes = config.capabilities.scoring.modes as ScoringMode[]

  // ---- Direct evidence for the product-rule initial selection (§3/§4) ----
  // DIRECT evidence — never source_finalized_at / resultStatus (absent for
  // legacy imports). `hasResults` = occurrence ids with stored result rows;
  // `todayId` = the occurrence dated today (the play-day event); `postedGolf`
  // = today's event has any completed scorecard in the DB.
  const weekNumbers = occurrences.map((o) => Number(o.id)).filter((n) => Number.isFinite(n))
  const hasResults = await resolveWeeksWithResults(competitionKey, weekNumbers)
  const todayOccurrence = occurrences.find((o) => o.date === todayDate) ?? null
  const todayId = todayOccurrence?.id ?? null
  const todayHasPostedGolf = todayId ? await resolveHasPostedGolf(competitionKey, Number(todayId)) : false

  // For TODAY's event, also consult the LIVE path (GG) for posted golf — the
  // direct scorecard evidence that golf is happening right now — but ONLY when
  // the GG adapter can actually call upstream (API key present). Discovery
  // resolves the occurrence from persisted hints (gg_event_id on the event row),
  // so it does NOT require seasonId; gating on seasonId wrongly disabled the
  // entire live path in deployments where IGC_*_SEASON_ID is unset. The result
  // is reused as the live initial when today is selected. Skipped only when GG
  // is unreachable (no API key) — DB evidence alone suffices there.
  const ggConfigured = !!process.env.GOLF_GENIUS_API_KEY
  const todayLive = (todayId && ggConfigured && config.capabilities.supportsLiveResults)
    ? await getLiveResults({ competitionKey, occurrenceId: todayId, scoring, nowIso })
    : null
  const todayLiveHasGolf = !!(todayLive?.leaderboard?.scorecards.some((c) => c.holesCompleted > 0))
  // Genuinely in-progress: at least one PARTIAL scorecard (card still on the
  // course). This is the authoritative "golf is happening now" signal that
  // engages the live path even before the nominal playStartLocal — distinct
  // from todayLiveHasGolf, which is also true once a round is finalized. See
  // 2026-08-25 regression (live scores arrived at 15:59, before the 16:00 window).
  const todayLiveInProgress = !!todayLive?.leaderboard?.scorecards.some((c) => c.isLive)

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
    todayLiveHasGolf,
    todayLiveInProgress,
  })
  // A finalized Men’s round can have durable scores before official flight
  // membership exists. Re-enter the existing live response path only for that
  // narrow state so a reload receives a projection and keeps checking at the
  // low-frequency membership cadence. This does not change LIVE score polling
  // or correctly official historical rounds.
  const awaitingOfficialFlights = competitionKey === 'mens-league'
    && selected?.format === 'individual'
    && historical?.resultStatus === 'final'
    && historical.flightMembership?.status !== 'official'
    && ggConfigured
    && config.capabilities.supportsLiveResults
  const membershipLive = awaitingOfficialFlights && selected
    ? (selected.id === todayId && todayLive
      ? todayLive
      : await getLiveResults({ competitionKey, occurrenceId: selected.id, scoring, nowIso }))
    : null
  const useLivePath = dec.useLivePath || awaitingOfficialFlights
  const initial = dec.useLivePath
    ? (selected?.id === todayId && todayLive ? todayLive : historical)
    : (membershipLive ?? historical)
  const pollUrl = useLivePath && selected
    ? `/api/competition/live?competition=${encodeURIComponent(competitionKey)}&occurrence=${encodeURIComponent(selected.id)}`
    : null

  // ---- P1-2: preload BOTH scoring datasets for instant Gross/Net toggle ----
  // Finalized/historical weeks: fetch every scoring from the DB (cheap RLS
  // reads) so a toggle is an instant client remount with preloaded data. Live
  // path: only the current scoring is fetched server-side; the other scoring
  // is fetched client-side via the poll (the shell prefetches its URL so the
  // first toggle is warm and repeated toggles hit the server cache).
  const initialByScoring: Record<string, LiveResponse | null> = {}
  initialByScoring[scoring] = initial
  if (!useLivePath) {
    for (const m of scoringModes) {
      if (m === scoring) continue
      initialByScoring[m] = selected ? await buildHistoricalLiveResponse(competitionKey, selected, m) : null
    }
  } else {
    for (const m of scoringModes) {
      if (!(m in initialByScoring)) initialByScoring[m] = null
    }
  }

  const vm = buildStandingsViewModel({
    competitionKey,
    occurrences,
    selectedOccurrenceId: selectedId,
    urlState: { view: urlState.view, scoring: urlState.scoring, grouping: urlState.grouping },
    availableScoringModes: scoringModes,
    storedScoring: null, // server has no localStorage; client resolves stored pref on toggle
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

  // ---- P1-1: preload Season Points rows so the view switch is instant ----
  // Resolved only when the competition actually has a 'season' view; null
  // otherwise (women's is weekly-only) so the shell never offers a season tab.
  const seasonRows = config.capabilities.views.includes('season')
    ? await resolveSeasonPoints(competitionKey)
    : null

  return (
    <StandingsShell
      competitionKey={competitionKey}
      configViews={config.capabilities.views}
      initialView={vm.view}
      initialScoring={vm.scoring}
      scoringModes={scoringModes}
      seasonRows={seasonRows}
      weekly={{
        occurrences: vm.occurrences,
        selectedOccurrenceId: vm.selectedOccurrenceId,
        queryParam: config.navigation.queryParam,
        grouping: vm.grouping,
        capabilities: vm.capabilities,
        initialByScoring,
        pollUrl,
        initialIsHistoricalFinal: dec.initialIsHistoricalFinal,
        awaitingOfficialFlights,
        useLivePath,
      }}
    />
  )
}
