import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEventSeriesBySlug, getEditionsForSeries } from '@/lib/events/series';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, CalendarDays } from 'lucide-react';

interface EventSeriesPageProps {
  params: Promise<{ seriesSlug: string }>;
}

export default async function EventSeriesPage({ params }: EventSeriesPageProps) {
  const { seriesSlug } = await params;
  const series = await getEventSeriesBySlug(seriesSlug);

  if (!series) {
    notFound();
  }

  const editions = await getEditionsForSeries(series.id);

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-2xl leading-none">
            planit.golf
          </Link>
          <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        <h1 className="mb-2 text-3xl font-semibold">{series.name}</h1>
        {series.description && (
          <p className="mb-6 text-muted-foreground">{series.description}</p>
        )}

        <h2 className="mb-4 text-xl font-semibold">Editions</h2>

        {editions.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {editions.map((edition) => (
              <Link
                key={edition.id}
                href={`/events/${seriesSlug}/${edition.year}`}
                className="block"
              >
                <Card className="transition hover:border-primary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CalendarDays className="h-5 w-5" />
                      {edition.year}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {edition.location_name || 'Location TBD'}
                    </p>
                    <p className="mt-2 text-sm capitalize text-muted-foreground">
                      Status: {edition.status}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No editions available yet.</p>
        )}
      </div>
    </main>
  );
}
