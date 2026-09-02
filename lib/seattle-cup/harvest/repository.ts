import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { getIgcClubId } from '@/lib/scouting-access'
import { hasHarvestCaptainAccess } from './access.ts'
import type { User } from '@supabase/supabase-js'
import { loadSeattleCup2026Archive } from './archive-context.ts'
import {
  HARVEST_CAMPAIGN_ID,
  HARVEST_EDITION_REF,
  HARVEST_FEATURE_KEY,
  HARVEST_TEAM_KEY,
  archivePlayerRefs,
  buildPersonalizedMatches,
  findArchivePlayer,
  resolveReporterIdentity,
  type HarvestMatchContext,
  type ContributorRole,
  type GuidedResponseV1,
  type PlayerExternalRef,
  type RelationshipContext,
  type ReportKind,
  type ScoutingReportContext,
} from './domain.ts'

export interface HarvestParticipantRow {
  id: string
  campaign_id: string
  edition_ref: string
  invite_id: string | null
  user_id: string | null
  email: string
  reporter_team_key: string
  contributor_role: ContributorRole
  reporter_player_ref: PlayerExternalRef | null
  identity_status: 'canonical' | 'confirmation_required' | 'confirmed' | 'not_applicable'
  identity_source: 'profile_member' | 'invite_email' | 'admin' | 'none'
  campaign_status: 'invited' | 'claimed' | 'started' | 'completed' | 'skipped'
  claimed_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface StoredScoutingReport {
  id: string
  reporter_user_id: string
  reporter_player_ref: PlayerExternalRef | null
  reporter_team_key: string
  contributor_role: ContributorRole
  relationship_context: RelationshipContext
  report_kind: ReportKind
  contributed_at: string
  campaign_id: string
  edition_ref: string
  subjects: PlayerExternalRef[]
  context: ScoutingReportContext
  questionnaire_key: string
  questionnaire_version: number
  questionnaire_snapshot: Record<string, unknown>
  response_payload: GuidedResponseV1
  visibility: 'team' | 'captain'
  provenance: { kind: 'human'; channel: 'intel_harvest' }
}

export interface ContributorHarvestSession {
  participant: HarvestParticipantRow
  reporterPlayerRef: PlayerExternalRef | null
  confirmationCandidates: PlayerExternalRef[]
  requiresIdentityConfirmation: boolean
  matches: HarvestMatchContext[]
  ownReports: StoredScoutingReport[]
}

function samePlayer(a: PlayerExternalRef | null, b: PlayerExternalRef | null): boolean {
  return !!a && !!b && a.system === b.system && a.kind === b.kind && a.value === b.value
}

async function syncClaimedParticipant(user: User): Promise<void> {
  const service = createServiceClient()
  const clubId = await getIgcClubId()
  const { data: invites, error } = await service
    .from('capability_invites')
    .select('id')
    .eq('feature_key', HARVEST_FEATURE_KEY)
    .eq('club_id', clubId)
    .eq('claimed_by_user_id', user.id)
    .eq('status', 'claimed')
  if (error) throw error
  const inviteIds = (invites ?? []).map((invite) => invite.id as string)
  if (inviteIds.length === 0) return
  const now = new Date().toISOString()
  const { error: updateError } = await service
    .from('intel_harvest_participants')
    .update({
      user_id: user.id,
      campaign_status: 'claimed',
      claimed_at: now,
      updated_at: now,
    })
    .in('invite_id', inviteIds)
    .is('user_id', null)
  if (updateError) throw updateError
}

async function canonicalPlayerForProfile(userId: string): Promise<PlayerExternalRef | null> {
  const service = createServiceClient()
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('member_id')
    .eq('id', userId)
    .maybeSingle()
  if (profileError) throw profileError
  if (!profile?.member_id) return null
  const { data: member, error: memberError } = await service
    .from('members')
    .select('golf_member_id')
    .eq('id', profile.member_id)
    .maybeSingle()
  if (memberError) throw memberError
  if (!member?.golf_member_id) return null
  const player = findArchivePlayer(loadSeattleCup2026Archive(), member.golf_member_id as string)
  return player?.teamKey === HARVEST_TEAM_KEY ? player : null
}

async function ensureParticipant(user: User): Promise<HarvestParticipantRow> {
  await syncClaimedParticipant(user)
  const service = createServiceClient()
  const { data: existing, error } = await service
    .from('intel_harvest_participants')
    .select('*')
    .eq('campaign_id', HARVEST_CAMPAIGN_ID)
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  if (existing) return existing as HarvestParticipantRow

  // Seattle Cup reviewers/captains may enter without a contributor invite.
  // Only the narrow captain entitlement creates captain-observation semantics.
  const [canonical, captain] = await Promise.all([
    canonicalPlayerForProfile(user.id),
    hasHarvestCaptainAccess(user.id),
  ])
  const now = new Date().toISOString()
  const row = {
    campaign_id: HARVEST_CAMPAIGN_ID,
    edition_ref: HARVEST_EDITION_REF,
    user_id: user.id,
    email: (user.email ?? `${user.id}@unknown.invalid`).toLowerCase(),
    reporter_team_key: HARVEST_TEAM_KEY,
    contributor_role: canonical ? 'player' : captain ? 'captain' : 'other_firsthand',
    reporter_player_ref: canonical,
    identity_status: canonical ? 'canonical' : 'not_applicable',
    identity_source: canonical ? 'profile_member' : 'none',
    campaign_status: 'started',
    claimed_at: now,
    started_at: now,
    updated_at: now,
  }
  const { data: inserted, error: insertError } = await service
    .from('intel_harvest_participants')
    .insert(row)
    .select('*')
    .single()
  if (insertError) throw insertError
  return inserted as HarvestParticipantRow
}

export async function loadContributorHarvestSession(user: User): Promise<ContributorHarvestSession> {
  const service = createServiceClient()
  let participant = await ensureParticipant(user)
  const archive = loadSeattleCup2026Archive()
  const canonical = await canonicalPlayerForProfile(user.id)
  const proposed = participant.reporter_player_ref
    ? findArchivePlayer(archive, participant.reporter_player_ref.value)
    : null

  if (canonical && (!proposed || samePlayer(canonical, proposed))) {
    const now = new Date().toISOString()
    const { data, error } = await service
      .from('intel_harvest_participants')
      .update({
        reporter_player_ref: canonical,
        identity_status: 'canonical',
        identity_source: 'profile_member',
        campaign_status: participant.campaign_status === 'invited' || participant.campaign_status === 'claimed'
          ? 'started'
          : participant.campaign_status,
        started_at: participant.started_at ?? now,
        updated_at: now,
      })
      .eq('id', participant.id)
      .select('*')
      .single()
    if (error) throw error
    participant = data as HarvestParticipantRow
  } else if (participant.campaign_status === 'invited' || participant.campaign_status === 'claimed') {
    const now = new Date().toISOString()
    const { data, error } = await service
      .from('intel_harvest_participants')
      .update({ campaign_status: 'started', started_at: participant.started_at ?? now, updated_at: now })
      .eq('id', participant.id)
      .select('*')
      .single()
    if (error) throw error
    participant = data as HarvestParticipantRow
  }

  const identity = resolveReporterIdentity({
    canonical,
    proposed,
    identityStatus: participant.identity_status,
  })
  const userClient = await createClient()
  const { data: reports, error: reportsError } = await userClient
    .from('scouting_reports')
    .select('*')
    .eq('reporter_user_id', user.id)
    .eq('campaign_id', HARVEST_CAMPAIGN_ID)
    .order('contributed_at', { ascending: true })
  if (reportsError) throw reportsError

  return {
    participant,
    reporterPlayerRef: identity.reporterPlayerRef,
    confirmationCandidates: identity.confirmationCandidates,
    requiresIdentityConfirmation: identity.requiresConfirmation,
    // An archive identity is context, not eligibility and not a forced role.
    // Someone who played in 2026 may still be invited specifically as a
    // caddie/captain/watcher and must remain in the observer flow.
    matches: participant.contributor_role === 'player' && identity.reporterPlayerRef
      ? buildPersonalizedMatches(archive, identity.reporterPlayerRef.value)
      : [],
    ownReports: (reports ?? []) as StoredScoutingReport[],
  }
}

export async function confirmParticipantIdentity(
  user: User,
  ggMemberCardId: string,
): Promise<void> {
  const session = await loadContributorHarvestSession(user)
  const candidate = session.confirmationCandidates.find((row) => row.value === ggMemberCardId)
  if (!candidate) throw new Error('That player identity is not available for this invitation')
  const now = new Date().toISOString()
  const service = createServiceClient()
  const { error } = await service
    .from('intel_harvest_participants')
    .update({
      reporter_player_ref: candidate,
      identity_status: 'confirmed',
      updated_at: now,
    })
    .eq('id', session.participant.id)
    .eq('user_id', user.id)
  if (error) throw error
}

export async function markHarvestComplete(user: User, reportCount: number): Promise<void> {
  const session = await loadContributorHarvestSession(user)
  const now = new Date().toISOString()
  const service = createServiceClient()
  const { error } = await service
    .from('intel_harvest_participants')
    .update({
      campaign_status: reportCount > 0 ? 'completed' : 'skipped',
      completed_at: now,
      updated_at: now,
    })
    .eq('id', session.participant.id)
    .eq('user_id', user.id)
  if (error) throw error
}

export function allSelectableArchivePlayers(): PlayerExternalRef[] {
  return archivePlayerRefs(loadSeattleCup2026Archive())
}
