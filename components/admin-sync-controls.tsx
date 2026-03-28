'use client'

import { useState, useTransition } from 'react'
import { syncRosterAndRefresh, testRosterConnection } from '@/app/admin-actions'
import { Button } from '@/components/ui/button'

type StatusState =
  | { tone: 'neutral'; message: string }
  | { tone: 'success'; message: string }
  | { tone: 'error'; message: string }

export function AdminSyncControls() {
  const [status, setStatus] = useState<StatusState>({ tone: 'neutral', message: '' })
  const [isPending, startTransition] = useTransition()

  const statusClassName =
    status.tone === 'success'
      ? 'text-emerald-200'
      : status.tone === 'error'
        ? 'text-red-200'
        : 'text-background/70'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="border-white/30 bg-transparent text-background hover:bg-white/10 hover:text-background"
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
        className="border-white/30 bg-transparent text-background hover:bg-white/10 hover:text-background"
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
        <p className={`text-xs sm:max-w-md ${statusClassName}`}>{status.message}</p>
      ) : null}
    </div>
  )
}
