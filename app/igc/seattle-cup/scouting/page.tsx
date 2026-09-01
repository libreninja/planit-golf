import Link from 'next/link'
import { requireScoutingAccess } from '@/lib/scouting-access'
import { getAppShellUser } from '@/lib/app-shell/user'
import * as ai from '@/lib/planit-ai/client'
import { addCandidateAction } from './actions'
import { Button } from '@/components/ui/button'
import { ScoutingUnavailable } from '@/components/scouting/scouting-unavailable'
import { CandidateBoard } from './candidate-board'

export const dynamic = 'force-dynamic'

type StateFilter = 'considering' | 'out' | 'selected' | 'all'

export default async function ScoutingBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; hcpmin?: string; hcpmax?: string; avail?: string }>
}) {
  // Access gate FIRST: unauthorized users redirect before any planit-ai call.
  await requireScoutingAccess()
  const shellUser = await getAppShellUser()
  const canManageAccess = shellUser.isAdmin

  const sp = await searchParams
  const stateFilter: StateFilter =
    sp.state === 'out' || sp.state === 'selected' || sp.state === 'all' ? sp.state : 'considering'
  // Handicap range (numeric, supports plus handicaps stored as negatives).
  // Empty/invalid → null (open bound). Bounds derive from candidate data client-side.
  const num = (v: string | undefined): number | null => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const hcpMin = num(sp.hcpmin)
  const hcpMax = num(sp.hcpmax)
  // avail = "<sessionId>:<can|out>"
  const availFilter = sp.avail ?? ''

  let board: ai.ScoutingBoardRow[] = []
  let addable: ai.AddablePlayer[] = []
  let sessions: ai.ScoutingSession[] = []
  try {
    ;[board, addable, sessions] = await Promise.all([
      ai.getBoard(),
      ai.getAddablePlayers(),
      ai.getSessions(),
    ])
  } catch (err) {
    if (ai.isBackendUnavailable(err)) {
      console.warn('[scouting] backend unavailable:', (err as Error).message)
      return <ScoutingUnavailable />
    }
    console.error('[scouting] board load failed:', err)
    throw err
  }

  // The board is rendered by a client component that owns optimistic state and
  // per-session availability editing with immediate background persistence.
  // All rows are passed unfiltered; the client applies the URL-driven filters
  // (state tabs, handicap buckets, availability) so edits and the
  // acknowledged-then-leave transition stay coherent with the active view.
  return (
    <div>
      <div className="space-y-6 py-2">
        {/* Header: headline + candidate count. Admin actions stay low-prominence
            and admin-only, but Cup resolution gets its own labeled entry (with a
            deep link to the section) so admins don't have to discover it under
            "Manage access". No provenance/observation explanation on the board. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl leading-none">Seattle Cup · Scouting</h1>
            <p className="mt-1 text-xs text-muted-foreground">2026 candidates · {board.length} players</p>
          </div>
          {canManageAccess ? (
            <div className="flex flex-none items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/igc/seattle-cup/harvest/2026/review">Intel harvest</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/scouting#cup-resolution">Cup resolution</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/admin/scouting">Manage access</Link>
              </Button>
            </div>
          ) : null}
        </div>

        <CandidateBoard
          rows={board}
          sessions={sessions}
          stateFilter={stateFilter}
          hcpMin={hcpMin}
          hcpMax={hcpMax}
          availFilter={availFilter}
        />

        {/* Add candidate */}
        {addable.length > 0 && (
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-2 text-sm font-semibold">Add a candidate</h2>
            <form action={addCandidateAction} className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Player</label>
                <select name="sourceMemberCardId" className="rounded-md border border-border px-3 py-2">
                  {addable.map((p) => (
                    <option key={p.sourceMemberCardId} value={p.sourceMemberCardId}>
                      {p.displayName ?? p.sourceMemberCardId}
                      {p.currentRank != null ? ` (rank ${p.currentRank})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm">Add candidate</Button>
            </form>
          </section>
        )}
      </div>
    </div>
  )
}
