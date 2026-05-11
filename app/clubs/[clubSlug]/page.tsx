import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClubBySlug } from '@/lib/clubs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Users, CalendarDays } from 'lucide-react';

interface ClubPageProps {
  params: Promise<{ clubSlug: string }>;
}

export default async function ClubPage({ params }: ClubPageProps) {
  const { clubSlug } = await params;
  const club = await getClubBySlug(clubSlug);

  if (!club) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-2xl leading-none">
            planit.golf
          </Link>
          <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10">
            <Link href="/clubs">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All Clubs
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">
        {/* Club Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-semibold">{club.name}</h1>
          {club.short_name && (
            <p className="text-lg text-muted-foreground">{club.short_name}</p>
          )}
          {club.description && (
            <p className="mt-4 max-w-2xl text-muted-foreground">{club.description}</p>
          )}
        </div>

        {/* Placeholder Sections */}
        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Upcoming and past events will appear here.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Members
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Member directory and leaderboards coming soon.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
