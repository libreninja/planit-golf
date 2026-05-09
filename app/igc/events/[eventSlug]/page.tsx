import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  ExternalLink,
  Info,
  ListChecks,
  MapPin,
  MessageSquare,
  RefreshCw,
  Trophy,
  Users,
} from 'lucide-react'

import { syncIgcEventFromGolfGenius } from '@/app/igc/actions'
import { IgcSyncButton } from '@/components/igc/IgcSyncButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getProfileRoles, getUser } from '@/lib/auth'
import {
  getIgcEventHubData,
  type IgcEventHubData,
  type IgcFeedEvent,
  type IgcLeaderboardSnapshot,
  type IgcRound,
  type IgcTeeTime,
} from '@/lib/igc/data'

export const dynamic = 'force-dynamic'

function formatDate(value: string | null | undefined) {
  if (!value) return 'Date TBD'

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`))
}

function formatDateRange(event: NonNullable<IgcEventHubData['event']>) {
  if (!event.ends_on || event.ends_on === event.starts_on) return formatDate(event.starts_on)
  return `${formatDate(event.starts_on)} - ${formatDate(event.ends_on)}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not synced yet'

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(new Date(value))
}

function formatTime(value: string | null | undefined, fallback: string | null | undefined) {
  if (!value) return fallback || 'Time TBD'

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  }).format(new Date(value))
}

function getLatestSnapshots(snapshots: IgcLeaderboardSnapshot[]) {
  const seen = new Set<string>()
  const latest: IgcLeaderboardSnapshot[] = []

  for (const snapshot of snapshots) {
    const key = `${snapshot.round_id || 'event'}:${snapshot.leaderboard_type}`
    if (seen.has(key) || snapshot.rows.length === 0) continue
    seen.add(key)
    latest.push(snapshot)
  }

  return latest
}

function asText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>
        return asText(row.label) || asText(row.title) || asText(row.text) || asText(row.name)
      }
      return null
    })
    .filter((item): item is string => Boolean(item))
}

function asLinks(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return { label: item, url: item }
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>
        const url = asText(row.url) || asText(row.href)
        const label = asText(row.label) || asText(row.title) || url
        return url ? { label: label || url, url } : null
      }
      return null
    })
    .filter((item): item is { label: string; url: string } => Boolean(item))
}

