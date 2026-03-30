'use client'

import { useEffect, useState } from 'react'
import { AdminSectionCard } from '@/components/admin-section-card'
import { LastRunSections } from '@/components/last-run-sections'
import { UpcomingRunAdmin } from '@/components/upcoming-run-admin'

interface RunRow {
  memberId: string
  displayName: string
  email: string
  golfMemberName: string
  golfMemberId: string
  runOrder: number
  inviteStatus: 'not invited' | 'pending' | 'claimed' | 'revoked'
  appStatus: 'not signed up' | 'ready' | 'missing preferences'
  preferences: string[]
}

interface RunSection {
  title: string
  roundLabel?: string
  opensLabel?: string
  closesLabel?: string
  orderPolicy?: string
  orderSeed?: string
  taskCount?: number
  validationWarnings?: string[]
  rows: RunRow[]
  demandCounts: Record<string, number>
}

function LoadingCard() {
  return (
    <AdminSectionCard title="Next registration runs" contentClassName="text-sm text-muted-foreground">
      Fetching the latest run data...
    </AdminSectionCard>
  )
}

export function AdminRunSections() {
  const [sections, setSections] = useState<RunSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void fetch('/api/admin-next-runs', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load next registration runs')
        return response.json() as Promise<{ sections?: RunSection[] }>
      })
      .then((payload) => {
        if (!cancelled) {
          setSections(payload.sections || [])
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : 'Unable to load next registration runs')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return <LoadingCard />
  }

  if (error) {
    return (
      <AdminSectionCard title="Next registration runs" contentClassName="text-sm text-destructive">
        {error}
      </AdminSectionCard>
    )
  }

  return (
    <>
      {sections.map((section) => (
        <UpcomingRunAdmin
          key={section.title}
          title={section.title}
          roundLabel={section.roundLabel}
          opensLabel={section.opensLabel}
          closesLabel={section.closesLabel}
          orderPolicy={section.orderPolicy}
          orderSeed={section.orderSeed}
          taskCount={section.taskCount}
          validationWarnings={section.validationWarnings}
          rows={section.rows}
          demandCounts={section.demandCounts}
        />
      ))}
      <LastRunSections />
    </>
  )
}
