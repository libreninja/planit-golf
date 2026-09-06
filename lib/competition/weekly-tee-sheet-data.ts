import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { makeGolfGeniusRequestOptional } from '@/lib/gg/client'
import {
  normalizeWeeklyTeeSheet,
  selectCurrentWeeklyTeeSheetOccurrence,
  type WeeklyOccurrenceRow,
  type WeeklyTeeSheetGroup,
} from './weekly-tee-sheet'

export interface CurrentWeeklyTeeSheet {
  occurrence: WeeklyOccurrenceRow | null
  groups: WeeklyTeeSheetGroup[]
  status: 'published' | 'not_published' | 'unavailable' | 'no_occurrence'
}

function todayInPacific(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export async function getCurrentMensWeeklyTeeSheet(now = new Date()): Promise<CurrentWeeklyTeeSheet> {
  const supabase = await createClient()
  const today = todayInPacific(now)
  const { data, error } = await supabase
    .from('igc_league_events')
    .select('week_number, event_name, event_date, gg_event_id, gg_round_id')
    .eq('league_key', 'mens')
    .gte('event_date', today)
    .lt('week_number', 100)
    .order('event_date', { ascending: true })
    .limit(8)

  if (error) return { occurrence: null, groups: [], status: 'unavailable' }
  const occurrence = selectCurrentWeeklyTeeSheetOccurrence((data ?? []) as WeeklyOccurrenceRow[], today)
  if (!occurrence) return { occurrence: null, groups: [], status: 'no_occurrence' }
  if (!occurrence.gg_event_id || !occurrence.gg_round_id || !process.env.GOLF_GENIUS_API_KEY) {
    return { occurrence, groups: [], status: 'not_published' }
  }

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
