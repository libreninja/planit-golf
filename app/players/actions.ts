'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { followPolicy } from '@/lib/players/follow-policy'

export interface FollowActionResult {
  ok: boolean
  following: boolean
  reason?: 'authentication_required' | 'unresolved_golfer' | 'self_follow' | 'write_failed'
}

export async function setGolferFollow(golferId: string, following: boolean): Promise<FollowActionResult> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const viewerId = auth.user?.id ?? null

  const [identityRes, selfRes] = viewerId ? await Promise.all([
    supabase
      .from('golfer_external_identities')
      .select('golfer_id', { count: 'exact', head: true })
      .eq('golfer_id', golferId)
      .eq('resolution_status', 'resolved'),
    supabase
      .from('golfer_user_links')
      .select('golfer_id', { count: 'exact', head: true })
      .eq('user_id', viewerId)
      .eq('golfer_id', golferId),
  ]) : [{ count: 0 }, { count: 0 }]

  const policy = followPolicy({
    viewerId,
    golferResolved: (identityRes.count ?? 0) > 0,
    selfLinked: (selfRes.count ?? 0) > 0,
  })
  if (!policy.allowed) return { ok: false, following: false, reason: policy.reason }

  const result = following
    ? await supabase.from('golfer_follows').upsert(
      { user_id: viewerId!, golfer_id: golferId },
      { onConflict: 'user_id,golfer_id', ignoreDuplicates: true },
    )
    : await supabase
      .from('golfer_follows')
      .delete()
      .eq('user_id', viewerId!)
      .eq('golfer_id', golferId)

  if (result.error) return { ok: false, following: !following, reason: 'write_failed' }
  revalidatePath(`/players/${golferId}`)
  return { ok: true, following }
}
