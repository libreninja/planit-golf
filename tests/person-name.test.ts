import { test } from 'node:test'
import assert from 'node:assert/strict'
import { displayPersonFirstName, displayPersonName } from '../lib/players/person-name.ts'

test('source Last, First displays as First Last without changing the source value', () => {
  const identity = {
    externalId: '2925267413723276873',
    displayNameSnapshot: 'Benner, Josh',
    provenance: { scope: 'igc-mens-2026', observed: 'Benner, Josh' },
  }
  const before = structuredClone(identity)

  assert.equal(displayPersonName(identity.displayNameSnapshot), 'Josh Benner')
  assert.deepEqual(identity, before)
})

test('natural First Last remains in natural order', () => {
  assert.equal(displayPersonName('Myles Philbin'), 'Myles Philbin')
})

test('middle initials and suffixes remain readable', () => {
  assert.equal(displayPersonName('McWalter, J Bryce'), 'J Bryce McWalter')
  assert.equal(displayPersonName('Smith, John A. Jr.'), 'John A. Smith Jr.')
  assert.equal(displayPersonName('Smith Jr., John A.'), 'John A. Smith Jr.')
})

test('structured source fields support compound names without parsing identity text', () => {
  assert.equal(displayPersonName({
    sourceName: 'De La Cruz, Ana Maria',
    firstName: 'Ana Maria',
    lastName: 'De La Cruz',
  }), 'Ana Maria De La Cruz')
  assert.equal(displayPersonName({
    sourceName: 'Smith, John A. Jr.',
    firstName: 'John A. Jr.',
    lastName: 'Smith',
  }), 'John A. Smith Jr.')
})

test('uncertain multi-comma and single-token names fail closed', () => {
  assert.equal(displayPersonName('Smith, John, Jr.'), 'Smith, John, Jr.')
  assert.equal(displayPersonName('Madonna'), 'Madonna')
  assert.equal(displayPersonFirstName('Smith, John A.'), 'John')
})

test('presentation formatting is only applied explicitly and does not rewrite stored rows', () => {
  const row = { player_name: 'Van hollebeke, Benjamin', member_card_id: '12980010990643996253' }
  assert.equal(displayPersonName(row.player_name), 'Benjamin Van hollebeke')
  assert.equal(row.player_name, 'Van hollebeke, Benjamin')
  assert.equal(row.member_card_id, '12980010990643996253')
})
