import type { Metadata } from 'next'
import { ParticipantCard } from './participant-card'

export const metadata: Metadata = {
  title: 'Wine Valley · Scorecard', description: 'Your Wine Valley group scorecard.',
  robots: { index: false, follow: false }, referrer: 'no-referrer',
}

export default function ScorecardPage() { return <ParticipantCard /> }
