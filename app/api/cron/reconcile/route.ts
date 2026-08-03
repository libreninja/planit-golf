import { NextResponse } from 'next/server'

import { reconcileAllCompetitions } from '@/lib/competition/reconcile/reconcile'
import { cleanExpiredCache } from '@/lib/competition/cache'

export const dynamic = 'force-dynamic'
// maxDuration is NOT assumed from a default; the deployment plan must verify
// the actual Vercel function timeout for this route and the soft deadline in
// reconcile.ts stays well below it. See design spec §7 (revision 9).

// One shared absolute deadline for the whole run. The hourly cron leaves
// reserve time below this for serialization + cache cleanup.
const CRON_DEADLINE_MS = 90_000

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const deadlineMs = Date.now() + CRON_DEADLINE_MS
  const summaries = await reconcileAllCompetitions({ deadlineMs, nowIso: new Date().toISOString() })
  await cleanExpiredCache().catch(() => {})
  console.log('[cron/reconcile]', JSON.stringify(summaries))
  return NextResponse.json({ ok: true, summaries })
}
