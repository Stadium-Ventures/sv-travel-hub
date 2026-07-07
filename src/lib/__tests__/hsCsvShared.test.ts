import { describe, it, expect } from 'vitest'
import { parseDate, isUsDst, parseGameTime, resolveHeaders } from '../hsCsvShared'

describe('parseDate', () => {
  it('parses 2-digit years', () => {
    expect(parseDate('3/3/26')).toBe('2026-03-03')
  })

  it('parses 4-digit years', () => {
    expect(parseDate('3/3/2026')).toBe('2026-03-03')
  })

  it('rejects garbage', () => {
    expect(parseDate('garbage')).toBe('')
    expect(parseDate('3/3')).toBe('')
    expect(parseDate('13/40/26')).toBe('')
    expect(parseDate('3/3/026')).toBe('')
  })
})

describe('isUsDst — window computed per-year', () => {
  it('2027: second Sunday of March is the 14th', () => {
    expect(isUsDst(2027, 3, 13)).toBe(false)
    expect(isUsDst(2027, 3, 14)).toBe(true)
  })

  it('2026: second Sunday of March is the 8th', () => {
    expect(isUsDst(2026, 3, 7)).toBe(false)
    expect(isUsDst(2026, 3, 8)).toBe(true)
  })

  it('same March date flips DST between years via parseGameTime', () => {
    // 2026-03-10 is after the 2026 switch (Mar 8) → EDT, UTC+(-4) → 18:30 + 4
    expect(parseGameTime('2026-03-10', '6:30 PM', 'Orlando, FL')).toBe('2026-03-10T22:30:00+00:00')
    // 2027-03-10 is before the 2027 switch (Mar 14) → EST → 18:30 + 5
    expect(parseGameTime('2027-03-10', '6:30 PM', 'Orlando, FL')).toBe('2027-03-10T23:30:00+00:00')
  })
})

describe('Central-city override', () => {
  it('treats Santa Rosa Beach (FL panhandle) as Central', () => {
    // April → DST. Central DST = UTC-5, Eastern DST = UTC-4.
    expect(parseGameTime('2026-04-07', '6:30 PM', 'Santa Rosa Beach, FL')).toBe('2026-04-07T23:30:00+00:00')
    expect(parseGameTime('2026-04-07', '6:30 PM', 'Miami, FL')).toBe('2026-04-07T22:30:00+00:00')
  })
})

describe('resolveHeaders', () => {
  it('resolves aliases case/whitespace-insensitively', () => {
    const { columns, missing } = resolveHeaders([
      'School', ' LEVEL ', 'Game Date', 'Time (local)', 'Venue', 'Opp', 'City',
    ])
    expect(columns['Team']).toBe('School')
    expect(columns['Level']).toBe(' LEVEL ')
    expect(columns['Date']).toBe('Game Date')
    expect(columns['Time (Local time)']).toBe('Time (local)')
    expect(columns['Ballpark']).toBe('Venue')
    expect(columns['Opponent']).toBe('Opp')
    expect(columns['Location']).toBe('City')
    expect(missing).toEqual([])
  })

  it('reports unresolvable logical columns', () => {
    const { columns, missing } = resolveHeaders(['Level', 'Date'])
    expect(missing).toContain('Team')
    expect(columns['Level']).toBe('Level')
  })
})

describe('isHomeGame ballpark aliases', () => {
  it('matches aliases containing periods (Robert C. Wynn for SCF)', async () => {
    const { isHomeGame, CSV_TEAM_INFO } = await import('../hsCsvShared')
    const scf = CSV_TEAM_INFO['SCF']!
    expect(isHomeGame('SCF', 'SCF', 'Robert C. Wynn Field', 'Polk State', 'Bradenton FL', scf)).toBe(true)
    expect(isHomeGame('SCF', 'SCF', 'Robert Wynn', 'Polk State', 'Bradenton FL', scf)).toBe(false)
  })
})
