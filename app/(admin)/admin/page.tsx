import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/session-actions'
import { HelpModal } from '@/components/help-modal'
import { InviteAdmin } from '@/components/invite-admin'
import { UpcomingRunAdmin } from '@/components/upcoming-run-admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { requireAdmin } from '@/lib/auth'

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export default async function AdminPage() {
  await requireAdmin()
  const supabase = await createClient()

  const { data: members } = await supabase
    .from('members')
    .select(`
      id,
      display_name,
      email,
      phone,
      golf_member_name,
      golf_member_id,
      active,
      invites (
        id,
        status,
        invite_token
      ),
      profiles (
        id,
        email
      )
    `)
    .eq('active', true)
    .order('display_name', { ascending: true })

  const { data: events } = await supabase
    .from('events')
    .select(`
      id,
      event_date,
      course_name,
      registration_opens_at,
      status,
      event_time_slots (
        time_slot,
        display_order
      )
    `)
    .eq('status', 'upcoming')
    .order('event_date', { ascending: true })
    .limit(1)

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

  const nextEvent = events?.[0] || null
  const profileIds = (members || []).flatMap((member) => toArray(member.profiles).map((profileRow) => profileRow.id))

  const { data: defaultPreferences } =
    profileIds.length > 0
      ? await supabase
          .from('default_preferences')
          .select('user_id, tee_time_preferences')
          .in('user_id', profileIds)
      : { data: [] as { user_id: string; tee_time_preferences: string[] }[] }

  const { data: eventPreferences } =
    nextEvent && profileIds.length > 0
      ? await supabase
          .from('event_preferences')
          .select('user_id, event_id, tee_time_preferences')
          .eq('event_id', nextEvent.id)
          .in('user_id', profileIds)
      : { data: [] as { user_id: string; event_id: string; tee_time_preferences: string[] }[] }

  const defaultPrefMap = new Map((defaultPreferences || []).map((row) => [row.user_id, row.tee_time_preferences]))
  const eventPrefMap = new Map((eventPreferences || []).map((row) => [row.user_id, row.tee_time_preferences]))
  const availableSlots = (nextEvent?.event_time_slots || [])
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((slot) => slot.time_slot)

  const runRows: Array<{
    memberId: string
    displayName: string
    email: string
    golfMemberName: string
    golfMemberId: string
    inviteStatus: 'not invited' | 'pending' | 'claimed' | 'revoked'
    appStatus: 'not signed up' | 'ready' | 'missing preferences'
    preferences: string[]
  }> = (members || []).map((member) => {
    const invite = toArray(member.invites)[0]
    const profileRow = toArray(member.profiles)[0]
    const rawPreferences: string[] = profileRow
      ? eventPrefMap.get(profileRow.id) || defaultPrefMap.get(profileRow.id) || []
      : []
    const resolvedPreferences = rawPreferences
      .filter((preference: string) => availableSlots.includes(preference))
      .slice(0, 3)
    const inviteStatus = (invite?.status || 'not invited') as 'not invited' | 'pending' | 'claimed' | 'revoked'
    const appStatus: 'not signed up' | 'ready' | 'missing preferences' = !profileRow
      ? 'not signed up'
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
  }).filter((row) => row.appStatus === 'ready')

  const nextRunDemandCounts = runRows.reduce<Record<string, number>>((counts, row) => {
    for (const time of row.preferences) {
      counts[time] = (counts[time] || 0) + 1
    }
    return counts
  }, {})

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
        <Card className="border-white/70 bg-white/85 shadow-lg shadow-primary/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg">Member invites</CardTitle>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">Manage invites</Button>
              </DialogTrigger>
              <DialogContent className="flex h-[32rem] max-h-[85vh] max-w-4xl flex-col overflow-hidden">
                <DialogHeader>
                  <DialogTitle>Member invites</DialogTitle>
                </DialogHeader>
                <InviteAdmin rows={inviteRows} />
              </DialogContent>
            </Dialog>
          </CardHeader>
        </Card>
        <UpcomingRunAdmin rows={runRows} demandCounts={nextRunDemandCounts} />
      </div>
    </main>
  )
}
