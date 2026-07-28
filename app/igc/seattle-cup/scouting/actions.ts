'use server'

// Server actions for the Seattle Cup scouting UI. Each resolves the
// authenticated captain (the actor/author for attribution), calls the planit-ai
// HTTP client, and revalidates the affected route. The captain identity is
// passed server-to-server as x-planit-actor; it is never exposed to the browser.
//
// After a SUCCESSFUL planit-ai write, each action also appends one durable
// activity_events row (see lib/activity.ts) so other captains get a realtime
// inbox update + a board/card refresh. Activity authoring never throws — a
// failed activity insert must not roll back or surface a failure for the
// scouting write that triggered it (cross-database, no distributed transaction).

import { revalidatePath } from 'next/cache'
import { requireScoutingAccess } from '@/lib/scouting-access'
import { createClient } from '@/lib/supabase/server'
import * as ai from '@/lib/planit-ai/client'
import { recordActivity } from '@/lib/activity'

// Resolve the full actor: auth user (id + email) PLUS the profile display_name
// (needed for the inbox line). One small query per write. Falls back to email
// / id when the profile has no display name.
async function actorUser(): Promise<{ id: string; email: string; displayName: string }> {
  const user = await requireScoutingAccess()
  const email = user.email ?? user.id
  let displayName = email
  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle()
    if (data?.display_name) displayName = data.display_name as string
  } catch {
    // Non-fatal: fall back to email. The scouting write must not depend on this.
  }
  return { id: user.id, email, displayName }
}

function str(formData: FormData, key: string): string {
  return (formData.get(key) as string | null) ?? ''
}

export async function addCandidateAction(formData: FormData) {
  const actor = await actorUser()
  const sourceMemberCardId = str(formData, 'sourceMemberCardId')
  if (!sourceMemberCardId) throw new Error('sourceMemberCardId is required')
  await ai.addCaptainCandidate(sourceMemberCardId, actor.email)
  revalidatePath('/igc/seattle-cup/scouting')
  // No activity for adding a candidate to the pool (not one of the V1 types).
}

