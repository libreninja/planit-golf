import { NextResponse } from 'next/server'
import { getProfileRoles } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

function formatDateLabel(dateString: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateString}T00:00:00Z`))
}

async function requireAdminRequest() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const roles = await getProfileRoles(user.id)
  if (!roles.is_admin && !roles.is_system_admin) {
    return null
  }

  return user
}

export async function GET() {
  const user = await requireAdminRequest()
  if (!user) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  }

  const serviceClient = createServiceClient()
  const { data: runs } = await serviceClient
    .from('registration_runs')
    .select('league, event_date, status, success_count, failure_count, completed_at')
    .order('event_date', { ascending: false })

  const latestByLeague = new Map<string, NonNullable<typeof runs>[number]>()
  for (const run of runs || []) {
    if (!latestByLeague.has(run.league)) {
      latestByLeague.set(run.league, run)
    }
  }

  const sections = await Promise.all(
    Array.from(latestByLeague.entries()).map(async ([league, run]) => {
      const { data: results } = await serviceClient
        .from('registration_run_results')
        .select('player_name, run_order, attempted_times, reserved_time, success, error')
        .eq('league', league)
        .eq('event_date', run.event_date)
        .order('run_order', { ascending: true })

      return {
        title: league === 'mens' ? "Men's last run" : "Women's last run",
        roundLabel: formatDateLabel(run.event_date),
        status: run.status,
        completedLabel: run.completed_at
          ? new Intl.DateTimeFormat('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/Los_Angeles',
            }).format(new Date(run.completed_at))
          : undefined,
        successCount: run.success_count,
        failureCount: run.failure_count,
        rows: (results || []).map((row) => ({
          playerName: row.player_name,
          runOrder: row.run_order,
          attemptedTimes: row.attempted_times || [],
          reservedTime: row.reserved_time,
          success: row.success,
          error: row.error,
        })),
      }
    }),
  )

  return NextResponse.json({ sections })
}
