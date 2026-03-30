'use client'

import { AdminSectionCard } from '@/components/admin-section-card'

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

interface UpcomingRunAdminProps {
  title?: string
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

export function UpcomingRunAdmin({ title = 'Next run', roundLabel, opensLabel, closesLabel, orderPolicy, orderSeed, taskCount, validationWarnings, rows, demandCounts }: UpcomingRunAdminProps) {
  return (
    <AdminSectionCard
      title={title}
      headerRight={typeof taskCount === 'number' ? `${taskCount} task${taskCount === 1 ? '' : 's'}` : undefined}
    >
        {roundLabel || opensLabel || closesLabel ? (
          <div className="mb-4 space-y-1 text-sm text-muted-foreground">
            {roundLabel ? <p><span className="font-medium text-foreground">Registering for:</span> {roundLabel}</p> : null}
            {opensLabel ? <p><span className="font-medium text-foreground">Opens:</span> {opensLabel}</p> : null}
            {closesLabel ? <p><span className="font-medium text-foreground">Closes:</span> {closesLabel}</p> : null}
            {typeof taskCount === 'number' ? <p><span className="font-medium text-foreground">Runner preview:</span> {taskCount} task{taskCount === 1 ? '' : 's'} via {orderPolicy || 'input'} order</p> : null}
          </div>
        ) : null}
        {validationWarnings?.length ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p className="font-medium">Validation warnings</p>
            <ul className="mt-1 list-disc pl-4">
              {validationWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted members with preferences yet.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Member name</th>
                <th className="px-3 py-2 font-medium">Pref 1</th>
                <th className="px-3 py-2 font-medium">Pref 2</th>
                <th className="px-3 py-2 font-medium">Pref 3</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.memberId} className="border-b border-border/70 last:border-b-0">
                  <td className="px-3 py-3 font-medium text-muted-foreground">{row.runOrder}</td>
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
    </AdminSectionCard>
  )
}
