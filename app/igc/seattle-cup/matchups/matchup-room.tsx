'use client'

// Seattle Cup Matchup Room — the captain's decision-support workspace.
//
// The browser NEVER computes handicap arithmetic. Pair enumeration is pure
// combinatorics done here; every stroke number shown is the deterministic
// engine result returned by planit-ai (saveMatchup returns the consequence, and
// previewMatchup computes a what-if counter without persisting). Locked roster
// course handicaps are read verbatim from the snapshot column named by the
// round descriptor's `handicapField` — never recomputed from Index.
//
// URL-driven: team & round are searchParams (switching refetches server-side).
// Within a (team, round), edits call immediate-save server actions and update
// local state optimistically; errors roll back.

import { useState, useTransition, useEffect, Fragment } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import * as ai from '@/lib/planit-ai/client'
import { evidenceFor, type PlayerEvidence, type EvidenceStrength } from '@/lib/seattle-cup/evidence'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  saveMatchupCall,
  clearMatchupCall,
  lockRoundCall,
  previewMatchupCall,
  setRoundLineupCall,
  clearRoundLineupCall,
  getRoundLineupCall,
  respondAnalysisCall,
  putUpAnalysisCall,
} from './actions'

type ConsequenceMap = Record<number, ai.MatchHandicapResult | null>

// ---- pure helpers (combinatorics only; no handicap math) ----

function playerCourseHandicap(p: ai.RosterPlayer, round: ai.RoundDescriptor): number | null {
  return p[round.handicapField]
}

/** Available team players for a slot: team players not used in OTHER slots. The
 *  slot's own currently-assigned players are kept available (editing in place). */
function availablePlayers(
  teamPlayers: ai.RosterPlayer[],
  slots: ai.MatchupSlot[],
  position: number,
): ai.RosterPlayer[] {
  const usedElsewhere = new Set<string>()
  for (const s of slots) {
    if (s.position === position) continue
    for (const r of s.our) usedElsewhere.add(r.rosterPlayerId)
  }
  return teamPlayers.filter((p) => !usedElsewhere.has(p.id))
}

function legalPairCount(teamSize: number, available: number): number {
  if (teamSize === 1) return available
  return (available * (available - 1)) / 2
}

const STATUS_LABEL: Record<ai.MatchStatus, string> = {
  matched: 'GHIN matched',
  unmatched: 'GHIN unmatched',
  ambiguous: 'GHIN ambiguous',
  name_mismatch: 'name mismatch',
}

// ---- evidence rendering ----
// Real history only. Strength is a sample-size signal (LIMITED/MODERATE/STRONG),
// never a fabricated win probability. Sample size is always shown.

const STRENGTH_VARIANT: Record<EvidenceStrength, 'default' | 'secondary' | 'outline'> = {
  STRONG: 'default',
  MODERATE: 'secondary',
  LIMITED: 'outline',
}

function pct(rate: number | null): string {
  if (rate == null) return '—'
  return `${Math.round(rate * 100)}%`
}

/** One-line evidence summary for table cells / slot cards. Always includes the
 *  sample size (events). */
function evidenceLine(ev: PlayerEvidence): string {
  if (!ev.linked) return 'no linked history'
  const parts: string[] = []
  if (ev.events != null) parts.push(`${ev.events} event${ev.events === 1 ? '' : 's'}`)
  if (ev.wins != null) parts.push(`${ev.wins} W`)
  if (ev.winRate != null) parts.push(`${pct(ev.winRate)} win`)
  if (ev.seattleCupCount != null && ev.seattleCupCount > 0) parts.push(`SC ×${ev.seattleCupCount}`)
  return parts.length ? parts.join(' · ') : 'no league history'
}

function EvidenceStrengthBadge({ ev }: { ev: PlayerEvidence }) {
  if (!ev.linked || !ev.strength) {
    return <span className="text-xs text-muted-foreground">no link</span>
  }
  return <Badge variant={STRENGTH_VARIANT[ev.strength]} className="text-xs">{ev.strength}</Badge>
}

