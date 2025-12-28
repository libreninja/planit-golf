import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function InvitePage({
  params,
}: {
  params: { token: string }
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    // Not logged in, redirect to login with next param
    redirect(`/login?next=/invite/${params.token}`)
  }

  // Find membership by token
  const { data: membership, error: membershipError } = await supabase
    .from('memberships')
    .select('*, trips!inner(slug, title)')
    .eq('invite_token', params.token)
    .single()

  if (membershipError || !membership) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid Invite</CardTitle>
            <CardDescription>
              This invite link is invalid or has expired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/trips">Go to My Trips</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Check if email matches (case-insensitive)
  if (membership.invited_email.toLowerCase() !== user.email?.toLowerCase()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Email Mismatch</CardTitle>
            <CardDescription>
              This invite was sent to {membership.invited_email}, but you're logged in as {user.email}.
              Please log out and sign in with the correct email address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <form action="/api/auth/signout" method="post">
              <Button type="submit" variant="outline" className="w-full">
                Sign Out
              </Button>
            </form>
            <Button asChild variant="ghost" className="w-full">
              <Link href="/trips">Go to My Trips</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // If already accepted, just redirect
  if (membership.status === 'accepted' && membership.user_id === user.id) {
    redirect(`/trips/${membership.trips.slug}`)
  }

  // Claim the invite
  const { error: updateError } = await supabase
    .from('memberships')
    .update({
      user_id: user.id,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', membership.id)

  if (updateError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Error</CardTitle>
            <CardDescription>
              There was an error claiming your invite. Please try again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/trips">Go to My Trips</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Success! Redirect to trip page
  redirect(`/trips/${membership.trips.slug}`)
}

