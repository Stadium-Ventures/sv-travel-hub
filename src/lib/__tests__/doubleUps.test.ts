import { describe, it, expect } from 'vitest'
import { findDoubleUps, findClosestApproach } from '../doubleUps'
import type { GameEvent } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'

function player(name: string, org: string, overrides: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    playerName: name,
    org,
    level: 'Pro',
    isJuco: false,
    tier: 2,
    leadAgent: 'Kent',
    state: 'IL',
    status: '',
    visitsRemaining: 3,
    ...overrides,
  } as RosterPlayer
}

const BELOIT = { lat: 42.4914, lng: -89.0343 } // ABC Supply Stadium
const PEORIA = { lat: 40.6748, lng: -89.5921 } // Dozer Park (~90 min away)

function game(overrides: Partial<GameEvent> & { id: string; date: string }): GameEvent {
  return {
    dayOfWeek: 2,
    time: overrides.date + 'T18:00:00Z',
    homeTeam: 'Beloit Sky Carp',
    awayTeam: 'Peoria Chiefs',
    isHome: true,
    venue: { name: 'ABC Supply Stadium', coords: BELOIT },
    source: 'mlb-api',
    playerNames: [],
    ...overrides,
  } as GameEvent
}

describe('findDoubleUps — same-venue matchups', () => {
  it('detects two Pro clients on opposing teams via playerSides (merged event)', () => {
    const players = [player('Carter', 'Marlins'), player('Kolhosser', 'Cardinals')]
    const g = game({
      id: 'mlb-1',
      date: '2026-07-22',
      playerNames: ['Carter', 'Kolhosser'],
      playerSides: { Carter: 'home', Kolhosser: 'away' },
    })
    const result = findDoubleUps([g], players, '2026-07-20', '2026-07-30')
    expect(result).toHaveLength(1)
    expect(result[0]!.type).toBe('same-venue-matchup')
    expect(result[0]!.playerNames.sort()).toEqual(['Carter', 'Kolhosser'])
  })

  it('detects NCAA clients at two schools via mirrored events', () => {
    const players = [
      player('Smith', 'Florida State', { level: 'NCAA' }),
      player('Jones', 'Miami', { level: 'NCAA' }),
    ]
    const venue = { name: 'Dick Howser Stadium', coords: { lat: 30.4419, lng: -84.3037 } }
    const fromFsu = game({
      id: 'ncaa-d1-florida-state-2026-04-10-miami',
      date: '2026-04-10',
      homeTeam: 'Florida State', awayTeam: 'Miami', isHome: true,
      venue, source: 'ncaa-lookup', playerNames: ['Smith'],
    })
    const fromMiami = game({
      id: 'ncaa-d1-miami-2026-04-10-florida-st.',
      date: '2026-04-10',
      homeTeam: 'Florida St.', awayTeam: 'Miami', isHome: false,
      venue, source: 'ncaa-lookup', playerNames: ['Jones'],
    })
    const result = findDoubleUps([fromFsu, fromMiami], players, '2026-04-01', '2026-04-30')
    const matchups = result.filter((r) => r.type === 'same-venue-matchup')
    expect(matchups).toHaveLength(1)
    expect(matchups[0]!.playerNames.sort()).toEqual(['Jones', 'Smith'])
  })

  it('does NOT flag two clients on the SAME team as a matchup', () => {
    const players = [player('A', 'Marlins'), player('B', 'Marlins')]
    const g = game({
      id: 'mlb-2', date: '2026-07-22',
      playerNames: ['A', 'B'],
      playerSides: { A: 'home', B: 'home' },
    })
    const result = findDoubleUps([g], players, '2026-07-20', '2026-07-30')
    expect(result.filter((r) => r.type === 'same-venue-matchup')).toHaveLength(0)
  })
})

