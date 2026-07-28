import { PreferenceForm } from '@/components/preference-form'
import { AdminSectionCard } from '@/components/admin-section-card'
import { AdminSystemTools } from '@/components/admin-system-tools'
import { AdminRunSections } from '@/components/admin-run-sections'
import { loadHomePageData } from '@/lib/home-page-data'
import { createServiceClient } from '@/lib/supabase/service'

// Men's League → Tee Times. This is the existing tee-time preference workflow
// (Good to Go), re-homed under Men's League. The data flow and invite-gated
// access are unchanged: loadHomePageData still resolves the profile, invite
// link, member league, and upcoming events, and still redirects to /login,
// /invite/[token], or /stay-tuned exactly as before. Weekly overrides and
// preference behavior are unchanged.
//
// For a viewer with the administration capability (profile.is_admin or
// is_system_admin), the registration admin controls render inline below the
// preference form — the same tools that used to live on a separate top-level
// /admin destination. Ordinary Tee Times users see only the preference
// experience. Authorization boundaries are preserved: the admin tool
// components and their backing API routes enforce admin access independently.
export const dynamic = 'force-dynamic'

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export default async function MensTeeTimesPage() {
  const { user, profile, events, defaultPrefs, eventPrefs } = await loadHomePageData()
  const isAdmin = Boolean(profile?.is_admin || profile?.is_system_admin)

  // Admin roster/invite counts for the inline System tools card. Mirrors the
  // fetch that used to live on /admin; only run for admins.
  let adminCounts = null
  if (isAdmin) {
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
    adminCounts = {
      claimedInviteCount: (members || []).filter((m) => toArray(m.invites)[0]?.status === 'claimed').length,
      pendingInviteCount: (members || []).filter((m) => toArray(m.invites)[0]?.status === 'pending').length,
      mensRosterCount: (members || []).filter((m) => m.league === 'mens').length,
      womensRosterCount: (members || []).filter((m) => m.league === 'womens').length,
    }
  }

  return (
    <div>
      <div className="space-y-8 py-2">
        <PreferenceForm
          user={user}
          profile={profile}
          events={events}
          defaultPrefs={defaultPrefs}
          eventPrefs={eventPrefs}
          eventDemandCounts={{}}
          embedded
        />

        {isAdmin && adminCounts ? (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Registration admin</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage registration runs, invites, roster sync, and the Golf Genius connection for the Men&apos;s League tee-time workflow.
            </p>
            <AdminSectionCard title="System tools" defaultOpen={false} contentClassName="pt-0">
              <AdminSystemTools
                claimedInviteCount={adminCounts.claimedInviteCount}
                pendingInviteCount={adminCounts.pendingInviteCount}
                mensRosterCount={adminCounts.mensRosterCount}
                womensRosterCount={adminCounts.womensRosterCount}
              />
            </AdminSectionCard>
            <AdminRunSections />
          </section>
        ) : null}
      </div>
    </div>
  )
}