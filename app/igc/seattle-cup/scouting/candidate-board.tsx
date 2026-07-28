'use client'

// The operable candidate board. This is the captain's primary working surface:
// state (Considering/Out/Selected) and per-session availability are editable
// directly from each row, with immediate background persistence, optimistic
// UI, a subtle pending state, and rollback on error. There is NO save button and
// NO user-visible dirty-state workflow — the board is a directly interactive
// application, not a form.
//
// Filtering (state tabs, handicap buckets, availability) is URL-driven and
// preserved. When an edit would make a row leave the active filter view, the
// row is NOT removed instantly (that would be disorienting): it briefly shows
// the acknowledged new value with a quiet highlight, then fades out. This is a
// transition, not a confirmation dialog, and persistence is not delayed — only
// the visual departure is.

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils/cn'
import * as ai from '@/lib/planit-ai/client'
import { setCandidateStateCall, setAvailabilityCall } from './actions'

type StateFilter = 'considering' | 'out' | 'selected' | 'all'
type LeavePhase = 'show' | 'fade'
// A partial filter patch. `undefined` keys mean "leave unchanged"; `null` hcp
// bounds and `''` avail mean "clear that filter".
type FilterPatch = Partial<{ state: StateFilter; hcpMin: number | null; hcpMax: number | null; avail: string }>

const STATE_TABS: { key: StateFilter; label: string }[] = [
  { key: 'considering', label: 'Considering' },
  { key: 'out', label: 'Out' },
  { key: 'selected', label: 'Selected' },
  { key: 'all', label: 'All' },
]

const STATE_OPTS: { value: string; label: string }[] = [
  { value: 'considering', label: 'Considering' },
  { value: 'out', label: 'Out' },
  { value: 'selected', label: 'Selected' },
]

// Product default SELECTED range for the handicap filter: 0.0–18.0 (internal
// 0 / 18). This is the DEFAULT VIEW FILTER shown on a clean load — it is NOT an
// eligibility rule. It does not mark plus-handicap or >18 players Out, does not
// label anyone ineligible, and does not remove anyone from the underlying
// candidate pool. It is distinct from the slider's AVAILABLE extremes (lower
// +5.0 / internal -5, upper dataset-derived): users can still drag Min into plus
// territory, type +2.5, drag Max above 18, and reach the full +5→dataset-max
// range. null bounds mean "use the product default" (0 for Min, 18 for Max) and
// are omitted from the URL; explicit non-default bounds serialize and stay
// shareable. 18.0 remains a soft reference mark, never a cutoff.
const HCP_DEFAULT_MIN = 0
const HCP_DEFAULT_MAX = 18

// Plus handicaps exist: a +2.3 golfer is BETTER than a 0.0 golfer, and the
// underlying numeric representation stores +2.3 as -2.3. So the numeric range is
// monotonic in golf ability (lower numeric = better), and we display standard
// golf notation to the user (+2.3 for -2.3). The slider's AVAILABLE bounds are
// derived from the candidate dataset so plus handicaps and players above 18 are
// all reachable; 18 is shown only as a soft reference mark, never an eligibility
// cutoff (we do not hide >18 players or mark them out automatically).
function formatHcp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (v < 0) return `+${(-v).toFixed(1)}`
  return v.toFixed(1)
}

// Inclusive range match against RESOLVED bounds (callers pass the product
// default when a bound is unset, so the default 0–18 view is a real filter, not
// an open range). A player with no handicap value never matches an active range
// (they can't be placed on the numeric scale).
function hcpInRange(v: number | null, min: number, max: number): boolean {
  if (v == null || !Number.isFinite(v)) return false
  if (v < min) return false
  if (v > max) return false
  return true
}

// Parse a user-typed handicap in golf notation to the internal numeric value.
// "+2.5" -> -2.5 (plus handicap), "0" -> 0, "7.4" -> 7.4, "18" -> 18, "-2.3" -> -2.3.
// Empty/invalid -> null (treated as "no bound"). Clamps to [lo, hi] and rounds to 0.1.
function parseHcpInput(s: string, lo: number, hi: number): number | null {
  const t = s.trim()
  if (t === '') return null
  const n = Number.isFinite(parseFloat(t)) ? (t.startsWith('+') ? -parseFloat(t.slice(1)) : parseFloat(t)) : NaN
  if (!Number.isFinite(n)) return null
  return Math.round(Math.min(hi, Math.max(lo, n)) * 10) / 10
}

// Map a value on [lo, hi] to a 0–100 percentage for the slider fill positioning.
function hcpPct(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 0
  return ((v - lo) / (hi - lo)) * 100
}

// The six availability values, '' = unset/unknown (Not asked yet). Glyphs are the
// board's scannable language; color is quiet (no traffic-light saturation beyond
// the existing emerald/amber/red text already used for availability glyphs).
const AVAIL_OPTS: { value: string; label: string; glyph: string; cls: string }[] = [
  { value: 'fully_available', label: 'Fully available', glyph: '✓', cls: 'text-emerald-700' },
  { value: 'partially_available', label: 'Partially available', glyph: '~', cls: 'text-amber-700' },
  { value: 'unavailable', label: 'Unavailable', glyph: '✕', cls: 'text-red-700' },
  { value: 'response_pending', label: 'Response pending', glyph: '?', cls: 'text-muted-foreground' },
  { value: 'no_response', label: 'No response', glyph: '—', cls: 'text-muted-foreground' },
  { value: '', label: 'Not asked yet', glyph: '·', cls: 'text-muted-foreground/40' },
]

