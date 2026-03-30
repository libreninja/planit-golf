'use client'

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

export function LastRunAdmin({
  title,
  roundLabel,
  status,
  completedLabel,
  successCount,
  failureCount,
  rows,
}: LastRunSection) {
  return (
    <Card className="overflow-hidden border-white/70 bg-white/85 shadow-lg shadow-primary/10">
      <CardHeader className="bg-primary text-primary-foreground">
        <CardTitle className="text-lg text-primary-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="mb-4 space-y-1 text-sm text-muted-foreground">
          {roundLabel ? <p><span className="font-medium text-foreground">Round:</span> {roundLabel}</p> : null}
          <p><span className="font-medium text-foreground">Status:</span> {status}</p>
          {completedLabel ? <p><span className="font-medium text-foreground">Completed:</span> {completedLabel}</p> : null}
          <p><span className="font-medium text-foreground">Results:</span> {successCount} success · {failureCount} failed</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No player-level results recorded for this run yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Member name</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.runOrder}-${row.playerName}`} className="border-b border-border/70 last:border-b-0">
                  <td className="px-3 py-3 font-medium text-muted-foreground">{row.runOrder}</td>
                  <td className="px-3 py-3 font-medium">{row.playerName}</td>
                  <td className="px-3 py-3">{row.attemptedTimes.join(' -> ')}</td>
                  <td className="px-3 py-3">
                    {row.success ? `Registered${row.reservedTime ? ` for ${row.reservedTime}` : ''}` : row.error || 'Failed'}
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
