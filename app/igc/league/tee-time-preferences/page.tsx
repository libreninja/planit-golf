import { redirect } from 'next/navigation'

// Legacy /igc/league/tee-time-preferences. The Men's League tee-time
// preference workflow now lives at /igc/mens-league/tee-times (under Men's
// League, where it belongs). This route redirects so existing links and
// bookmarks — including the /good-to-go compat route — keep working. The
// destination preserves the full Good to Go data flow and invite-gated access.
export default async function LegacyTeeTimePreferencesPage() {
  redirect('/igc/mens-league/tee-times')
}