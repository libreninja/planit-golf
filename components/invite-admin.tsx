'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createInvite, revokeInvite } from '@/app/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface InviteRow {
  id: string
  display_name: string | null
  email: string | null
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
  const [localRows, setLocalRows] = useState(rows)
  const [query, setQuery] = useState('')
  const [showInvitedMembers, setShowInvitedMembers] = useState(false)
  const [generatedLinks, setGeneratedLinks] = useState<Record<string, string>>({})
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  useEffect(() => {
    setLocalRows(rows)
  }, [rows])

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      const baseRows = localRows.filter((row) => {
        const status = row.invites?.[0]?.status || 'not invited'
        if (showInvitedMembers) return status !== 'not invited'
        return status !== 'claimed'
      })

      return showInvitedMembers ? baseRows : baseRows.slice(0, 3)
    }

    return localRows.filter((row) =>
      [row.display_name || '', row.email || '', row.phone || '', row.golf_member_name, row.golf_member_id].some((value) =>
        value.toLowerCase().includes(normalized),
      ),
    )
  }, [localRows, query, showInvitedMembers])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-1">
      <form className="flex gap-2 py-1" onSubmit={(event) => event.preventDefault()}>
        <Input
          placeholder="Search by member name, email, phone, or Golf Genius ID"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>

      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showInvitedMembers}
          onChange={(event) => setShowInvitedMembers(event.target.checked)}
          className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
        />
        <span>Show invited members</span>
      </label>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {filteredRows.map((row) => {
          const invite = row.invites?.[0]
          const status = invite?.status || 'not invited'
          const inviteLink = generatedLinks[row.id] || (invite ? `/signup?token=${invite.invite_token}` : null)

          return (
            <div key={row.id} className="rounded-xl border border-border bg-background/80 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{row.display_name || row.golf_member_name}</p>
                    <Badge variant={status === 'claimed' ? 'default' : 'secondary'}>{status}</Badge>
                  </div>
                  {row.email ? <p className="truncate text-sm text-muted-foreground">{row.email}</p> : null}
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
                        setLocalRows((current) =>
                          current.map((currentRow) =>
                            currentRow.id === row.id
                              ? {
                                  ...currentRow,
                                  invites: [
                                    {
                                      id: currentRow.invites?.[0]?.id || `pending-${row.id}`,
                                      status: 'pending',
                                      invite_token: token,
                                    },
                                  ],
                                }
                              : currentRow,
                          ),
                        )
                        setGeneratedLinks((current) => ({
                          ...current,
                          [row.id]: `/signup?token=${token}`,
                        }))
                        router.refresh()
                        setBusyRow(null)
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
                          setLocalRows((current) =>
                            current.map((currentRow) =>
                              currentRow.id === row.id
                                ? {
                                    ...currentRow,
                                    invites: [
                                      {
                                        ...invite,
                                        status: 'revoked',
                                      },
                                    ],
                                  }
                                : currentRow,
                            ),
                          )
                          setGeneratedLinks((current) => {
                            const next = { ...current }
                            delete next[row.id]
                            return next
                          })
                          router.refresh()
                          setBusyRow(null)
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
