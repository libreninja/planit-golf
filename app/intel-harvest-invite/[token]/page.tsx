import Link from 'next/link'
import { redirect } from 'next/navigation'
import { HarvestSignUpForm } from '@/components/harvest/harvest-signup-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { HARVEST_FEATURE_KEY, inviteAcceptanceMode } from '@/lib/seattle-cup/harvest/domain'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

function Notice({ title, description }: { title: string; description: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="space-y-3"><Button asChild className="w-full"><Link href="/login">Sign in</Link></Button><Button asChild variant="outline" className="w-full"><Link href="/">Back to planit.golf</Link></Button></CardContent></Card>
    </main>
  )
}

export default async function IntelHarvestInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()
  const { data: invite } = await service
    .from('capability_invites')
    .select('id, email, display_name, feature_key, status, expires_at')
    .eq('invite_token', token)
    .maybeSingle()
  if (!invite || invite.feature_key !== HARVEST_FEATURE_KEY) return <Notice title="Invite not found" description="This Intel Harvest invitation is not valid. Ask a Seattle Cup captain to send a new one." />
  const expired = !!invite.expires_at && new Date(invite.expires_at as string) < new Date()
  if (invite.status === 'claimed') return <Notice title="Invite already used" description="This invitation has already been used. Sign in to return to the Intel Harvest." />
  if (invite.status === 'revoked' || expired) return <Notice title="Invite no longer valid" description="This invitation has expired or was revoked. Ask a captain to resend it." />

  const acceptanceMode = inviteAcceptanceMode({ userEmail: user?.email ?? null, inviteEmail: invite.email as string })
  if (acceptanceMode === 'wrong_account') return <Notice title="Wrong account" description={`You're signed in as ${user?.email}, but this invitation is for ${invite.email}. Sign out and use the invited account.`} />
  if (user && acceptanceMode === 'claim') {
    const { data: claimed } = await supabase.rpc('claim_capability_invite', {
      p_user_id: user.id,
      p_email: invite.email,
      p_token: token,
      p_display_name: (invite.display_name as string | null) ?? null,
    })
    if (Array.isArray(claimed) && claimed.length > 0) {
      const now = new Date().toISOString()
      await service.from('intel_harvest_participants').update({
        user_id: user.id,
        campaign_status: 'claimed',
        claimed_at: now,
        updated_at: now,
      }).eq('invite_id', invite.id)
    }
    redirect('/igc/seattle-cup/harvest/2026')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <HarvestSignUpForm inviteToken={token} email={invite.email as string} displayName={invite.display_name as string | null} />
    </main>
  )
}
