import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { SignUpForm } from '@/components/auth/SignUpForm'

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const params = await searchParams
  const user = await getUser()
  const inviteToken = params.token?.trim()

  if (user && inviteToken) {
    redirect(`/invite/${inviteToken}`)
  }

  if (user) {
    redirect('/')
  }

  if (!inviteToken) {
    redirect('/stay-tuned')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_right,_rgba(115,174,128,0.24),_transparent_30rem)]" />
      <SignUpForm inviteToken={inviteToken} />
    </main>
  )
}
