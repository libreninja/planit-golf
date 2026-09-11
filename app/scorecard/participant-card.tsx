'use client'

import { useEffect, useRef, useState } from 'react'
import type { ParticipantScorecard } from '@/lib/events/participant-scorecard'

type Draft = { value: string; expectedRevision: number; requestId: string }
type Scores = ParticipantScorecard['scores']
class SaveError extends Error {
  code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}
async function requestCard(path = '/api/scorecard', body?: unknown) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const result = await response.json()
  if (!response.ok) throw new SaveError(result.error, result.code)
  return result
}
// getRandomValues also supports a phone opening this local demo over LAN HTTP.
function newRequestId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const keyFor = (id: string, hole: number) => `${id}:${hole}`

export function ParticipantCard() {
  const pendingToken = useRef('')
  const initialLoad = useRef<Promise<ParticipantScorecard> | null>(null)
  const [card, setCard] = useState<ParticipantScorecard | null>(null)
  const [hole, setHole] = useState(1)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [conflict, setConflict] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  useEffect(() => {
    // Fragment avoids tokens in server access logs/referrers. Exchange once for
    // a path-scoped HttpOnly session cookie; no localStorage or account session.
    const token = window.location.hash.slice(1)
    if (token) {
      pendingToken.current = token
      window.history.replaceState(null, '', '/scorecard')
    }
    let active = true
    const load = initialLoad.current ??= token ? requestCard('/api/scorecard/access', { token }) : requestCard()
    load.then((data: ParticipantScorecard) => {
      if (active) { pendingToken.current = ''; setCard(data); setHole(data.startingHole ?? data.holes[0].hole) }
    }).catch((e: Error) => { if (active) setError(e instanceof SaveError ? e.message : 'Unable to reach scoring. Try again to open your card.') })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!Object.keys(drafts).length) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [drafts])

  async function retryOpen() {
    setError('')
    try {
      const data: ParticipantScorecard = pendingToken.current
        ? await requestCard('/api/scorecard/access', { token: pendingToken.current }) : await requestCard()
      pendingToken.current = ''
      setCard(data); setHole(data.startingHole ?? data.holes[0].hole)
    } catch (e) { setError(e instanceof SaveError ? e.message : 'Unable to reach scoring. Try again to open your card.') }
  }

  async function save() {
    if (!card) return
    setBusy(true); setError(''); setNotice('')
    try {
      for (const player of card.players) {
        const key = keyFor(player.id, hole)
        const draft = drafts[key]
        if (!draft) continue
        if (draft.value === '') {
          setDrafts((current) => { const next = { ...current }; delete next[key]; return next })
          continue
        }
        const saved: Scores[number] = await requestCard('/api/scorecard', {
          eventEditionId: card.eventEditionId, roundId: card.roundId, groupId: card.groupId,
          participantId: player.id, hole, gross: Number(draft.value),
          expectedRevision: draft.expectedRevision, requestId: draft.requestId,
        })
        setCard((current) => current && ({ ...current,
          scores: [...current.scores.filter((s) => s.participantId !== player.id || s.hole !== hole), saved] }))
        setDrafts((current) => { const next = { ...current }; delete next[key]; return next })
      }
      // Read authoritative state after all acknowledged writes, also on retry.
      setCard(await requestCard())
      setNotice(`Hole ${hole} saved. Blank scores stay unscored.`)
      const index = card.holes.findIndex((h) => h.hole === hole)
      if (index < card.holes.length - 1) setHole(card.holes[index + 1].hole)
    } catch (e) {
      setError(e instanceof SaveError ? e.message : 'Unable to reach scoring. Your entries are still here; try again.')
      if (e instanceof SaveError && ['P1002', 'P1003'].includes(e.code)) setConflict(true)
      if (e instanceof SaveError && e.code === 'P1010') setUnavailable(true)
    } finally { setBusy(false) }
  }

  async function reviewLatest() {
    setBusy(true)
    try {
      const latest: ParticipantScorecard = await requestCard()
      setCard(latest)
      setDrafts((current) => Object.fromEntries(Object.entries(current).map(([key, draft]) => {
        const [id, holeNumber] = key.split(':')
        const score = latest.scores.find((s) => s.participantId === id && s.hole === Number(holeNumber))
        return [key, { ...draft, expectedRevision: score?.revision ?? 0, requestId: newRequestId() }]
      })))
      setConflict(false); setError('')
      setNotice('Latest saved scores are shown below. Your entries are unchanged. Check them, then Save & Next to confirm your corrections.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to read current scores.') }
    finally { setBusy(false) }
  }

  if (!card) return <main className="mx-auto max-w-md px-5 py-12">
    <h1 className="text-3xl">Wine Valley</h1>
    <p className="mt-6" role={error ? 'alert' : 'status'}>{error || 'Opening your scorecard…'}</p>
    {error && <button className="mt-6 min-h-12 rounded-xl border px-5" onClick={retryOpen}>Try again</button>}
  </main>

  const currentHole = card.holes.find((h) => h.hole === hole)!
  const index = card.holes.indexOf(currentHole)
  const completed = card.holes.filter((h) => card.players.length > 0 && card.players.every((p) =>
    card.scores.some((s) => s.participantId === p.id && s.hole === h.hole))).length
  const time = card.startsAt ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit',
  }).format(new Date(card.startsAt)) : ''
  const invalid = card.players.some((p) => {
    const value = drafts[keyFor(p.id, hole)]?.value
    return value !== undefined && value !== '' && (!/^\d{1,2}$/.test(value) || Number(value) < 1)
  })

  return <main className="mx-auto min-h-dvh max-w-md px-5 pb-10 pt-8">
    <header className="mb-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Group scorecard</p>
      <h1 className="mt-2 text-4xl">{card.eventName}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{card.roundName.replace(/FRIDAY AFTERNOON ROUND 1/i, 'Friday PM')} · {time}</p>
    </header>
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-label={`Hole ${hole} scores`}>
      <div className="flex items-center justify-between bg-primary px-5 py-5 text-primary-foreground">
        <h2 className="text-3xl">Hole {hole}</h2><span className="text-sm font-medium">Par {currentHole.par}</span>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className="divide-y px-5">
          {card.players.map((player) => {
            const score = card.scores.find((s) => s.participantId === player.id && s.hole === hole)
            const key = keyFor(player.id, hole)
            return <div key={key} className="flex min-h-24 items-center justify-between gap-4 py-4">
              <label htmlFor={key} className="min-w-0 flex-1 font-medium">{player.name}
                <span className="mt-1 block text-xs font-normal text-muted-foreground">{score ? `Saved ${score.gross} · revision ${score.revision}` : 'Not scored'}</span>
              </label>
              <input id={key} aria-label={`${player.name} gross score`} inputMode="numeric" type="text"
                autoComplete="off" pattern="[0-9]{1,2}" maxLength={2} placeholder="–" disabled={busy || unavailable}
                className="h-14 w-16 rounded-xl border bg-background text-center text-2xl tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
                value={drafts[key]?.value ?? score?.gross ?? ''}
                onChange={(event) => {
                  const value = event.target.value
                  setDrafts((current) => ({ ...current, [key]: {
                    value, expectedRevision: current[key]?.expectedRevision ?? score?.revision ?? 0,
                    requestId: newRequestId(),
                  } }))
                  setNotice('')
                }} />
            </div>
          })}
        </div>
        <div className="space-y-3 px-5 pb-5">
          {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {conflict && <button type="button" onClick={reviewLatest} disabled={busy} className="min-h-12 w-full rounded-xl border px-3 font-medium">Review latest scores</button>}
          <button type="submit" disabled={busy || invalid || conflict || unavailable || !card.players.length}
            className="min-h-14 w-full rounded-xl bg-primary px-4 py-4 font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? 'Saving…' : index === card.holes.length - 1 ? 'Save scores' : 'Save & Next'}
          </button>
          <p className="text-xs leading-relaxed text-muted-foreground">Gross strokes · Each player saves separately. Blank entries leave saved scores unchanged.</p>
        </div>
      </form>
    </section>
    <nav className="mt-4 flex items-center justify-between" aria-label="Hole navigation">
      <button disabled={busy || index === 0} onClick={() => setHole(card.holes[index - 1].hole)} className="min-h-12 rounded-xl px-3 disabled:opacity-30">← Previous</button>
      <span className="text-sm text-muted-foreground">{hole} / {card.holes.length}</span>
      <button disabled={busy || index === card.holes.length - 1} onClick={() => setHole(card.holes[index + 1].hole)} className="min-h-12 rounded-xl px-3 disabled:opacity-30">Next →</button>
    </nav>
    <p className="mt-4 text-center text-sm text-muted-foreground">{completed === card.holes.length ? 'Group card complete' : `${completed} of ${card.holes.length} holes complete for your group`}</p>
  </main>
}
