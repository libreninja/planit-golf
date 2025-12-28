import { z } from 'zod'

export const tripSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  slug: z.string().min(1, 'Slug is required'),
  location_name: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  itinerary: z.array(z.object({
    day: z.string(),
    title: z.string(),
    details: z.string().optional(),
  })).nullable().optional(),
  deposit_amount_cents: z.number().int().min(0),
  deposit_due_date: z.string().nullable().optional(),
  venmo_handle: z.string().nullable().optional(),
  venmo_qr_url: z.string().url().nullable().optional().or(z.literal('')),
  zelle_recipient: z.string().nullable().optional(),
  required_memo_template: z.string().nullable().optional(),
})

export type TripFormData = z.infer<typeof tripSchema>

