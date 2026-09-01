'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireHarvestReviewAccess } from '@/lib/seattle-cup/harvest/access'
import { loadSeattleCup2026Archive } from '@/lib/seattle-cup/harvest/archive-context'
import {
  HARVEST_CAMPAIGN_ID,
  HARVEST_EDITION_REF,
  HARVEST_FEATURE_KEY,
  HARVEST_TEAM_KEY,
  findArchivePlayer,
} from '@/lib/seattle-cup/harvest/domain'
import { getIgcClubId } from '@/lib/scouting-access'
import { createServiceClient } from '@/lib/supabase/service'
import { sendIntelHarvestInviteEmail } from '@/lib/email/mailer'

const REVIEW_PATH = '/igc/seattle-cup/harvest/2026/review'

function normEmail(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim().toLowerCase()
}

export async function createIntelHarvestInvite(formData: FormData) {
  const { user } = await requireHarvestReviewAccess()
  const service = createServiceClient()
  const email = normEmail(formData.get('email'))
  const displayName = String(formData.get('displayName') ?? '').trim() || null
  const ggMemberCardId = String(formData.get('ggMemberCardId') ?? '').trim()
  if (!email || !email.includes('@')) throw new Error('A valid email is required')

  const { data: existingParticipant, error: existingError } = await service
    .from('intel_harvest_participants')
    .select('user_id')
    .eq('campaign_id', HARVEST_CAMPAIGN_ID)
    .eq('email', email)
    .maybeSingle()
  if (existingError) throw existingError
  if (existingParticipant?.user_id) {
    throw new Error('That email has already claimed this campaign. Manage their entitlement instead of issuing another identity-bound invite.')
  }

  const reporterPlayerRef = ggMemberCardId
    ? findArchivePlayer(loadSeattleCup2026Archive(), ggMemberCardId)
    : null
  if (ggMemberCardId && (!reporterPlayerRef || reporterPlayerRef.teamKey !== HARVEST_TEAM_KEY)) {
    throw new Error('The proposed player identity must be an archived 2026 Interbay player')
  }

  const clubId = await getIgcClubId()
  const token = randomUUID()
  const { data: invite, error: inviteError } = await service
    .from('capability_invites')
    .upsert({
      club_id: clubId,
      feature_key: HARVEST_FEATURE_KEY,
      email,
      invite_token: token,
      status: 'pending',
      display_name: displayName ?? reporterPlayerRef?.displayName ?? null,
      created_by: user.id,
      claimed_by_user_id: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'email,club_id,feature_key' })
    .select('id')
    .single()
  if (inviteError) throw inviteError

  const { error: participantError } = await service
    .from('intel_harvest_participants')
    .upsert({
      campaign_id: HARVEST_CAMPAIGN_ID,
      edition_ref: HARVEST_EDITION_REF,
      invite_id: invite.id,
      user_id: null,
      email,
      reporter_team_key: HARVEST_TEAM_KEY,
      reporter_player_ref: reporterPlayerRef,
      identity_status: reporterPlayerRef ? 'confirmation_required' : 'not_applicable',
      identity_source: reporterPlayerRef ? 'invite_email' : 'none',
      campaign_status: 'invited',
      claimed_at: null,
      started_at: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'campaign_id,email' })
  if (participantError) throw participantError

  await sendIntelHarvestInviteEmail(token, email, displayName ?? reporterPlayerRef?.displayName)
  revalidatePath(REVIEW_PATH)
}

export async function revokeIntelHarvestInvite(formData: FormData) {
  await requireHarvestReviewAccess()
  const inviteId = String(formData.get('inviteId') ?? '')
  if (!inviteId) throw new Error('inviteId is required')
  const service = createServiceClient()
  const { error } = await service
    .from('capability_invites')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('feature_key', HARVEST_FEATURE_KEY)
    .eq('status', 'pending')
  if (error) throw error
  revalidatePath(REVIEW_PATH)
}

export async function resendIntelHarvestInvite(formData: FormData) {
  await requireHarvestReviewAccess()
  const inviteId = String(formData.get('inviteId') ?? '')
  if (!inviteId) throw new Error('inviteId is required')
  const token = randomUUID()
  const service = createServiceClient()
  const { data, error } = await service
    .from('capability_invites')
    .update({ invite_token: token, status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('feature_key', HARVEST_FEATURE_KEY)
    .select('email, display_name')
    .single()
  if (error) throw error
  await sendIntelHarvestInviteEmail(token, data.email as string, data.display_name as string | null)
  revalidatePath(REVIEW_PATH)
}
