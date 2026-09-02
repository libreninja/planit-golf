import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { getHarvestAccess } from '@/lib/seattle-cup/harvest/access'
import { HARVEST_CAMPAIGN_ID, canReviewHarvest } from '@/lib/seattle-cup/harvest/domain'
import { createClient } from '@/lib/supabase/server'

function csv(value: unknown): string {
  const text = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replaceAll('"', '""')}"`
}

export async function GET() {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const access = await getHarvestAccess(user)
  if (!canReviewHarvest(access)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const supabase = await createClient()
  const { data: reports, error } = await supabase
    .from('scouting_reports')
    .select('*')
    .eq('campaign_id', HARVEST_CAMPAIGN_ID)
    .order('contributed_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const header = ['id', 'reporter_user_id', 'reporter_player_ref', 'contributor_role', 'relationship_context', 'report_kind', 'subjects', 'context', 'questionnaire_key', 'questionnaire_version', 'questionnaire_snapshot', 'response_payload', 'visibility', 'provenance', 'contributed_at']
  const lines = [header.map(csv).join(','), ...(reports ?? []).map((report) => header.map((key) => csv(report[key])).join(','))]
  return new NextResponse(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="seattle-cup-2026-intel-harvest.csv"',
      'cache-control': 'private, no-store',
    },
  })
}
