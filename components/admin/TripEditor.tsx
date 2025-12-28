'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { tripSchema, type TripFormData } from '@/lib/validations/trip'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Plus, Trash2 } from 'lucide-react'

interface TripEditorProps {
  trip?: {
    id: string
    title: string
    slug: string
    location_name: string | null
    start_date: string | null
    end_date: string | null
    overview: string | null
    itinerary: any
    deposit_amount_cents: number
    deposit_due_date: string | null
    venmo_handle: string | null
    venmo_qr_url: string | null
    zelle_recipient: string | null
    required_memo_template: string | null
  } | null
}

export function TripEditor({ trip }: TripEditorProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const form = useForm<TripFormData>({
    resolver: zodResolver(tripSchema),
    defaultValues: {
      title: trip?.title || '',
      slug: trip?.slug || '',
      location_name: trip?.location_name || null,
      start_date: trip?.start_date || null,
      end_date: trip?.end_date || null,
      overview: trip?.overview || null,
      itinerary: trip?.itinerary || [],
      deposit_amount_cents: trip?.deposit_amount_cents || 0,
      deposit_due_date: trip?.deposit_due_date || null,
      venmo_handle: trip?.venmo_handle || null,
      venmo_qr_url: trip?.venmo_qr_url || null,
      zelle_recipient: trip?.zelle_recipient || null,
      required_memo_template: trip?.required_memo_template || null,
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'itinerary',
  })

  const generateSlug = (title: string) => {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  const onSubmit = async (data: TripFormData) => {
    setLoading(true)
    try {
      const url = trip
        ? `/api/admin/trips?id=${trip.id}`
        : '/api/admin/trips'
      const method = trip ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error('Failed to save trip')
      }

      const result = await response.json()
      router.push(`/admin/trips/${result.id || trip?.id}`)
      router.refresh()
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title *</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  onChange={(e) => {
                    field.onChange(e)
                    if (!trip) {
                      form.setValue('slug', generateSlug(e.target.value))
                    }
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Slug *</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>
                URL-friendly identifier (e.g., bandon-crossings-2026)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="location_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Location</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="deposit_amount_cents"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deposit Amount (cents)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                  />
                </FormControl>
                <FormDescription>
                  Amount in cents (e.g., 50000 = $500.00)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="start_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    value={field.value || ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="end_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    value={field.value || ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="deposit_due_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Deposit Due Date</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    value={field.value || ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="overview"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Overview</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value || ''}
                  rows={6}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div>
          <div className="flex justify-between items-center mb-4">
            <FormLabel>Itinerary</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ day: '', title: '', details: '' })}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Day
            </Button>
          </div>
          {fields.map((field, index) => (
            <div key={field.id} className="border p-4 rounded mb-4 space-y-4">
              <div className="flex justify-between items-start">
                <h4 className="font-medium">Day {index + 1}</h4>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name={`itinerary.${index}.day`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Day</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Friday" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`itinerary.${index}.title`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Main round" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`itinerary.${index}.details`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Details</FormLabel>
                      <FormControl>
                        <Textarea {...field} value={field.value || ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="venmo_handle"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Venmo Handle</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} placeholder="@username" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="venmo_qr_url"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Venmo QR Code URL</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} placeholder="https://..." />
                </FormControl>
                <FormDescription>
                  Public URL to Venmo QR code image
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="zelle_recipient"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Zelle Recipient</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} placeholder="email@example.com" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="required_memo_template"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Payment Memo Template</FormLabel>
                <FormControl>
                  <Input {...field} value={field.value || ''} placeholder="BC26 Deposit - {LastName}" />
                </FormControl>
                <FormDescription>
                  Template for payment memo/note
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : trip ? 'Update Trip' : 'Create Trip'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

