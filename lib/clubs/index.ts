import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export interface Club {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  description: string | null;
  logo_url: string | null;
  is_public: boolean;
  created_at: string;
}

export async function getClubsIndex(): Promise<Club[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('is_public', true)
    .order('name');

  if (error) throw error;
  return data || [];
}

export async function getClubBySlug(slug: string): Promise<Club | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createClub(
  club: Omit<Club, 'id' | 'created_at'>
): Promise<Club> {
  const serviceClient = createServiceClient();

  const { data, error } = await serviceClient
    .from('clubs')
    .insert(club)
    .select()
    .single();

  if (error) throw error;
  return data;
}