function availOpt(value: string) {
  return AVAIL_OPTS.find((o) => o.value === value) ?? AVAIL_OPTS[5]
}

// "can play" = fully or partially available; "out" = unavailable. Unknown (no
// row) and pending/no_response do NOT match either, so unknown stays distinct
// from unavailable in filtering as well as in the glyph.
function availMatchesStatus(status: string | null, kind: 'can' | 'out'): boolean {
  const s = status ?? ''
  if (kind === 'can') return s === 'fully_available' || s === 'partially_available'
  return s === 'unavailable'
}

function Hcap({ h }: { h: ai.ScoutingBoardRow['currentHandicap'] }) {
  const sourceLabel =
    h.source === 'ghin'
      ? 'GHIN'
      : h.source === 'golf_genius'
        ? 'Golf Genius'
        : h.source === 'manual'
          ? 'manual'
          : (h.source ?? '—')
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium tabular-nums">{formatHcp(h.value)}</span>
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{sourceLabel}</span>
      {h.isStale && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">stale</span>}
    </span>
  )
}

// ---- Handicap range control: dual-thumb slider + linked Min/Max text inputs ----
// One compact control. Two overlaid native <input type="range"> provide the two
// thumbs (keyboard-accessible via native range semantics); pointer-events are
// disabled on the inputs and re-enabled only on the thumbs so the track/fill
// behind them don't eat drags. The selected range is drawn as a filled segment
// between the thumbs. Two small text inputs give precise entry in golf notation
// and are the SAME state as the slider (two-way sync). No library added.

const RANGE_THUMB_CLS =
  'pointer-events-none absolute inset-0 w-full appearance-none bg-transparent ' +
  '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 ' +
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border ' +
  '[&::-webkit-slider-thumb]:border-foreground [&::-webkit-slider-thumb]:bg-card [&::-webkit-slider-thumb]:shadow-sm ' +
  '[&::-webkit-slider-thumb]:cursor-pointer ' +
  '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 ' +
  '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-foreground ' +
  '[&::-moz-range-thumb]:bg-card [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-track]:bg-transparent'

// A compact Min/Max text input bound to the same range state as the slider.
// Allows an incomplete value while focused; normalizes/validates on blur/Enter.
function HcpText({
  label,
  value,
  lo,
  hi,
  onCommit,
}: {
  label: string
  value: number
  lo: number
  hi: number
  onCommit: (v: number | null) => void
}) {
  const [text, setText] = useState(formatHcp(value))
  const [focused, setFocused] = useState(false)
  // Re-sync the displayed (canonical) value when the prop changes and the user
  // isn't mid-edit (e.g. the slider moved this bound, or Reset range reset it).
  // Adjusting state during render (vs. in an effect) avoids a cascading re-render.
  const [prevValue, setPrevValue] = useState(value)
  if (!focused && value !== prevValue) {
    setText(formatHcp(value))
    setPrevValue(value)
  }
  return (
    <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          onCommit(parseHcpInput(text, lo, hi))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        className="w-16 rounded border border-border bg-white px-1.5 py-0.5 text-xs tabular-nums text-foreground focus:border-foreground focus:outline-none"
      />
    </label>
  )
}

