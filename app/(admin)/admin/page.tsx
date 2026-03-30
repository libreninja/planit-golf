import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { AdminRunSections } from '@/components/admin-run-sections'
import { AdminSectionCard } from '@/components/admin-section-card'
import { AdminSystemTools } from '@/components/admin-system-tools'
import { signOut } from '@/app/session-actions'
import { HelpModal } from '@/components/help-modal'
import { Button } from '@/components/ui/button'
import { requireAdmin } from '@/lib/auth'

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export default async function AdminPage() {
  await requireAdmin()
  const serviceClient = createServiceClient()

  const { data: members } = await serviceClient
    .from('members')
    .select(`
      id,
      display_name,
      league,
      active,
      invites (
        status
      )
    `)
    .eq('active', true)
    .order('display_name', { ascending: true })
  const claimedInviteCount = (members || []).filter((member) => toArray(member.invites)[0]?.status === 'claimed').length
  const pendingInviteCount = (members || []).filter((member) => toArray(member.invites)[0]?.status === 'pending').length
  const mensRosterCount = (members || []).filter((member) => member.league === 'mens').length
  const womensRosterCount = (members || []).filter((member) => member.league === 'womens').length

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
        <AdminSectionCard title="System tools" defaultOpen={false} contentClassName="pt-0">
          <AdminSystemTools
            claimedInviteCount={claimedInviteCount}
            pendingInviteCount={pendingInviteCount}
            mensRosterCount={mensRosterCount}
            womensRosterCount={womensRosterCount}
          />
        </AdminSectionCard>
        <AdminRunSections />
      </div>
    </main>
  )
}
