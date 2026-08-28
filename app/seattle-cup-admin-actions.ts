'use server'

// Admin server actions for the Seattle Cup OFFICIAL tournament resolution.
// All resolution facts except the sudden-death fourball playoff result are
// DERIVED (lib/seattle-cup/resolution.ts); these actions record or clear ONLY
// that out-of-band fact, after re-validating against a freshly computed
// resolution. Writes use the service-role client
// (seattle_cup_tournament_results has no public RLS policies). Each action
// re-checks admin role first — same pattern as app/scouting-admin-actions.ts.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getProfileRoles } from '@/lib/auth'
import { ROUND_LIST, SEATTLE_CUP_EVENT_ID, SEATTLE_CUP_SEASON_YEAR } from '@/lib/seattle-cup/config'
import { getSeattleCupLive } from '@/lib/seattle-cup/live'
import {
  calculateSeattleCupTournamentResolution,
  validatePlayoffResolution,
  type SeattleCupPlayoffRecord,
} from '@/lib/seattle-cup/resolution'
import {
  writeSeattleCupPlayoffRecord,
  deleteSeattleCupPlayoffRecord,
} from '@/lib/seattle-cup/playoff-store'

async function requireAdminUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const roles = await getProfileRoles(user.id)
  if (!roles.is_admin && !roles.is_system_admin) {
    throw new Error('Admin access required')
  }
  return { user, service: createServiceClient() }
}

async function currentResolutionNoRecord() {
  // Recompute from the live normalized snapshots with NO stored record, so a
  // stale/incorrect persisted row can never legitimize a new write.
  const snapshots = await Promise.all(
    ROUND_LIST.map((definition) => getSeattleCupLive({ round: definition.round })),
  )
  return calculateSeattleCupTournamentResolution(snapshots, null)
}

// Record the sudden-death fourball playoff winner. Validates: tournament is
// final, a playoff is actually required, and the winner is one of the tied
// teams. Underlying GG match results are never modified and a rules-derived
// winner cannot be overridden (validation rejects those cases).
export async function recordSeattleCupPlayoff(formData: FormData) {
  const { user } = await requireAdminUser()
  const winnerTeamKey = String(formData.get('winnerTeamKey') || '').trim()
  const notes = (formData.get('notes') as string | null)?.trim() || null

  const resolution = await currentResolutionNoRecord()
  const verdict = validatePlayoffResolution(resolution, winnerTeamKey)
  if (!verdict.ok) throw new Error(verdict.error)

  const record: SeattleCupPlayoffRecord = {
    competitionKey: 'seattle-cup',
    seasonYear: SEATTLE_CUP_SEASON_YEAR,
    ggEventId: SEATTLE_CUP_EVENT_ID,
    winnerTeamKey: verdict.winnerTeamKey,
    tiedTeamKeys: verdict.tiedTeamKeys,
    notes,
    resolvedAt: new Date().toISOString(),
    resolvedBy: user.id,
  }
  await writeSeattleCupPlayoffRecord(record)
  revalidatePath('/admin/scouting')
}

// Explicit authenticated correction: remove a mistaken playoff result. The
// derived resolution (playoff-required) stands again immediately.
export async function clearSeattleCupPlayoff() {
  await requireAdminUser()
  await deleteSeattleCupPlayoffRecord()
  revalidatePath('/admin/scouting')
}