// ---- State control: compact 3-segment pill ---------------------------------
// One click changes state. The active segment is filled (bg-foreground /
// text-background) so the current state is immediately readable while scanning,
// without saturated traffic-light colors. Inactive segments are quiet muted
// text. It is obviously a control (buttons + hover), not a passive badge or a
// generic dropdown.
function StateSegmented({
  current,
  pending,
  error,
  disabled,
  onChange,
}: {
  current: string
  pending: boolean
  error: string | null
  disabled: boolean
  onChange: (state: string) => void
}) {
  return (
    <div
      title={error ?? undefined}
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-card p-0.5',
        error && 'ring-1 ring-red-500/60'
      )}
    >
      {STATE_OPTS.map((o) => {
        const active = current === o.value
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled || pending}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
              active
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              pending && active && 'opacity-70 animate-pulse'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---- Availability chip: session label + glyph, one clickable unit ------------
// The closed control is a compact chip that pairs the full session name with its
// current availability glyph, read as a single control (label and glyph are
// immediately adjacent, not pushed to opposite ends of a wide slot). The whole
// chip is the trigger — the captain targets the readable name, not a tiny
// detached glyph. Clicking opens a small menu of the six values in a portal (so
// it is never clipped by the table's horizontal-scroll container). The glyph is
// the primary signal; the chip's own styling stays neutral (a light hairline
// border + hover, no traffic-light saturation) so the four chips read as a quiet
// grouped strip beneath the primary row. While a save is in flight the chip
// dims and pulses; on error it gets a red ring and reverts.
function AvailCell({
  playerId,
  sessionId,
  scope,
  label,
  value,
  pending,
  error,
  disabled,
  open,
  onToggle,
  onSelect,
}: {
  playerId: string
  sessionId: string
  scope: 'd' | 'm'
  label: string
  value: string
  pending: boolean
  error: string | null
  disabled: boolean
  open: boolean
  onToggle: () => void
  onSelect: (status: string) => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!open) {
      setRect(null)
      return
    }
    const measure = () => setRect(btnRef.current?.getBoundingClientRect() ?? null)
    measure()
    // Close on scroll/resize so the menu never detaches from its cell. When
    // open, onToggle flips the cell closed (the parent uses a toggle handler).
    window.addEventListener('scroll', onToggle, true)
    window.addEventListener('resize', onToggle)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle()
    }
    window.addEventListener('keydown', onKey)
    // Outside-click closes. Using mousedown (not a full-screen overlay) means a
    // click on ANOTHER cell still reaches that cell's button — so switching
    // directly between cells is a single click, not two.
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      onToggle()
    }
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('scroll', onToggle, true)
      window.removeEventListener('resize', onToggle)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const opt = availOpt(value)

  let menuStyle: React.CSSProperties = {}
  if (rect) {
    const menuW = 168
    const menuH = 224
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = rect.left
    if (left + menuW > vw - 8) left = vw - menuW - 8
    if (left < 8) left = 8
    let top = rect.bottom + 4
    if (top + menuH > vh - 8) top = Math.max(8, rect.top - menuH - 4)
    menuStyle = { position: 'fixed', top, left, width: menuW }
  }

  return (
    <span className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        data-testid={`avail-${scope}-${playerId}-${sessionId}`}
        title={error ?? `${label} · ${opt.label}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs font-medium transition-colors',
          'border-border hover:bg-muted',
          value === '' && 'border-border/50 text-muted-foreground',
          pending && 'opacity-60 animate-pulse',
          error && 'border-red-500/60 ring-1 ring-red-500/60',
          open && 'border-foreground'
        )}
      >
        <span className="whitespace-nowrap">{label}</span>
        <span className={cn('tabular-nums', opt.cls)} aria-hidden>{opt.glyph}</span>
      </button>
      {open && rect
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={menuStyle}
              className="z-50 rounded-md border border-border bg-card p-1 shadow-md"
            >
              {AVAIL_OPTS.map((o) => {
                const active = o.value === value
                return (
                  <button
                    key={o.value || 'unset'}
                    type="button"
                    role="menuitem"
                    disabled={pending}
                    onClick={() => onSelect(o.value)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
                      active ? 'bg-muted font-medium text-foreground' : 'text-foreground hover:bg-muted'
                    )}
                  >
                    <span className={cn('w-4 text-center', o.cls)}>{o.glyph}</span>
                    <span className="text-muted-foreground">{o.label}</span>
                  </button>
                )
              })}
            </div>,
            document.body
          )
        : null}
    </span>
  )
}

// ---- Main board ------------------------------------------------------------

// The two immediate-save calls are injectable so the board's optimistic state
// flow can be exercised in isolation (dev/test harness) without the server
// action or auth. In production the real server actions are used by default.
export type BoardActions = {
  setCandidateState: (playerId: string, state: string) => Promise<void>
  setAvailability: (playerId: string, sessionId: string, status: string) => Promise<void>
}

export function CandidateBoard({
  rows,
  sessions,
  stateFilter,
  hcpMin,
  hcpMax,
  availFilter,
  actions,
}: {
  rows: ai.ScoutingBoardRow[]
  sessions: ai.ScoutingSession[]
  stateFilter: StateFilter
  hcpMin: number | null
  hcpMax: number | null
  availFilter: string
  actions?: BoardActions
}) {
  const doSetCandidateState = actions?.setCandidateState ?? setCandidateStateCall
  const doSetAvailability = actions?.setAvailability ?? setAvailabilityCall
  const router = useRouter()
  // `isPending` covers the background server re-render triggered by pushing the
  // new searchParams (the board route is force-dynamic, so it re-reads /board).
  // The client applies the filter optimistically so results update instantly; the
  // URL push keeps filtered views shareable, and isPending drives a subtle
  // "updating" treatment on the results area.
  const [navPending, startNav] = useTransition()
  // Optimistic current values. These are the source of truth for display and
  // filtering. Initialized once from server props; updated optimistically on
  // every edit. The server action persists immediately in the background.
  const [states, setStates] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.playerId, r.candidateState ?? 'considering']))
  )
  const [avails, setAvails] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.playerId,
        Object.fromEntries((r.availability?.perSession ?? []).map((s) => [s.sessionId, s.status ?? ''])),
      ])
    )
  )
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [leaving, setLeaving] = useState<Record<string, LeavePhase>>({})
  const [openCell, setOpenCell] = useState<string | null>(null)

  // ---- Optimistic filter state (the URL/searchParams is the canonical, shareable
  // representation; this local mirror leads during a transition so a click is
  // acknowledged instantly). Re-synced from server props whenever they change
  // (i.e. when the pushed navigation lands).
  const [fState, setFState] = useState<StateFilter>(stateFilter)
  const [fHcpMin, setFHcpMin] = useState<number | null>(hcpMin)
  const [fHcpMax, setFHcpMax] = useState<number | null>(hcpMax)
  const [fAvail, setFAvail] = useState<string>(availFilter)
  useEffect(() => setFState(stateFilter), [stateFilter])
  useEffect(() => setFHcpMin(hcpMin), [hcpMin])
  useEffect(() => setFHcpMax(hcpMax), [hcpMax])
  useEffect(() => setFAvail(availFilter), [availFilter])

  // Collapsible Filters panel. Default open (desktop); the collapsed header still
  // shows the active-filter count so active filtering is never hidden.
  const [filtersOpen, setFiltersOpen] = useState(true)

  const availSid = fAvail.split(':')[0] || ''
  const availKind = (fAvail.split(':')[1] as 'can' | 'out' | undefined) ?? ''

  function cellKey(playerId: string, sessionId?: string) {
    return sessionId ? `a:${playerId}/${sessionId}` : `s:${playerId}`
  }

  function setPendingKey(key: string, on: boolean) {
    setPending((p) => {
      const n = { ...p }
      if (on) n[key] = true
      else delete n[key]
      return n
    })
  }

  function setError(key: string, msg: string | null) {
    setErrors((e) => {
      const n = { ...e }
      if (msg) {
        n[key] = msg
        setTimeout(() => setErrors((e2) => { const m = { ...e2 }; delete m[key]; return m }), 4500)
      } else delete n[key]
      return n
    })
  }

  // Acknowledged-then-leave: show the row (with the new value) for a beat, then
  // fade it out, then drop it from the filtered view. Persistence already
  // happened; only the visual departure is staged.
  function startLeave(playerId: string) {
    setLeaving((m) => ({ ...m, [playerId]: 'show' }))
    setTimeout(() => setLeaving((m) => ({ ...m, [playerId]: 'fade' })), 650)
    setTimeout(() => setLeaving((m) => { const n = { ...m }; delete n[playerId]; return n }), 1150)
  }

  function rowMatchesAvail(playerId: string): boolean {
    if (!availSid || (availKind !== 'can' && availKind !== 'out')) return true
    const status = avails[playerId]?.[availSid] ?? ''
    return availMatchesStatus(status, availKind)
  }

  async function editState(playerId: string, newState: string) {
    const prev = states[playerId] ?? 'considering'
    if (prev === newState || leaving[playerId]) return
    const key = cellKey(playerId)
    setStates((s) => ({ ...s, [playerId]: newState }))
    setPendingKey(key, true)
    setError(key, null)
    try {
      await doSetCandidateState(playerId, newState)
    } catch {
      setStates((s) => ({ ...s, [playerId]: prev }))
      setError(key, "Couldn't save — reverted")
    } finally {
      setPendingKey(key, false)
    }
    // If the new state no longer matches the active (optimistic) state filter,
    // stage the acknowledged-then-leave transition.
    if (fState !== 'all' && newState !== fState) startLeave(playerId)
  }

  async function editAvail(playerId: string, sessionId: string, newStatus: string) {
    const prev = avails[playerId]?.[sessionId] ?? ''
    if (prev === newStatus || leaving[playerId]) return
    const key = cellKey(playerId, sessionId)
    setAvails((a) => ({ ...a, [playerId]: { ...(a[playerId] ?? {}), [sessionId]: newStatus } }))
    setPendingKey(key, true)
    setError(key, null)
    setOpenCell(null)
    try {
      await doSetAvailability(playerId, sessionId, newStatus)
    } catch {
      setAvails((a) => ({ ...a, [playerId]: { ...(a[playerId] ?? {}), [sessionId]: prev } }))
      setError(key, "Couldn't save — reverted")
    } finally {
      setPendingKey(key, false)
    }
    if (availSid && !rowMatchesAvailAfter(playerId, sessionId, newStatus)) startLeave(playerId)
  }

  function rowMatchesAvailAfter(playerId: string, editedSid: string, editedStatus: string): boolean {
    if (!availSid || (availKind !== 'can' && availKind !== 'out')) return true
    // Use the edited value if the edited session is the filtered one, else current.
    const status = availSid === editedSid ? editedStatus : (avails[playerId]?.[availSid] ?? '')
    return availMatchesStatus(status, availKind)
  }

  // Live funnel counts from optimistic state.
  const counts = useMemo(() => {
    const c = { considering: 0, out: 0, selected: 0, all: rows.length }
    for (const r of rows) {
      const s = states[r.playerId] ?? 'considering'
      if (s === 'considering') c.considering++
      else if (s === 'out') c.out++
      else if (s === 'selected') c.selected++
    }
    return c
  }, [rows, states])

  function isVisible(r: ai.ScoutingBoardRow): boolean {
    if (leaving[r.playerId]) return false // leaving rows render separately
    if (fState !== 'all' && (states[r.playerId] ?? 'considering') !== fState) return false
    if (!hcpInRange(r.currentHandicap.value, fHcpMin ?? HCP_DEFAULT_MIN, fHcpMax ?? HCP_DEFAULT_MAX)) return false
    if (availSid && (availKind === 'can' || availKind === 'out') && !rowMatchesAvail(r.playerId)) return false
    return true
  }

  // Build the shareable URL from the CURRENT optimistic filter state, with an
  // optional patch. `state==='considering'`, null hcp bounds (the product default
  // 0–18), and empty avail are the defaults and are omitted from the URL — a
  // clean scouting URL with no hcp params represents the 0–18 default. Explicit
  // non-default hcp bounds (including the full +5→dataset-max range) serialize
  // and stay canonical/shareable.
  function hrefWith(patch: FilterPatch = {}): string {
    const st = patch.state !== undefined ? patch.state : fState
    const hmin = patch.hcpMin !== undefined ? patch.hcpMin : fHcpMin
    const hmax = patch.hcpMax !== undefined ? patch.hcpMax : fHcpMax
    const av = patch.avail !== undefined ? patch.avail : fAvail
    const q = new URLSearchParams()
    if (st && st !== 'considering') q.set('state', st)
    if (hmin != null) q.set('hcpmin', String(hmin))
    if (hmax != null) q.set('hcpmax', String(hmax))
    if (av) q.set('avail', av)
    const qs = q.toString()
    return `/igc/seattle-cup/scouting${qs ? `?${qs}` : ''}`
  }

  // Push the canonical URL in a transition (debounced so range drags coalesce).
  // Local state has already updated optimistically; this keeps the URL shareable
  // and lets the server re-render catch up. `navPending` reflects the in-flight
  // navigation and drives the subtle results-area loading treatment.
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function pushFilters(href: string) {
    if (pushTimer.current) clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(() => {
      startNav(() => router.replace(href))
    }, 250)
  }

  // One handler for every filter control: update the optimistic mirror instantly
  // (the control and the results reflect it on the next render), then push the URL.
  function applyFilter(patch: FilterPatch) {
    if (patch.state !== undefined) setFState(patch.state)
    if (patch.hcpMin !== undefined) setFHcpMin(patch.hcpMin)
    if (patch.hcpMax !== undefined) setFHcpMax(patch.hcpMax)
    if (patch.avail !== undefined) setFAvail(patch.avail)
    pushFilters(hrefWith(patch))
  }

  // Handicap range bound setters, shared by the dual-thumb slider AND the Min/Max
  // text inputs (one source of truth). Enforce Min <= Max. A bound parked at the
  // product default (0 for Min, 18 for Max) is stored as null so the default 0–18
  // view serializes to no URL params; explicit non-default values (including the
  // full +5→dataset-max range) serialize and stay shareable. Clearing a bound
  // (empty input) also returns it to the product default.
  const setHcpMin = (v: number | null) => {
    if (v == null) {
      applyFilter({ hcpMin: null })
      return
    }
    const max = fHcpMax ?? HCP_DEFAULT_MAX
    const clamped = Math.min(v, max)
    applyFilter({ hcpMin: clamped === HCP_DEFAULT_MIN ? null : clamped })
  }
  const setHcpMax = (v: number | null) => {
    if (v == null) {
      applyFilter({ hcpMax: null })
      return
    }
    const min = fHcpMin ?? HCP_DEFAULT_MIN
    const clamped = Math.max(v, min)
    applyFilter({ hcpMax: clamped === HCP_DEFAULT_MAX ? null : clamped })
  }

  // Handicap range AVAILABLE bounds (the slider's extremes — NOT the default
  // selected range; the product default is 0–18, see HCP_DEFAULT_*). The LOWER
  // bound is a stable +5.0 (numeric -5) so the range always reaches well into
  // plus-handicap territory regardless of the current candidate data; the UPPER
  // bound is derived from the dataset (so players above 18 stay reachable). Step
  // 0.1 matches handicap precision. 18 is a soft reference mark on the scale,
  // NOT an upper cutoff — players above 18 stay in the pool; no eligibility is
  // changed.
  const hcpBounds = useMemo(() => {
    const vs = rows
      .map((r) => r.currentHandicap.value)
      .filter((v): v is number => v != null && Number.isFinite(v))
    if (vs.length === 0) return { lo: -5, hi: 24 }
    const hi = Math.ceil(Math.max(...vs)) + 1
    return { lo: -5, hi: Math.max(hi, 19) }
  }, [rows])

  const visibleRows = rows.filter(isVisible)
  const leavingRows = rows.filter((r) => !!leaving[r.playerId])
  const anyFilter =
    fState !== 'considering' || fHcpMin != null || fHcpMax != null || !!fAvail
  const activeFilterCount =
    (fState !== 'considering' ? 1 : 0) +
    (fHcpMin != null || fHcpMax != null ? 1 : 0) +
    (fAvail ? 1 : 0)
  // The handicap range is at the product default (0–18) when both bounds are
  // unset (null = default). Drives the always-present "Reset range" control's
  // disabled state so it can keep stable space without layout shift.
  const atDefault = fHcpMin == null && fHcpMax == null

  // Shared per-row controls.
  const stateControl = (r: ai.ScoutingBoardRow) => {
    const k = cellKey(r.playerId)
    return (
      <StateSegmented
        current={states[r.playerId] ?? 'considering'}
        pending={!!pending[k]}
        error={errors[k] ?? null}
        disabled={!!leaving[r.playerId]}
        onChange={(s) => editState(r.playerId, s)}
      />
    )
  }
  // One availability cell. Used by both the desktop secondary strip and the
  // mobile card. The popover is portal-rendered so it is never clipped.
  //
  // IMPORTANT: the desktop table and the mobile card are BOTH in the DOM (one is
  // CSS-hidden, not unmounted), so the same (player, session) cell exists twice.
  // The pending/error key is shared (one save per cell, reflected on both), but
  // the OPEN-CELL key is scoped per layout instance ('d' desktop / 'm' mobile).
  // Without the scope, opening the desktop cell would also "open" the hidden
  // mobile instance, whose outside-click listener would then fire on the menu
  // item's mousedown and close the menu before the click/select registered — so
  // the chosen value never applied. The scope makes only the clicked instance
  // open (and only it registers a listener/portal).
  const renderAvailCell = (r: ai.ScoutingBoardRow, s: ai.ScoutingSession, scope: 'd' | 'm') => {
    const k = cellKey(r.playerId, s.id) // pending/error: shared across layouts
    const ok = `a:${scope}:${r.playerId}/${s.id}` // openCell: per instance
    return (
      <AvailCell
        key={`${scope}:${s.id}`}
        playerId={r.playerId}
        sessionId={s.id}
        scope={scope}
        label={s.format ?? '·'}
        value={avails[r.playerId]?.[s.id] ?? ''}
        pending={!!pending[k]}
        error={errors[k] ?? null}
        disabled={!!leaving[r.playerId]}
        open={openCell === ok}
        onToggle={() => setOpenCell((cur2) => (cur2 === ok ? null : ok))}
        onSelect={(status) => editAvail(r.playerId, s.id, status)}
      />
    )
  }

  // Candidate-level alternating tint. The unit of alternation is the WHOLE
  // candidate (primary + availability rows share one tint), never the physical
  // row — that keeps availability visually attached to its player. A very faint
  // green-neutral (primary at low opacity) on odd candidates, transparent on
  // even — restrained, consistent with the PlanIt palette, NOT gray zebra
  // striping. Hover is a uniform faint dark tint so it reads identically on both
  // tints; the leave 'show' highlight (bg-accent/30) overrides the tint on both
  // rows so the candidate lights up as one unit. Pending/error states layer on
  // top via the per-cell controls, not the row tint, so they stay legible.
  const groupTint = (i: number) => (i % 2 === 0 ? 'bg-transparent' : 'bg-primary/[0.05]')

  // Mobile card classes. The card is ONE element per candidate, so the candidate
  // boundary is the section's divide-y; the card itself carries the same subtle
  // group tint (alternating) plus the leave highlight/fade. Hover is a uniform
  // faint tint that reads identically on both tints.
  function cardClasses(r: ai.ScoutingBoardRow, i: number): string {
    const phase = leaving[r.playerId]
    if (phase === 'fade') return cn(groupTint(i), 'opacity-0 transition-opacity duration-500')
    if (phase === 'show') return 'bg-accent/30'
    return cn(groupTint(i), 'hover:bg-foreground/5')
  }

  // Primary row. Its TOP border is the candidate boundary (stronger, full
  // border-border) — the separator BETWEEN candidates. The availability row below
  // uses only a hairline, so the player-to-availability join is visibly weaker
  // than the candidate-to-candidate break.
  function rowClasses(r: ai.ScoutingBoardRow, i: number): string {
    const phase = leaving[r.playerId]
    if (phase === 'fade') return cn(groupTint(i), 'border-t border-border opacity-0 transition-opacity duration-500')
    if (phase === 'show') return 'border-t border-border bg-accent/30'
    return cn(groupTint(i), 'border-t border-border hover:bg-foreground/5')
  }

  // Secondary availability strip. Same candidate tint as its primary row (so the
  // two read as one record), a HAIRLINE top divider (border-border/25 — weaker
  // than the candidate boundary above the primary row), and no hover — the strip
  // is a labeled subsection of the candidate, not an independently interactive
  // row. During the leave transition it matches the primary row's highlight/fade.
  function stripClasses(r: ai.ScoutingBoardRow, i: number): string {
    const phase = leaving[r.playerId]
    if (phase === 'fade') return cn(groupTint(i), 'opacity-0 transition-opacity duration-500')
    if (phase === 'show') return 'bg-accent/30 border-t border-border/25'
    return cn(groupTint(i), 'border-t border-border/25')
  }

  // A candidate renders as TWO table rows (primary + secondary strip), grouped
  // by a Fragment so they stay together and share one key. Rendering in `rows`
  // order (rather than separate visible/leaving passes) keeps a leaving row in
  // its sorted slot while it fades in place. `i` is the candidate ordinal among
  // rendered rows, driving the subtle group-level alternation.
  function renderCandidate(r: ai.ScoutingBoardRow, i: number) {
    return (
      <Fragment>
        <tr className={rowClasses(r, i)}>
          <td className="px-3 py-2 text-muted-foreground">{r.currentRank ?? '—'}</td>
          <td className="px-3 py-2">
            <Link href={`/igc/seattle-cup/scouting/players/${r.playerId}`} className="font-medium hover:underline">
              {r.displayName ?? 'Unknown'}
            </Link>
            <div className="text-xs text-muted-foreground">GHIN {r.ghinNumber ?? '—'}</div>
          </td>
          <td className="px-3 py-2 text-right">{r.totalPoints != null ? r.totalPoints.toFixed(1) : '—'}</td>
          <td className="px-3 py-2 text-right">{r.numberOfEvents ?? '—'}</td>
          <td className="px-3 py-2 text-right">{r.numberOfWins ?? '—'}</td>
          <td className="px-3 py-2"><Hcap h={r.currentHandicap} /></td>
          <td className="px-3 py-2">{stateControl(r)}</td>
        </tr>
        {/* Secondary strip: a low-prominence "Availability" label establishes what
            the four session controls mean, then the four chips (label + value as
            one unit) grouped left. The label is intentionally quieter than the
            player name / primary data. Full session names stay legible. */}
        <tr className={stripClasses(r, i)}>
          <td colSpan={7} className="px-3 py-1.5">
            {/* One coherent row: label + the four session chips, wrapping together. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Availability
              </span>
              {/* Compact grouped strip: each session + its availability value is one
                  chip (label adjacent to glyph), the four chips grouped left with
                  consistent spacing — NOT stretched across the row. Every candidate
                  renders the same four chips in the same order (Fourball→Scramble→
                  Chapman→Singles), so a session lines up vertically for scanning. */}
              <div className="flex flex-wrap gap-2">
                {sessions.map((s) => renderAvailCell(r, s, 'd'))}
              </div>
            </div>
          </td>
        </tr>
      </Fragment>
    )
  }

  return (
    <div className="space-y-6">
      {/* ONE coherent, collapsible Filters panel. All filtering controls live here;
          nothing filter-related is scattered elsewhere. Collapsing keeps a
          compact active-filter summary so active filtering is never invisible. */}
      <section className="rounded-md border border-border bg-white/80">
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left"
        >
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-foreground/80">
                {activeFilterCount} active
              </span>
            )}
            {navPending && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-foreground/50" />
                updating
              </span>
            )}
          </span>
          <svg
            viewBox="0 0 20 20"
            className={cn('h-4 w-4 text-muted-foreground transition-transform', filtersOpen ? 'rotate-180' : 'rotate-0')}
            aria-hidden
          >
            <path d="M5 7l5 6 5-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {filtersOpen && (
          <div className="space-y-5 border-t border-border p-4">
            {/* Candidate state */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Candidate state
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {STATE_TABS.map((t) => {
                  const active = fState === t.key
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => applyFilter({ state: t.key })}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors',
                        active
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border bg-white text-foreground hover:bg-muted/40'
                      )}
                    >
                      <span className="font-medium">{t.label}</span>
                      <span className={active ? 'text-background/70' : 'text-muted-foreground'}>{counts[t.key]}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Handicap range: ONE compact control = a dual-thumb slider plus linked
                Min/Max text inputs (same state, two-way sync). Plus handicaps are
                negative numerics shown in golf notation (+2.3). The slider's
                AVAILABLE range is +5.0 → dataset-max; the DEFAULT SELECTED range
                is 0.0–18.0 (a view filter, not an eligibility rule). 18 is a soft
                reference, NOT a cutoff. */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  Handicap
                </span>
                <div className="flex items-center gap-3">
                  <HcpText
                    label="Min"
                    value={fHcpMin ?? HCP_DEFAULT_MIN}
                    lo={hcpBounds.lo}
                    hi={hcpBounds.hi}
                    onCommit={setHcpMin}
                  />
                  <HcpText
                    label="Max"
                    value={fHcpMax ?? HCP_DEFAULT_MAX}
                    lo={hcpBounds.lo}
                    hi={hcpBounds.hi}
                    onCommit={setHcpMax}
                  />
                </div>
              </div>
              {/* Dual-thumb slider: two overlaid native range inputs (keyboard
                  accessible) with pointer-events only on the thumbs; the filled
                  segment between the thumbs is the selected range. */}
              <div className="relative h-5">
                <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
                <div
                  className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/55"
                  style={{
                    left: `${hcpPct(fHcpMin ?? HCP_DEFAULT_MIN, hcpBounds.lo, hcpBounds.hi)}%`,
                    right: `${100 - hcpPct(fHcpMax ?? HCP_DEFAULT_MAX, hcpBounds.lo, hcpBounds.hi)}%`,
                  }}
                />
                <input
                  type="range"
                  min={hcpBounds.lo}
                  max={hcpBounds.hi}
                  step={0.1}
                  value={fHcpMin ?? HCP_DEFAULT_MIN}
                  onChange={(e) => setHcpMin(Number(e.target.value))}
                  aria-label="Minimum handicap"
                  className={cn(RANGE_THUMB_CLS, 'z-10')}
                />
                <input
                  type="range"
                  min={hcpBounds.lo}
                  max={hcpBounds.hi}
                  step={0.1}
                  value={fHcpMax ?? HCP_DEFAULT_MAX}
                  onChange={(e) => setHcpMax(Number(e.target.value))}
                  aria-label="Maximum handicap"
                  className={cn(RANGE_THUMB_CLS, 'z-20')}
                />
              </div>
              <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                Default view is 0.0–18.0. Plus handicaps use golf notation (e.g. +2.3). 18.0 is a Seattle Cup reference mark, not a cutoff — drag Max above 18 to see higher-handicap players.
              </p>
              {/* Reset range: always rendered so the control occupies stable
                  space at all times and the panel geometry never shifts. Disabled
                  (visually restrained) at the default 0–18 range; enabled
                  (clearly actionable) when the range differs. Clicking returns
                  Min/Max to the product default via the existing reset semantics. */}
              <button
                type="button"
                disabled={atDefault}
                onClick={() => applyFilter({ hcpMin: null, hcpMax: null })}
                className={cn(
                  'mt-1 text-xs',
                  atDefault
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    : 'text-muted-foreground underline hover:text-foreground'
                )}
              >
                Reset range
              </button>
            </div>

            {/* Availability: per session can play / out (single active filter). */}
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Availability
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                {sessions.map((s) => {
                  const canActive = availSid === s.id && availKind === 'can'
                  const outActive = availSid === s.id && availKind === 'out'
                  return (
                    <div
                      key={s.id}
                      className="flex items-center gap-1 rounded-full border border-border bg-white px-1 py-0.5"
                    >
                      <span className="px-2 text-xs text-muted-foreground">{s.format ?? 'Session'}</span>
                      <button
                        type="button"
                        onClick={() => applyFilter({ avail: canActive ? '' : `${s.id}:can` })}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs transition-colors',
                          canActive ? 'bg-emerald-600 text-white' : 'text-emerald-700 hover:bg-emerald-50'
                        )}
                      >
                        can play
                      </button>
                      <button
                        type="button"
                        onClick={() => applyFilter({ avail: outActive ? '' : `${s.id}:out` })}
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs transition-colors',
                          outActive ? 'bg-red-600 text-white' : 'text-red-700 hover:bg-red-50'
                        )}
                      >
                        out
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>

            {anyFilter && (
              <button
                type="button"
                onClick={() => applyFilter({ state: 'considering', hcpMin: null, hcpMax: null, avail: '' })}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>

      {/* Results area. A subtle pending treatment (thin top progress bar + faint
          overlay) appears while a filter navigation is in flight, so a click is
          acknowledged even though the optimistic state already updated the rows. */}
      <div className="relative" aria-busy={navPending}>
        {navPending && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden rounded-t-md">
              <div className="h-full w-full animate-pulse bg-foreground/40" />
            </div>
            <div className="pointer-events-none absolute inset-0 z-10 rounded-md bg-foreground/[0.03]" />
          </>
        )}

      {/* Desktop board (md+): operable table. Each candidate is a primary row
          (rank/player/points/events/wins/handicap/state) plus a compact secondary
          availability strip (Fourball/Scramble/Chapman/Singles) so the four
          session names get full, consistently-positioned room without widening
          the primary row. */}
      <section className="hidden overflow-x-auto rounded-md border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2 text-right">Points</th>
              <th className="px-3 py-2 text-right">Events</th>
              <th className="px-3 py-2 text-right">Wins</th>
              <th className="px-3 py-2">Handicap</th>
              <th className="px-3 py-2">State</th>
            </tr>
          </thead>
          <tbody>
            {/* Rendered in `rows` (sorted) order; a leaving row stays in its slot
                while it fades in place. The index drives the candidate-level
                alternating tint and is stable across renders for the same ordinal. */}
            {rows
              .filter((r) => leaving[r.playerId] || isVisible(r))
              .map((r, i) => (
                <Fragment key={r.playerId}>{renderCandidate(r, i)}</Fragment>
              ))}
            {visibleRows.length === 0 && leavingRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No candidates match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Mobile board (<md): card list, intentionally laid out for touch. Each card
          is one candidate; the section's divide-y is the candidate boundary. The
          availability subsection sits beneath state with a hairline + a quiet
          "Availability" label so it clearly belongs to the candidate above it. */}
      <section className="divide-y divide-border rounded-md border border-border bg-white/80 md:hidden">
        {[...visibleRows, ...leavingRows].map((r, i) => (
          <div key={r.playerId} className={cn('p-3', cardClasses(r, i))}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-muted-foreground">{r.currentRank ?? '—'}</span>
                  <Link href={`/igc/seattle-cup/scouting/players/${r.playerId}`} className="font-medium hover:underline">
                    {r.displayName ?? 'Unknown'}
                  </Link>
                </div>
                <div className="text-xs text-muted-foreground">GHIN {r.ghinNumber ?? '—'}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>{r.totalPoints != null ? `${r.totalPoints.toFixed(1)} pts` : '—'}</div>
                <div>{r.numberOfEvents ?? '—'} ev · {r.numberOfWins ?? '—'} w</div>
                <div className="text-foreground"><Hcap h={r.currentHandicap} /></div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {stateControl(r)}
              <Link
                href={`/igc/seattle-cup/scouting/players/${r.playerId}`}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                Details
              </Link>
            </div>
            {/* Availability subsection: hairline + quiet label make it a labeled part
                of THIS candidate. Same compact chips as desktop — each value tied to
                its full session name, grouped (not a 4-col grid that squeezes names). */}
            <div className="mt-2.5 border-t border-border/25 pt-2">
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Availability
              </div>
              <div className="flex flex-wrap gap-2">
                {sessions.map((s) => renderAvailCell(r, s, 'm'))}
              </div>
            </div>
          </div>
        ))}
        {visibleRows.length === 0 && leavingRows.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No candidates match these filters.</div>
        )}
      </section>
      </div>
    </div>
  )
}