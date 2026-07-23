import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { getIgcClubId, SCOUTING_FEATURE_KEY } from '@/lib/scouting-access'
import {
  createScoutingInvite,
  grantScoutingByEmail,
  revokeScouting,
  revokeScoutingInvite,
  resendScoutingInvite,
} from '@/app/scouting-admin-actions'
import { Button } from '@/components/ui/button'

// Seattle Cup scouting access admin. Invite (email), grant to an existing
// account, revoke access, and manage pending invites (resend/revoke). All
// writes are service-role; the page is guarded by requireAdmin.

function fmtDate(v: string | null | undefined): string {
  return v ? v.slice(0, 10) : '—'
}

export default async function ScoutingAdminPage() {
  await requireAdmin()
  const service = createServiceClient()
  const clubId = await getIgcClubId()

  const { data: entitlementsRaw } = await service
    .from('feature_entitlements')
    .select('user_id, status, source, granted_at, revoked_at, updated_at')
    .eq('club_id', clubId)
    .eq('feature_key', SCOUTING_FEATURE_KEY)
    .order('updated_at', { ascending: false })

  const userIds = (entitlementsRaw || []).map((e) => e.user_id as string)
  const { data: profiles } =
    userIds.length > 0
      ? await service
          .from('profiles')
          .select('id, email, display_name')
          .in('id', userIds)
      : { data: [] }
  const profileById = new Map((profiles || []).map((p) => [p.id as string, p]))

  const { data: invites } = await service
    .from('capability_invites')
    .select('id, email, display_name, status, created_at, claimed_at')
    .eq('club_id', clubId)
    .eq('feature_key', SCOUTING_FEATURE_KEY)
    .order('created_at', { ascending: false })

  const entitlements = entitlementsRaw || []
  const pendingInvites = (invites || []).filter((i) => i.status === 'pending')

  return (
    <main className="min-h-screen">
      <div className="sticky top-0 z-30 bg-foreground text-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <p className="font-display text-2xl leading-none">Seattle Cup Scouting · Access</p>
          <Button asChild variant="outline" size="sm" className="border-white/30 bg-transparent text-background hover:bg-white/10 hover:text-background">
            <Link href="/admin">Back to admin</Link>
          </Button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Invite a new captain */}
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-1 text-lg font-semibold">Invite a captain</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Sends an email with a secure link. Works for someone without a PlanIt account yet —
              they create one from the link. No IGC membership is created.
            </p>
            <form action={createScoutingInvite} className="space-y-2">
              <input
                name="email"
                type="email"
                required
                placeholder="captain@example.com"
                className="w-full rounded-md border border-border px-3 py-2"
              />
              <input
                name="displayName"
                type="text"
                placeholder="Display name (optional)"
                className="w-full rounded-md border border-border px-3 py-2"
              />
              <Button type="submit" size="sm">Send invite</Button>
            </form>
          </section>

          {/* Grant to an existing account */}
          <section className="rounded-md border border-border bg-white/80 p-4">
            <h2 className="mb-1 text-lg font-semibold">Grant to an existing account</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              For someone who already has a PlanIt account (e.g. an existing IGC member). No email,
              no re-registration. Grants the scouting entitlement only.
            </p>
            <form action={grantScoutingByEmail} className="space-y-2">
              <input
                name="email"
                type="email"
                required
                placeholder="existing@example.com"
                className="w-full rounded-md border border-border px-3 py-2"
              />
              <Button type="submit" size="sm">Grant access</Button>
            </form>
          </section>
        </div>

        {/* People with access */}
        <section>
          <h2 className="mb-3 text-xl font-semibold">People with scouting access</h2>
          {entitlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one has been granted scouting access yet.</p>
          ) : (
            <table className="w-full rounded-md border border-border text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Name / email</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Granted</th>
                  <th className="px-3 py-2">Revoked</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {entitlements.map((e) => {
                  const p = profileById.get(e.user_id as string)
                  return (
                    <tr key={e.user_id as string} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium">{p?.display_name ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{p?.email ?? e.user_id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={e.status === 'active' ? 'text-green-700' : 'text-muted-foreground'}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">{e.source}</td>
                      <td className="px-3 py-2">{fmtDate(e.granted_at as string | null)}</td>
                      <td className="px-3 py-2">{fmtDate(e.revoked_at as string | null)}</td>
                      <td className="px-3 py-2 text-right">
                        {e.status === 'active' && (
                          <form action={revokeScouting} className="inline">
                            <input type="hidden" name="userId" value={e.user_id as string} />
                            <Button type="submit" variant="outline" size="sm">Revoke</Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* Pending invites */}
        <section>
          <h2 className="mb-3 text-xl font-semibold">Pending invites</h2>
          {pendingInvites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          ) : (
            <table className="w-full rounded-md border border-border text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Sent</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {pendingInvites.map((i) => (
                  <tr key={i.id as string} className="border-t border-border">
                    <td className="px-3 py-2">{i.email}</td>
                    <td className="px-3 py-2">{i.display_name ?? '—'}</td>
                    <td className="px-3 py-2">{fmtDate(i.created_at as string | null)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <form action={resendScoutingInvite} className="inline">
                          <input type="hidden" name="inviteId" value={i.id as string} />
                          <Button type="submit" variant="outline" size="sm">Resend</Button>
                        </form>
                        <form action={revokeScoutingInvite} className="inline">
                          <input type="hidden" name="inviteId" value={i.id as string} />
                          <Button type="submit" variant="outline" size="sm">Revoke</Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  )
}