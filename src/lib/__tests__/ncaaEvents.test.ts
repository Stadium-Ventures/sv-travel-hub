import { describe, it, expect } from 'vitest'
import type { NcaaSourceGame } from '../../../api/_lib/ncaaSchedule'
import { ncaaScheduleToEvents, resolveTeamVenue, placeKey, homeCityOf, type NcaaSchedule } from '../ncaaEvents'
import { NCAA_NEUTRAL_SITES } from '../../data/ncaaNeutralSites'
import { parseNcaaSheetRows, sheetTeamToSchool } from '../ncaaSheetGames'

const game = (over: Partial<NcaaSourceGame>): NcaaSourceGame => ({
  date: '2027-03-05', startTime: null, timeText: '', side: 'home', opponent: 'Lamar',
  location: 'Austin, Texas', venueName: 'UFCU Disch-Falk Field', exhibition: false, tournament: '', status: 'scheduled',
  ...over,
})
const schedule = (games: NcaaSourceGame[], origin: NcaaSchedule['origin'] = 'official'): NcaaSchedule => ({
  school: 'Texas', season: 2027, origin, sourceUrl: 'https://example.edu/schedule', games, fetchedAt: 0,
})
const places = (key: string) => {
  const s = NCAA_NEUTRAL_SITES[key]
  return s ? { name: s.name, coords: s.coords } : null
}
// Synthetic client names only.
const PLAYERS = ['Test Player One']

describe('ncaaScheduleToEvents', () => {
  it('home games at the usual park use the school ballpark', () => {
    const { events } = ncaaScheduleToEvents(schedule([game({}), game({ date: '2027-03-06' })]), PLAYERS, places)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ isHome: true, homeTeam: 'Texas', awayTeam: 'Lamar', confidence: 'high', confidenceNote: 'Home game' })
    expect(events[0]!.venue.name).toBe('UFCU Disch-Falk Field')
    expect(events[0]!.playerNames).toEqual(PLAYERS)
  })

  it('a "home" showcase game at a big-league park is placed there', () => {
    const games = [game({}), game({ date: '2027-02-19', opponent: 'Clemson', location: 'Arlington, TX', venueName: 'Globe Life Field' })]
    const { events } = ncaaScheduleToEvents(schedule(games), PLAYERS, places)
    const showcase = events.find((e) => e.date === '2027-02-19')!
    expect(showcase.venue.name).toBe('Globe Life Field')
    expect(showcase.confidenceNote).toBe('Home game played at Globe Life Field, Arlington, TX')
  })

  it('away games go to the opponent park, unless the site prints a different park', () => {
    const games = [
      game({}),
      game({ date: '2027-05-22', side: 'away', opponent: 'Georgia', location: 'Athens, Ga.', venueName: 'Foley Field' }),
      game({ date: '2027-02-21', side: 'away', opponent: 'Virginia', location: 'Arlington, TX', venueName: 'Globe Life Field' }),
      // A renamed park a few blocks from the one in the table still counts as the opponent's.
      game({ date: '2027-04-10', side: 'away', opponent: 'Florida', location: 'Gainesville, Fla.', venueName: 'Condron Family Ballpark' }),
    ]
    const { events } = ncaaScheduleToEvents(schedule(games), PLAYERS, places)
    const at = (d: string) => events.find((e) => e.date === d)!
    expect(at('2027-05-22')).toMatchObject({ isHome: false, homeTeam: 'Georgia', confidence: 'high', confidenceNote: 'At Georgia' })
    expect(at('2027-05-22').venue.name).toBe('Foley Field')
    expect(at('2027-02-21').venue.name).toBe('Globe Life Field')
    expect(at('2027-02-21').confidence).toBe('medium')
    expect(at('2027-04-10').venue.name).toBe('Florida Ballpark')
  })

  it('labels fall exhibitions and neutral sites', () => {
    const g = game({ date: '2026-10-03', side: 'neutral', opponent: 'Houston', location: 'Round Rock, Texas', venueName: 'Dell Diamond', exhibition: true })
    const { events } = ncaaScheduleToEvents(schedule([g]), PLAYERS, places)
    expect(events[0]!.confidenceNote).toBe('Fall exhibition. Neutral site: Dell Diamond, Round Rock, Texas')
    expect(events[0]!.venue.name).toBe('Dell Diamond')
  })

  it('leaves out canceled and postponed games and queues unknown places', () => {
    const games = [
      game({ status: 'canceled' }),
      game({ date: '2027-03-07', status: 'postponed' }),
      game({ date: '2027-03-12', side: 'neutral', opponent: 'Rice', location: 'Nowhere, Texas', venueName: 'Imaginary Park' }),
    ]
    const { events, unresolved } = ncaaScheduleToEvents(schedule(games), PLAYERS, places)
    expect(events).toEqual([])
    expect(unresolved).toHaveLength(1)
    expect(unresolved[0]).toMatchObject({ key: placeKey('Nowhere, Texas', 'Imaginary Park'), query: 'Imaginary Park, Nowhere, Texas' })
  })

  it('keeps both games of a doubleheader', () => {
    const { events } = ncaaScheduleToEvents(schedule([game({}), game({ timeText: '6 p.m.' })]), PLAYERS, places)
    expect(events.map((e) => e.id)).toEqual(['ncaa-texas-2027-03-05-lamar', 'ncaa-texas-2027-03-05-lamar-g2'])
  })

  it('games not read live from the official site are not marked confirmed', () => {
    const { events } = ncaaScheduleToEvents(schedule([game({})], 'sheet'), PLAYERS, places)
    expect(events[0]).toMatchObject({ confidence: 'medium', confidenceNote: 'Home game (from the Client Game Schedule sheet)' })
  })
})

