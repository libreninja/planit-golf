import Link from 'next/link'
import { getNextRunEventDate, getRegistrationWindow } from '@/lib/registration-schedule'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { AdminSystemTools } from '@/components/admin-system-tools'
import { signOut } from '@/app/session-actions'
import { HelpModal } from '@/components/help-modal'
import { UpcomingRunAdmin } from '@/components/upcoming-run-admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireAdmin } from '@/lib/auth'

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export default async function AdminPage() {
  await requireAdmin()
  const supabase = await createClient()
  const serviceClient = createServiceClient()

  const { data: members } = await serviceClient
    .from('members')
    .select(`
      id,
      display_name,
      email,
      phone,
      golf_member_name,
      golf_member_id,
      league,
      active,
      invites (
        id,
        status,
        invite_token
      ),
      profiles (
        id,
        email,
        registrations_paused,
        membership_revoked
      )
    `)
    .eq('active', true)
    .order('display_name', { ascending: true })

  const { data: events } = await serviceClient
    .from('events')
    .select(`
      id,
      event_date,
      course_name,
      league,
      registration_opens_at,
      status,
      event_time_slots (
        time_slot,
        display_order
      )
    `)
    .eq('status', 'upcoming')
    .order('event_date', { ascending: true })

  const inviteRows = (members || []).map((member) => ({
    id: member.id,
    display_name: member.display_name,
    email: member.email,
    phone: member.phone,
    golf_member_name: member.golf_member_name,
    golf_member_id: member.golf_member_id,
    active: member.active,
    invites: toArray(member.invites).map((invite) => ({
      id: invite.id,
      status: invite.status,
      invite_token: invite.invite_token,
    })),
  }))
  const claimedInviteCount = inviteRows.filter((row) => row.invites?.[0]?.status === 'claimed').length
  const pendingInviteCount = inviteRows.filter((row) => row.invites?.[0]?.status === 'pending').length
  const mensRosterCount = (members || []).filter((member) => member.league === 'mens').length
  const womensRosterCount = (members || []).filter((member) => member.league === 'womens').length

  const targetRunDateByLeague = {
    mens: getNextRunEventDate('mens'),
    womens: getNextRunEventDate('womens'),
  }
  const nextEventsByLeague = new Map<string, NonNullable<typeof events>[number]>()
  for (const event of events || []) {
    if (!event.league || nextEventsByLeague.has(event.league)) continue
    if (event.event_date === targetRunDateByLeague[event.league as 'mens' | 'womens']) {
      nextEventsByLeague.set(event.league, event)
    }
  }
  const profileIds = (members || []).flatMap((member) => toArray(member.profiles).map((profileRow) => profileRow.id))

  const { data: defaultPreferences } =
    profileIds.length > 0
      ? await serviceClient
          .from('default_preferences')
          .select('user_id, tee_time_preferences')
          .in('user_id', profileIds)
      : { data: [] as { user_id: string; tee_time_preferences: string[] }[] }

  const { data: eventPreferences } =
    nextEventsByLeague.size > 0 && profileIds.length > 0
      ? await serviceClient
          .from('event_preferences')
          .select('user_id, event_id, tee_time_preferences, skip_registration')
          .in('event_id', Array.from(nextEventsByLeague.values()).map((event) => event.id))
          .in('user_id', profileIds)
      : { data: [] as { user_id: string; event_id: string; tee_time_preferences: string[]; skip_registration: boolean }[] }

  const defaultPrefMap = new Map((defaultPreferences || []).map((row) => [row.user_id, row.tee_time_preferences]))
  const eventPrefMap = new Map((eventPreferences || []).map((row) => [`${row.event_id}:${row.user_id}`, row]))

  type RunRow = {
    memberId: string
    displayName: string
    email: string
    golfMemberName: string
    golfMemberId: string
    inviteStatus: 'not invited' | 'pending' | 'claimed' | 'revoked'
    appStatus: 'not signed up' | 'ready' | 'missing preferences'
    preferences: string[]
  }

  const buildRunRows = (league: string, eventId: string, availableSlots: string[]): RunRow[] =>
    (members || [])
      .filter((member) => member.league === league)
      .map((member) => {
        const invite = toArray(member.invites)[0]
        const profileRow = toArray(member.profiles)[0]
        const eventPreference = profileRow ? eventPrefMap.get(`${eventId}:${profileRow.id}`) : null
        const rawPreferences: string[] = profileRow
          ? eventPreference?.tee_time_preferences || defaultPrefMap.get(profileRow.id) || []
          : []
        const resolvedPreferences = rawPreferences
          .filter((preference: string) => availableSlots.includes(preference))
          .slice(0, 3)
        const inviteStatus = (invite?.status || 'not invited') as 'not invited' | 'pending' | 'claimed' | 'revoked'
        const appStatus: 'not signed up' | 'ready' | 'missing preferences' = !profileRow
          ? 'not signed up'
          : profileRow.registrations_paused || profileRow.membership_revoked || eventPreference?.skip_registration
            ? 'missing preferences'
            : resolvedPreferences.length > 0
              ? 'ready'
              : 'missing preferences'

        return {
          memberId: member.id,
          displayName: member.display_name,
          email: member.email,
          golfMemberName: member.golf_member_name,
          golfMemberId: member.golf_member_id,
          inviteStatus,
          appStatus,
          preferences: resolvedPreferences,
        }
      })
      .filter((row) => row.appStatus === 'ready')

  const runSections = Array.from(nextEventsByLeague.entries()).map(([league, event]) => {
    const availableSlots = (event.event_time_slots || [])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((slot) => slot.time_slot)
    const rows = buildRunRows(league, event.id, availableSlots)
    const demandCounts = rows.reduce<Record<string, number>>((counts, row) => {
      for (const time of row.preferences) {
        counts[time] = (counts[time] || 0) + 1
      }
      return counts
    }, {})
    const title = league === 'mens' ? "Men's next registration run" : league === 'womens' ? "Women's next registration run" : `${league} next registration run`
    const registrationWindow = getRegistrationWindow(league as 'mens' | 'womens', event.event_date)
    return { title, rows, demandCounts, ...registrationWindow }
  })

  return (
    <main className="min-h-screen">
      <div className="sticky top-0 z-30 bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-left">
            <p className="font-display text-2xl leading-none">Good to Go Admin</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <HelpModal mode="admin" />
            <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10 hover:text-background">
              <Link href="/">Back</Link>
            </Button>
            <form action={signOut}>
              <Button variant="ghost" size="sm" className="text-background hover:bg-white/10 hover:text-background" type="submit">
                Sign Out
              </Button>
            </form>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-4">
        <Card className="overflow-hidden border-white/70 bg-white/85 shadow-lg shadow-primary/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 bg-primary text-primary-foreground">
            <CardTitle className="text-lg text-primary-foreground">System tools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <AdminSystemTools
              inviteRows={inviteRows}
              claimedInviteCount={claimedInviteCount}
              pendingInviteCount={pendingInviteCount}
              mensRosterCount={mensRosterCount}
              womensRosterCount={womensRosterCount}
            />
          </CardContent>
        </Card>
        {runSections.map((section) => (
          <UpcomingRunAdmin
            key={section.title}
            title={section.title}
            roundLabel={section.roundLabel}
            opensLabel={section.opensLabel}
            closesLabel={section.closesLabel}
            rows={section.rows}
            demandCounts={section.demandCounts}
          />
        ))}
      </div>
    </main>
  )
}
