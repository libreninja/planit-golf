'use client';

import { useState } from 'react';
import { FeedEvent } from '@/lib/events/feed';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import {
  Trophy,
  Users,
  Clock,
  Calendar,
  Bell,
  Share2,
  ThumbsUp,
  MessageCircle,
} from 'lucide-react';

interface FeedItemProps {
  event: FeedEvent;
  onReact?: (eventId: string, reaction: string) => void;
  onUnreact?: (eventId: string, reaction: string) => void;
}

const EVENT_ICONS: Record<string, React.ReactNode> = {
  standings_updated: <Trophy className="h-4 w-4" />,
  pairings_posted: <Users className="h-4 w-4" />,
  registration_closes: <Clock className="h-4 w-4" />,
  registration_opens: <Calendar className="h-4 w-4" />,
  event_started: <Bell className="h-4 w-4" />,
  event_completed: <Trophy className="h-4 w-4" />,
  score_posted: <Share2 className="h-4 w-4" />,
};

const EVENT_LABELS: Record<string, string> = {
  standings_updated: 'Standings Updated',
  pairings_posted: 'Pairings Posted',
  registration_closes: 'Registration Closing Soon',
  registration_opens: 'Registration Open',
  event_started: 'Event Started',
  event_completed: 'Event Complete',
  score_posted: 'Score Posted',
};

export function FeedItem({ event, onReact, onUnreact }: FeedItemProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [localReactions, setLocalReactions] = useState(event.reaction_counts || {});
  const [userReactions, setUserReactions] = useState(event.user_reactions || []);

  const handleReaction = async (reaction: string) => {
    if (isLoading) return;

    const isRemoving = userReactions.includes(reaction);
    setIsLoading(true);

    try {
      const response = await fetch('/api/feed/reactions', {
        method: isRemoving ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feed_event_id: event.id,
          reaction_type: reaction,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update reaction');
      }

      // Update local state optimistically
      if (isRemoving) {
        setUserReactions(userReactions.filter(r => r !== reaction));
        setLocalReactions({
          ...localReactions,
          [reaction]: Math.max(0, (localReactions[reaction] || 1) - 1),
        });
        onUnreact?.(event.id, reaction);
      } else {
        setUserReactions([...userReactions, reaction]);
        setLocalReactions({
          ...localReactions,
          [reaction]: (localReactions[reaction] || 0) + 1,
        });
        onReact?.(event.id, reaction);
      }
    } catch (error) {
      console.error('Reaction error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatTimeAgo = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000);

    if (diffInSeconds < 60) return 'just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  const getEventIcon = () => {
    return EVENT_ICONS[event.type] || <Bell className="h-4 w-4" />;
  };

  const getEventLabel = () => {
    return EVENT_LABELS[event.type] || event.type.replace(/_/g, ' ');
  };

  const renderEventContent = () => {
    switch (event.type) {
      case 'standings_updated':
        return (
          <div className="space-y-2">
            <p className="text-sm">
              {typeof event.data.round === 'number'
                ? `Round ${event.data.round} of ${event.data.totalRounds || '?'} complete`
                : 'Final standings updated'}
            </p>
            {typeof event.data.leaderName === 'string' && (
              <p className="text-sm font-medium">
                Current leader: {String(event.data.leaderName)}
              </p>
            )}
          </div>
        );

      case 'pairings_posted':
        return (
          <div className="space-y-2">
            <p className="text-sm">
              {typeof event.data.round === 'number'
                ? `Round ${event.data.round} pairings are now available`
                : 'Tee times have been posted'}
            </p>
          </div>
        );

      case 'registration_closes':
        return (
          <div className="space-y-2">
            <p className="text-sm">
              Registration closes in {String(event.data.hours_remaining || 'a few')} hours
            </p>
          </div>
        );

      default:
        return event.data.message ? (
          <p className="text-sm">{String(event.data.message)}</p>
        ) : null;
    }
  };

  return (
    <div
      className={cn(
        'flex gap-3 p-4 transition-colors hover:bg-muted/50',
        event.is_pinned && 'bg-muted/30'
      )}
    >
      {/* Icon */}
      <div className="flex-shrink-0">
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full',
            event.is_pinned
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {getEventIcon()}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{getEventLabel()}</span>
          <span className="text-xs text-muted-foreground">
            {formatTimeAgo(event.created_at)}
          </span>
          {event.is_pinned && (
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              Pinned
            </span>
          )}
        </div>

        <div className="mt-1 text-muted-foreground">
          {renderEventContent()}
        </div>

        {/* Reactions */}
        <div className="mt-3 flex items-center gap-2">
          {/* Common emoji reactions */}
          {['👍', '🔥', '👏', '🎉'].map(emoji => {
            const count = localReactions[emoji] || 0;
            const isActive = userReactions.includes(emoji);

            if (count === 0 && !isActive) return null;

            return (
              <Button
                key={emoji}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 px-2 text-xs gap-1',
                  isActive && 'bg-primary/10 text-primary'
                )}
                onClick={() => handleReaction(emoji)}
                disabled={isLoading}
              >
                <span>{emoji}</span>
                {count > 0 && <span>{count}</span>}
              </Button>
            );
          })}

          {/* Add reaction button */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => handleReaction('👍')}
            disabled={isLoading}
          >
            <ThumbsUp className="h-3 w-3 mr-1" />
            React
          </Button>
        </div>
      </div>
    </div>
  );
}
