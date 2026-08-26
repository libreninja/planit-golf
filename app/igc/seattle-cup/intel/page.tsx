import { requireScoutingAccess } from '@/lib/scouting-access'
import intelData from '@/data/seattle-cup-intel.json'
import { IntelCheatSheet, type IntelJson } from './intel-cheat-sheet'

// Opposition intelligence cheat sheet for the 2026 Seattle Cup picks call.
// Auth: the SAME gate as the scouting board — `requireScoutingAccess()` (an
// active `seattle_cup_scouting` feature entitlement on the IGC club). Anonymous
// users are redirected to /login by requireAuth; authenticated-but-unentitled
// users redirect to /. No second auth system, no public URL.
//
// Data: a deterministic JSON artifact generated in planit-ai (src/cup/publish.ts)
// from the GG fixtures + locked 2026 roster, committed at
// data/seattle-cup-intel.json. The browser receives ALREADY-DERIVED facts — no
// historical calculation runs client-side.
export const dynamic = 'force-dynamic'

export default async function IntelPage() {
  // Access gate FIRST — identical to /igc/seattle-cup/scouting.
  await requireScoutingAccess()
  return <IntelCheatSheet intel={intelData as IntelJson} />
}