import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEventEdition } from '@/lib/events/editions';
import { StandingsDisplay } from '@/components/events/standings-display';
import { PairingsDisplay } from '@/components/events/pairings-display';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, CalendarDays, MapPin } from 'lucide-react';

interface EventEditionPageProps {
  params: Promise<{ seriesSlug: string; year: string }>;
}

export default async function EventEditionPage({ params }: EventEditionPageProps) {
  const { seriesSlug, year } = await params;
  const yearNum = parseInt(year, 10);

  if (isNaN(yearNum)) {
    notFound();
  }

  const edition = await getEventEdition(seriesSlug, yearNum);

  if (!edition) {
    notFound();
  }

  const formatDate = (date: string | null) => {
    if (!date) return 'TBD';
    return new Date(date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const dateRange = edition.ends_on && edition.ends_on !== edition.starts_on
    ? `${formatDate(edition.starts_on)} - ${formatDate(edition.ends_on)}`
    : formatDate(edition.starts_on);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-2xl leading-none">
            planit.golf
          </Link>
          <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10">
            <Link href={`/events/${seriesSlug}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        {/* Event Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            {dateRange}
          </div>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            {edition.series?.name} {edition.year}
          </h1>
          {edition.location_name && (
            <div className="mt-2 flex items-center gap-2 text-muted-foreground">
              <MapPin className="h-4 w-4" />
              {edition.location_name}
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="standings" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-flex">
            <TabsTrigger value="standings">Standings</TabsTrigger>
            <TabsTrigger value="pairings">Pairings</TabsTrigger>
            <TabsTrigger value="logistics">Logistics</TabsTrigger>
          </TabsList>

          <TabsContent value="standings">
            <StandingsDisplay editionId={edition.id} />
          </TabsContent>

          <TabsContent value="pairings">
            <PairingsDisplay editionId={edition.id} />
          </TabsContent>

          <TabsContent value="logistics">
            <div className="rounded-md border border-border bg-white/80 p-6">
              <h3 className="mb-4 text-lg font-semibold">Logistics</h3>
              <p className="text-sm text-muted-foreground">
                Event logistics will be posted here.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {/* Feed Section */}
        <section className="mt-8">
          <h2 className="mb-4 text-xl font-semibold">Activity</h2>
          <div className="rounded-md border border-border bg-white/80 p-6">
            <p className="text-sm text-muted-foreground">
              Event activity feed coming soon...
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
