import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FeaturedEvent } from '@/components/events/featured-event';
import { getCurrentEdition } from '@/lib/events/editions';
import { createClient } from '@/lib/supabase/server';
import {
  hasScoutingAccess,
  ensureCapabilityInviteClaimed,
} from '@/lib/scouting-access';

// Lightweight, non-redirecting probe of what a signed-in user can reach. Mirrors
// the "can access without invite" condition used by the tee-time preferences page
// (lib/home-page-data.ts) without running that page's invite-claim/redirect
// logic, so the homepage never bounces a visitor.
async function getUserAccess() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { signedIn: false as const, teeTime: false, scouting: false };
  }

  // Just-confirmed scouting invite: claim the entitlement if a token is still
  // sitting in user_metadata, then fall through to the normal access check.
  await ensureCapabilityInviteClaimed(user);

  const { data: profile } = await supabase
    .from('profiles')
    .select('member_id, invite_id, is_system_admin, membership_revoked')
    .eq('id', user.id)
    .maybeSingle();

  const teeTime = Boolean(
    profile?.member_id &&
      (profile?.invite_id || profile?.is_system_admin) &&
      !profile?.membership_revoked,
  );
  const scouting = await hasScoutingAccess(user.id);

  return { signedIn: true as const, teeTime, scouting, email: user.email };
}

export default async function Home() {
  // Get featured event (IGC current edition)
  const [featuredEvent, access] = await Promise.all([
    getCurrentEdition('igc'),
    getUserAccess(),
  ]);

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-2xl leading-none">
            planit.golf
          </Link>
          <div className="flex items-center gap-2">
            {access.signedIn ? (
              <span className="text-sm text-background/80">
                {access.email}
              </span>
            ) : (
              <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10">
                <Link href="/login">Member Login</Link>
              </Button>
            )}
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

        {/* Navigation — access-aware. Only the tools you can actually open are
            shown; everything is plain language (no internal product/architecture
            names beyond the league a captain would recognize). */}
        <nav className="mt-8 flex flex-wrap gap-4">
          {access.signedIn && access.teeTime && (
            <Button asChild variant="default">
              <Link href="/igc/league/tee-time-preferences">
                Interbay League Tee Time Preferences
              </Link>
            </Button>
          )}
          {access.signedIn && access.scouting && (
            <Button asChild variant="default">
              <Link href="/igc/seattle-cup/scouting">Seattle Cup Scouting</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/events">All Events</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/clubs">Clubs</Link>
          </Button>
        </nav>

        {access.signedIn && !access.teeTime && !access.scouting && (
          <p className="mt-4 text-sm text-muted-foreground">
            You&apos;re signed in, but no league tools are available for your account yet.
            Ask your captain if you expected access to something.
          </p>
        )}
      </div>
    </main>
  );
}