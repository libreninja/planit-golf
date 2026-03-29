import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string; notice?: string }>
}) {
  const params = await searchParams
  const user = await getUser()

  if (user) {
    redirect(params.next || '/')
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,_rgba(250,224,163,0.45),_transparent_25rem)]" />
      <LoginForm next={params.next || '/'} prefillEmail={params.email || ''} notice={params.notice || ''} />
    </main>
  )
}