export function MatchupRoom({
  roster,
  rounds,
  slots: initialSlots,
  lineup: initialLineup,
  team,
  teams,
  round,
  evidence,
}: {
  roster: ai.RosterSnapshot
  rounds: ai.RoundDescriptor[]
  slots: ai.MatchupSlot[]
  lineup: ai.RoundLineup | null
  team: string
  teams: string[]
  round: ai.RoundDescriptor
  evidence: Record<string, PlayerEvidence>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const [slots, setSlots] = useState<ai.MatchupSlot[]>(initialSlots)
  const [consequences, setConsequences] = useState<ConsequenceMap>(() => {
    const m: ConsequenceMap = {}
    for (const s of initialSlots) {
      // Consequence isn't returned by the list endpoint; the UI re-derives it
      // lazily via preview for assigned slots on demand. Initialize empty.
      m[s.position] = null
    }
    return m
  })
  const [busyPos, setBusyPos] = useState<number | null>(null)
  const [errPos, setErrPos] = useState<{ pos: number; msg: string } | null>(null)
  const [locking, startLocking] = useTransition()
  const [lockMsg, setLockMsg] = useState<string | null>(null)

  // ---- round lineup (the 12 amateurs fielded for this paired round) ----
  // The 4-layer model: (1) 25-person tournament team → (2) 24 eligible amateurs
  // (pro excluded for R1–R3) → (3) 12 selected round lineup → (4) remaining
  // players after each locked match. The draft board operates on #3/#4 only.
  const [lineupIds, setLineupIds] = useState<Set<string>>(
    () => new Set(initialLineup?.playerIds ?? []),
  )
  const [lineupBusy, startLineupBusy] = useTransition()
  const [lineupMsg, setLineupMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // Keep local lineup state in sync when the team/round changes (URL refetch
  // replaces the server-fetched lineup prop).
  const lineupKey = `${team}-${round.round}`
  const [lastLineupKey, setLastLineupKey] = useState(lineupKey)
  if (lineupKey !== lastLineupKey) {
    setLastLineupKey(lineupKey)
    setLineupIds(new Set(initialLineup?.playerIds ?? []))
    setLineupMsg(null)
  }

  const teamPlayers = roster.players.filter((p) => p.team === team)
  const playerById = new Map(roster.players.map((p) => [p.id, p] as const))
  const usedIds = new Set(slots.flatMap((s) => s.our.map((r) => r.rosterPlayerId)))
  const filled = slots.length
  const allFilled = filled >= round.slots
  const anyLocked = slots.some((s) => s.locked)

  const lineupComplete = lineupIds.size === round.slots * round.teamSize // 12 for paired rounds
  // The eligible amateurs (pro excluded) — the pool the captain selects 12 from.
  const eligibleAms = teamPlayers.filter((p) => !p.isPro)
  const ineligible = teamPlayers.filter((p) => p.isPro)
  // The selected lineup players — the draft board operates on these only.
  const lineupPlayers = eligibleAms.filter((p) => lineupIds.has(p.id))

  function switchTeam(nextTeam: string) {
    const sp = new URLSearchParams(params.toString())
    sp.set('team', nextTeam)
    router.replace(`${pathname}?${sp.toString()}`)
  }
  function switchRound(nextRound: number) {
    const sp = new URLSearchParams(params.toString())
    sp.set('round', String(nextRound))
    router.replace(`${pathname}?${sp.toString()}`)
  }

  async function onSave(
    position: number,
    ourPlayerIds: string[],
    meta: { putUp?: ai.PutUp | null; selectionOrder?: number | null; rationale?: string | null },
  ) {
    setErrPos(null)
    setBusyPos(position)
    try {
      const saved = await saveMatchupCall({
        team,
        round: round.round,
        position,
        ourPlayerIds,
        putUp: meta.putUp ?? null,
        selectionOrder: meta.selectionOrder ?? null,
        rationale: meta.rationale ?? null,
      })
      setSlots((prev) => {
        const without = prev.filter((s) => s.position !== position)
        return [...without, saved.slot].sort((a, b) => a.position - b.position)
      })
      setConsequences((prev) => ({ ...prev, [position]: saved.consequence }))
    } catch (e) {
      setErrPos({ pos: position, msg: (e as Error).message })
    } finally {
      setBusyPos(null)
    }
  }

  async function onClear(position: number) {
    setErrPos(null)
    setBusyPos(position)
    try {
      await clearMatchupCall(team, round.round, position)
      setSlots((prev) => prev.filter((s) => s.position !== position))
      setConsequences((prev) => {
        const next = { ...prev }
        delete next[position]
        return next
      })
    } catch (e) {
      setErrPos({ pos: position, msg: (e as Error).message })
    } finally {
      setBusyPos(null)
    }
  }

  async function onPreviewWhatIf(position: number, ourPlayerIds: string[], opponentPlayerIds: string[]) {
    setBusyPos(position)
    setErrPos(null)
    try {
      const consequence = await previewMatchupCall(team, round.round, ourPlayerIds, opponentPlayerIds)
      setConsequences((prev) => ({ ...prev, [position]: consequence }))
    } catch (e) {
      setErrPos({ pos: position, msg: (e as Error).message })
    } finally {
      setBusyPos(null)
    }
  }

  async function onLock() {
    setLockMsg(null)
    startLocking(async () => {
      try {
        const n = await lockRoundCall(team, round.round)
        setLockMsg(n > 0 ? `Locked ${n} slot${n === 1 ? '' : 's'}.` : 'Already locked.')
        setSlots((prev) => prev.map((s) => ({ ...s, locked: true })))
      } catch (e) {
        setLockMsg(`Lock failed: ${(e as Error).message}`)
      }
    })
  }

  function toggleLineupPlayer(id: string) {
    setLineupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else {
        // Never exceed the required size (12) from the UI either.
        if (next.size >= round.slots * round.teamSize) return prev
        next.add(id)
      }
      return next
    })
    setLineupMsg(null)
  }

  async function onSaveLineup() {
    setLineupMsg(null)
    const ids = Array.from(lineupIds)
    startLineupBusy(async () => {
      try {
        await setRoundLineupCall(team, round.round, ids)
        setLineupMsg({ ok: true, text: `Saved ${ids.length}/12. ${ids.length === 12 ? 'Lineup complete.' : 'Provisional — not yet 12.'}` })
      } catch (e) {
        setLineupMsg({ ok: false, text: (e as Error).message })
      }
    })
  }

  async function onClearLineup() {
    setLineupMsg(null)
    startLineupBusy(async () => {
      try {
        await clearRoundLineupCall(team, round.round)
        setLineupIds(new Set())
        setLineupMsg({ ok: true, text: 'Lineup cleared.' })
      } catch (e) {
        setLineupMsg({ ok: false, text: (e as Error).message })
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Selectors */}
      <div className="flex flex-wrap items-end gap-4 rounded-md border border-border bg-white/80 p-4">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Team</label>
          <select
            value={team}
            onChange={(e) => switchTeam(e.target.value)}
            className="rounded-md border border-border px-3 py-2"
          >
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Round</label>
          <select
            value={round.round}
            onChange={(e) => switchRound(Number(e.target.value))}
            className="rounded-md border border-border px-3 py-2"
          >
            {rounds.map((r) => (
              <option key={r.round} value={r.round}>
                R{r.round} · {r.format} @ {r.courseLabel}
              </option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {filled}/{round.slots} slots assigned
        </div>
      </div>

      {/* Round info */}
      <section className="rounded-md border border-border bg-white/80 p-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-semibold">{round.format}</span>
          <span className="text-sm text-muted-foreground">@ {round.courseLabel}</span>
          <span className="text-sm text-muted-foreground">{round.date}</span>
          <span className="text-sm text-muted-foreground">
            {round.teamSize === 1 ? 'Singles (1v1)' : 'Pairs (2v2)'}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{round.formula}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Locked course handicaps are read verbatim from the roster column{' '}
          <code className="rounded bg-muted px-1">{round.handicapField}</code> — never recomputed.
        </p>
      </section>

      {/* Round lineup selector — select the 12 amateurs to field for this round.
          The head pro is shown separately, marked "Head Pro — Singles only",
          and is NOT selectable for R1–R3. A provisional (<12) lineup is allowed
          for planning; the draft board requires a complete (12) lineup. */}
      <LineupPanel
        round={round}
        eligibleAms={eligibleAms}
        ineligible={ineligible}
        selectedIds={lineupIds}
        complete={lineupComplete}
        busy={lineupBusy}
        msg={lineupMsg}
        onToggle={toggleLineupPlayer}
        onSave={onSaveLineup}
        onClear={onClearLineup}
        evidence={evidence}
      />

      {/* Draft board — operates on the selected 12 only (remaining players
          shrink as matches lock). Gated until the lineup is complete (12). */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Draft board</h2>
        {lineupComplete ? (
          <>
            <RespondPanel round={round} team={team} allPlayers={roster.players} evidence={evidence} />
            <PutUpPanel round={round} team={team} allPlayers={roster.players} evidence={evidence} />
          </>
        ) : null}
        {!lineupComplete ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Select {round.slots * round.teamSize} players for the {round.format} lineup before drafting matches.
            Currently {lineupIds.size}/{round.slots * round.teamSize}.
          </div>
        ) : (
          <>
            {Array.from({ length: round.slots }, (_, i) => i + 1).map((position) => {
              const slot = slots.find((s) => s.position === position) ?? null
              return (
                <SlotCard
                  key={position}
                  position={position}
                  slot={slot}
                  round={round}
                  lineupPlayers={lineupPlayers}
                  allPlayers={roster.players}
                  slots={slots}
                  consequence={consequences[position] ?? null}
                  busy={busyPos === position}
                  error={errPos?.pos === position ? errPos.msg : null}
                  playerById={playerById}
                  evidence={evidence}
                  onSave={onSave}
                  onClear={onClear}
                  onPreviewWhatIf={onPreviewWhatIf}
                />
              )
            })}
          </>
        )}
      </section>

      {/* Lock */}
      <section className="flex items-center gap-3 rounded-md border border-border bg-white/80 p-4">
        <Button onClick={onLock} disabled={!allFilled || locking || anyLocked}>
          {anyLocked ? 'Round locked' : locking ? 'Locking…' : 'Lock round'}
        </Button>
        <p className="text-xs text-muted-foreground">
          {allFilled
            ? 'All slots assigned. Locking finalizes the lineup (draft → final).'
            : `Assign all ${round.slots} slots before locking.`}
        </p>
        {lockMsg ? <span className="text-xs text-muted-foreground">{lockMsg}</span> : null}
      </section>
    </div>
  )
}

// ---- round lineup selector (12 from 24 eligible amateurs) ----

function LineupPanel({
  round,
  eligibleAms,
  ineligible,
  selectedIds,
  complete,
  busy,
  msg,
  onToggle,
  onSave,
  onClear,
  evidence,
}: {
  round: ai.RoundDescriptor
  eligibleAms: ai.RosterPlayer[]
  ineligible: ai.RosterPlayer[]
  selectedIds: Set<string>
  complete: boolean
  busy: boolean
  msg: { ok: boolean; text: string } | null
  onToggle: (id: string) => void
  onSave: () => void
  onClear: () => void
  evidence: Record<string, PlayerEvidence>
}) {
  const required = round.slots * round.teamSize // 12 for paired rounds
  // Sort selected-first then by course handicap (low → high) for a stable scan.
  const sorted = [...eligibleAms].sort((a, b) => {
    const sa = selectedIds.has(a.id) ? 0 : 1
    const sb = selectedIds.has(b.id) ? 0 : 1
    if (sa !== sb) return sa - sb
    return (playerCourseHandicap(a, round) ?? 999) - (playerCourseHandicap(b, round) ?? 999)
  })

  return (
    <section className="rounded-md border border-border bg-white/80 p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold">Round lineup · select {required}</h2>
        <span className={`text-xs ${complete ? 'text-emerald-700' : 'text-amber-700'}`}>
          {selectedIds.size}/{required} selected {complete ? '✓ complete' : '— provisional'}
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Choose the {required} amateurs to field for {round.format} @ {round.courseLabel}. Locked course
        handicaps (column{' '}
        <code className="rounded bg-muted px-1">{round.handicapField}</code>) are shown verbatim. The
        draft board unlocks once the lineup is complete.
      </p>

      {/* Head pro — Singles only, shown separately, not selectable for R1–R3 */}
      {ineligible.length > 0 ? (
        <div className="mb-2 rounded-md border border-dashed border-border bg-muted/30 p-2">
          {ineligible.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{p.displayName}</span>
              <Badge variant="outline" className="text-xs">Head Pro — Singles only</Badge>
              <span className="text-xs text-muted-foreground">ineligible for {round.format}</span>
              <span className="font-mono text-xs text-muted-foreground">Index {p.handicapIndex ?? '—'}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2">✓</th>
              <th className="py-1 pr-3">Player</th>
              <th className="py-1 pr-3">GHIN</th>
              <th className="py-1 pr-3">Index</th>
              <th className="py-1 pr-3">{round.courseLabel} HDCP</th>
              <th className="py-1 pr-3">Status</th>
              <th className="py-1 pr-3">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const ch = playerCourseHandicap(p, round)
              const selected = selectedIds.has(p.id)
              const ev = evidenceFor(evidence, p.resolvedPlayerId)
              return (
                <tr key={p.id} className={`border-b border-border/60 ${selected ? 'bg-emerald-50/60' : ''}`}>
                  <td className="py-1 pr-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggle(p.id)}
                      disabled={!selected && selectedIds.size >= required}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="py-1 pr-3">{p.displayName}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{p.ghinNumber ?? '—'}</td>
                  <td className="py-1 pr-3">{p.handicapIndex ?? '—'}</td>
                  <td className="py-1 pr-3 font-semibold">{ch ?? '—'}</td>
                  <td className="py-1 pr-3">
                    <Badge variant={p.matchStatus === 'matched' ? 'secondary' : 'outline'} className="text-xs">
                      {STATUS_LABEL[p.matchStatus]}
                    </Badge>
                  </td>
                  <td className="py-1 pr-3">
                    <div className="flex items-center gap-2">
                      <EvidenceStrengthBadge ev={ev} />
                      <span className="text-xs text-muted-foreground">{evidenceLine(ev)}</span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={busy || selectedIds.size === 0}>
          {busy ? 'Saving…' : `Save lineup (${selectedIds.size})`}
        </Button>
        <Button size="sm" variant="outline" onClick={onClear} disabled={busy || selectedIds.size === 0}>
          Clear
        </Button>
        {msg ? (
          <span className={`text-xs ${msg.ok ? 'text-muted-foreground' : 'text-destructive'}`}>{msg.text}</span>
        ) : null}
      </div>
    </section>
  )
}

// ---- RESPOND panel (exhaustive: every legal our-pair vs their exposed pair) ----

function RespondPanel({
  round,
  team,
  allPlayers,
  evidence,
}: {
  round: ai.RoundDescriptor
  team: string
  allPlayers: ai.RosterPlayer[]
  evidence: Record<string, PlayerEvidence>
}) {
  const [oppTeam, setOppTeam] = useState<string>('')
  const [oppLineup, setOppLineup] = useState<ai.RoundLineup | null>(null)
  const [oppLineupLoading, setOppLineupLoading] = useState(false)
  const [exposed, setExposed] = useState<string[]>([])
  const [analysis, setAnalysis] = useState<ai.RespondAnalysis | null>(null)
  const [running, startRunning] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  // Fetch the opponent's lineup when their team is picked (constrains the
  // exposed-pair choices to their selected 12). Mirrors the what-if pattern.
  useEffect(() => {
    if (!oppTeam) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOppLineupLoading(true)
    getRoundLineupCall(oppTeam, round.round)
      .then((l) => { if (!cancelled) { setOppLineup(l); setExposed([]) } })
      .catch(() => { if (!cancelled) setOppLineup(null) })
      .finally(() => { if (!cancelled) setOppLineupLoading(false) })
    return () => { cancelled = true }
  }, [oppTeam, round.round])

  const oppLineupPlayers = oppLineup
    ? allPlayers.filter((p) => p.team === oppTeam && oppLineup.playerIds.includes(p.id))
    : []
  const oppReady = !!oppLineup && oppLineup.complete

  function run() {
    setErr(null)
    startRunning(async () => {
      try {
        const a = await respondAnalysisCall(team, round.round, oppTeam, exposed)
        setAnalysis(a)
      } catch (e) {
        setErr((e as Error).message)
      }
    })
  }

  function setExposedLeg(i: number, id: string) {
    setExposed((prev) => {
      const next = [...prev]
      next[i] = id
      return next
    })
  }

  const teams = Array.from(new Set(allPlayers.map((p) => p.team))).filter((t) => t !== team)

  return (
    <div className="mb-2 rounded-md border border-border bg-white/80 p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">RESPOND</h3>
        <span className="text-xs text-muted-foreground">
          opponent exposes a pair → every legal response from our remaining lineup, exact consequence, ordered favorable-first
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Opponent team</label>
          <select
            value={oppTeam}
            onChange={(e) => { setOppTeam(e.target.value); setOppLineup(null); setExposed([]); setAnalysis(null) }}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Their exposed pair</label>
          <div className="flex gap-2">
            {Array.from({ length: round.teamSize }, (_, i) => (
              <select
                key={i}
                value={exposed[i] ?? ''}
                onChange={(e) => setExposedLeg(i, e.target.value)}
                disabled={!oppReady}
                className="min-w-40 rounded-md border border-border px-2 py-2 text-sm disabled:opacity-50"
              >
                <option value="">—</option>
                {oppLineupPlayers.map((p) => {
                  const ch = playerCourseHandicap(p, round)
                  return (
                    <option key={p.id} value={p.id}>
                      {p.displayName}{ch != null ? ` (${ch})` : ''}
                    </option>
                  )
                })}
              </select>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          disabled={!oppReady || exposed.filter(Boolean).length !== round.teamSize || running}
          onClick={run}
        >
          {running ? 'Running…' : 'Run RESPOND'}
        </Button>
        {!oppReady ? (
          <span className="text-xs text-muted-foreground">
            {oppLineupLoading ? 'Loading opponent lineup…' : oppTeam ? `Opponent lineup ${oppLineup ? `incomplete (${oppLineup.playerIds.length}/12)` : 'not set'}` : 'Pick an opponent team.'}
          </span>
        ) : null}
      </div>

      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}

      {analysis ? (
        <div className="mt-3">
          <div className="mb-2 text-xs text-muted-foreground">
            {analysis.opponentTeam} exposed{' '}
            <strong>{analysis.theirExposed.map((p) => p.displayName).join(' / ')}</strong>
            {analysis.theirValue != null ? ` (team value ${analysis.theirValue})` : ''}
            {' · '}our remaining {analysis.ourRemainingCount} →{' '}
            {analysis.candidates.length} legal response{analysis.candidates.length === 1 ? '' : 's'}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">Our pair</th>
                  <th className="py-1 pr-3">CH</th>
                  <th className="py-1 pr-3">Our value</th>
                  <th className="py-1 pr-3">Consequence</th>
                  <th className="py-1 pr-3">Spread</th>
                  <th className="py-1 pr-3">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {analysis.candidates.map((c, i) => {
                  const dirColor =
                    c.direction?.direction === 'receive'
                      ? 'text-emerald-700'
                      : c.direction?.direction === 'give'
                        ? 'text-rose-700'
                        : 'text-muted-foreground'
                  return (
                    <tr key={i} className="border-b border-border/60">
                      <td className="py-1 pr-3 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="py-1 pr-3">{c.our.map((p) => p.displayName).join(' / ')}</td>
                      <td className="py-1 pr-3 text-xs text-muted-foreground">
                        {c.our.map((p) => p.courseHandicap ?? '—').join(' / ')}
                      </td>
                      <td className="py-1 pr-3">{c.ourValue ?? '—'}</td>
                      <td className={`py-1 pr-3 font-semibold ${dirColor}`}>
                        {c.direction?.label ?? '—'}
                      </td>
                      <td className="py-1 pr-3 text-xs text-muted-foreground">{c.internalSpread ?? '—'}</td>
                      <td className="py-1 pr-3">
                        <div className="flex flex-col gap-0.5">
                          {c.our.map((p) => {
                            const ev = evidenceFor(evidence, p.resolvedPlayerId)
                            return (
                              <span key={p.rosterPlayerId} className="flex items-center gap-1 text-xs">
                                <EvidenceStrengthBadge ev={ev} />
                                <span className="text-muted-foreground">{evidenceLine(ev)}</span>
                              </span>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Ordered by consequence (most favorable — we receive — first), then tighter internal spread.
            Evidence is shown for context only and never affects this order.
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ---- per-slot card ----

function consequenceLabel(n: number | null): string {
  if (n == null) return '—'
  if (n > 0) return `We receive ${n}`
  if (n === 0) return 'Even'
  return `We give ${-n}`
}

function consequenceColor(n: number | null): string {
  if (n == null || n === 0) return 'text-muted-foreground'
  return n > 0 ? 'text-emerald-700' : 'text-rose-700'
}

function PutUpPanel({
  round,
  team,
  allPlayers,
  evidence,
}: {
  round: ai.RoundDescriptor
  team: string
  allPlayers: ai.RosterPlayer[]
  evidence: Record<string, PlayerEvidence>
}) {
  const [oppTeam, setOppTeam] = useState<string>('')
  const [oppLineup, setOppLineup] = useState<ai.RoundLineup | null>(null)
  const [oppLineupLoading, setOppLineupLoading] = useState(false)
  const [analysis, setAnalysis] = useState<ai.PutUpAnalysis | null>(null)
  const [running, startRunning] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Fetch the opponent's lineup when their team is picked. PUT-UP enumerates
  // opponent counters from THEIR remaining (their 12 minus their used slots),
  // so we need their complete lineup. Mirrors the RESPOND/what-if pattern.
  useEffect(() => {
    if (!oppTeam) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOppLineupLoading(true)
    getRoundLineupCall(oppTeam, round.round)
      .then((l) => { if (!cancelled) setOppLineup(l) })
      .catch(() => { if (!cancelled) setOppLineup(null) })
      .finally(() => { if (!cancelled) setOppLineupLoading(false) })
    return () => { cancelled = true }
  }, [oppTeam, round.round])

  const oppReady = !!oppLineup && oppLineup.complete

  function run() {
    setErr(null)
    startRunning(async () => {
      try {
        const a = await putUpAnalysisCall(team, round.round, oppTeam)
        setAnalysis(a)
        setExpanded(new Set())
      } catch (e) {
        setErr((e as Error).message)
      }
    })
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const teams = Array.from(new Set(allPlayers.map((p) => p.team))).filter((t) => t !== team)

  return (
    <div className="mb-2 rounded-md border border-border bg-white/80 p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">PUT-UP</h3>
        <span className="text-xs text-muted-foreground">
          we put up a pair → every legal opponent counter, full matrix, ordered by worst-case robustness (maximin)
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Opponent team</label>
          <select
            value={oppTeam}
            onChange={(e) => { setOppTeam(e.target.value); setOppLineup(null); setAnalysis(null) }}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Button size="sm" disabled={!oppReady || running} onClick={run}>
          {running ? 'Running…' : 'Run PUT-UP'}
        </Button>
        {!oppReady ? (
          <span className="text-xs text-muted-foreground">
            {oppLineupLoading ? 'Loading opponent lineup…' : oppTeam ? `Opponent lineup ${oppLineup ? `incomplete (${oppLineup.playerIds.length}/12)` : 'not set'}` : 'Pick an opponent team.'}
          </span>
        ) : null}
      </div>

      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}

      {analysis ? (
        <div className="mt-3">
          <div className="mb-2 text-xs text-muted-foreground">
            our remaining {analysis.ourRemainingCount} →{' '}
            {analysis.candidates.length} put-up pair{analysis.candidates.length === 1 ? '' : 's'} ·
            their remaining {analysis.oppRemainingCount} counters each
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">Our put-up</th>
                  <th className="py-1 pr-3">CH</th>
                  <th className="py-1 pr-3">Our value</th>
                  <th className="py-1 pr-3">Worst</th>
                  <th className="py-1 pr-3">Median</th>
                  <th className="py-1 pr-3">Best</th>
                  <th className="py-1 pr-3">Worst counter</th>
                  <th className="py-1 pr-3">Range</th>
                  <th className="py-1 pr-3">Recv/Even/Give</th>
                  <th className="py-1 pr-3">Matrix</th>
                </tr>
              </thead>
              <tbody>
                {analysis.candidates.map((c, i) => {
                  const key = c.our.map((p) => p.rosterPlayerId).sort().join('|')
                  const isOpen = expanded.has(key)
                  return (
                    <Fragment key={key}>
                      <tr className="border-b border-border/60">
                        <td className="py-1 pr-3 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="py-1 pr-3">{c.our.map((p) => p.displayName).join(' / ')}</td>
                        <td className="py-1 pr-3 text-xs text-muted-foreground">
                          {c.our.map((p) => p.courseHandicap ?? '—').join(' / ')}
                        </td>
                        <td className="py-1 pr-3">{c.ourValue ?? '—'}</td>
                        <td className={`py-1 pr-3 font-semibold ${consequenceColor(c.worstForUs)}`}>
                          {consequenceLabel(c.worstForUs)}
                        </td>
                        <td className={`py-1 pr-3 ${consequenceColor(c.median)}`}>
                          {c.median ?? '—'}
                        </td>
                        <td className={`py-1 pr-3 ${consequenceColor(c.bestForUs)}`}>
                          {consequenceLabel(c.bestForUs)}
                        </td>
                        <td className="py-1 pr-3 text-xs">
                          {c.worstCounter ? c.worstCounter.map((p) => p.displayName).join(' / ') : '—'}
                        </td>
                        <td className="py-1 pr-3 text-xs text-muted-foreground">
                          {c.rangeMin != null && c.rangeMax != null ? `${c.rangeMin}…${c.rangeMax}` : '—'}
                        </td>
                        <td className="py-1 pr-3 text-xs">
                          <span className="text-emerald-700">{c.counts.receive}</span>
                          {' / '}
                          <span className="text-muted-foreground">{c.counts.even}</span>
                          {' / '}
                          <span className="text-rose-700">{c.counts.give}</span>
                          <span className="text-muted-foreground">
                            {' '}({Math.round(c.pcts.receive * 100)}%/{Math.round(c.pcts.give * 100)}%)
                          </span>
                        </td>
                        <td className="py-1 pr-3">
                          <button
                            type="button"
                            onClick={() => toggleExpand(key)}
                            className="text-xs text-blue-700 underline"
                          >
                            {isOpen ? 'Hide' : `${c.responseCount} counters`}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-muted/20">
                          <td colSpan={11} className="px-4 py-2">
                            <div className="mb-1 text-xs text-muted-foreground">
                              Full counter matrix — every legal opponent pair and the exact signed
                              consequence (our perspective). The opponent is assumed to pick the counter
                              worst for us (lowest), which drives the minimax order above.
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border text-left text-muted-foreground">
                                    <th className="py-1 pr-3">Their counter</th>
                                    <th className="py-1 pr-3">CH</th>
                                    <th className="py-1 pr-3">Their value</th>
                                    <th className="py-1 pr-3">Consequence</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.responses.map((r, j) => (
                                    <tr key={j} className="border-b border-border/40">
                                      <td className="py-1 pr-3">{r.their.map((p) => p.displayName).join(' / ')}</td>
                                      <td className="py-1 pr-3 text-muted-foreground">
                                        {r.their.map((p) => p.courseHandicap ?? '—').join(' / ')}
                                      </td>
                                      <td className="py-1 pr-3">{r.theirValue ?? '—'}</td>
                                      <td className={`py-1 pr-3 font-medium ${consequenceColor(r.consequence)}`}>
                                        {consequenceLabel(r.consequence)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Ordered by worst-case robustness (maximin: the put-up whose worst counter is least bad
            ranks first), then median, then % of counters favorable to us. The full counter matrix is
            preserved under each row — no synthetic score, no win probabilities.
          </p>
        </div>
      ) : null}
    </div>
  )
}

function SlotCard({
  position,
  slot,
  round,
  lineupPlayers,
  allPlayers,
  slots,
  consequence,
  busy,
  error,
  playerById,
  evidence,
  onSave,
  onClear,
  onPreviewWhatIf,
}: {
  position: number
  slot: ai.MatchupSlot | null
  round: ai.RoundDescriptor
  lineupPlayers: ai.RosterPlayer[]
  allPlayers: ai.RosterPlayer[]
  slots: ai.MatchupSlot[]
  consequence: ai.MatchHandicapResult | null
  busy: boolean
  error: string | null
  playerById: Map<string, ai.RosterPlayer>
  evidence: Record<string, PlayerEvidence>
  onSave: (position: number, ourPlayerIds: string[], meta: { putUp?: ai.PutUp | null; selectionOrder?: number | null; rationale?: string | null }) => void
  onClear: (position: number) => void
  onPreviewWhatIf: (position: number, ourPlayerIds: string[], opponentPlayerIds: string[]) => void
}) {
  const available = availablePlayers(lineupPlayers, slots, position)
  const currentIds = slot?.our.map((r) => r.rosterPlayerId) ?? []
  const [pick, setPick] = useState<string[]>(currentIds)
  const [putUp, setPutUp] = useState<ai.PutUp | ''>(slot?.putUp ?? '')
  const [selectionOrder, setSelectionOrder] = useState<string>(slot?.selectionOrder != null ? String(slot.selectionOrder) : '')
  const [rationale, setRationale] = useState<string>(slot?.rationale ?? '')
  const [showWhatIf, setShowWhatIf] = useState(false)
  const [oppTeam, setOppTeam] = useState<string>(slot?.opponentTeam ?? '')
  const [oppPicks, setOppPicks] = useState<string[]>(slot?.opponent?.map((r) => r.rosterPlayerId) ?? [])

  // Keep the picker in sync when the slot changes (e.g. after a save or URL refetch).
  // Simple sync: when slot identity changes, reset local pick state.
  const slotKey = slot?.id ?? `empty-${position}`
  const [lastKey, setLastKey] = useState(slotKey)
  if (slotKey !== lastKey) {
    setLastKey(slotKey)
    setPick(currentIds)
    setPutUp(slot?.putUp ?? '')
    setSelectionOrder(slot?.selectionOrder != null ? String(slot.selectionOrder) : '')
    setRationale(slot?.rationale ?? '')
    setOppTeam(slot?.opponentTeam ?? '')
    setOppPicks(slot?.opponent?.map((r) => r.rosterPlayerId) ?? [])
  }

  const oppTeamPlayers = oppTeam ? allPlayers.filter((p) => p.team === oppTeam) : []
  // The opponent's selected round lineup (their 12), fetched on demand so the
  // what-if counter constrains picks to their lineup, not their full roster. If
  // their lineup is incomplete, the counter is disabled (never present a
  // provisional opponent lineup as confirmed).
  const [oppLineup, setOppLineup] = useState<ai.RoundLineup | null>(null)
  const [oppLineupLoading, setOppLineupLoading] = useState(false)
  useEffect(() => {
    if (!oppTeam) return
    let cancelled = false
    // Standard fetch-on-prop-change: flip the loading flag before the async
    // fetch. The setStates inside .then/.finally are async (not flagged).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOppLineupLoading(true)
    getRoundLineupCall(oppTeam, round.round)
      .then((l) => {
        if (!cancelled) setOppLineup(l)
      })
      .catch(() => {
        if (!cancelled) setOppLineup(null)
      })
      .finally(() => {
        if (!cancelled) setOppLineupLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [oppTeam, round.round])
  const oppLineupPlayers = oppLineup
    ? oppTeamPlayers.filter((p) => oppLineup.playerIds.includes(p.id))
    : []
  const oppLineupReady = !!oppLineup && oppLineup.complete
  const pickComplete = pick.length === round.teamSize && pick.every((id) => id)
  const legalPairs = legalPairCount(round.teamSize, available.length)

  function setLeg(i: number, id: string) {
    setPick((prev) => {
      const next = [...prev]
      next[i] = id
      return next
    })
  }
  function setOppLeg(i: number, id: string) {
    setOppPicks((prev) => {
      const next = [...prev]
      next[i] = id
      return next
    })
  }

  return (
    <div className="rounded-md border border-border bg-white/80 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="font-semibold">Slot {position}</span>
        {slot?.locked ? <Badge variant="secondary">locked</Badge> : null}
        <span className="text-xs text-muted-foreground">
          {round.teamSize === 1 ? 'Singles' : 'Pair'} · {legalPairs} legal option{legalPairs === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Our pair picker */}
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            {round.teamSize === 1 ? 'Our player' : 'Our pair'}
          </label>
          <div className="flex gap-2">
            {Array.from({ length: round.teamSize }, (_, i) => (
              <select
                key={i}
                value={pick[i] ?? ''}
                onChange={(e) => setLeg(i, e.target.value)}
                className="flex-1 rounded-md border border-border px-2 py-2 text-sm"
              >
                <option value="">—</option>
                {available.map((p) => {
                  const ch = playerCourseHandicap(p, round)
                  return (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                      {ch != null ? ` (${ch})` : ''}
                    </option>
                  )
                })}
              </select>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={putUp}
              onChange={(e) => setPutUp(e.target.value as ai.PutUp | '')}
              className="rounded-md border border-border px-2 py-1 text-xs"
            >
              <option value="">put-up: —</option>
              <option value="us">we put up</option>
              <option value="them">they put up</option>
            </select>
            <input
              type="number"
              min={1}
              placeholder="order #"
              value={selectionOrder}
              onChange={(e) => setSelectionOrder(e.target.value)}
              className="w-20 rounded-md border border-border px-2 py-1 text-xs"
            />
            <Button
              size="sm"
              disabled={!pickComplete || busy || slot?.locked}
              onClick={() =>
                onSave(position, pick, {
                  putUp: (putUp || null) as ai.PutUp | null,
                  selectionOrder: selectionOrder ? Number(selectionOrder) : null,
                  rationale: rationale || null,
                })
              }
            >
              {busy ? 'Saving…' : slot ? 'Update' : 'Assign'}
            </Button>
            {slot ? (
              <Button size="sm" variant="outline" disabled={busy || slot.locked} onClick={() => onClear(position)}>
                Clear
              </Button>
            ) : null}
          </div>
          <input
            type="text"
            placeholder="rationale (why this pair)"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            className="mt-2 w-full rounded-md border border-border px-2 py-1 text-xs"
          />
          {/* Per-player real evidence for the currently picked players. Sample
              size always shown; strength is sample-size-driven, not a prediction. */}
          {pick.filter(Boolean).length > 0 ? (
            <ul className="mt-2 space-y-0.5">
              {pick.filter(Boolean).map((id) => {
                const p = playerById.get(id)
                if (!p) return null
                const ev = evidenceFor(evidence, p.resolvedPlayerId)
                return (
                  <li key={id} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{p.displayName}:</span>
                    <EvidenceStrengthBadge ev={ev} />
                    <span className="text-muted-foreground">{evidenceLine(ev)}</span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        {/* What-if counter */}
        <div>
          <button
            type="button"
            className="mb-1 text-xs text-muted-foreground underline"
            onClick={() => setShowWhatIf((v) => !v)}
          >
            {showWhatIf ? 'Hide' : 'Show'} what-if counter
          </button>
          {showWhatIf ? (
            <div className="rounded-md border border-dashed border-border p-2">
              <label className="mb-1 block text-xs text-muted-foreground">Opponent team</label>
              <select
                value={oppTeam}
                onChange={(e) => {
                  setOppTeam(e.target.value)
                  setOppPicks([])
                  setOppLineup(null)
                }}
                className="mb-2 w-full rounded-md border border-border px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {Array.from(new Set(allPlayers.map((p) => p.team)))
                  .filter((t) => t !== undefined)
                  .map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
              </select>
              <div className="flex gap-2">
                {Array.from({ length: round.teamSize }, (_, i) => (
                  <select
                    key={i}
                    value={oppPicks[i] ?? ''}
                    onChange={(e) => setOppLeg(i, e.target.value)}
                    disabled={!oppLineupReady}
                    className="flex-1 rounded-md border border-border px-2 py-1 text-sm disabled:opacity-50"
                  >
                    <option value="">—</option>
                    {oppLineupPlayers.map((p) => {
                      const ch = playerCourseHandicap(p, round)
                      return (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                          {ch != null ? ` (${ch})` : ''}
                        </option>
                      )
                    })}
                  </select>
                ))}
              </div>
              {!oppLineupReady ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {oppLineupLoading
                    ? 'Loading opponent lineup…'
                    : oppTeam
                      ? `Opponent lineup ${oppLineup ? `incomplete (${oppLineup.playerIds.length}/12)` : 'not set'} — preview disabled.`
                      : 'Pick an opponent team.'}
                </p>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={!pickComplete || oppPicks.length !== round.teamSize || busy || !oppLineupReady}
                onClick={() => onPreviewWhatIf(position, pick, oppPicks)}
              >
                Preview consequence
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Consequence */}
      {consequence ? <ConsequenceView result={consequence} /> : null}
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function ConsequenceView({ result }: { result: ai.MatchHandicapResult }) {
  if (!result.complete) {
    return (
      <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
        ⚠ {result.note ?? 'Incomplete: a required course handicap is missing.'}
      </div>
    )
  }
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-2 text-sm">
      <div className="mb-1 text-xs text-muted-foreground">
        Deterministic strokes · {result.mode === 'per_player' ? 'per player' : 'per side'} · low plays scratch
      </div>
      {result.mode === 'per_player' ? (
        <table className="w-full text-sm">
          <tbody>
            {result.players.map((pl) => (
              <tr key={pl.player.id}>
                <td className="py-0.5 pr-3">{pl.player.displayName}</td>
                <td className="py-0.5 pr-3 text-muted-foreground">CH {pl.courseHandicap}</td>
                <td className="py-0.5 pr-3">
                  {pl.gives ? (
                    <Badge variant="outline" className="text-xs">gives</Badge>
                  ) : (
                    <span className="font-semibold">+{pl.strokesReceived}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {result.sides.map((side, idx) => (
              <tr key={idx}>
                <td className="py-0.5 pr-3">
                  {side.members.map((m) => m.player.displayName).join(' / ')}
                </td>
                <td className="py-0.5 pr-3 text-muted-foreground">team {side.teamHandicap}</td>
                <td className="py-0.5 pr-3">
                  {side.gives ? (
                    <Badge variant="outline" className="text-xs">gives</Badge>
                  ) : (
                    <span className="font-semibold">+{side.strokesReceived}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}