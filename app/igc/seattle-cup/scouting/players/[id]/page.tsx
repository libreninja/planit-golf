import { notFound } from 'next/navigation'
import { requireScoutingAccess } from '@/lib/scouting-access'
import * as ai from '@/lib/planit-ai/client'
import {
  createNoteAction,
  updateNoteAction,
  deleteNoteAction,
  setCandidateStateAction,
} from '../../actions'
import { AvailabilityEditor } from './availability-editor'
import { Button } from '@/components/ui/button'
import { ScoutingUnavailable } from '@/components/scouting/scouting-unavailable'

export const dynamic = 'force-dynamic'

const ROSTER_STATES = ['considering', 'out', 'selected'] as const
const ROSTER_LABELS: Record<(typeof ROSTER_STATES)[number], string> = {
  considering: 'Considering',
  out: 'Out',
  selected: 'Selected',
}

function HcapSource({ source }: { source: string | null }) {
  if (source === 'ghin') return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">GHIN</span>
  if (source === 'golf_genius')
    return <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">Golf Genius · may be stale</span>
  if (source === 'manual') return <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">manual</span>
  return null
}

function NoteMeta({ n }: { n: ai.ScoutingNote }) {
  const parts: string[] = [n.category ?? 'general']
  if (n.attributedTo) parts.push(`via ${n.attributedTo}`)
  if (n.author) parts.push(`entered by ${n.author}`)
  if (n.source && n.source !== 'human') parts.push(n.source)
  parts.push(`updated ${n.updatedAt.slice(0, 10)}`)
  return <span className="text-xs text-muted-foreground">{parts.join(' · ')}</span>
}

