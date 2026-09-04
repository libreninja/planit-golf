import { createClient } from '@/lib/supabase/server'
import { getLiveResults } from '@/lib/competition/live'
import { IGC_MENS_2026_SCOPE } from './identity'
import {
  derivePlayerDetail,
  type PlayerDetailModel,
  type PlayerEventFact,
  type PlayerPerformanceFact,
  type PlayerResultFact,
} from './player-detail'

export interface MensPlayerDetailData {
  golferId: string
  displayName: string
  memberCardId: string
  handicapSnapshot: { value: string; asOf: string | null } | null
  model: PlayerDetailModel
  viewer: {
    signedIn: boolean
    isFollowing: boolean
    isSelf: boolean
  }
}

export async function getResolvedGolferIdsForMens2026(): Promise<Record<string, string>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('golfer_external_identities')
    .select('external_id, golfer_id')
    .eq('source_system', 'golf_genius')
    .eq('scope_type', 'competition_season')
    .eq('scope_key', IGC_MENS_2026_SCOPE)
    .eq('resolution_status', 'resolved')
    .not('golfer_id', 'is', null)
    .limit(1000)

  if (error || !data) return {}
  return Object.fromEntries(
    data
      .filter((row) => typeof row.external_id === 'string' && typeof row.golfer_id === 'string')
      .map((row) => [row.external_id as string, row.golfer_id as string]),
  )
}

