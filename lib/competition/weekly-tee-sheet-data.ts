import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { makeGolfGeniusRequestOptional } from '@/lib/gg/client'
import {
  normalizeWeeklyTeeSheet,
  type WeeklyOccurrenceRow,
  type WeeklyTeeSheetData,
} from './weekly-tee-sheet'

async function resolveTeeSheet(
  occurrence: WeeklyOccurrenceRow | null,
): Promise<WeeklyTeeSheetData> {
  if (!occurrence) return { occurrence: null, groups: [], status: 'no_occurrence' }
  if (!occurrence.gg_event_id || !occurrence.gg_round_id) {
    return { occurrence, groups: [], status: 'not_published' }
  }
  if (!process.env.GOLF_GENIUS_API_KEY) return { occurrence, groups: [], status: 'unavailable' }

  try {
    const raw = await makeGolfGeniusRequestOptional({
      endpoint: `/events/${occurrence.gg_event_id}/rounds/${occurrence.gg_round_id}/tee_sheet`,
    })
    const groups = normalizeWeeklyTeeSheet(raw)
    return { occurrence, groups, status: groups.length > 0 ? 'published' : 'not_published' }
  } catch {
    return { occurrence, groups: [], status: 'unavailable' }
  }
}

export async function getMensWeeklyTeeSheet(
  occurrenceId: string,
): Promise<WeeklyTeeSheetData> {
  const weekNumber = Number(occurrenceId)
  if (!Number.isFinite(weekNumber)) {
    return { occurrence: null, groups: [], status: 'no_occurrence' }
  }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('igc_league_events')
    .select('week_number, event_name, event_date, gg_event_id, gg_round_id')
    .eq('league_key', 'mens')
    .eq('week_number', weekNumber)
    .maybeSingle()

  if (error) return { occurrence: null, groups: [], status: 'unavailable' }
  return resolveTeeSheet((data as WeeklyOccurrenceRow | null) ?? null)
}
