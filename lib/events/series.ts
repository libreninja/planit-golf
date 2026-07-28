import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export interface EventSeries {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_public: boolean;
  created_at: string;
}

export async function getEventSeriesIndex(): Promise<EventSeries[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_series')
    .select('*')
    .eq('is_public', true)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function getEventSeriesBySlug(slug: string): Promise<EventSeries | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('event_series')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createEventSeries(
  series: Omit<EventSeries, 'id' | 'created_at'>
): Promise<EventSeries> {
  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient
    .from('event_series')
    .insert(series)
    .select()
    .single();

  if (error) throw error;
  return data;
}
