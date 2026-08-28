'use server'

import { revalidatePath } from 'next/cache'

import { requireAdmin } from '@/lib/auth'
import { ROUND_LIST, TEAM_LIST } from '@/lib/seattle-cup/config'
import { getSeattleCupLive } from '@/lib/seattle-cup/live'
import { saveSeattleCupPlayoffResult } from '@/lib/seattle-cup/playoff-store'
import type { TeamKey } from '@/lib/seattle-cup/types'

function teamKey(value: FormDataEntryValue | null): TeamKey {
  const candidate = String(value ?? '')
  const valid = TEAM_LIST.some((team) => team.key === candidate)
  if (!valid) throw new Error('Select a valid Seattle Cup team')
  return candidate as TeamKey
}

export async function recordSeattleCupPlayoffResult(formData: FormData): Promise<void> {
  const { user } = await requireAdmin()
  const snapshots = await Promise.all(
    ROUND_LIST.map((round) => getSeattleCupLive({ round: round.round })),
  )

  await saveSeattleCupPlayoffResult({
    snapshots,
    winnerTeamKey: teamKey(formData.get('winnerTeamKey')),
    notes: String(formData.get('notes') ?? ''),
    actorUserId: user.id,
  })

  revalidatePath('/admin/scouting')
}