export default async function PlayerCardPage({ params }: { params: Promise<{ id: string }> }) {
  // Access gate FIRST: unauthorized users redirect before any planit-ai call.
  await requireScoutingAccess()
  const { id } = await params

  let card: ai.ScoutingCard | null = null
  let categories: string[] = []
  try {
    ;[card, categories] = await Promise.all([ai.getCard(id), ai.getNoteCategories()])
  } catch (err) {
    // Unknown player id — the backend is fine, show the not-found page.
    if (ai.isNotFound(err)) notFound()
    if (ai.isBackendUnavailable(err)) {
      console.warn('[scouting] backend unavailable:', (err as Error).message)
      return <ScoutingUnavailable />
    }
    // Real defect: log loudly and re-throw so it stays visible.
    console.error('[scouting] card load failed:', err)
    throw err
  }
  // getCard may resolve to null when the backend returns a 200/null for a
  // missing player (rather than 404) — preserve the not-found behavior.
  if (!card) notFound()

  return (
    <div>
      <div className="space-y-6 py-2">
        <div>
          <h1 className="font-display text-2xl leading-none">{card.displayName ?? 'Unknown player'}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            GHIN {card.ghinNumber ?? '—'} {card.email ? `· ${card.email}` : ''} · data as-of {card.provenance.asOf.slice(0, 10)}
          </p>
        </div>

        {/* Roster state: captain decision, shared across scouts. Low-friction —
            one click changes state. Independent of availability. */}
        <section className="rounded-md border border-border bg-white/80 p-4">
          <h2 className="mb-1 text-sm font-semibold">Roster state</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Captain decision, shared across scouts. Independent of availability.
          </p>
          <div className="flex flex-wrap gap-2">
            {ROSTER_STATES.map((st) => {
              const active = card.candidateState === st
              return (
                <form key={st} action={setCandidateStateAction} className="inline">
                  <input type="hidden" name="playerId" value={card.playerId} />
                  <input type="hidden" name="state" value={st} />
                  <Button type="submit" variant={active ? 'default' : 'outline'} size="sm">
                    {ROSTER_LABELS[st]}
                  </Button>
                </form>
              )
            })}
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Current league */}
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-2 text-sm font-semibold">Current league (Golf Genius)</h2>
            {card.currentLeague ? (
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Rank</dt><dd>{card.currentLeague.currentRank ?? '—'}</dd>
                <dt className="text-muted-foreground">Points</dt><dd>{card.currentLeague.totalPoints != null ? card.currentLeague.totalPoints.toFixed(1) : '—'}</dd>
                <dt className="text-muted-foreground">Events played</dt><dd>{card.currentLeague.numberOfEvents ?? '—'}</dd>
                <dt className="text-muted-foreground">Wins</dt><dd>{card.currentLeague.numberOfWins ?? '—'}</dd>
                <dt className="text-muted-foreground">Top-10</dt><dd>{card.currentLeague.topTenFinishes ?? '—'}</dd>
                <dt className="text-muted-foreground">Behind leader</dt><dd>{card.currentLeague.pointsBehindLeader != null ? card.currentLeague.pointsBehindLeader.toFixed(1) : '—'}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No current-season standing.</p>
            )}
          </section>

          {/* Seattle Cup history */}
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-2 text-sm font-semibold">Seattle Cup roster history</h2>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-800">{card.seattleCupHistory.count}</span>
              <span className="text-sm text-muted-foreground">{card.seattleCupHistory.years.join(', ') || 'none'}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Registration history, not confirmed appearances.</p>
          </section>

          {/* Handicap */}
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-2 text-sm font-semibold">Current handicap (derived)</h2>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{card.currentHandicap.value != null ? card.currentHandicap.value.toFixed(1) : '—'}</span>
              <HcapSource source={card.currentHandicap.source} />
              {card.currentHandicap.isStale && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">stale</span>}
              <span className="text-xs text-muted-foreground">as-of {card.currentHandicap.effectiveDate ?? '—'}</span>
            </div>
            {card.currentHandicap.observations.length > 0 && (
              <table className="mt-3 w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr><th className="py-1">Source</th><th className="py-1">Index</th><th className="py-1">Scores</th><th className="py-1">Effective</th></tr>
                </thead>
                <tbody>
                  {card.currentHandicap.observations.map((o) => (
                    <tr key={o.id} className="border-t border-border">
                      <td className="py-1"><HcapSource source={o.source} /></td>
                      <td className="py-1">{o.handicapIndex != null ? o.handicapIndex.toFixed(1) : '—'}</td>
                      <td className="py-1">{o.currentYearScoreCount ?? '—'}</td>
                      <td className="py-1">{o.effectiveDate ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Baseline */}
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-2 text-sm font-semibold">Baseline status</h2>
            {!card.baseline.determinable ? (
              <p className="text-sm text-muted-foreground">Pending GHIN — active status and current-year score count require a GHIN observation.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Active GHIN</dt><dd>{card.baseline.active ? 'yes' : 'no'}</dd>
                <dt className="text-muted-foreground">Current-year scores</dt><dd>{card.baseline.currentYearScoreCount ?? '—'}</dd>
                <dt className="text-muted-foreground">Meets minimum (≥8)</dt><dd>{card.baseline.meetsMinimum ? 'yes' : 'no'}</dd>
              </dl>
            )}
          </section>

          {/* Availability: one form, four session fields, one Save button. */}
          <section className="rounded-md border border-border bg-white/80 p-4 md:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">Availability (2026 sessions)</h2>
            <AvailabilityEditor
              playerId={card.playerId}
              sessions={card.availability.sessions.map((s) => ({
                sessionId: s.sessionId,
                format: s.format,
                date: s.date,
                course: s.course,
              }))}
              persisted={Object.fromEntries(
                card.availability.sessions.map((s) => [s.sessionId, s.status ?? null])
              )}
            />
          </section>

          {/* Notes */}
          <section className="rounded-md border border-border bg-white/80 p-4 md:col-span-2">
            <h2 className="mb-1 text-sm font-semibold">Scouting notes</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Attributable human observations — not system-derived facts. The recorder (you) is recorded automatically;
              name the original source below when a note came through someone else.
            </p>

            <form action={createNoteAction} className="mb-4 space-y-2">
              <input type="hidden" name="playerId" value={card.playerId} />
              <div className="flex flex-wrap gap-2">
                <select name="category" className="rounded-md border border-border px-2 py-1 text-sm">
                  <option value="">Category (optional)</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input name="attributedTo" type="text" placeholder="original source — who said it (optional)" className="flex-1 rounded-md border border-border px-3 py-1 text-sm" />
              </div>
              <input name="context" type="text" placeholder="context (e.g. league conversation, tournament) — optional" className="w-full rounded-md border border-border px-3 py-1 text-sm" />
              <textarea name="body" placeholder="Scouting observation…" className="w-full rounded-md border border-border px-3 py-1 text-sm" rows={2} />
              <Button type="submit" size="sm">Add note</Button>
            </form>

            <div className="space-y-3">
              {card.notes.map((n) => (
                <div key={n.id} className="rounded-md border border-border p-3">
                  <form action={updateNoteAction} className="space-y-2">
                    <input type="hidden" name="playerId" value={card.playerId} />
                    <input type="hidden" name="noteId" value={n.id} />
                    <div className="flex flex-wrap gap-2">
                      <select name="category" defaultValue={n.category ?? ''} className="rounded-md border border-border px-2 py-1 text-sm">
                        <option value="">Category (optional)</option>
                        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <input name="attributedTo" type="text" defaultValue={n.attributedTo ?? ''} placeholder="original source (optional)" className="flex-1 rounded-md border border-border px-3 py-1 text-sm" />
                    </div>
                    <input name="context" type="text" defaultValue={n.source && n.source !== 'human' ? n.source : ''} placeholder="context — optional" className="w-full rounded-md border border-border px-3 py-1 text-sm" />
                    <textarea name="body" defaultValue={n.body} className="w-full rounded-md border border-border px-3 py-1 text-sm" rows={2} />
                    <div className="flex items-center gap-3">
                      <Button type="submit" variant="outline" size="sm">Save edit</Button>
                      <NoteMeta n={n} />
                    </div>
                  </form>
                  <form action={deleteNoteAction} className="mt-2">
                    <input type="hidden" name="playerId" value={card.playerId} />
                    <input type="hidden" name="noteId" value={n.id} />
                    <Button type="submit" variant="ghost" size="sm" className="text-red-700">Delete</Button>
                  </form>
                </div>
              ))}
              {card.notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
            </div>
          </section>

          {/* Tags UI is intentionally hidden (item 2). The tag data model, API,
              and server actions are preserved for future re-enablement. */}

          <section className="rounded-md border border-border bg-white/80 p-4 md:col-span-2">
            <h2 className="mb-2 text-sm font-semibold">Honest gaps</h2>
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              <li>Scoring average: not yet available (tee-sheet ingestion deferred).</li>
              <li>Away-course rounds / index trend: pending GHIN round-history (P1.2).</li>
              <li>Top-30 formula, Captain&apos;s Pick limit, handicap distribution, date/away-course weighting: intentionally not modeled.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}