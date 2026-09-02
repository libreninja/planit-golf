import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { getProfileRoles, requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getIgcClubId, hasScoutingAccess } from '@/lib/scouting-access'
import {
  HARVEST_FEATURE_KEY,
  HARVEST_CAPTAIN_FEATURE_KEY,
  canAccessHarvest,
  canReviewHarvest,
} from './domain.ts'

export interface HarvestAccess {
  user: User
  contributor: boolean
  scouting: boolean
  captain: boolean
}

export async function hasHarvestContributorAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const clubId = await getIgcClubId()
  const { data, error } = await supabase
    .from('feature_entitlements')
    .select('id')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('feature_key', HARVEST_FEATURE_KEY)
    .eq('status', 'active')
    .maybeSingle()
  if (error) {
    console.error('[intel-harvest-access] entitlement query failed:', error.message)
    return false
  }
  return !!data
}

export async function hasHarvestCaptainAccess(userId: string): Promise<boolean> {
  const supabase = await createClient()
  const clubId = await getIgcClubId()
  const { data, error } = await supabase
    .from('feature_entitlements')
    .select('id')
    .eq('user_id', userId)
    .eq('club_id', clubId)
    .eq('feature_key', HARVEST_CAPTAIN_FEATURE_KEY)
    .eq('status', 'active')
    .maybeSingle()
  if (error) {
    console.error('[intel-harvest-captain-access] entitlement query failed:', error.message)
    return false
  }
  return !!data
}

export async function getHarvestAccess(user: User): Promise<HarvestAccess> {
  const [contributor, scouting, captain] = await Promise.all([
    hasHarvestContributorAccess(user.id),
    hasScoutingAccess(user.id),
    hasHarvestCaptainAccess(user.id),
  ])
  return {
    user,
    contributor,
    scouting,
    captain,
  }
}

export async function requireHarvestAccess(): Promise<HarvestAccess> {
  const user = await requireAuth()
  const access = await getHarvestAccess(user)
  if (!canAccessHarvest(access)) redirect('/')
  return access
}

export async function requireHarvestReviewAccess(): Promise<HarvestAccess> {
  const user = await requireAuth()
  const access = await getHarvestAccess(user)
  if (!canReviewHarvest(access)) redirect('/')
  return access
}

async function getHarvestAccessWithAdmin(user: User): Promise<HarvestAccess & { isAdmin: boolean }> {
  const [access, roles] = await Promise.all([getHarvestAccess(user), getProfileRoles(user.id)])
  return { ...access, isAdmin: roles.is_admin || roles.is_system_admin }
}

export async function requireHarvestReviewOrManagerAccess(): Promise<HarvestAccess & { isAdmin: boolean }> {
  const user = await requireAuth()
  const access = await getHarvestAccessWithAdmin(user)
  if (!canReviewHarvest(access) && !access.isAdmin) redirect('/')
  return access
}

export async function requireHarvestCampaignManager(): Promise<HarvestAccess & { isAdmin: boolean }> {
  const user = await requireAuth()
  const access = await getHarvestAccessWithAdmin(user)
  if (!access.captain && !access.isAdmin) redirect('/')
  return access
}
