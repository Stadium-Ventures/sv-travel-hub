import { describe, it, expect } from 'vitest'
import { generateSpringTrainingEvents } from '../tripEngine'
import { SPRING_TRAINING_SITES, campEndDate } from '../../data/springTraining'
import type { RosterPlayer } from '../../types/roster'
import type { GameEvent } from '../../types/schedule'

function player(playerName: string, org = 'Colorado Rockies'): RosterPlayer {
  return {
    playerName, normalizedName: playerName.toLowerCase(), org, level: 'Pro', isJuco: false,
    mlbPlayerId: null, pgPlayerId: null, position: 'P', state: '', draftClass: '', tier: 2, leadAgent: '',
    visitTarget2026: 0, visitsCompleted: 0, lastVisitDate: null, visitsRemaining: 0, status: '',
  }
}

function game(date: string, playerNames: string[], gameType?: string): GameEvent {
  return {
    id: `mlb-${date}-${playerNames.join()}`, date, dayOfWeek: new Date(date + 'T12:00:00Z').getUTCDay(),
    time: `${date}T23:00:00Z`, homeTeam: 'Home', awayTeam: 'Away', isHome: true,
    venue: { name: 'Park', coords: { lat: 35, lng: -90 } }, source: 'mlb-api', playerNames, gameType,
  }
}

function campDays(events: GameEvent[], name: string): string[] {
  return events.filter((e) => e.playerNames.includes(name)).map((e) => e.date)
}

describe('generateSpringTrainingEvents with real games', () => {
  // 2027: big-league camp games from Feb 19, MLB Opening Day Mar 25,
  // Double-A and below open Apr 2.
  const mlbClient = player('Big Leaguer')
  const aaClient = player('Double A')
  const unassigned = player('No Team')
  const games = [
    game('2027-02-19', ['Big Leaguer'], 'S'),
    game('2027-02-20', ['Big Leaguer'], 'S'),
    game('2027-03-25', ['Big Leaguer'], 'R'),
    game('2027-04-02', ['Double A'], 'R'),
    game('2027-08-15', ['Double A'], 'R'),
  ]
  const events = generateSpringTrainingEvents([mlbClient, aaClient, unassigned], '2027-02-15', '2027-04-12', undefined, games)

  it('keeps clients with loaded season games in camp (the old rule dropped them)', () => {
    expect(campDays(events, 'Double A').length).toBeGreaterThan(0)
    expect(campDays(events, 'Big Leaguer').length).toBeGreaterThan(0)
  })

  it('runs a lower-level client through the day before his Opening Day', () => {
    const days = campDays(events, 'Double A')
    expect(days).toContain('2027-02-15')
    expect(days).toContain('2027-03-31')
    expect(days).toContain('2027-04-01')
    expect(days).not.toContain('2027-04-02')
    expect(days).not.toContain('2027-03-28') // Sunday
  })

  it('skips days a client has a real game and stops at the big-league Opening Day', () => {
    const days = campDays(events, 'Big Leaguer')
    expect(days).toContain('2027-02-16')
    expect(days).not.toContain('2027-02-19')
    expect(days).not.toContain('2027-02-20')
    expect(days).toContain('2027-02-24') // camp off day, no game
    expect(days).toContain('2027-03-24')
    expect(days).not.toContain('2027-03-25')
  })

  it('falls back to Mar 25 when the Opening Day is unknown', () => {
    const days = campDays(events, 'No Team')
    expect(days).toContain('2027-03-25')
    expect(days).not.toContain('2027-03-26')
  })

  it('puts every in-camp client of an org on one event at the org complex', () => {
    const e = events.find((x) => x.date === '2027-02-16')!
    expect(e.playerNames.sort()).toEqual(['Big Leaguer', 'Double A', 'No Team'])
    expect(e.venue.coords).toEqual(SPRING_TRAINING_SITES[115]!.coords)
  })

  it('without real games behaves as before: everyone, Feb 15 to Mar 25', () => {
    const legacy = generateSpringTrainingEvents([aaClient], '2027-02-15', '2027-04-12')
    const days = campDays(legacy, 'Double A')
    expect(days[0]).toBe('2027-02-15')
    expect(days[days.length - 1]).toBe('2027-03-25')
  })
})

describe('campEndDate', () => {
  it('is the day before Opening Day, capped at Apr 10', () => {
    expect(campEndDate(2027, '2027-04-02')).toBe('2027-04-01')
    expect(campEndDate(2027, '2027-03-25')).toBe('2027-03-24')
    expect(campEndDate(2027, '2027-06-10')).toBe('2027-04-10')
    expect(campEndDate(2027)).toBe('2027-03-25')
  })
})

describe('SPRING_TRAINING_SITES', () => {
  // MLB Stats API venue locations (2027 spring schedule).
  const kmBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    111 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180))

  it('puts the Tigers at Joker Marchant Stadium in Lakeland', () => {
    expect(kmBetween(SPRING_TRAINING_SITES[116]!.coords, { lat: 28.074822, lng: -81.9508415 })).toBeLessThan(0.5)
  })
  it('puts the Red Sox at JetBlue Park', () => {
    expect(kmBetween(SPRING_TRAINING_SITES[111]!.coords, { lat: 26.55092, lng: -81.76225 })).toBeLessThan(0.5)
  })
  it('uses current complex names', () => {
    expect(SPRING_TRAINING_SITES[117]!.venueName).toBe('CACTI Park of the Palm Beaches')
    expect(SPRING_TRAINING_SITES[120]!.venueName).toBe('CACTI Park of the Palm Beaches')
    expect(SPRING_TRAINING_SITES[142]!.venueName).toBe('Lee Health Sports Complex')
  })
})
