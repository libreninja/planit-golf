import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export interface FeedEvent {
  id: string;
  subject_type: 'event_edition' | 'club' | 'trip' | 'user';
  subject_id: string;
  actor_type: 'system' | 'user' | 'external_sync';
  actor_id: string | null;
  type: string;
  data: Record<string, unknown>;
  visibility: 'public' | 'club_members' | 'participants' | 'admins';
  dedupe_key: string | null;
  is_pinned: boolean;
  is_hidden: boolean;
  created_at: string;
  actor?: {
    display_name: string;
  };
  reactions?: FeedReaction[];
  reaction_counts?: Record<string, number>;
  user_reactions?: string[];
}

export interface FeedReaction {
  id: string;
  feed_event_id: string;
  user_id: string;
  reaction_type: string;
  created_at: string;
}

export interface FeedFilters {
  subjectType?: 'event_edition' | 'club' | 'trip' | 'user';
  subjectId?: string;
  types?: string[];
  visibility?: 'public' | 'club_members' | 'participants' | 'admins';
  limit?: number;
  cursor?: string;
}

export async function getFeedEvents(filters: FeedFilters = {}): Promise<FeedEvent[]> {
  const supabase = await createClient();
  const { subjectType, subjectId, types, visibility = 'public', limit = 20 } = filters;

  let query = supabase
    .from('feed_events')
    .select(`
      *,
      actor:profiles!actor_id(display_name)
    `)
    .eq('is_hidden', false)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (subjectType) {
    query = query.eq('subject_type', subjectType);
  }

  if (subjectId) {
    query = query.eq('subject_id', subjectId);
  }

  if (types?.length) {
    query = query.in('type', types);
  }

  // Visibility filter
  query = query.eq('visibility', visibility);

  const { data, error } = await query;

  if (error) throw error;

  // Get reactions for these events
  const eventIds = data?.map(e => e.id) || [];

  if (eventIds.length > 0) {
    const { data: reactions } = await supabase
      .from('feed_reactions')
      .select('*')
      .in('feed_event_id', eventIds);

    // Group reactions by event
    const reactionsByEvent = (reactions || []).reduce((acc: Record<string, FeedReaction[]>, r: FeedReaction) => {
      if (!acc[r.feed_event_id]) acc[r.feed_event_id] = [];
      acc[r.feed_event_id].push(r);
      return acc;
    }, {} as Record<string, FeedReaction[]>);

    // Add reactions and counts to events
    const currentUserId = (await supabase.auth.getUser()).data.user?.id;

    return (data || []).map(event => {
      const eventReactions = reactionsByEvent[event.id] || [];
      const counts = eventReactions.reduce((acc: Record<string, number>, r: FeedReaction) => {
        acc[r.reaction_type] = (acc[r.reaction_type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const userReactions = eventReactions
        .filter((r: FeedReaction) => r.user_id === currentUserId)
        .map((r: FeedReaction) => r.reaction_type);

      return {
        ...event,
        reactions: eventReactions,
        reaction_counts: counts,
        user_reactions: userReactions,
      };
    });
  }

  return data || [];
}

export async function createFeedEvent(
  event: Omit<FeedEvent, 'id' | 'created_at'>
): Promise<FeedEvent> {
  const serviceClient = createServiceClient();

  // Check for duplicate if dedupe_key provided
  if (event.dedupe_key) {
    const { data: existing } = await serviceClient
      .from('feed_events')
      .select('id')
      .eq('dedupe_key', event.dedupe_key)
      .maybeSingle();

    if (existing) {
      throw new Error('Duplicate feed event');
    }
  }

  const { data, error } = await serviceClient
    .from('feed_events')
    .insert(event)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function addReaction(
  feedEventId: string,
  reactionType: string
): Promise<FeedReaction> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    throw new Error('Must be logged in to react');
  }

  const { data, error } = await supabase
    .from('feed_reactions')
    .insert({
      feed_event_id: feedEventId,
      user_id: user.user.id,
      reaction_type: reactionType,
    })
    .select()
    .single();

  if (error) {
    // Handle duplicate reaction
    if (error.code === '23505') {
      throw new Error('Already reacted with this emoji');
    }
    throw error;
  }

  return data;
}

export async function removeReaction(
  feedEventId: string,
  reactionType: string
): Promise<void> {
  const supabase = await createClient();

  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    throw new Error('Must be logged in to remove reaction');
  }

  const { error } = await supabase
    .from('feed_reactions')
    .delete()
    .eq('feed_event_id', feedEventId)
    .eq('user_id', user.user.id)
    .eq('reaction_type', reactionType);

  if (error) throw error;
}

export async function pinFeedEvent(
  feedEventId: string,
  pinned: boolean
): Promise<void> {
  const serviceClient = createServiceClient();

  const { error } = await serviceClient
    .from('feed_events')
    .update({ is_pinned: pinned })
    .eq('id', feedEventId);

  if (error) throw error;
}

export async function hideFeedEvent(
  feedEventId: string,
  hidden: boolean
): Promise<void> {
  const serviceClient = createServiceClient();

  const { error } = await serviceClient
    .from('feed_events')
    .update({ is_hidden: hidden })
    .eq('id', feedEventId);

  if (error) throw error;
}

// Helper to create common feed event types
export function createStandingsUpdatedEvent(
  eventEditionId: string,
  standingsData: {
    round?: number;
    totalRounds?: number;
    leaderName?: string;
    scores?: unknown[];
  }
): Omit<FeedEvent, 'id' | 'created_at'> {
  return {
    subject_type: 'event_edition',
    subject_id: eventEditionId,
    actor_type: 'system',
    actor_id: null,
    type: 'standings_updated',
    data: standingsData,
    visibility: 'public',
    dedupe_key: `standings:${eventEditionId}:${standingsData.round || 'final'}`,
    is_pinned: false,
    is_hidden: false,
  };
}

export function createPairingsPostedEvent(
  eventEditionId: string,
  pairingsData: {
    round?: number;
    pairings?: unknown[];
    teeTimes?: unknown[];
  }
): Omit<FeedEvent, 'id' | 'created_at'> {
  return {
    subject_type: 'event_edition',
    subject_id: eventEditionId,
    actor_type: 'system',
    actor_id: null,
    type: 'pairings_posted',
    data: pairingsData,
    visibility: 'public',
    dedupe_key: `pairings:${eventEditionId}:${pairingsData.round || 'current'}`,
    is_pinned: false,
    is_hidden: false,
  };
}

export function createRegistrationClosesEvent(
  eventEditionId: string,
  hoursRemaining: number
): Omit<FeedEvent, 'id' | 'created_at'> {
  return {
    subject_type: 'event_edition',
    subject_id: eventEditionId,
    actor_type: 'system',
    actor_id: null,
    type: 'registration_closes',
    data: { hours_remaining: hoursRemaining },
    visibility: 'public',
    dedupe_key: `reg_closes:${eventEditionId}`,
    is_pinned: false,
    is_hidden: false,
  };
}
