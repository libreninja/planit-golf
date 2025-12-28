import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { LoginForm } from '@/components/auth/LoginForm'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string }
}) {
  const user = await getUser()
  
  // If already logged in, redirect to next or trips
  if (user) {
    redirect(searchParams.next || '/trips')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <LoginForm />
    </div>
  )
}

