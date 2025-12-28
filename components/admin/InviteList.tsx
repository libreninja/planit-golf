'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Copy, Check } from 'lucide-react'

interface InviteListProps {
  tripId: string
}

export function InviteList({ tripId }: InviteListProps) {
  const [emails, setEmails] = useState('')
  const [loading, setLoading] = useState(false)
  const [existingInvites, setExistingInvites] = useState<any[]>([])
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)

  const loadInvites = async () => {
    try {
      const response = await fetch(`/api/invites?trip_id=${tripId}`)
      if (response.ok) {
        const data = await response.json()
        setExistingInvites(data || [])
      }
    } catch (error) {
      console.error('Failed to load invites', error)
    }
  }

  // Load invites on mount
  useEffect(() => {
    loadInvites()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  const handleSendInvites = async () => {
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch('/api/invites/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_id: tripId,
          emails: emails.split('\n').filter(e => e.trim()),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invites')
      }

      const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
      const emailConfigured = data.email_configured !== false
      
      setMessage({
        type: 'success',
        text: emailConfigured
          ? `Successfully sent ${data.sent} invite(s). ${data.failed || 0} failed.`
          : `Created ${data.sent} invite(s). Email not configured - use the invite links below to share manually.`,
      })
      setEmails('')
      loadInvites()
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Failed to send invites',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Send New Invites</CardTitle>
          <CardDescription>
            Enter email addresses (one per line)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="emails">Email Addresses</Label>
            <Textarea
              id="emails"
              placeholder="john@example.com&#10;jane@example.com"
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              rows={6}
            />
          </div>
          {message && (
            <div
              className={`p-3 rounded-md text-sm ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-800'
                  : 'bg-red-50 text-red-800'
              }`}
            >
              {message.text}
            </div>
          )}
          <Button onClick={handleSendInvites} disabled={loading || !emails.trim()}>
            {loading ? 'Sending...' : 'Send Invites'}
          </Button>
        </CardContent>
      </Card>

      {existingInvites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Existing Invites</CardTitle>
            <CardDescription>
              {typeof window !== 'undefined' && (
                <>Invite links: {window.location.origin}/invite/[token]</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invite Link</TableHead>
                  <TableHead>Invited</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {existingInvites.map((invite) => {
                  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
                  const inviteUrl = `${appUrl}/invite/${invite.invite_token}`
                  const isCopied = copiedToken === invite.invite_token
                  
                  return (
                    <TableRow key={invite.id}>
                      <TableCell>{invite.invited_email}</TableCell>
                      <TableCell>
                        <Badge variant={invite.status === 'accepted' ? 'default' : 'outline'}>
                          {invite.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-1 rounded max-w-[200px] truncate">
                            {inviteUrl}
                          </code>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              navigator.clipboard.writeText(inviteUrl)
                              setCopiedToken(invite.invite_token)
                              setTimeout(() => setCopiedToken(null), 2000)
                            }}
                          >
                            {isCopied ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        {new Date(invite.invited_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

