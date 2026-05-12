'use client';

import { useState, useEffect } from 'react';
import { FeedEvent, FeedFilters, getFeedEvents } from '@/lib/events/feed';
import { FeedItem } from './feed-item';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw } from 'lucide-react';

interface FeedListProps {
  filters?: FeedFilters;
  showLoadMore?: boolean;
  onEventClick?: (event: FeedEvent) => void;
}

export function FeedList({ filters = {}, showLoadMore = true, onEventClick }: FeedListProps) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const fetchEvents = async (isInitial = true) => {
    try {
      setIsLoading(true);
      setError(null);

      const fetchFilters = isInitial
        ? filters
        : { ...filters, cursor: events[events.length - 1]?.id };

      const data = await getFeedEvents(fetchFilters);

      if (isInitial) {
        setEvents(data);
      } else {
        setEvents((prev) => [...prev, ...data]);
      }

      setHasMore(data.length === (filters.limit || 20));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feed');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [filters.subjectId, filters.subjectType, filters.types?.join(',')]);

  const handleReaction = (eventId: string, reaction: string) => {
    // Optimistic update handled in FeedItem
  };

  const handleUnreaction = (eventId: string, reaction: string) => {
    // Optimistic update handled in FeedItem
  };

  if (isLoading && events.length === 0) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 p-4">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-sm text-muted-foreground mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchEvents()}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Check back later for updates
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {events.map((event) => (
        <div
          key={event.id}
          onClick={() => onEventClick?.(event)}
          className={onEventClick ? 'cursor-pointer' : ''}
        >
          <FeedItem
            event={event}
            onReact={handleReaction}
            onUnreact={handleUnreaction}
          />
        </div>
      ))}

      {showLoadMore && hasMore && (
        <div className="p-4 text-center">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchEvents(false)}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
