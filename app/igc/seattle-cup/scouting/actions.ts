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