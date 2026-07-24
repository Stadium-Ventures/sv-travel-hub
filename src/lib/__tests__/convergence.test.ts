import { describe, it, expect } from 'vitest'
import { findConvergenceWindows, playersWithoutGames } from '../convergence'
import type { GameEvent } from '../../types/schedule'

// Real-ish California geography — the Kent question this engine exists for:
// "dates to see Tanner, Garrett and Kellon in SoCal?"
const SAN_JOSE = { lat: 37.3496, lng: -121.9084 } // Excite Ballpark
const SACRAMENTO = { lat: 38.5802, lng: -121.5133 } // Sutter Health Park (~2h from SJ)
const SAN_DIEGO = { lat: 32.7076, lng: -117.157 } // Petco Park
const LOS_ANGELES = { lat: 34.0739, lng: -118.24 } // Dodger Stadium
const BOSTON = { lat: 42.3467, lng: -71.0972 } // Fenway Park

function game(overrides: Partial<GameEvent> & { id: string; date: string; playerNames: string[] }): GameEvent {
  return {
    dayOfWeek: 2,
    time: overrides.date + 'T19:00:00Z',
    homeTeam: 'Home',
    awayTeam: 'Away',
    isHome: true,
    venue: { name: overrides.id + ' park', coords: SAN_JOSE },
    source: 'mlb-api',
    ...overrides,
  } as GameEvent
}

