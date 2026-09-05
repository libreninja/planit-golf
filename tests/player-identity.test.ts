import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveScopedIdentities } from '../lib/players/identity.ts'

test('canonical golfer resolution never merges two cards by display name alone', () => {
  const resolved = resolveScopedIdentities([
    { externalId: 'card-a', displayName: 'Same, Name' },
    { externalId: 'card-b', displayName: 'Same, Name' },
  ])
  assert.equal(resolved.length, 2)
  assert.deepEqual(resolved.map((item) => item.externalId).sort(), ['card-a', 'card-b'])
  assert.ok(resolved.every((item) => item.status === 'resolved'))
})

test('ambiguous and generic scoped cards remain unresolved', () => {
  const resolved = resolveScopedIdentities([
    { externalId: 'shared', displayName: 'Myles Philbin' },
    { externalId: 'shared', displayName: 'Pat Philbin' },
    { externalId: 'guest', displayName: 'Guest Player 2' },
  ])
  assert.deepEqual(resolved.find((item) => item.externalId === 'shared'), {
    externalId: 'shared',
    displayName: 'Pat Philbin',
    status: 'unresolved',
    reason: 'ambiguous_display_names',
  })
  assert.equal(resolved.find((item) => item.externalId === 'guest')?.reason, 'generic_guest_slot')
})

test('missing external identity evidence never creates a canonical resolution', () => {
  assert.deepEqual(resolveScopedIdentities([{ externalId: null, displayName: 'Name Only' }]), [])
})
