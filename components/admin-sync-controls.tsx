'use client'

import { useEffect, useState, useTransition } from 'react'
import { syncRosterAndRefresh, testRosterConnection } from '@/app/admin-actions'
import { Button } from '@/components/ui/button'

type StatusState =
  | { tone: 'neutral'; message: string }
  | { tone: 'success'; message: string }
  | { tone: 'error'; message: string }

export function AdminSyncControls() {
  const [status, setStatus] = useState<StatusState>({ tone: 'neutral', message: '' })
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!status.message) return
    const timeout = window.setTimeout(() => {
      setStatus({ tone: 'neutral', message: '' })
    }, 5000)

    return () => window.clearTimeout(timeout)
  }, [status])

  const statusClassName =
    status.tone === 'success'
      ? 'text-emerald-700'
      : status.tone === 'error'
        ? 'text-red-700'
        : 'text-muted-foreground'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="border-border bg-background text-foreground hover:bg-secondary hover:text-foreground"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            try {
              const result = await testRosterConnection()
              const preview = result.events?.map((event: { name: string }) => event.name).join(', ')
              setStatus({
                tone: 'success',
                message: `Connection OK. ${result.eventCount} matching events${preview ? `: ${preview}` : ''}`,
              })
            } catch (error) {
              setStatus({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Connection test failed',
              })
            }
          })
        }}
      >
        Test connection
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="border-border bg-background text-foreground hover:bg-secondary hover:text-foreground"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            try {
              const result = await syncRosterAndRefresh()
              setStatus({
                tone: 'success',
                message: `Roster synced. ${result.matchedMembers} active members updated.`,
              })
            } catch (error) {
              setStatus({
                tone: 'error',
                message: error instanceof Error ? error.message : 'Roster sync failed',
              })
            }
          })
        }}
      >
        Sync roster
      </Button>

      {status.message ? (
        <div className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-background px-4 py-3 text-sm shadow-xl ${statusClassName}`}>
          {status.message}
        </div>
      ) : null}
    </div>
  )
}
