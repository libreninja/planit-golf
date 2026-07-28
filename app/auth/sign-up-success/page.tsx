import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function SignUpSuccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>We sent a confirmation link to finish setting up your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Click the link in the email to confirm your account and continue.
          </p>
          <p className="text-sm text-muted-foreground">
            If you don&apos;t see it within a few minutes, check your spam or junk folder.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
