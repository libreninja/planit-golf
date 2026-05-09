'use client'

import { useFormStatus } from 'react-dom'
import { RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function IgcSyncButton() {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" size="sm" disabled={pending} className="gap-2">
      <RefreshCw className={pending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
      {pending ? 'Syncing' : 'Sync from Golf Genius'}
    </Button>
  )
}
