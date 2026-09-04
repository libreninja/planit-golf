import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { followPolicy } from '../lib/players/follow-policy.ts'

test('a resolved golfer can be followed without having a Planit account', () => {
  assert.deepEqual(followPolicy({ viewerId: 'viewer', golferResolved: true, selfLinked: false }), { allowed: true })
})

test('self-follow and unresolved follow are prevented', () => {
  assert.deepEqual(followPolicy({ viewerId: 'viewer', golferResolved: true, selfLinked: true }), { allowed: false, reason: 'self_follow' })
  assert.deepEqual(followPolicy({ viewerId: 'viewer', golferResolved: false, selfLinked: false }), { allowed: false, reason: 'unresolved_golfer' })
})

test('follow capture requires an authenticated viewer', () => {
  assert.deepEqual(followPolicy({ viewerId: null, golferResolved: true, selfLinked: false }), { allowed: false, reason: 'authentication_required' })
})

test('database policies keep follows private to the authenticated viewer', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260904000000_player_detail_v1.sql', import.meta.url), 'utf8')
  assert.match(sql, /Users view their own golfer follows[\s\S]*user_id = auth\.uid\(\)/)
  assert.match(sql, /Users follow as themselves[\s\S]*WITH CHECK \(user_id = auth\.uid\(\)\)/)
  assert.match(sql, /Users unfollow as themselves[\s\S]*USING \(user_id = auth\.uid\(\)\)/)
  assert.match(sql, /a golfer cannot follow themselves/)
  assert.match(sql, /unresolved golfer cannot be followed/)
})
