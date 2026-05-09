import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, CalendarDays, MapPin } from 'lucide-react';
import type { EventEdition } from '@/lib/events/editions';

interface FeaturedEventProps {
  event: EventEdition | null;
}

export function FeaturedEvent({ event }: FeaturedEventProps) {
  if (!event) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>No upcoming events</CardTitle>
          <CardDescription>Check back soon for upcoming tournaments.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const formatDate = (date: string | null) => {
    if (!date) return 'Dates TBD';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const dateRange = event.ends_on && event.ends_on !== event.starts_on
    ? `${formatDate(event.starts_on)} - ${formatDate(event.ends_on)}`
    : formatDate(event.starts_on);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4" />
          {dateRange}
        </CardDescription>
        <CardTitle className="text-2xl">{event.series?.name} {event.year}</CardTitle>
        {event.location_name && (
          <CardDescription className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            {event.location_name}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full sm:w-auto">
          <Link href={`/events/${event.series?.slug}/${event.year}`}>
            View Event
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
