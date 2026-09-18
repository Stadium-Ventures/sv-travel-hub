import { describe, it, expect } from 'vitest'
import { sideFor, isHomeFor, teamFor, opponentFor, matchupLabel, isHeadToHead } from '../gameSide'
import type { GameEvent } from '../../types/schedule'

// Oct 8: Mesa Solar Sox (Munroe, Victor) at Salt River Rafters (Kilby).
// The event was produced from Salt River's schedule, so isHome is Salt
// River's view; Mesa players are merged in with their own side.
const game: GameEvent = {
  id: 'mlb-1', date: '2026-10-08', dayOfWeek: 4, time: '2026-10-08T20:30:00Z',
  homeTeam: 'Salt River Rafters', awayTeam: 'Mesa Solar Sox', isHome: true,
  venue: { name: 'Salt River Fields at Talking Stick', coords: { lat: 33.55, lng: -111.88 } },
  source: 'mlb-api',
  playerNames: ['Dax Kilby', 'Jake Munroe', 'Najer Victor'],
  playerSides: { 'Dax Kilby': 'home', 'Jake Munroe': 'away', 'Najer Victor': 'away' },
  sportId: 17,
}

describe('gameSide on a head-to-head game', () => {
  it('gives each player their own side', () => {
    expect(sideFor(game, 'Dax Kilby')).toBe('home')
    expect(sideFor(game, 'Jake Munroe')).toBe('away')
    expect(isHomeFor(game, 'Najer Victor')).toBe(false)
  })
  it('names the right club and opponent per player', () => {
    expect(teamFor(game, 'Jake Munroe')).toBe('Mesa Solar Sox')
    expect(opponentFor(game, 'Jake Munroe')).toBe('Salt River Rafters')
    expect(teamFor(game, 'Dax Kilby')).toBe('Salt River Rafters')
    expect(opponentFor(game, 'Dax Kilby')).toBe('Mesa Solar Sox')
  })
  it('labels the matchup per player, and neutrally when no player is given', () => {
    expect(matchupLabel(game, 'Dax Kilby')).toBe('vs Mesa Solar Sox')
    expect(matchupLabel(game, 'Jake Munroe')).toBe('@ Salt River Rafters')
    expect(isHeadToHead(game)).toBe(true)
    expect(matchupLabel(game)).toBe('Mesa Solar Sox at Salt River Rafters')
  })
  it('falls back to isHome when sides are unknown', () => {
    const plain: GameEvent = { ...game, playerSides: undefined, playerNames: ['Dax Kilby'] }
    expect(sideFor(plain, 'Dax Kilby')).toBe('home')
    expect(matchupLabel(plain)).toBe('vs Mesa Solar Sox')
    expect(isHeadToHead(plain)).toBe(false)
  })
})
