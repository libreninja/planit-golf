import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export interface EventEdition {
  id: string;
  event_series_id: string;
  slug: string | null;
  year: number;
  starts_on: string | null;
  ends_on: string | null;
  location_name: string | null;
  visibility: 'public' | 'club_members' | 'invite_only';
  status: 'draft' | 'active' | 'archived';
  golf_genius_event_id: string | null;
  created_at: string;
  series?: {
    slug: string;
    name: string;
  };
}

export async function getEventEdition(
  seriesSlug: string,
  year: number
): Promise<EventEdition | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_editions')
    .select(`
      *,
      series:event_series!inner(slug, name)
    `)
    .eq('event_series.slug', seriesSlug)
    .eq('year', year)
    .eq('visibility', 'public')
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getCurrentEdition(seriesSlug: string): Promise<EventEdition | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_editions')
    .select(`
      *,
      series:event_series!inner(slug, name)
    `)
    .eq('event_series.slug', seriesSlug)
    .eq('status', 'active')
    .eq('visibility', 'public')
    .order('starts_on', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getEditionsForSeries(seriesId: string): Promise<EventEdition[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_editions')
    .select('*')
    .eq('event_series_id', seriesId)
    .eq('visibility', 'public')
    .order('year', { ascending: false });

  if (error) throw error;
  return data || [];
}
