import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FeaturedEvent } from '@/components/events/featured-event';
import { getCurrentEdition } from '@/lib/events/editions';

export default async function Home() {
  // Get featured event (IGC current edition)
  const featuredEvent = await getCurrentEdition('igc');

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-2xl leading-none">
            planit.golf
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10">
              <Link href="/login">Member Login</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        {/* Hero */}
        <section className="mb-8">
          <h1 className="mb-4 text-3xl font-semibold leading-tight sm:text-5xl">
            Live Golf Events
          </h1>
          <p className="mb-6 max-w-2xl text-base leading-7 text-muted-foreground">
            Follow tournaments, track standings, and stay connected with your golf community.
          </p>
          <FeaturedEvent event={featuredEvent} />
        </section>

        {/* Happening Now */}
        <section>
          <h2 className="mb-4 text-xl font-semibold">Happening Now</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Placeholder cards - will populate with feed data */}
            <div className="rounded-md border border-border bg-white/80 p-4">
              <p className="text-sm text-muted-foreground">Live standings and updates coming soon...</p>
            </div>
          </div>
        </section>

        {/* Navigation */}
        <nav className="mt-8 flex gap-4">
          <Button asChild variant="outline">
            <Link href="/events">All Events</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/clubs">Clubs</Link>
          </Button>
        </nav>
      </div>
    </main>
  );
}
