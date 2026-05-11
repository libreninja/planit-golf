import Link from 'next/link';
import { getClubsIndex } from '@/lib/clubs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Users } from 'lucide-react';

export default async function ClubsIndexPage() {
  const clubs = await getClubsIndex();

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
        <h1 className="mb-2 text-3xl font-semibold">Golf Clubs</h1>
        <p className="mb-6 text-muted-foreground">
          Connect with golf communities and follow your favorite clubs.
        </p>

        {clubs.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clubs.map((club) => (
              <Link
                key={club.id}
                href={`/clubs/${club.slug}`}
                className="block"
              >
                <Card className="transition hover:border-primary/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="h-5 w-5" />
                      {club.name}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {club.short_name && (
                      <p className="text-sm font-medium text-muted-foreground">
                        {club.short_name}
                      </p>
                    )}
                    {club.description && (
                      <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                        {club.description}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No clubs available yet.</p>
        )}
      </div>
    </main>
  );
}
