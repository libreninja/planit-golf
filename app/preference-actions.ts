'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function saveDefaultPreferences(teeTimePreferences: string[]) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('default_preferences').upsert(
    {
      user_id: user.id,
      tee_time_preferences: teeTimePreferences,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )

  if (error) throw error
  revalidatePath('/')
}

export async function saveEventPreference(eventId: string, teeTimePreferences: string[]) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('event_preferences').upsert(
    {
      user_id: user.id,
      event_id: eventId,
      tee_time_preferences: teeTimePreferences,
      skip_registration: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,event_id' },
  )

  if (error) throw error
  revalidatePath('/')
}

export async function saveEventRegistrationOverride(eventId: string, teeTimePreferences: string[], skipRegistration: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase.from('event_preferences').upsert(
    {
      user_id: user.id,
      event_id: eventId,
      tee_time_preferences: teeTimePreferences,
      skip_registration: skipRegistration,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,event_id' },
  )

  if (error) throw error
  revalidatePath('/')
}

export async function deleteEventPreference(eventId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('event_preferences')
    .delete()
    .eq('user_id', user.id)
    .eq('event_id', eventId)

  if (error) throw error
  revalidatePath('/')
}

export async function saveRegistrationSettings(registrationsPaused: boolean, membershipRevoked: boolean) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('profiles')
    .update({
      registrations_paused: registrationsPaused || membershipRevoked,
      membership_revoked: membershipRevoked,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) throw error
  revalidatePath('/')
  revalidatePath('/admin')
}