async function isCurrentUserAdmin() {
  const user = await getUser()
  if (!user) return false
  const roles = await getProfileRoles(user.id)
  return roles.is_admin || roles.is_system_admin
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-white/55 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: string
}) {
  return (
    <div className="rounded-md border border-border bg-white/80 p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  )
}

function RoundTeeTimes({
  round,
  teeTimes,
}: {
  round: IgcRound | null
  teeTimes: IgcTeeTime[]
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xl font-semibold">{round?.name || 'Event Tee Times'}</h3>
        {round?.course_name || round?.starts_on ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {[round.course_name, round.starts_on ? formatDate(round.starts_on) : null].filter(Boolean).join(' / ')}
          </p>
        ) : null}
      </div>

      {teeTimes.length > 0 ? (
        <div className="grid gap-3">
          {teeTimes.map((teeTime) => (
            <div key={teeTime.id} className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                    {formatTime(teeTime.starts_at, teeTime.tee_time_label)}
                  </p>
                  {teeTime.tee || teeTime.group_name ? (
                    <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {[teeTime.tee ? `Tee ${teeTime.tee}` : null, teeTime.group_name].filter(Boolean).join(' / ')}
                    </p>
                  ) : null}
                </div>
                <Badge variant="secondary" className="rounded-md">
                  {teeTime.pairings.length || 0}
                </Badge>
              </div>

              {teeTime.pairings.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {teeTime.pairings.map((pairing) => (
                    <div key={pairing.id} className="flex items-center justify-between gap-3 rounded-md bg-secondary/60 px-3 py-2">
                      <span className="text-sm font-medium">{pairing.player_name}</span>
                      {pairing.team_name ? (
                        <span className="text-xs text-muted-foreground">{pairing.team_name}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Pairings not imported yet.</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState>Tee times and pairings will appear after the first Golf Genius sync.</EmptyState>
      )}
    </div>
  )
}

function LeaderboardBlock({
  snapshot,
  round,
}: {
  snapshot: IgcLeaderboardSnapshot
  round: IgcRound | null
}) {
  return (
    <div className="rounded-md border border-border bg-white/85 shadow-sm">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xl font-semibold">
              {round?.name || 'Event'} {snapshot.leaderboard_type === 'results' ? 'Results' : 'Leaderboard'}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">Imported {formatDateTime(snapshot.snapshot_at)}</p>
          </div>
          <Badge variant="secondary" className="rounded-md">
            {snapshot.rows.length} rows
          </Badge>
        </div>
      </div>
      <div className="divide-y divide-border">
        {snapshot.rows.slice(0, 12).map((row, index) => (
          <div key={`${row.externalId || row.name || index}`} className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 p-3">
            <div className="text-lg font-bold text-primary">{row.position || index + 1}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{row.name || 'Unknown player'}</p>
              <p className="text-xs text-muted-foreground">
                {[row.today ? `Today ${row.today}` : null, row.thru ? `Thru ${row.thru}` : null].filter(Boolean).join(' / ') || 'Imported from Golf Genius'}
              </p>
            </div>
            <div className="text-right text-sm font-semibold">{row.score || '-'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function FeedIcon({ type }: { type: string }) {
  if (type.includes('leader')) return <Trophy className="h-4 w-4" aria-hidden="true" />
  if (type.includes('tee')) return <Clock className="h-4 w-4" aria-hidden="true" />
  if (type.includes('sync')) return <RefreshCw className="h-4 w-4" aria-hidden="true" />
  if (type.includes('result')) return <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
  return <MessageSquare className="h-4 w-4" aria-hidden="true" />
}

function FeedList({ feedEvents }: { feedEvents: IgcFeedEvent[] }) {
  if (feedEvents.length === 0) {
    return <EmptyState>Event updates will appear here as Golf Genius syncs and logistics change.</EmptyState>
  }

  return (
    <div className="space-y-3">
      {feedEvents.map((feedEvent) => (
        <div key={feedEvent.id} className="grid grid-cols-[2rem_1fr] gap-3 rounded-md border border-border bg-white/85 p-4 shadow-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FeedIcon type={feedEvent.type} />
          </div>
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{feedEvent.title}</h3>
              <p className="text-xs text-muted-foreground">{formatDateTime(feedEvent.occurred_at)}</p>
            </div>
            {feedEvent.body ? (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{feedEvent.body}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function Logistics({ logistics }: { logistics: Record<string, unknown> }) {
  const lodging = asText(logistics.lodging)
  const dinner = asText(logistics.dinner)
  const transportation = asText(logistics.transportation)
  const itinerary = asList(logistics.itinerary)
  const announcements = asList(logistics.announcements)
  const links = asLinks(logistics.usefulLinks)
  const hasContent = lodging || dinner || transportation || itinerary.length > 0 || announcements.length > 0 || links.length > 0

  if (!hasContent) {
    return <EmptyState>Logistics are ready for lodging, itinerary, dinner, transportation, links, and announcements.</EmptyState>
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {announcements.length > 0 ? (
        <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm sm:col-span-2">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Announcements</h3>
          <div className="mt-3 space-y-2">
            {announcements.map((item) => (
              <p key={item} className="text-sm leading-6">{item}</p>
            ))}
          </div>
        </div>
      ) : null}
      {lodging ? (
        <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lodging</h3>
          <p className="mt-3 text-sm leading-6">{lodging}</p>
        </div>
      ) : null}
      {itinerary.length > 0 ? (
        <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Itinerary</h3>
          <div className="mt-3 space-y-2">
            {itinerary.map((item) => (
              <p key={item} className="text-sm leading-6">{item}</p>
            ))}
          </div>
        </div>
      ) : null}
      {dinner ? (
        <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Dinner</h3>
          <p className="mt-3 text-sm leading-6">{dinner}</p>
        </div>
      ) : null}
      {transportation ? (
        <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Transportation</h3>
          <p className="mt-3 text-sm leading-6">{transportation}</p>
        </div>
      ) : null}
      {links.length > 0 ? (
        <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Links</h3>
          <div className="mt-3 grid gap-2">
            {links.map((link) => (
              <a key={link.url} href={link.url} className="inline-flex items-center gap-2 text-sm font-medium text-primary" target="_blank" rel="noreferrer">
                {link.label}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default async function IgcEventPage({
  params,
}: {
  params: Promise<{ eventSlug: string }>
}) {
  const [{ eventSlug }, data, canSync] = await Promise.all([
    params,
    params.then(({ eventSlug: slug }) => getIgcEventHubData(slug)),
    isCurrentUserAdmin(),
  ])

  if (data.setupRequired) {
    return (
      <main className="min-h-screen bg-background px-4 py-6">
        <div className="mx-auto max-w-2xl rounded-md border border-border bg-white/85 p-5 shadow-sm">
          <h1 className="text-2xl font-semibold">IGC companion tables are not ready</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Apply migration 014, then reopen this page.
          </p>
        </div>
      </main>
    )
  }

  if (!data.event) notFound()

  const { event, players, rounds, teeTimes, feedEvents, logistics, syncRuns } = data
  const latestSnapshots = getLatestSnapshots(data.leaderboardSnapshots)
  const roundsById = new Map(rounds.map((round) => [round.id, round]))
  const teeTimesWithoutRound = teeTimes.filter((teeTime) => !teeTime.round_id)
  const latestSync = syncRuns[0]

  return (
    <main className="min-h-screen bg-background">
      <div className="border-b border-border bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Button asChild variant="ghost" size="sm" className="gap-2 text-background hover:bg-white/10 hover:text-background">
            <Link href="/igc/events">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Events
            </Link>
          </Button>
          <Link href="/igc" className="font-display text-2xl leading-none">
            {data.community?.short_name || 'IGC'}
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-5 sm:pt-8">
        <section className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-md bg-primary/10 text-primary hover:bg-primary/10">
                {event.status}
              </Badge>
              {event.last_sync_status ? (
                <Badge variant="outline" className="rounded-md bg-white/60">
                  {event.last_sync_status}
                </Badge>
              ) : null}
            </div>
            <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-6xl">{event.name}</h1>
            {event.description ? (
              <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">{event.description}</p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
                {formatDateRange(event)}
              </span>
              {event.location_name ? (
                <span className="inline-flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
                  {event.location_name}
                </span>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 sm:min-w-72">
            {event.golf_genius_portal_url ? (
              <Button asChild variant="outline" className="gap-2 bg-white/75">
                <a href={event.golf_genius_portal_url} target="_blank" rel="noreferrer">
                  Golf Genius
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
            ) : null}
            {canSync ? (
              <form action={syncIgcEventFromGolfGenius} className="rounded-md border border-border bg-white/85 p-3 shadow-sm">
                <input type="hidden" name="eventSlug" value={eventSlug} />
                <div className="mb-3 flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
                  <span>Last sync: {formatDateTime(event.last_synced_at)}</span>
                </div>
                <IgcSyncButton />
              </form>
            ) : null}
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={Users} label="Players" value={String(players.length)} />
          <Stat icon={Clock} label="Tee Groups" value={String(teeTimes.length)} />
          <Stat icon={Trophy} label="Boards" value={String(latestSnapshots.length)} />
          <Stat icon={ListChecks} label="Updates" value={String(feedEvents.length)} />
        </section>

        <nav className="sticky top-0 z-20 mt-5 overflow-x-auto border-y border-border bg-background/95 py-2 backdrop-blur">
          <div className="flex min-w-max gap-2">
            {[
              ['#overview', 'Overview'],
              ['#tee-times', 'Tee Times'],
              ['#leaderboard', 'Leaderboard'],
              ['#feed', 'Feed'],
              ['#logistics', 'Logistics'],
            ].map(([href, label]) => (
              <Button key={href} asChild variant="outline" size="sm" className="bg-white/75">
                <a href={href}>{label}</a>
              </Button>
            ))}
          </div>
        </nav>

        <section id="overview" className="scroll-mt-20 pt-7">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-3xl font-semibold">Overview</h2>
            {latestSync ? (
              <span className="text-xs text-muted-foreground">Sync {formatDateTime(latestSync.completed_at || latestSync.started_at)}</span>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Players</h3>
              {players.length > 0 ? (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {players.slice(0, 24).map((player) => (
                    <div key={player.id} className="rounded-md bg-secondary/60 px-3 py-2 text-sm font-medium">
                      {player.display_name}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Player roster will appear after sync.</p>
              )}
            </div>
            <div className="rounded-md border border-border bg-white/85 p-4 shadow-sm">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Rounds</h3>
              {rounds.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {rounds.map((round) => (
                    <div key={round.id} className="rounded-md bg-secondary/60 px-3 py-2">
                      <p className="text-sm font-semibold">{round.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[round.course_name, round.starts_on ? formatDate(round.starts_on) : null, round.status].filter(Boolean).join(' / ')}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">Rounds will appear after sync.</p>
              )}
            </div>
          </div>
        </section>

        <section id="tee-times" className="scroll-mt-20 pt-8">
          <h2 className="mb-3 text-3xl font-semibold">Tee Times / Pairings</h2>
          <div className="space-y-6">
            {rounds.map((round) => (
              <RoundTeeTimes
                key={round.id}
                round={round}
                teeTimes={teeTimes.filter((teeTime) => teeTime.round_id === round.id)}
              />
            ))}
            {rounds.length === 0 || teeTimesWithoutRound.length > 0 ? (
              <RoundTeeTimes round={null} teeTimes={teeTimesWithoutRound} />
            ) : null}
          </div>
        </section>

        <section id="leaderboard" className="scroll-mt-20 pt-8">
          <h2 className="mb-3 text-3xl font-semibold">Leaderboard</h2>
          {latestSnapshots.length > 0 ? (
            <div className="grid gap-3">
              {latestSnapshots.map((snapshot) => (
                <LeaderboardBlock
                  key={snapshot.id}
                  snapshot={snapshot}
                  round={snapshot.round_id ? roundsById.get(snapshot.round_id) || null : null}
                />
              ))}
            </div>
          ) : (
            <EmptyState>Leaderboard and results snapshots will appear after Golf Genius data is imported.</EmptyState>
          )}
        </section>

        <section id="feed" className="scroll-mt-20 pt-8">
          <h2 className="mb-3 text-3xl font-semibold">Feed</h2>
          <FeedList feedEvents={feedEvents} />
        </section>

        <section id="logistics" className="scroll-mt-20 pt-8">
          <h2 className="mb-3 text-3xl font-semibold">Logistics</h2>
          <Logistics logistics={logistics} />
        </section>
      </div>
    </main>
  )
}
