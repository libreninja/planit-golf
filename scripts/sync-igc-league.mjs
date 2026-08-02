#!/usr/bin/env node
// Thin CLI wrapper around the reusable reconciliation logic.
// Usage: node scripts/sync-igc-league.mjs [mens|womens]
import { reconcileCompetition } from '../lib/competition/reconcile/reconcile.ts'
const leagueKey = process.argv[2]
if (!leagueKey || !['mens', 'womens'].includes(leagueKey)) {
  console.error('Usage: node scripts/sync-igc-league.mjs [mens|womens]'); process.exit(1)
}
const competitionKey = leagueKey === 'mens' ? 'mens-league' : 'womens-league'
const summary = await reconcileCompetition({ competitionKey, deadlineMs: Date.now() + 5 * 60_000, nowIso: new Date().toISOString() })
console.log(`${competitionKey}:`, summary)
