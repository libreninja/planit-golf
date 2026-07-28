import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEventSeriesIndex } from '@/lib/events/series';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Trophy } from 'lucide-react';

export default async function EventsIndexPage() {
  const series = await getEventSeriesIndex();

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
        <h1 className="mb-2 text-3xl font-semibold">All Events</h1>
        <p className="mb-6 text-muted-foreground">
          Discover golf tournaments and competitions from clubs around the world.
        </p>

        {series.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {series.map((s) => (
              <Link
                key={s.id}
                href={`/events/${s.slug}`}
                className="block"
              >
                <Card className="transition hover:border-primary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trophy className="h-5 w-5" />
                      {s.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {s.description && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                        {s.description}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No events available yet.</p>
        )}
      </div>
    </main>
  );
}
