import { describe, it, expect } from 'vitest'
import { migrateRosterPersist, scrubPlayer, ROSTER_PERSIST_VERSION } from '../rosterPersist'

// Synthetic fixture only; no real player data.
const legacyPlayer = {
  playerName: 'Test Player',
  normalizedName: 'test player',
  org: 'Test U',
  tier: 2,
  dob: '2000-01-01',
  age: 25,
  phone: '555-0100',
  email: 'test@example.invalid',
  father: 'Parent A',
  mother: 'Parent B',
}

describe('sv-travel-roster persist migration', () => {
  it('is at least v1 (v0 snapshots held contact data)', () => {
    expect(ROSTER_PERSIST_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('strips every contact key from a v0 snapshot', () => {
    const migrated = migrateRosterPersist(
      { players: [legacyPlayer], lastFetchedAt: 'x', visitOverrides: { a: 1 } },
      0,
    ) as { players: Record<string, unknown>[]; lastFetchedAt: string; visitOverrides: unknown }
    const p = migrated.players[0]!
    for (const k of ['dob', 'age', 'phone', 'email', 'father', 'mother']) {
      expect(p).not.toHaveProperty(k)
    }
    expect(p.playerName).toBe('Test Player')
    expect(p.tier).toBe(2)
    expect(migrated.lastFetchedAt).toBe('x')
    expect(migrated.visitOverrides).toEqual({ a: 1 })
  })

  it('tolerates empty or malformed snapshots', () => {
    expect(migrateRosterPersist(null, 0)).toBeNull()
    expect(migrateRosterPersist({ players: 'nope' }, 0)).toEqual({ players: [] })
    expect(migrateRosterPersist({ players: [null, legacyPlayer] }, 0)).toEqual({
      players: [scrubPlayer(legacyPlayer)],
    })
  })

  it('scrubPlayer does not mutate its input', () => {
    const copy = { ...legacyPlayer }
    scrubPlayer(copy)
    expect(copy.phone).toBe('555-0100')
  })
})