describe('findDoubleUps — series collapsing', () => {
  it('collapses a 6-game series into one entry with all dates', () => {
    const players = [player('Carter', 'Marlins'), player('Kolhosser', 'Cardinals')]
    const games = ['22', '23', '24', '25', '26', '27'].map((d, i) =>
      game({
        id: `mlb-${i + 10}`,
        date: `2026-07-${d}`,
        playerNames: ['Carter', 'Kolhosser'],
        playerSides: { Carter: 'home', Kolhosser: 'away' },
      }),
    )
    const result = findDoubleUps(games, players, '2026-07-20', '2026-07-30')
    expect(result).toHaveLength(1)
    expect(result[0]!.dates).toHaveLength(6)
    expect(result[0]!.date).toBe('2026-07-22')
  })

  it('keeps separate series apart when more than 2 days apart', () => {
    const players = [player('Carter', 'Marlins'), player('Kolhosser', 'Cardinals')]
    const games = ['2026-07-01', '2026-07-20'].map((date, i) =>
      game({
        id: `mlb-${i + 20}`, date,
        playerNames: ['Carter', 'Kolhosser'],
        playerSides: { Carter: 'home', Kolhosser: 'away' },
      }),
    )
    const result = findDoubleUps(games, players, '2026-06-25', '2026-07-30')
    expect(result).toHaveLength(2)
  })
})

describe('findDoubleUps — nearby venues', () => {
  it('skips pairs where both games have the identical eligible player set', () => {
    const players = [player('A', 'Marlins')]
    const g1 = game({ id: 'x1', date: '2026-07-22', playerNames: ['A'], playerSides: { A: 'home' } })
    const g2 = game({
      id: 'x2', date: '2026-07-22', playerNames: ['A'], playerSides: { A: 'away' },
      homeTeam: 'Other', awayTeam: 'Team',
      venue: { name: 'Nearby Field', coords: { lat: 42.50, lng: -89.05 } },
    })
    const result = findDoubleUps([g1, g2], players, '2026-07-20', '2026-07-30')
    expect(result.filter((r) => r.type === 'nearby-venues')).toHaveLength(0)
  })

  it('does not pair venues beyond a 90-minute drive (Beloit↔Peoria ~2.5h)', () => {
    const players = [player('A', 'Marlins'), player('B', 'Cardinals')]
    const g1 = game({ id: 'y1', date: '2026-07-22', playerNames: ['A'], playerSides: { A: 'home' } })
    const g2 = game({
      id: 'y2', date: '2026-07-22', playerNames: ['B'], playerSides: { B: 'home' },
      homeTeam: 'Peoria Chiefs', awayTeam: 'Someone Else',
      venue: { name: 'Dozer Park', coords: PEORIA },
    })
    const result = findDoubleUps([g1, g2], players, '2026-07-20', '2026-07-30')
    expect(result.filter((r) => r.type === 'nearby-venues')).toHaveLength(0)
  })

  it('includes pairs in Kent\'s yellow band (46-90 min drive)', () => {
    const players = [player('A', 'Marlins'), player('B', 'Cardinals')]
    const g1 = game({ id: 'z1', date: '2026-07-22', playerNames: ['A'], playerSides: { A: 'home' } })
    const g2 = game({
      id: 'z2', date: '2026-07-22', playerNames: ['B'], playerSides: { B: 'home' },
      homeTeam: 'Other Team', awayTeam: 'Visitors',
      // ~100km south of Beloit → ~75 min estimated drive
      venue: { name: 'Yellow Band Park', coords: { lat: 41.59, lng: -89.03 } },
    })
    const result = findDoubleUps([g1, g2], players, '2026-07-20', '2026-07-30')
    const nearby = result.filter((r) => r.type === 'nearby-venues')
    expect(nearby).toHaveLength(1)
    expect(nearby[0]!.driveMinutesBetween).toBeGreaterThan(45)
    expect(nearby[0]!.driveMinutesBetween).toBeLessThanOrEqual(90)
  })
})

