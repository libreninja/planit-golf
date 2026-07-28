'use server'

// Server actions for the Seattle Cup scouting UI. Each resolves the
// authenticated captain (the actor/author for attribution), calls the planit-ai
// HTTP client, and revalidates the affected route. The captain identity is
// passed server-to-server as x-planit-actor; it is never exposed to the browser.

import { revalidatePath } from 'next/cache'
import { requireScoutingAccess } from '@/lib/scouting-access'
import * as ai from '@/lib/planit-ai/client'

async function actorEmail(): Promise<string> {
  const user = await requireScoutingAccess()
  return user.email ?? user.id
}

function str(formData: FormData, key: string): string {
  return (formData.get(key) as string | null) ?? ''
}

export async function addCandidateAction(formData: FormData) {
  const actor = await actorEmail()
  const sourceMemberCardId = str(formData, 'sourceMemberCardId')
  if (!sourceMemberCardId) throw new Error('sourceMemberCardId is required')
  await ai.addCaptainCandidate(sourceMemberCardId, actor)
  revalidatePath('/igc/seattle-cup/scouting')
}

export async function createNoteAction(formData: FormData) {
  const actor = await actorEmail()
  const playerId = str(formData, 'playerId')
  const res = (await ai.createNote(
    playerId,
    {
      body: str(formData, 'body'),
      category: str(formData, 'category') || null,
      attributedTo: str(formData, 'attributedTo') || null,
      context: str(formData, 'context') || null,
    },
    actor
  )) as { id?: string; error?: string }
  if (!res?.id && res?.error) throw new Error(res.error)
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function updateNoteAction(formData: FormData) {
  const actor = await actorEmail()
  const playerId = str(formData, 'playerId')
  const noteId = str(formData, 'noteId')
  await ai.updateNote(
    noteId,
    {
      body: str(formData, 'body'),
      category: str(formData, 'category') || null,
      attributedTo: str(formData, 'attributedTo') || null,
      context: str(formData, 'context') || null,
    },
    actor
  )
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function deleteNoteAction(formData: FormData) {
  const actor = await actorEmail()
  const playerId = str(formData, 'playerId')
  const noteId = str(formData, 'noteId')
  await ai.deleteNote(noteId, actor)
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function addTagAction(formData: FormData) {
  const actor = await actorEmail()
  const playerId = str(formData, 'playerId')
  await ai.addTag(playerId, str(formData, 'tag'), actor)
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function removeTagAction(formData: FormData) {
  const actor = await actorEmail()
  const playerId = str(formData, 'playerId')
  await ai.removeTag(playerId, str(formData, 'tag'), actor)
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function setAvailabilityAction(formData: FormData) {
  const actor = await actorEmail()
  const playerId = str(formData, 'playerId')
  const sessionId = str(formData, 'sessionId')
  const status = str(formData, 'status')
  await ai.setAvailability(playerId, sessionId, status, actor)
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
  revalidatePath('/igc/seattle-cup/scouting')
}

// Batch availability save from the single-form editor. `changes` is the set of
// sessions whose value differs from persisted. status === '' means clear (return
// the session to unknown/unset); any other value is a real availability status.
// One user action saves every changed session in a single submit.
export async function setAvailabilityBatchAction(
  playerId: string,
  changes: { sessionId: string; status: string }[]
) {
  const actor = await actorEmail()
  for (const c of changes) {
    if (!c.sessionId) continue
    if (c.status === '') {
      await ai.clearAvailability(playerId, c.sessionId, actor)
    } else {
      await ai.setAvailability(playerId, c.sessionId, c.status, actor)
    }
  }
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
  revalidatePath('/igc/seattle-cup/scouting')
}

export async function setCandidateStateAction(formData: FormData) {
  const actor = await actorEmail()
  const playerId = str(formData, 'playerId')
  const state = str(formData, 'state')
  await ai.setCandidateState(playerId, state, actor)
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
  revalidatePath('/igc/seattle-cup/scouting')
}

// ---- Immediate-save actions for the operable board ----
// Called directly (awaited) from the CandidateBoard client component. These
// persist and return; they intentionally do NOT revalidate. Both the board and
// the player-detail routes are force-dynamic, so they always read fresh on
// navigation. The client owns the optimistic UI, the subtle pending state, and
// rollback on error. Revalidating would risk re-rendering the board mid-edit
// and fighting the optimistic state. status === '' means clear (unset).

export async function setCandidateStateCall(playerId: string, state: string) {
  const actor = await actorEmail()
  await ai.setCandidateState(playerId, state, actor)
}

export async function setAvailabilityCall(playerId: string, sessionId: string, status: string) {
  const actor = await actorEmail()
  if (status === '') {
    await ai.clearAvailability(playerId, sessionId, actor)
  } else {
    await ai.setAvailability(playerId, sessionId, status, actor)
  }
}