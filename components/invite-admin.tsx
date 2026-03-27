'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createInvite, revokeInvite } from '@/app/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface InviteRow {
  id: string
  display_name: string
  email: string
  phone: string | null
  golf_member_name: string
  golf_member_id: string
  active: boolean
  invites:
    | {
        id: string
        status: 'pending' | 'claimed' | 'revoked'
        invite_token: string
      }[]
    | null
}

export function InviteAdmin({ rows }: { rows: InviteRow[] }) {
  const [query, setQuery] = useState('')
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({})
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
  const [mounted, setMounted] = useState(false)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
    setOrigin(window.location.origin)
  }, [])

  if (!mounted) {
    return null
  }

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return rows
        .filter((row) => {
          const status = row.invites?.[0]?.status || 'not invited'
          return status !== 'claimed'
        })
        .slice(0, 3)
    }

    return rows.filter((row) =>
      [row.display_name, row.email, row.phone || '', row.golf_member_name, row.golf_member_id].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    )
  }, [query, rows])

  return (
    <div className="space-y-4">
      <form className="flex gap-2" onSubmit={(event) => event.preventDefault()}>
        <Input
          placeholder="Search by member name, email, phone, or Golf Genius ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>

      <div className="space-y-3">
        {filteredRows.map((row) => {
          const invite = row.invites?.[0]
          const status = invite?.status || 'not invited'
          const inviteLink =
            generatedLinks[row.id] || (invite && origin ? `${origin}/signup?token=${invite.invite_token}` : null)

          return (
            <div key={row.id} className="rounded-xl border border-border bg-background/80 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{row.display_name}</p>
                    <Badge variant={status === 'claimed' ? 'default' : 'secondary'}>{status}</Badge>
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{row.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.golf_member_name} · {row.golf_member_id}
                  </p>
                  {row.phone ? <p className="text-sm text-muted-foreground">{row.phone}</p> : null}
                </div>

                <div className="flex flex-wrap gap-2 md:justify-end">
                  <Button
                    size="sm"
                    disabled={isPending && busyRow === row.id}
                    onClick={() => {
                      setBusyRow(row.id)
                      startTransition(async () => {
                        const token = await createInvite(row.id)
                        setGeneratedLinks((current) => ({
                          ...current,
                          [row.id]: `${window.location.origin}/signup?token=${token}`,
                        }))
                        router.refresh()
                      })
                    }}
                  >
                    {invite ? 'Regenerate' : 'Invite'}
                  </Button>

                  {invite ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending && busyRow === row.id}
                      onClick={() => {
                        setBusyRow(row.id)
                        startTransition(async () => {
                          await revokeInvite(invite.id)
                          router.refresh()
                        })
                      }}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </div>

              {inviteLink ? (
                <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm break-all">
                  {inviteLink}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
