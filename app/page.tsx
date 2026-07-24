import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/server'
import { ensureCapabilityInviteClaimed } from '@/lib/scouting-access'
import { getAppShellUser } from '@/lib/app-shell/user'
import {
  getDashboardData,
  type AttentionItem,
  type ComingUpItem,
} from '@/lib/app-shell/dashboard'

export const dynamic = 'force-dynamic'

// Authenticated home — the member's dashboard. Coming Up shows real upcoming
// league rounds with the member's tee-time preference state; Needs Attention
// surfaces genuinely actionable items (preferences due, a pending scouting
// invite). The page stays quiet when there is nothing to surface: no hero, no
// "happening now" filler, no navigation cards that duplicate the rail.
//
// The scouting-invite safety net (ensureCapabilityInviteClaimed) is preserved
// here exactly as the old homepage ran it, so a member who confirms a scouting
// signup but lands on / before the /scouting-invite/[token] redirect still gets
// their entitlement claimed.
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return <SignInPrompt />
  }

  // Claim a scouting invite left over from a just-confirmed signup before
  // resolving access, so the freshly-granted entitlement is visible below.
  await ensureCapabilityInviteClaimed(user)
  const viewer = await getAppShellUser()

  const data = await getDashboardData({
    userId: viewer.userId ?? '',
    email: viewer.email ?? '',
    league: viewer.league,
    gtgAccess: viewer.gtgAccess,
    hasScouting: viewer.scouting,
  })

  return <Dashboard comingUp={data.comingUp} needsAttention={data.needsAttention} />
}

function SignInPrompt() {
  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-md border border-border bg-card p-8 text-center">
        <h1 className="font-display text-3xl">planit.golf</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The private place to manage your Interbay golf season — tee-time
          preferences, league rounds, and Seattle Cup scouting.
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </div>
  )
}

const BUCKET_LABEL: Record<ComingUpItem['relativeBucket'], string> = {
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  later: 'Coming up',
}

const BUCKET_ORDER: ComingUpItem['relativeBucket'][] = ['today', 'tomorrow', 'thisWeek', 'later']

function PrefBadge({ state }: { state: ComingUpItem['prefState'] }) {
  if (state === 'set') return <Badge variant="secondary">Preferences set</Badge>
  if (state === 'cant-play') return <Badge variant="outline">Not playing</Badge>
  return (
    <Badge variant="default" className="bg-primary/90">
      Set preferences
    </Badge>
  )
}

function Dashboard({
  comingUp,
  needsAttention,
}: {
  comingUp: ComingUpItem[]
  needsAttention: AttentionItem[]
}) {
  const empty = comingUp.length === 0 && needsAttention.length === 0

  return (
    <div className="space-y-10">
      {needsAttention.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Needs attention</h2>
          <ul className="space-y-2">
            {needsAttention.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-sm hover:bg-muted"
                >
                  <span>{item.label}</span>
                  <span className="text-muted-foreground">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {comingUp.length > 0 ? (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Coming up</h2>
          <div className="space-y-6">
            {BUCKET_ORDER.map((bucket) => {
              const items = comingUp.filter((i) => i.relativeBucket === bucket)
              if (items.length === 0) return null
              return (
                <div key={bucket}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {BUCKET_LABEL[bucket]}
                  </h3>
                  <ul className="space-y-2">
                    {items.map((item) => (
                      <li key={item.id}>
                        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium">{item.dateLabel}</p>
                            <p className="truncate text-sm text-muted-foreground">
                              {item.course}
                              {item.leagueLabel ? ` · ${item.leagueLabel}` : ''}
                            </p>
                            {item.registration ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Registration opens {item.registration.opensLabel}
                              </p>
                            ) : null}
                          </div>
                          {item.prefState === 'not-set' ? (
                            <Button asChild size="sm" variant="default">
                              <Link href="/igc/league/tee-time-preferences">
                                Set preferences
                              </Link>
                            </Button>
                          ) : (
                            <PrefBadge state={item.prefState} />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {empty ? (
        <p className="text-sm text-muted-foreground">
          Nothing on the schedule right now. Check back closer to your next round.
        </p>
      ) : null}
    </div>
  )
}