import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScoutingSignUpForm } from '@/components/scouting/scouting-signup-form'

export const dynamic = 'force-dynamic'

// Dedicated accept route for Seattle Cup capability invites. Kept separate from
// the GTG /invite/[token] flow (which is members-anchored) so a scouting reviewer
// with no GG roster row can still accept. The route never reveals whether an
// account exists for an email to an unauthenticated viewer; the signup form
// handles existing-account detection only after the invite token+email validate.
function Notice({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">Back to planit.golf</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

export default async function ScoutingInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const service = createServiceClient()

  const { data: invite } = await service
    .from('capability_invites')
    .select('email, display_name, status, expires_at')
    .eq('invite_token', token)
    .maybeSingle()

  if (!invite) {
    return (
      <Notice
        title="Invite not found"
        desc="This invite link is not valid. Ask a Seattle Cup captain to send you a new one."
      />
    )
  }

  const expired = !!invite.expires_at && new Date(invite.expires_at as string) < new Date()
  if (invite.status === 'claimed') {
    return (
      <Notice
        title="Invite already used"
        desc="This invite link has already been used. Sign in to reach Seattle Cup scouting, or ask for a new invite if you do not yet have access."
      />
    )
  }
  if (invite.status === 'revoked' || expired) {
    return (
      <Notice
        title="Invite no longer valid"
        desc="This invite is expired or has been revoked. Ask a Seattle Cup captain to resend it."
      />
    )
  }

  // Logged in: claim if this account's email matches the invite.
  if (user) {
    const inviteEmail = (invite.email as string).trim().toLowerCase()
    if (user.email && user.email.trim().toLowerCase() === inviteEmail) {
      const { data: claimed } = await supabase.rpc('claim_capability_invite', {
        p_user_id: user.id,
        p_email: invite.email,
        p_token: token,
        p_display_name: (invite.display_name as string | null) ?? null,
      })
      if (Array.isArray(claimed) && claimed.length > 0) {
        redirect('/igc/seattle-cup/scouting')
      }
      // Claim returned nothing (e.g. just claimed elsewhere). Send to scouting;
      // the access gate will route on if there is no entitlement.
      redirect('/igc/seattle-cup/scouting')
    }
    return (
      <Notice
        title="Wrong account"
        desc={`You're signed in as ${user.email}, but this invite is for ${invite.email}. Sign out and open the link from the ${invite.email} inbox.`}
      />
    )
  }

  // Not logged in: show the signup form prefilled with the invite email.
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <ScoutingSignUpForm
        inviteToken={token}
        email={invite.email as string}
        displayName={(invite.display_name as string | null) ?? null}
      />
    </div>
  )
}