describe('opponent lookups', () => {
  it('knows the short forms school sites print', () => {
    expect(resolveTeamVenue('ULM')?.name).toBe(resolveTeamVenue('Louisiana-Monroe')?.name)
    expect(resolveTeamVenue('UIW')).not.toBeNull()
    expect(resolveTeamVenue('Mississippi St.')?.name).toBe(resolveTeamVenue('Mississippi State')?.name)
    expect(resolveTeamVenue('Georgia')?.name).toBe('Foley Field')
    expect(resolveTeamVenue('Not A Real School')).toBeNull()
  })

  it('finds the home city from the schedule itself', () => {
    expect(homeCityOf([game({}), game({ location: 'Austin, TX' }), game({ location: 'Arlington, TX' })])).toBe('austin')
  })
})

describe('Client Game Schedule sheet NCAA rows', () => {
  // Synthetic rows: placeholder client names, real schools and ballparks.
  const csv = [
    'Client,Team,Level,Date,Location,Time (Local time),Opponent,Ballpark',
    'Test Player One,Ohio St.,NCAA,3/3/27,"Columbus, OH",3:00 PM,Xavier,Bill Davis Stadium',
    'Test Player Two,Ohio St.,NCAA,3/3/27,"Columbus, OH",3:00 PM,Xavier,Bill Davis Stadium',
    'Test Player One,Ohio St.,NCAA,3/4/27,"Columbus, OH",3:00 PM,Butler,Bill Davis Stadium',
    'Test Player One,Ohio St.,NCAA,4/19/27,"West Lafayette, IN",1:00 PM,Purdue,Alexander Field',
    'Test Player One,Ohio St.,NCAA,2/13/27,"Pensacola, FL",2:00 PM,Saint Louis,',
    'Test Player Three,Some HS,HS,3/3/27,"Town, FL",4:00 PM,Rival HS,',
  ].join('\n')

  it('maps sheet team names and collapses one row per client into one game', () => {
    expect(sheetTeamToSchool('Ohio St.')).toBe('Ohio State')
    const bySchool = parseNcaaSheetRows(csv)
    expect([...bySchool.keys()]).toEqual(['Ohio State'])
    const games = bySchool.get('Ohio State')!
    expect(games.map((g) => [g.date, g.side, g.opponent])).toEqual([
      ['2027-02-13', 'neutral', 'Saint Louis'],
      ['2027-03-03', 'home', 'Xavier'],
      ['2027-03-04', 'home', 'Butler'],
      ['2027-04-19', 'away', 'Purdue'],
    ])
  })
})