describe('findConvergenceWindows', () => {
  it('finds a consecutive-day swing covering all three players', () => {
    const games = [
      game({ id: 'k1', date: '2026-07-27', playerNames: ['Kellon'], venue: { name: 'Excite Ballpark', coords: SAN_JOSE } }),
      game({ id: 'g1', date: '2026-07-28', playerNames: ['Garrett'], venue: { name: 'Sutter Health Park', coords: SACRAMENTO } }),
      game({ id: 't1', date: '2026-07-29', playerNames: ['Tanner'], venue: { name: 'Petco Park', coords: SAN_DIEGO } }),
    ]
    const result = findConvergenceWindows(games, ['Tanner', 'Garrett', 'Kellon'], '2026-07-24', '2026-09-30')
    expect(result.length).toBeGreaterThan(0)
    const best = result[0]!
    expect(best.startDate).toBe('2026-07-27')
    expect(best.endDate).toBe('2026-07-29')
    expect(best.spanDays).toBe(3)
    expect(best.stops.map((s) => s.venueName)).toEqual(['Excite Ballpark', 'Sutter Health Park', 'Petco Park'])
    expect(best.hopMinutes).toHaveLength(2)
  })

  it('marks a window infeasible (but keeps it) when a between-day hop exceeds the cap', () => {
    // Sacramento → San Diego is ~8h — beyond a 6h cap, but still the closest
    // these two ever come, so it must surface with feasible: false.
    const games = [
      game({ id: 'a1', date: '2026-08-01', playerNames: ['A'], venue: { name: 'Sutter Health Park', coords: SACRAMENTO } }),
      game({ id: 'b1', date: '2026-08-02', playerNames: ['B'], venue: { name: 'Petco Park', coords: SAN_DIEGO } }),
    ]
    const result = findConvergenceWindows(games, ['A', 'B'], '2026-07-24', '2026-09-30', { maxHopMinutes: 360 })
    expect(result).toHaveLength(1)
    expect(result[0]!.feasible).toBe(false)
    expect(result[0]!.maxHopMinutes).toBeGreaterThan(360)
  })

  it('prefers a feasible window over a tighter-span infeasible one', () => {
    const games = [
      // Infeasible same-span option: B in Boston the same day A is in LA
      game({ id: 'a1', date: '2026-08-01', playerNames: ['A'], venue: { name: 'Dodger Stadium', coords: LOS_ANGELES } }),
      game({ id: 'b1', date: '2026-08-02', playerNames: ['B'], venue: { name: 'Fenway Park', coords: BOSTON } }),
      // Feasible option later: B visits San Diego two days after A's LA game
      game({ id: 'b2', date: '2026-08-03', playerNames: ['B'], venue: { name: 'Petco Park', coords: SAN_DIEGO } }),
    ]
    const result = findConvergenceWindows(games, ['A', 'B'], '2026-07-24', '2026-09-30')
    expect(result[0]!.feasible).toBe(true)
    expect(result[0]!.stops.map((s) => s.venueName)).toEqual(['Dodger Stadium', 'Petco Park'])
  })

  it('drops combos where two players play the same day beyond double-up range', () => {
    // Same-day LA + Boston is unattendable, and there is no other combo
    const games = [
      game({ id: 'a1', date: '2026-08-01', playerNames: ['A'], venue: { name: 'Dodger Stadium', coords: LOS_ANGELES } }),
      game({ id: 'b1', date: '2026-08-01', playerNames: ['B'], venue: { name: 'Fenway Park', coords: BOSTON } }),
    ]
    const result = findConvergenceWindows(games, ['A', 'B'], '2026-07-24', '2026-09-30')
    expect(result).toHaveLength(0)
  })

  it('merges two players sharing one game into a single stop', () => {
    const games = [
      game({ id: 'shared', date: '2026-08-01', playerNames: ['A', 'B'], venue: { name: 'Petco Park', coords: SAN_DIEGO } }),
      game({ id: 'c1', date: '2026-08-02', playerNames: ['C'], venue: { name: 'Dodger Stadium', coords: LOS_ANGELES } }),
    ]
    const result = findConvergenceWindows(games, ['A', 'B', 'C'], '2026-07-24', '2026-09-30')
    expect(result.length).toBeGreaterThan(0)
    const best = result[0]!
    expect(best.stops).toHaveLength(2)
    expect(best.stops[0]!.playerNames.sort()).toEqual(['A', 'B'])
  })

  it('respects the span cap — games too many days apart never form a window', () => {
    const games = [
      game({ id: 'a1', date: '2026-08-01', playerNames: ['A'], venue: { name: 'Petco Park', coords: SAN_DIEGO } }),
      game({ id: 'b1', date: '2026-08-20', playerNames: ['B'], venue: { name: 'Dodger Stadium', coords: LOS_ANGELES } }),
    ]
    const result = findConvergenceWindows(games, ['A', 'B'], '2026-07-24', '2026-09-30', { maxSpanDays: 5 })
    expect(result).toHaveLength(0)
  })

  it('collapses a series into one window per venue set, soonest first', () => {
    const games = ['01', '02', '03'].flatMap((d, i) => [
      game({ id: `a${i}`, date: `2026-08-${d}`, playerNames: ['A'], venue: { name: 'Petco Park', coords: SAN_DIEGO } }),
      game({ id: `b${i}`, date: `2026-08-${d}`, playerNames: ['B'], venue: { name: 'Dodger Stadium', coords: LOS_ANGELES } }),
    ])
    const result = findConvergenceWindows(games, ['A', 'B'], '2026-07-24', '2026-09-30')
    expect(result).toHaveLength(1)
    expect(result[0]!.startDate).toBe('2026-08-01')
  })

  it('ignores cancelled and out-of-range games', () => {
    const games = [
      game({ id: 'a1', date: '2026-08-01', playerNames: ['A'], venue: { name: 'Petco Park', coords: SAN_DIEGO } }),
      game({ id: 'b1', date: '2026-08-01', playerNames: ['B'], venue: { name: 'Dodger Stadium', coords: LOS_ANGELES }, gameStatus: 'Cancelled' }),
      game({ id: 'b2', date: '2026-10-15', playerNames: ['B'], venue: { name: 'Dodger Stadium', coords: LOS_ANGELES } }),
    ]
    expect(findConvergenceWindows(games, ['A', 'B'], '2026-07-24', '2026-09-30')).toHaveLength(0)
    expect(playersWithoutGames(games, ['A', 'B'], '2026-07-24', '2026-09-30')).toEqual(['B'])
  })
})
