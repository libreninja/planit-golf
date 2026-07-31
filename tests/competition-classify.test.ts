import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyEventFormat,
  nameKind,
  type DiscoveredTournament,
} from '../lib/competition/classify.ts'

function mkT(over: Partial<DiscoveredTournament> = {}): DiscoveredTournament {
  return {
    id: over.id ?? 't1',
    name: over.name ?? 'Gross Regular Season',
    metadataFormat: over.metadataFormat ?? null,
    nameKind: over.nameKind ?? 'individual',
  }
}

test('individual when ≥1 qualifying individual competition (metadata or gross/net name)', () => {
  const r = classifyEventFormat({ tournaments: [mkT()], teamOverride: false })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
})

test('Gross + Net + Closest to the Pin → individual (side game ignored, not team)', () => {
  const r = classifyEventFormat({
    tournaments: [
      mkT({ id: 'g1', name: 'Gross Regular Season', nameKind: 'individual' }),
      mkT({ id: 'n1', name: 'Net Regular Season', nameKind: 'individual' }),
      mkT({ id: 'kp1', name: 'Closest to the Pin', metadataFormat: 'side', nameKind: 'side' }),
    ],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'individual')
  assert.equal(r.discoveryState, 'discovered')
})

test('side game only → unknown/inconclusive, never team', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 'kp1', name: 'Closest to the Pin', metadataFormat: 'side', nameKind: 'side' })],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'unknown')
  assert.ok(r.discoveryState === 'pending' || r.discoveryState === 'inconclusive',
    'side-only must not be team')
})

test('explicit team tournament with no individual tournament → team', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 't1', metadataFormat: 'team', nameKind: 'team', name: 'Net Team Scramble' })],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('explicit team tournament + individual tournament → individual (metadata team does not override individual)', () => {
  const r = classifyEventFormat({
    tournaments: [
      mkT({ id: 'g1', name: 'Gross Regular Season', nameKind: 'individual' }),
      mkT({ id: 't1', metadataFormat: 'team', nameKind: 'team', name: 'Team Scramble' }),
    ],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'individual')
})

test('explicit team tournament + individual + occurrence-level override → team (override forces whole-occurrence team)', () => {
  const r = classifyEventFormat({
    tournaments: [
      mkT({ id: 'g1', name: 'Gross Regular Season', nameKind: 'individual' }),
      mkT({ id: 't1', metadataFormat: 'team', nameKind: 'team', name: 'Team Scramble' }),
    ],
    teamOverride: true,
  })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('team via explicit config override with no tournaments', () => {
  const r = classifyEventFormat({ tournaments: [], teamOverride: true })
  assert.equal(r.eventFormat, 'team')
  assert.equal(r.discoveryState, 'discovered')
})

test('a name that looks team-like but has NO positive metadata stays unknown (not team)', () => {
  const r = classifyEventFormat({
    tournaments: [mkT({ id: 't1', metadataFormat: null, nameKind: 'team', name: 'Some Team Thing' })],
    teamOverride: false,
  })
  assert.equal(r.eventFormat, 'unknown')
  assert.ok(r.discoveryState === 'pending' || r.discoveryState === 'inconclusive',
    'name-only team hint must not produce team')
})

test('empty tournament set (upcoming) → unknown/pending', () => {
  const r = classifyEventFormat({ tournaments: [], teamOverride: false })
  assert.equal(r.eventFormat, 'unknown')
  assert.equal(r.discoveryState, 'pending')
})

test('nameKind: gross/net/individual → individual hint; team/scramble → team hint; side games → side', () => {
  assert.equal(nameKind('Gross Regular Season'), 'individual')
  assert.equal(nameKind('Net Individual Play'), 'individual')
  assert.equal(nameKind('Team Scramble'), 'team')
  assert.equal(nameKind('Closest to the Pin'), 'side')
  assert.equal(nameKind('Mystery Round'), 'unknown')
})