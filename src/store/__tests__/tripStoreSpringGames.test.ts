import { describe, it, expect, vi } from 'vitest'
import type { GameEvent } from '../../types/schedule'

// Fall exhibitions (posted in the fall for next spring's season) and last
// season's games used to count as "has a real schedule", which switched off
// the estimated spring games for that client until spring dates posted.

vi.mock('../rosterStore', () => ({ useRosterStore: { getState: () => ({ players: [] }) } }))
vi.mock('../scheduleStore', () => ({ useScheduleStore: { getState: () => ({}) } }))
vi.mock('../venueStore', () => ({ useVenueStore: { getState: () => ({}) } }))
vi.mock('../heartbeatStore', () => ({ useHeartbeatStore: { getState: () => ({}) } }))
vi.mock('../summerStore', () => ({ useSummerStore: { getState: () => ({ summerGames: [] }) } }))

const { playersWithSpringGames } = await import('../tripStore')

// Synthetic names only.
function game(date: string, playerNames: string[]): GameEvent {
  return { date, playerNames } as unknown as GameEvent
}

describe('playersWithSpringGames', () => {
  const fallOnly = game('2026-11-08', ['Fall Only'])
  const lastSpring = game('2026-04-10', ['Last Spring'])
  const thisSpring = game('2027-03-06', ['This Spring'])
  const games = [fallOnly, lastSpring, thisSpring]

  it('ignores fall exhibitions and last season when planning next spring', () => {
    expect([...playersWithSpringGames(games, '2027-02-15', '2027-03-31')]).toEqual(['This Spring'])
  })

  it('counts the spring a long range reaches into', () => {
    expect([...playersWithSpringGames(games, '2026-10-16', '2027-11-30')]).toEqual(['This Spring'])
  })

  it('suppresses nothing for a fall-only range', () => {
    expect(playersWithSpringGames(games, '2026-10-16', '2026-11-30').size).toBe(0)
  })
})