export async function createNoteAction(formData: FormData) {
  const actor = await actorUser()
  const playerId = str(formData, 'playerId')
  const playerName = str(formData, 'playerName') || null
  const body = str(formData, 'body')
  const res = (await ai.createNote(
    playerId,
    {
      body,
      category: str(formData, 'category') || null,
      attributedTo: str(formData, 'attributedTo') || null,
      context: str(formData, 'context') || null,
    },
    actor.email
  )) as { id?: string; error?: string }
  if (!res?.id && res?.error) throw new Error(res.error)
  // Activity (note creation only, per V1). A short, safe preview — never the
  // full body — so the inbox line can hint at the note without duplicating it.
  const preview = body.trim().slice(0, 80)
  await recordActivity({
    actorUserId: actor.id,
    actorDisplayName: actor.displayName,
    activityType: 'note_added',
    subjectPlayerId: playerId,
    subjectPlayerName: playerName,
    metadata: res?.id ? { note_id: res.id, preview } : { preview },
  })
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function updateNoteAction(formData: FormData) {
  const actor = await actorUser()
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
    actor.email
  )
  // No activity for note edits (V1: note_added only).
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function deleteNoteAction(formData: FormData) {
  const actor = await actorUser()
  const playerId = str(formData, 'playerId')
  const noteId = str(formData, 'noteId')
  await ai.deleteNote(noteId, actor.email)
  // No activity for note deletes (V1: note_added only).
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function addTagAction(formData: FormData) {
  const actor = await actorUser()
  const playerId = str(formData, 'playerId')
  await ai.addTag(playerId, str(formData, 'tag'), actor.email)
  // No activity for tags (not a V1 activity type).
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function removeTagAction(formData: FormData) {
  const actor = await actorUser()
  const playerId = str(formData, 'playerId')
  await ai.removeTag(playerId, str(formData, 'tag'), actor.email)
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
}

export async function setAvailabilityAction(formData: FormData) {
  const actor = await actorUser()
  const playerId = str(formData, 'playerId')
  const sessionId = str(formData, 'sessionId')
  const status = str(formData, 'status')
  const playerName = str(formData, 'playerName') || null
  const sessionLabel = str(formData, 'sessionLabel') || null
  await ai.setAvailability(playerId, sessionId, status, actor.email)
  await recordActivity({
    actorUserId: actor.id,
    actorDisplayName: actor.displayName,
    activityType: 'availability_changed',
    subjectPlayerId: playerId,
    subjectPlayerName: playerName,
    metadata: { session_id: sessionId, session_label: sessionLabel, status },
  })
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
  revalidatePath('/igc/seattle-cup/scouting')
}

// Batch availability save from the single-form editor. `changes` is the set of
// sessions whose value differs from persisted. status === '' means clear (return
// the session to unknown/unset); any other value is a real availability status.
// One user action saves every changed session in a single submit. `playerName`
// and `sessionLabels` (sessionId -> human label, e.g. "Fourball") are display
// hints for the activity line; they are denormalized into activity metadata and
// are NOT authoritative domain data.
export async function setAvailabilityBatchAction(
  playerId: string,
  changes: { sessionId: string; status: string }[],
  playerName?: string | null,
  sessionLabels?: Record<string, string>
) {
  const actor = await actorUser()
  for (const c of changes) {
    if (!c.sessionId) continue
    if (c.status === '') {
      await ai.clearAvailability(playerId, c.sessionId, actor.email)
    } else {
      await ai.setAvailability(playerId, c.sessionId, c.status, actor.email)
    }
    // One activity event per changed session (each is a distinct availability
    // change). `cleared` flags the unset case so the line could later say
    // "cleared" without duplicating the prior value (prior value is not cheaply
    // available here and is intentionally not fetched).
    await recordActivity({
      actorUserId: actor.id,
      actorDisplayName: actor.displayName,
      activityType: 'availability_changed',
      subjectPlayerId: playerId,
      subjectPlayerName: playerName,
      metadata: {
        session_id: c.sessionId,
        session_label: sessionLabels?.[c.sessionId] ?? null,
        status: c.status,
        cleared: c.status === '',
      },
    })
  }
  revalidatePath(`/igc/seattle-cup/scouting/players/${playerId}`)
  revalidatePath('/igc/seattle-cup/scouting')
}

export async function setCandidateStateAction(formData: FormData) {
  const actor = await actorUser()
  const playerId = str(formData, 'playerId')
  const state = str(formData, 'state')
  const playerName = str(formData, 'playerName') || null
  const fromState = str(formData, 'fromState') || null
  await ai.setCandidateState(playerId, state, actor.email)
  await recordActivity({
    actorUserId: actor.id,
    actorDisplayName: actor.displayName,
    activityType: 'candidate_state_changed',
    subjectPlayerId: playerId,
    subjectPlayerName: playerName,
    metadata: { from_state: fromState, to_state: state },
  })
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
//
// `playerName`, `fromState`, and `sessionLabel` are display hints the board has
// in scope (it renders them); they are denormalized into activity metadata and
// are NOT authoritative. They avoid an extra planit-ai read on the latency-
// sensitive immediate-save path.

export async function setCandidateStateCall(
  playerId: string,
  state: string,
  playerName?: string | null,
  fromState?: string | null
) {
  const actor = await actorUser()
  await ai.setCandidateState(playerId, state, actor.email)
  await recordActivity({
    actorUserId: actor.id,
    actorDisplayName: actor.displayName,
    activityType: 'candidate_state_changed',
    subjectPlayerId: playerId,
    subjectPlayerName: playerName,
    metadata: { from_state: fromState ?? null, to_state: state },
  })
}

export async function setAvailabilityCall(
  playerId: string,
  sessionId: string,
  status: string,
  playerName?: string | null,
  sessionLabel?: string | null
) {
  const actor = await actorUser()
  if (status === '') {
    await ai.clearAvailability(playerId, sessionId, actor.email)
  } else {
    await ai.setAvailability(playerId, sessionId, status, actor.email)
  }
  await recordActivity({
    actorUserId: actor.id,
    actorDisplayName: actor.displayName,
    activityType: 'availability_changed',
    subjectPlayerId: playerId,
    subjectPlayerName: playerName,
    metadata: {
      session_id: sessionId,
      session_label: sessionLabel ?? null,
      status,
      cleared: status === '',
    },
  })
}