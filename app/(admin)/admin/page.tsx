import { createServiceClient } from '@/lib/supabase/service'
import { AdminRunSections } from '@/components/admin-run-sections'
import { AdminSectionCard } from '@/components/admin-section-card'
import { AdminSystemTools } from '@/components/admin-system-tools'
import { HelpModal } from '@/components/help-modal'
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
    <div>
      <div className="space-y-6 py-2">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Admin</h1>
          <HelpModal mode="admin" />
        </div>
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
    </div>
  )
}
