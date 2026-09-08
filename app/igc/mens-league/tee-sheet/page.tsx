import { redirect } from 'next/navigation'
import { mensLeagueTeeSheetCompatibilityHref } from '@/lib/igc/mens-league-navigation'

export const dynamic = 'force-dynamic'

export default async function MensLeagueTeeSheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(mensLeagueTeeSheetCompatibilityHref(await searchParams))
}
