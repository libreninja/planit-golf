import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/login?next=/invite/${token}`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('member_id, invite_id')
    .eq('id', user.id)
    .maybeSingle()

  if (profile?.member_id && profile?.invite_id) {
    redirect('/')
  }

  if (!user.email) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invite claim failed</CardTitle>
            <CardDescription>Your account does not have a usable email address for invite matching.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/stay-tuned">Go to waitlist</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { data: claimResult } = await supabase.rpc('claim_invite_for_user', {
    claim_user_id: user.id,
    claim_email: user.email,
    claim_token: token,
    claim_display_name:
      typeof user.user_metadata?.display_name === 'string'
        ? user.user_metadata.display_name
        : null,
  })

  const claimedInvite = Array.isArray(claimResult) ? claimResult[0] : claimResult

  if (!claimedInvite?.member_id || !claimedInvite?.invite_id) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid invite</CardTitle>
            <CardDescription>This invite is invalid, expired, or linked to a different email address.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild className="w-full">
              <Link href="/stay-tuned">Go to waitlist</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">Sign in with a different account</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  redirect('/')
}
