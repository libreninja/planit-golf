'use client'

import { useEffect, useState } from 'react'
import { LastRunAdmin } from '@/components/last-run-admin'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
      <Card className="overflow-hidden border-white/70 bg-white/85 shadow-lg shadow-primary/10">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-lg text-primary-foreground">Loading last run results</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm text-muted-foreground">Fetching the latest run outcomes...</CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="overflow-hidden border-white/70 bg-white/85 shadow-lg shadow-primary/10">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-lg text-primary-foreground">Last run results</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
      </Card>
    )
  }

  if (sections.length === 0) {
    return (
      <Card className="overflow-hidden border-white/70 bg-white/85 shadow-lg shadow-primary/10">
        <CardHeader className="bg-primary text-primary-foreground">
          <CardTitle className="text-lg text-primary-foreground">Last run results</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 text-sm text-muted-foreground">No completed runs have been recorded yet.</CardContent>
      </Card>
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
