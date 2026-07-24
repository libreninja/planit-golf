import { PreferenceForm } from '@/components/preference-form'
import { loadHomePageData } from '@/lib/home-page-data'

// Good to Go — the Interbay League tee-time preference workflow — re-homed
// here from `/` when the homepage became the event-centric landing page. The
// data flow and invite-gated access are unchanged: loadHomePageData still
// resolves the profile, invite link, member league, and upcoming events, and
// still redirects to /login, /invite/[token], or /stay-tuned exactly as it did
// at `/` on main. Existing users see the same form. See the production rollout
// plan (Phase 1) and docs/planit-golf-integration-discovery.md.
export default async function TeeTimePreferencesPage() {
  const { user, profile, events, defaultPrefs, eventPrefs } = await loadHomePageData()

  return (
    <PreferenceForm
      user={user}
      profile={profile}
      events={events}
      defaultPrefs={defaultPrefs}
      eventPrefs={eventPrefs}
      eventDemandCounts={{}}
      embedded
    />
  )
}