export async function getMensPlayerDetail(
  golferId: string,
  selectedWeek: number | null,
): Promise<MensPlayerDetailData | null> {
  const supabase = await createClient()
  const [golferRes, identityRes] = await Promise.all([
    supabase.from('golfers').select('id, display_name').eq('id', golferId).maybeSingle(),
    supabase
      .from('golfer_external_identities')
      .select('external_id')
      .eq('golfer_id', golferId)
      .eq('source_system', 'golf_genius')
      .eq('scope_type', 'competition_season')
      .eq('scope_key', IGC_MENS_2026_SCOPE)
      .eq('resolution_status', 'resolved')
      .limit(2),
  ])
  if (golferRes.error || identityRes.error || !golferRes.data || identityRes.data?.length !== 1) return null

  const memberCardId = identityRes.data[0].external_id as string
  const [eventsRes, performancesRes, resultsRes, seasonRes, memberRes, authRes] = await Promise.all([
    supabase
      .from('igc_league_events')
      .select('week_number, event_name, event_date, event_format')
      .eq('league_key', 'mens')
      .gte('event_date', '2026-01-01')
      .lt('event_date', '2027-01-01')
      .order('event_date', { ascending: true })
      .limit(200),
    supabase
      .from('igc_league_performances')
      .select('week_number, player_name, gross_scores, net_scores, to_par_gross, to_par_net, gross_total, net_total, to_par_gross_total, to_par_net_total, holes_completed, scorecard_status')
      .eq('league_key', 'mens')
      .eq('member_card_id', memberCardId)
      .gte('event_date', '2026-01-01')
      .lt('event_date', '2027-01-01')
      .limit(200),
    supabase
      .from('igc_league_results')
      .select('week_number, competition, position_label, flight_name, points')
      .eq('league_key', 'mens')
      .eq('member_card_id', memberCardId)
      .limit(500),
    supabase
      .from('igc_league_season_points')
      .select('position, total_points')
      .eq('league_key', 'mens')
      .eq('member_card_id', memberCardId)
      .maybeSingle(),
    supabase
      .from('igc_league_members')
      .select('handicap_index, synced_at')
      .eq('league_key', 'mens')
      .eq('member_card_id', memberCardId)
      .maybeSingle(),
    supabase.auth.getUser(),
  ])

  if (eventsRes.error || performancesRes.error || resultsRes.error) return null
  const events: PlayerEventFact[] = (eventsRes.data ?? []).map((event) => ({
    week: event.week_number as number,
    eventName: event.event_name as string,
    eventDate: event.event_date as string | null,
    format: (event.event_format ?? 'unknown') as PlayerEventFact['format'],
  }))
  const eventWeeks = new Set(events.map((event) => event.week))
  const performances: PlayerPerformanceFact[] = (performancesRes.data ?? []).map((performance) => ({
    week: performance.week_number as number,
    playerName: performance.player_name as string,
    grossScores: (performance.gross_scores ?? []) as (number | null)[],
    netScores: (performance.net_scores ?? []) as (number | null)[],
    toParGross: (performance.to_par_gross ?? []) as (number | null)[],
    toParNet: (performance.to_par_net ?? []) as (number | null)[],
    grossTotal: performance.gross_total as number | null,
    netTotal: performance.net_total as number | null,
    toParGrossTotal: performance.to_par_gross_total as number | null,
    toParNetTotal: performance.to_par_net_total as number | null,
    holesCompleted: (performance.holes_completed ?? 0) as number,
    scorecardStatus: performance.scorecard_status as string | null,
  }))
  const results: PlayerResultFact[] = (resultsRes.data ?? [])
    .filter((result) => eventWeeks.has(result.week_number as number))
    .map((result) => ({
      week: result.week_number as number,
      competition: result.competition as PlayerResultFact['competition'],
      positionLabel: result.position_label as string | null,
      flightName: result.flight_name as string | null,
      points: result.points === null ? null : Number(result.points),
    }))

  // Persisted rows are authoritative for completed rounds. If the originating
  // occurrence is not durably complete yet, read the same live competition
  // path the leaderboard uses so Player Detail preserves a live/partial source
  // week instead of silently spotlighting the golfer's previous result.
  const selectedEvent = selectedWeek === null ? null : events.find((event) => event.week === selectedWeek) ?? null
  const selectedStored = selectedWeek === null ? null : performances.find((performance) => performance.week === selectedWeek) ?? null
  const selectedStoredComplete = !!selectedStored
    && selectedStored.scorecardStatus?.toLowerCase() === 'completed'
    && selectedStored.holesCompleted === 9
  if (selectedEvent && !selectedStoredComplete) {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    if (selectedEvent.eventDate && selectedEvent.eventDate <= today) {
      try {
        const nowIso = new Date().toISOString()
        const [grossLive, netLive] = await Promise.all([
          getLiveResults({ competitionKey: 'mens-league', occurrenceId: String(selectedEvent.week), scoring: 'gross', nowIso }),
          getLiveResults({ competitionKey: 'mens-league', occurrenceId: String(selectedEvent.week), scoring: 'net', nowIso }),
        ])
        const liveCard = grossLive.leaderboard?.scorecards.find((card) => card.memberCardId === memberCardId)
          ?? netLive.leaderboard?.scorecards.find((card) => card.memberCardId === memberCardId)
          ?? null
        if (liveCard) {
          const state: PlayerPerformanceFact['state'] = grossLive.resultStatus === 'live' || netLive.resultStatus === 'live'
            ? 'live'
            : grossLive.resultStatus === 'final' && liveCard.holesCompleted === 9
              ? 'final'
              : 'incomplete'
          const livePerformance: PlayerPerformanceFact = {
            week: selectedEvent.week,
            playerName: liveCard.name,
            grossScores: liveCard.holes.map((hole) => hole.gross),
            netScores: liveCard.holes.map((hole) => hole.net),
            toParGross: liveCard.holes.map((hole) => hole.toParGross),
            toParNet: liveCard.holes.map((hole) => hole.toPar),
            grossTotal: liveCard.grossTotal,
            netTotal: liveCard.netTotal,
            toParGrossTotal: liveCard.toParGross,
            toParNetTotal: liveCard.toParNet,
            holesCompleted: liveCard.holesCompleted,
            scorecardStatus: liveCard.scorecardStatus,
            state,
          }
          const storedIndex = performances.findIndex((performance) => performance.week === selectedEvent.week)
          if (storedIndex >= 0) performances[storedIndex] = livePerformance
          else performances.push(livePerformance)

          for (const [competition, response] of [['gross', grossLive], ['net', netLive]] as const) {
            const entry = response.leaderboard?.entries.find((item) => item.key === liveCard.key)
            if (!entry) continue
            const resultIndex = results.findIndex((result) => result.week === selectedEvent.week && result.competition === competition)
            const fact: PlayerResultFact = {
              week: selectedEvent.week,
              competition,
              positionLabel: entry.positionLabel,
              flightName: entry.flight,
              points: entry.points,
            }
            if (resultIndex >= 0) results[resultIndex] = fact
            else results.push(fact)
          }
        }
      } catch {
        // The durable evidence record remains usable if GG is unavailable. An
        // explicit source week with no row renders honestly empty, never as a
        // different week's result.
      }
    }
  }
  const seasonRow = seasonRes.data
  const model = derivePlayerDetail({
    events,
    performances,
    results,
    season: seasonRow ? {
      rank: seasonRow.position as number | null,
      points: seasonRow.total_points === null ? null : Number(seasonRow.total_points),
    } : null,
    selectedWeek,
  })

  const user = authRes.data.user
  let isFollowing = false
  let isSelf = false
  if (user) {
    const [followRes, selfRes] = await Promise.all([
      supabase
        .from('golfer_follows')
        .select('golfer_id')
        .eq('user_id', user.id)
        .eq('golfer_id', golferId)
        .maybeSingle(),
      supabase
        .from('golfer_user_links')
        .select('golfer_id')
        .eq('user_id', user.id)
        .eq('golfer_id', golferId)
        .maybeSingle(),
    ])
    isFollowing = !followRes.error && !!followRes.data
    isSelf = !selfRes.error && !!selfRes.data
  }

  const handicap = memberRes.data?.handicap_index
  return {
    golferId,
    displayName: golferRes.data.display_name as string,
    memberCardId,
    handicapSnapshot: handicap !== null && handicap !== undefined && String(handicap).trim() !== ''
      ? { value: String(handicap), asOf: (memberRes.data?.synced_at as string | null) ?? null }
      : null,
    model,
    viewer: {
      signedIn: !!user,
      isFollowing,
      isSelf,
    },
  }
}
