'use client'

import { useState, useEffect } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface RosterTableProps {
  tripId: string
}

export function RosterTable({ tripId }: RosterTableProps) {
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const loadRoster = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/roster?trip_id=${tripId}`)
      if (response.ok) {
        const data = await response.json()
        setMembers(data || [])
      }
    } catch (error) {
      console.error('Failed to load roster', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRoster()
  }, [tripId])

  const handleVerifyPayment = async (paymentId: string) => {
    try {
      const response = await fetch('/api/admin/payments/verify', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: paymentId }),
      })

      if (response.ok) {
        loadRoster()
      }
    } catch (error) {
      console.error('Failed to verify payment', error)
    }
  }

  const filteredMembers = members.filter((member) => {
    if (filter === 'all') return true
    if (filter === 'needs_rsvp') return !member.rsvp_status
    if (filter === 'needs_deposit') return !member.payment_status || member.payment_status === 'not_reported'
    if (filter === 'needs_verification') return member.payment_status === 'reported'
    return true
  })

  const formatCurrency = (cents: number | null) => {
    if (!cents) return '-'
    return `$${(cents / 100).toFixed(2)}`
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Members</SelectItem>
            <SelectItem value="needs_rsvp">Needs RSVP</SelectItem>
            <SelectItem value="needs_deposit">Needs Deposit</SelectItem>
            <SelectItem value="needs_verification">Needs Verification</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>RSVP</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredMembers.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No members found
              </TableCell>
            </TableRow>
          ) : (
            filteredMembers.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  {member.user_email || member.invited_email}
                </TableCell>
                <TableCell>{member.invited_email}</TableCell>
                <TableCell>
                  <Badge variant={member.rsvp_status === 'yes' ? 'default' : 'outline'}>
                    {member.rsvp_status || 'Not RSVPed'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {member.payment_status === 'verified' ? (
                    <Badge variant="default">Verified</Badge>
                  ) : member.payment_status === 'reported' ? (
                    <Badge variant="secondary">Reported</Badge>
                  ) : (
                    <Badge variant="outline">Not reported</Badge>
                  )}
                  {member.payment_amount && (
                    <span className="ml-2 text-sm text-muted-foreground">
                      {formatCurrency(member.payment_amount)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {member.payment_id && member.payment_status === 'reported' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleVerifyPayment(member.payment_id)}
                    >
                      Verify Payment
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

