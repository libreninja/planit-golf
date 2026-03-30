'use client'

import { useEffect, useState } from 'react'
import { AdminSectionCard } from '@/components/admin-section-card'
import { LastRunAdmin } from '@/components/last-run-admin'

interface LastRunRow {
  playerName: string
  runOrder: number
  attemptedTimes: string[]
  reservedTime: string | null
  success: boolean
  error: string | null
}

interface LastRunSection {
  title: string
  roundLabel?: string
  status: string
  completedLabel?: string
  successCount: number
  failureCount: number
  rows: LastRunRow[]
}

export function LastRunSections() {
  const [sections, setSections] = useState<LastRunSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void fetch('/api/admin-last-runs', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load last run results')
        return response.json() as Promise<{ sections?: LastRunSection[] }>
      })
      .then((payload) => {
        if (!cancelled) setSections(payload.sections || [])
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Unable to load last run results')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <AdminSectionCard title="Last run results" contentClassName="text-sm text-muted-foreground">
        Fetching the latest run outcomes...
      </AdminSectionCard>
    )
  }

  if (error) {
    return (
      <AdminSectionCard title="Last run results" contentClassName="text-sm text-destructive">
        {error}
      </AdminSectionCard>
    )
  }

  if (sections.length === 0) {
    return (
      <AdminSectionCard title="Last run results" contentClassName="text-sm text-muted-foreground">
        No completed runs have been recorded yet.
      </AdminSectionCard>
    )
  }

  return (
    <>
      {sections.map((section) => (
        <LastRunAdmin key={section.title} {...section} />
      ))}
    </>
  )
}