describe('findClosestApproach', () => {
  it('returns the minimum drive between two players\' same/adjacent-day games', () => {
    const g1 = game({ id: 'c1', date: '2026-07-22', playerNames: ['A'] })
    const far = game({
      id: 'c2', date: '2026-07-22', playerNames: ['B'],
      homeTeam: 'Peoria Chiefs', awayTeam: 'X',
      venue: { name: 'Dozer Park', coords: PEORIA },
    })
    const result = findClosestApproach([g1, far], 'A', 'B', '2026-07-20', '2026-07-30')
    expect(result).not.toBeNull()
    expect(result!.driveMinutes).toBeGreaterThan(90) // Beloit↔Peoria ~2.5h
    expect(result!.venueA).toBe('ABC Supply Stadium')
    expect(result!.venueB).toBe('Dozer Park')
  })

  it('returns null when the players are never within a day of each other', () => {
    const g1 = game({ id: 'c3', date: '2026-07-22', playerNames: ['A'] })
    const g2 = game({ id: 'c4', date: '2026-07-28', playerNames: ['B'], venue: { name: 'Dozer Park', coords: PEORIA } })
    expect(findClosestApproach([g1, g2], 'A', 'B', '2026-07-20', '2026-07-30')).toBeNull()
  })
})

describe('findDoubleUps — stay-over doubles', () => {
  const NEARBY = { lat: 41.95, lng: -89.03 } // ~60km / ~45min from Beloit

  it('flags games on back-to-back days within a short drive', () => {
    const players = [player('A', 'Marlins'), player('B', 'Cardinals')]
    const g1 = game({ id: 's1', date: '2026-07-22', playerNames: ['A'], playerSides: { A: 'home' } })
    const g2 = game({
      id: 's2', date: '2026-07-23', playerNames: ['B'], playerSides: { B: 'home' },
      homeTeam: 'Other Team', awayTeam: 'Visitors',
      venue: { name: 'Nearby Park', coords: NEARBY },
    })
    const result = findDoubleUps([g1, g2], players, '2026-07-20', '2026-07-30')
    const stayOvers = result.filter((r) => r.type === 'stay-over')
    expect(stayOvers).toHaveLength(1)
    expect(stayOvers[0]!.playerNames.sort()).toEqual(['A', 'B'])
    expect(stayOvers[0]!.timeFeasible).toBe(true)
  })

  it('does not flag the same player\'s own consecutive games', () => {
    const players = [player('A', 'Marlins')]
    const g1 = game({ id: 's3', date: '2026-07-22', playerNames: ['A'], playerSides: { A: 'home' } })
    const g2 = game({
      id: 's4', date: '2026-07-23', playerNames: ['A'], playerSides: { A: 'away' },
      homeTeam: 'Other Team', awayTeam: 'Beloit Sky Carp',
      venue: { name: 'Nearby Park', coords: NEARBY },
    })
    const result = findDoubleUps([g1, g2], players, '2026-07-20', '2026-07-30')
    expect(result.filter((r) => r.type === 'stay-over')).toHaveLength(0)
  })

  it('suppresses a stay-over when the same players already have a same-day double', () => {
    const players = [player('A', 'Marlins'), player('B', 'Cardinals')]
    const d1a = game({ id: 't1', date: '2026-07-22', playerNames: ['A'], playerSides: { A: 'home' } })
    const d1b = game({
      id: 't2', date: '2026-07-22', playerNames: ['B'], playerSides: { B: 'home' },
      homeTeam: 'Other Team', awayTeam: 'Visitors',
      venue: { name: 'Nearby Park', coords: NEARBY },
    })
    const d2b = game({
      id: 't3', date: '2026-07-23', playerNames: ['B'], playerSides: { B: 'home' },
      homeTeam: 'Other Team', awayTeam: 'Visitors',
      venue: { name: 'Nearby Park', coords: NEARBY },
    })
    const result = findDoubleUps([d1a, d1b, d2b], players, '2026-07-20', '2026-07-30')
    // The A+B pairing surfaces once as a same-day double, not again as a stay-over
    expect(result.filter((r) => r.type === 'nearby-venues')).toHaveLength(1)
    expect(result.filter((r) => r.type === 'stay-over')).toHaveLength(0)
  })
})
