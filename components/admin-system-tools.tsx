'use client'

import { useState, useTransition } from 'react'
import { syncRosterAndRefresh, testRosterConnection } from '@/app/admin-actions'
import { InviteAdmin } from '@/components/invite-admin'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

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

interface AdminSystemToolsProps {
  claimedInviteCount: number
  pendingInviteCount: number
  mensRosterCount: number
  womensRosterCount: number
}

export function AdminSystemTools({
  claimedInviteCount,
  pendingInviteCount,
  mensRosterCount,
  womensRosterCount,
}: AdminSystemToolsProps) {
  const [connectionStatus, setConnectionStatus] = useState('Not tested')
  const [inviteRows, setInviteRows] = useState<InviteRow[]>([])
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteRowsLoading, setInviteRowsLoading] = useState(false)
  const [inviteRowsError, setInviteRowsError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const loadInviteRows = async () => {
    setInviteRowsLoading(true)
    setInviteRowsError(null)

    try {
      const response = await fetch('/api/admin-invites', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(typeof payload?.error === 'string' ? payload.error : 'Unable to load invites')
      }

      setInviteRows(payload.inviteRows || [])
    } catch (error) {
      setInviteRowsError(error instanceof Error ? error.message : 'Unable to load invites')
    } finally {
      setInviteRowsLoading(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/70">
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_auto] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <div>Tool</div>
        <div>Status</div>
        <div>Action</div>
      </div>

      <div className="divide-y divide-border">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_auto] items-center gap-3 px-4 py-3">
          <div className="text-sm font-medium text-foreground">Invites</div>
          <div className="text-sm text-muted-foreground">
            {claimedInviteCount} active · {pendingInviteCount} pending
          </div>
          <div>
            <Dialog
              open={inviteDialogOpen}
              onOpenChange={(open) => {
                setInviteDialogOpen(open)
                if (open) {
                  void loadInviteRows()
                }
              }}
            >
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  Manage invites
                </Button>
              </DialogTrigger>
              <DialogContent className="flex h-[32rem] max-h-[85vh] max-w-4xl flex-col overflow-hidden p-0 [&>button]:text-primary-foreground [&>button]:opacity-100">
                <DialogHeader className="bg-primary px-6 py-5 text-left text-primary-foreground">
                  <DialogTitle className="text-primary-foreground">Manage invites</DialogTitle>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 px-6 py-6">
                  {inviteRowsLoading ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                      Loading invites...
                    </div>
                  ) : inviteRowsError ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-destructive">
                      {inviteRowsError}
                    </div>
                  ) : (
                    <InviteAdmin rows={inviteRows} />
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_auto] items-center gap-3 px-4 py-3">
          <div className="text-sm font-medium text-foreground">GG connection</div>
          <div className="text-sm text-muted-foreground">{connectionStatus}</div>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  try {
                    const result = await testRosterConnection()
                    setConnectionStatus(result.success ? 'OK' : 'Failed')
                  } catch {
                    setConnectionStatus('Failed')
                  }
                })
              }}
            >
              Test connection
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_auto] items-center gap-3 px-4 py-3">
          <div className="text-sm font-medium text-foreground">Roster</div>
          <div className="text-sm text-muted-foreground">
            {mensRosterCount} men · {womensRosterCount} women
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  await syncRosterAndRefresh()
                })
              }}
            >
              Sync roster
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
