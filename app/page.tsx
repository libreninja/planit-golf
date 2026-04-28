import { PreferenceForm } from "@/components/preference-form"
import { loadHomePageData } from "@/lib/home-page-data"

export default async function Home() {
  const { user, profile, events, defaultPrefs, eventPrefs } = await loadHomePageData()

  return (
    <PreferenceForm
      user={user}
      profile={profile}
      events={events}
      defaultPrefs={defaultPrefs}
      eventPrefs={eventPrefs}
      eventDemandCounts={{}}
    />
  )
}
