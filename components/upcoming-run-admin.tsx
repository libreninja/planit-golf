'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface RunRow {
  memberId: string
  displayName: string
  email: string
  golfMemberName: string
  golfMemberId: string
  inviteStatus: 'not invited' | 'pending' | 'claimed' | 'revoked'
  appStatus: 'not signed up' | 'ready' | 'missing preferences'
  preferences: string[]
}

interface UpcomingRunAdminProps {
  title?: string
  roundLabel?: string
  opensLabel?: string
  closesLabel?: string
  rows: RunRow[]
  demandCounts: Record<string, number>
}

export function UpcomingRunAdmin({ title = 'Next run', roundLabel, opensLabel, closesLabel, rows, demandCounts }: UpcomingRunAdminProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <Card className="overflow-hidden border-white/70 bg-white/85 shadow-lg shadow-primary/10">
      <CardHeader className="bg-primary text-primary-foreground">
        <CardTitle className="text-lg text-primary-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {roundLabel || opensLabel || closesLabel ? (
          <div className="mb-4 space-y-1 text-sm text-muted-foreground">
            {roundLabel ? <p><span className="font-medium text-foreground">Registering for:</span> {roundLabel}</p> : null}
            {opensLabel ? <p><span className="font-medium text-foreground">Opens:</span> {opensLabel}</p> : null}
            {closesLabel ? <p><span className="font-medium text-foreground">Closes:</span> {closesLabel}</p> : null}
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted members with preferences yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">Member name</th>
                <th className="px-3 py-2 font-medium">Pref 1</th>
                <th className="px-3 py-2 font-medium">Pref 2</th>
                <th className="px-3 py-2 font-medium">Pref 3</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.memberId} className="border-b border-border/70 last:border-b-0">
                  <td className="px-3 py-3 font-medium">{row.displayName}</td>
                  <td className="px-3 py-3">
                    {row.preferences[0] ? `${row.preferences[0]}${demandCounts[row.preferences[0]] ? ` · ${demandCounts[row.preferences[0]]}` : ''}` : ''}
                  </td>
                  <td className="px-3 py-3">
                    {row.preferences[1] ? `${row.preferences[1]}${demandCounts[row.preferences[1]] ? ` · ${demandCounts[row.preferences[1]]}` : ''}` : ''}
                  </td>
                  <td className="px-3 py-3">
                    {row.preferences[2] ? `${row.preferences[2]}${demandCounts[row.preferences[2]] ? ` · ${demandCounts[row.preferences[2]]}` : ''}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
