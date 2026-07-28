// Server-only activity authoring. Appends ONE durable activity_events row from
// a planit.golf Server Action, AFTER the corresponding planit-ai scouting write
// has succeeded. planit.golf owns this layer (see migration 025 + the realtime
// design, Option C).
//
// CRITICAL failure semantics: the scouting write and the activity write cross
// two different databases (planit-ai and planit.golf Supabase) and are NOT in a
// distributed transaction. If the activity insert fails, the scouting mutation
// stays successful — recordActivity MUST NOT throw, roll back, or surface a
// failure to the caller. It logs the failure server-side and returns. The
// authoritative scouting state is more important than perfect activity delivery.

import { createServiceClient } from '@/lib/supabase/service'
import type { ActivityType } from '@/lib/activity-format'

export const ACTIVITY_FEATURE = 'seattle_cup_scouting' as const

export interface ActivityInput {
  actorUserId: string
  actorDisplayName: string
  activityType: ActivityType
  subjectPlayerId: string
  subjectPlayerName?: string | null
  metadata?: Record<string, unknown>
}

// Append one activity row. Swallows ALL errors so a scouting write that has
// already succeeded can never be broken by an activity-insert failure. The
// service-role client is used (RLS denies user writes by design); the row is
// authored by the server on behalf of the authenticated captain.
export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('activity_events').insert({
      actor_user_id: input.actorUserId,
      actor_display_name: input.actorDisplayName,
      feature: ACTIVITY_FEATURE,
      activity_type: input.activityType,
      subject_player_id: input.subjectPlayerId,
      subject_player_name: input.subjectPlayerName ?? null,
      metadata: input.metadata ?? {},
    })
    if (error) {
      console.error('[activity] insert failed:', error.message, {
        activityType: input.activityType,
        subjectPlayerId: input.subjectPlayerId,
      })
    }
  } catch (e) {
    console.error('[activity] recordActivity threw:', (e as Error).message)
  }
}