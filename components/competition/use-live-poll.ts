'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LiveResponse, ScoringMode } from '@/lib/competition/types'
import { nextPollDecision } from './next-poll-decision'
import { applyResponse } from './request-generation'

const LIVE_POLL_MS = 60_000
// Also serves as the low-frequency membership check after scoring is final.
// FINAL + PROJECTED remains on this cadence until official membership arrives.
const FINAL_POLL_MS = 5 * 60_000
const FINAL_POLL_BOUND_MS = 90 * 60_000

export function useLivePoll({
  initial, pollUrl, scoring, supportsLive, initialIsHistoricalFinal, awaitingOfficialFlights = false,
}: {
  initial: LiveResponse | null
  pollUrl: string | null
  scoring: ScoringMode
  supportsLive: boolean
  initialIsHistoricalFinal: boolean
  awaitingOfficialFlights?: boolean
}) {
  const [data, setData] = useState<LiveResponse | null>(initial)
  const [refreshing, setRefreshing] = useState(false)
  const [showingLastKnown, setShowingLastKnown] = useState(false)
  const finalSinceRef = useRef<number | null>(null)
  const dataRef = useRef(data)
  dataRef.current = data
  // Request-generation token: bumped on every scoring/occurrence change so
  // in-flight fetches for a previous mode are ignored (Correction 8).
  const genRef = useRef(0)

  // scoring is part of the poll URL so a scoring-mode change fetches the right
  // competition; it is also in the refresh callback's deps.
  const urlWithScoring = pollUrl
    ? `${pollUrl}${pollUrl.includes('?') ? '&' : '?'}scoring=${encodeURIComponent(scoring)}`
    : null

  // Bump the generation, adopt the newly preloaded data, and reset polling
  // state whenever occurrence/scoring changes. The workspace no longer needs
  // a scoring-key remount, so its control surface and flight selection survive
  // an orthogonal Gross/Net toggle.
  useEffect(() => {
    genRef.current += 1
    finalSinceRef.current = null
    setData(initial)
    setRefreshing(false)
    setShowingLastKnown(false)
  }, [pollUrl, scoring, initial])

  // refresh returns the fresh LiveResponse (or null) so the scheduler can
  // decide the next poll from post-refresh state. It applies its result only
  // when its captured generation still matches genRef.current.
  const refresh = useCallback(async (): Promise<LiveResponse | null> => {
    if (!urlWithScoring) return null
    const gen = genRef.current          // capture generation at issue time
    setRefreshing(true)
    try {
      const res = await fetch(urlWithScoring, { cache: 'no-store' })
      if (!res.ok) throw new Error(`refresh ${res.status}`)
      const json = (await res.json()) as { results?: LiveResponse }
      if (json.results && gen === genRef.current) {
        // applyResponse guards the generation again, but the gen check above
        // already ensures we only setData for the current generation.
        setData((cur) => applyResponse(cur, { gen, data: json.results! }, genRef.current))
        setShowingLastKnown(false)
        return json.results
      }
      return null
    } catch {
      // stale-while-error: keep last good data mounted (dataRef) and flag it.
      if (gen === genRef.current) setShowingLastKnown(true)
      return null
    } finally {
      if (gen === genRef.current) setRefreshing(false)
    }
  }, [urlWithScoring])

  useEffect(() => {
    if (!supportsLive || !urlWithScoring || initialIsHistoricalFinal && !awaitingOfficialFlights) return

    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const onVis = () => {
      if (cancelled) return
      if (!document.hidden) {
        // Tab became visible: immediate refresh, then re-schedule from the
        // fresh response (awaited) so the decision uses post-refresh state.
        void refresh().then(() => { if (!cancelled) schedule() }).catch(() => {})
      }
      schedule()
    }

    // schedule accepts the freshest LiveResponse (from the just-awaited
    // refresh) so the next decision reads post-refresh status, not the
    // pre-refresh dataRef snapshot (Correction 8).
    const schedule = (fresh?: LiveResponse | null) => {
      if (timer) { clearTimeout(timer); timer = null }
      const d = fresh ?? dataRef.current
      const status = d?.resultStatus ?? 'unknown'
      if (status === 'final' && finalSinceRef.current === null) finalSinceRef.current = Date.now()
      const decision = nextPollDecision(
        {
          resultStatus: status,
          durableCurrent: d?.leaderboard?.durableCurrent ?? false,
          finalSinceMs: finalSinceRef.current,
          nowMs: Date.now(),
          supportsLive,
          visible: !document.hidden,
          initialIsHistoricalFinal,
          flightMembershipStatus: d?.flightMembership?.status ?? 'unavailable',
          awaitingOfficialFlights,
        },
        { livePollMs: LIVE_POLL_MS, finalPollMs: FINAL_POLL_MS, finalPollBoundMs: FINAL_POLL_BOUND_MS },
      )
      if (decision.action === 'poll') {
        timer = setTimeout(async () => {
          // await refresh() BEFORE schedule() so the next decision uses the
          // post-refresh response, not the pre-refresh state.
          const r = await refresh().catch(() => null)
          if (cancelled) return
          schedule(r)
        }, decision.delayMs)
      }
    }

    // A live Gross/Net toggle remounts with a null initial for the newly
    // selected mode. Fetch immediately (the shell has already warmed the URL)
    // instead of showing an empty state until the first 60-second tick.
    if (!initial) void refresh().then((fresh) => { if (!cancelled) schedule(fresh) }).catch(() => {})
    else schedule()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
    // Re-schedule when scoring or occurrence changes (pollUrl). `data` is read
    // via dataRef so it doesn't need to be a dep. The generation bump effect
    // invalidates any in-flight previous-mode response.
  }, [supportsLive, urlWithScoring, refresh, initialIsHistoricalFinal, awaitingOfficialFlights, scoring, pollUrl, initial])

  // Effects adopt a new preloaded scoring dataset immediately after render.
  // During that one render, never pair the newly selected toggle with rows
  // from the previous scoring mode.
  const visibleData = data?.leaderboard && data.leaderboard.scoringMode !== scoring
    ? initial
    : data

  return { data: visibleData, refreshing, showingLastKnown, refresh }
}
