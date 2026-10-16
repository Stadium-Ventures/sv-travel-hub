import { describe, it, expect } from 'vitest'
import { parseSummerPlacementRows } from '../../data/summerLeagues'
import { migrateSummerPersist, SUMMER_PERSIST_VERSION } from '../summerPersist'

// Synthetic rows only; the contact value is a placeholder, not real data.
describe('Summer Placement Contact column', () => {
  it('is not read from the sheet', () => {
    const { placements } = parseSummerPlacementRows([
      ['Test Player', 'Test U', 'Test Team', 'CCBL', 'Confirmed', '555-0100 test@example.invalid'],
    ])
    expect(placements).toHaveLength(1)
    expect(placements[0]).not.toHaveProperty('contact')
    expect(JSON.stringify(placements)).not.toMatch(/555-0100|example\.invalid/)
  })

  it('is wiped from snapshots older builds persisted', () => {
    expect(SUMMER_PERSIST_VERSION).toBeGreaterThanOrEqual(2)
    const old = {
      assignments: [{ playerName: 'Test Player', summerTeam: 'Test Team', contact: '555-0100' }],
      byPlayer: { 'Test Player': { playerName: 'Test Player', summerTeam: 'Test Team', contact: '555-0100' } },
      fetchedAt: 'x',
      warnings: [],
    }
    const migrated = migrateSummerPersist(old, 1) as typeof old
    expect(JSON.stringify(migrated)).not.toMatch(/contact|555-0100/)
    expect(migrated.assignments[0]!.summerTeam).toBe('Test Team')
    expect(migrated.byPlayer['Test Player']!.summerTeam).toBe('Test Team')
    expect(migrated.fetchedAt).toBe('x')
  })

  it('tolerates empty or malformed snapshots', () => {
    expect(migrateSummerPersist(null, 1)).toBeNull()
    expect(migrateSummerPersist({ assignments: 'nope' }, 1)).toEqual({ assignments: 'nope' })
  })
})
