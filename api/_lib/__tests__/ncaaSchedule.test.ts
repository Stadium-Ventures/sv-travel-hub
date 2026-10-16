import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseSidearm,
  parseWmtSchedule,
  parseScheduleDate,
  parseStartTime,
  cleanOpponent,
  splitLocation,
  robotsDisallows,
  robotsBlocks,
  upcomingSeason,
  scheduleUrls,
  fetchSchoolSchedule,
  isUnreadableSchedulePage,
} from '../ncaaSchedule'
import { NCAA_SCHEDULE_SOURCES } from '../../_data/ncaaSources'

// Fixtures are trimmed copies of real public schedule pages (2026-10-16),
// with links, images and scripts stripped. They name schools, ballparks and
// towns only.
const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) => fs.readFileSync(path.join(here, 'fixtures', 'ncaa', name), 'utf8')

describe('date, time and name helpers', () => {
  it('uses the printed weekday to pick the year when none is printed', () => {
    // Feb 13 was a Friday in 2026 and is a Saturday in 2027.
    expect(parseScheduleDate('Feb 13 (Fri)', 2027)).toBe('2026-02-13')
    expect(parseScheduleDate('Feb 13 (Sat)', 2027)).toBe('2027-02-13')
    // Fall games belong to the next spring's season.
    expect(parseScheduleDate('Oct 17', 2027)).toBe('2026-10-17')
    expect(parseScheduleDate('February 13, 2026 (Friday)', 2030)).toBe('2026-02-13')
    expect(parseScheduleDate('TBA', 2027)).toBeNull()
  })

  it('turns a printed time and zone into UTC across DST', () => {
    expect(parseStartTime('2027-02-19', '7 p.m. CT')).toBe('2027-02-20T01:00:00.000Z')
    expect(parseStartTime('2026-05-20', '5:15 P.M. (CST)')).toBe('2026-05-20T22:15:00.000Z')
    expect(parseStartTime('2026-10-03', '12 p.m. CT')).toBe('2026-10-03T17:00:00.000Z')
    expect(parseStartTime('2026-02-13', '3:05 P.M.')).toBeNull() // no zone printed
    expect(parseStartTime('2026-02-13', 'TBA')).toBeNull()
  })

  it('cleans opponent names', () => {
    expect(cleanOpponent('#25 Jacksonville State')).toBe('Jacksonville State')
    expect(cleanOpponent('(#9) Oklahoma')).toBe('Oklahoma')
    expect(cleanOpponent('Grand Canyon * *')).toBe('Grand Canyon')
    expect(cleanOpponent('Coastal Carolina (Exhibition)')).toBe('Coastal Carolina')
    expect(cleanOpponent('UNC Greensboro (DH-Game 2)')).toBe('UNC Greensboro')
    expect(cleanOpponent('North Carolina (ACC)')).toBe('North Carolina')
    expect(cleanOpponent('Cincinnati (EXH)')).toBe('Cincinnati')
    expect(cleanOpponent('Miami (OH)')).toBe('Miami (OH)')
  })

  it('splits printed locations into town and ballpark', () => {
    expect(splitLocation('Austin, Texas (UFCU Disch-Falk Field)')).toEqual({ location: 'Austin, Texas', venueName: 'UFCU Disch-Falk Field' })
    expect(splitLocation('Orlando, Fla. / John Euliano Park')).toEqual({ location: 'Orlando, Fla.', venueName: 'John Euliano Park' })
    expect(splitLocation('Fifth Third Park / Spartanburg, S.C.')).toEqual({ location: 'Spartanburg, S.C.', venueName: 'Fifth Third Park' })
    expect(splitLocation('Nashville, Tenn./First Horizon Park')).toEqual({ location: 'Nashville, Tenn.', venueName: 'First Horizon Park' })
    expect(splitLocation('Globe Life Field | Arlington, Texas')).toEqual({ location: 'Arlington, Texas', venueName: 'Globe Life Field' })
    expect(splitLocation('Dallas, TX')).toEqual({ location: 'Dallas, TX', venueName: '' })
  })
})

describe('SIDEARM pages', () => {
  it('reads the text-only table (newer sites): neutral, showcase and TBA games', () => {
    const games = parseSidearm(fixture('sidearm-text-2027.html'), 2027)
    expect(games).toHaveLength(6)
    expect(games[0]).toMatchObject({
      date: '2026-10-03', side: 'neutral', opponent: 'Houston', location: 'Round Rock, Texas',
      venueName: 'Dell Diamond', exhibition: true, startTime: '2026-10-03T17:00:00.000Z',
    })
    // A "home" game at a big-league park keeps its printed place.
    expect(games[1]).toMatchObject({ date: '2027-02-19', side: 'home', venueName: 'Globe Life Field', exhibition: false })
    expect(games[1]!.tournament).toContain('College Showdown')
    expect(games[5]).toMatchObject({ date: '2027-05-22', side: 'away', opponent: 'Georgia', timeText: 'TBA', startTime: null })
  })

  it('reads the classic grid table with years and results', () => {
    const games = parseSidearm(fixture('sidearm-grid-2026.html'), 2026)
    expect(games).toHaveLength(7)
    expect(games.every((g) => g.status === 'final')).toBe(true)
    expect(games.filter((g) => g.side === 'neutral').map((g) => g.opponent)).toEqual(['Missouri State', 'Jacksonville State'])
  })

  it('reads the classic list layout some sites serve for fall schedules', () => {
    const games = parseSidearm(fixture('sidearm-list-2027.html'), 2027)
    expect(games.map((g) => [g.date, g.side, g.opponent])).toEqual([
      ['2026-10-24', 'neutral', 'Memphis'],
      ['2026-10-30', 'home', 'Jones College'],
      ['2026-11-06', 'home', 'Southern'],
      ['2026-11-13', 'away', 'LSU'],
    ])
    expect(games.every((g) => g.exhibition)).toBe(true)
  })
})

describe('WMT Digital pages (each theme in use)', () => {
  it('ISO datetimes, neutral sites and exhibition labels', () => {
    const games = parseWmtSchedule(fixture('wmt-datetime-fall.html'), 2027)
    expect(games.map((g) => [g.date, g.side, g.opponent, g.venueName])).toEqual([
      ['2026-10-17', 'neutral', 'Alabama', 'Blue Wahoos Stadium'],
      ['2026-10-31', 'home', 'Clemson', 'Mac Nease Baseball Park'],
      ['2026-11-01', 'away', 'Clemson', 'Doug Kingsmore Stadium'],
      ['2026-11-08', 'neutral', 'Tennessee', 'Erlanger Park'],
    ])
    expect(games[3]).toMatchObject({ location: 'Chattanooga, Tenn.', exhibition: true, startTime: '2026-11-08T19:00:00.000Z' })
  })

  it('month and day spans with --away and --neutral cards', () => {
    const games = parseWmtSchedule(fixture('wmt-monthday-2026.html'), 2026)
    expect(games).toHaveLength(7)
    expect(games[2]).toMatchObject({ date: '2026-02-21', side: 'neutral', opponent: 'Indiana', venueName: 'VyStar Ballpark' })
    expect(games[4]).toMatchObject({ side: 'away', opponent: 'TCU', location: 'Fort Worth, Texas' })
  })

  it('weekday plus month-day tags and a home/away/neutral label', () => {
    const games = parseWmtSchedule(fixture('wmt-weekday-2026.html'), 2026)
    expect(games.map((g) => [g.date, g.side, g.opponent])).toEqual([
      ['2026-02-13', 'home', 'Wagner'],
      ['2026-02-14', 'home', 'Wagner'],
      ['2026-02-17', 'home', 'VMI'],
      ['2026-03-01', 'away', 'VCU'],
      ['2026-03-24', 'neutral', 'Maryland'],
    ])
  })

  it('the default theme with a venue-type label and "(Exhibition)" names', () => {
    const games = parseWmtSchedule(fixture('wmt-default-fall.html'), 2027)
    expect(games.map((g) => [g.date, g.side, g.opponent])).toEqual([
      ['2026-10-09', 'neutral', 'Coastal Carolina'],
      ['2026-10-18', 'away', 'Georgia'],
      ['2026-10-31', 'away', 'Georgia Tech'],
      ['2026-11-01', 'home', 'Georgia Tech'],
    ])
    expect(games[1]!.startTime).toBe('2026-10-18T17:00:00.000Z')
  })

  it('themes that print both clubs, item blocks and team headings', () => {
    const both = parseWmtSchedule(fixture('wmt-current-team-2026.html'), 2026)
    expect(both.map((g) => g.opponent)).toEqual(['Tennessee Tech', 'Penn', 'Penn', 'Vanderbilt'])
    const blocks = parseWmtSchedule(fixture('wmt-item-block-2026.html'), 2026)
    expect(blocks[0]).toMatchObject({ opponent: 'Alumni Game', exhibition: true, venueName: 'Jackie Robinson Stadium' })
    const headings = parseWmtSchedule(fixture('wmt-heading-2026.html'), 2026)
    expect(headings.map((g) => [g.side, g.opponent])).toEqual([
      ['neutral', 'TCU'], ['neutral', 'Texas Tech'], ['neutral', 'Arizona'], ['away', 'Texas A&M'],
    ])
  })

  it('the older WordPress themes', () => {
    const items = parseWmtSchedule(fixture('wmt-wp-item-2026.html'), 2026)
    expect(items[0]).toMatchObject({ date: '2026-02-13', side: 'away', opponent: 'UNC Greensboro', location: 'Greensboro, N.C.' })
    const rows = parseWmtSchedule(fixture('wmt-wp-row-2026.html'), 2026)
    expect(rows[0]).toMatchObject({ side: 'home', opponent: 'Northern Kentucky', venueName: 'Founders Park', location: '' })
    expect(rows[1]).toMatchObject({ side: 'away', opponent: 'Wofford', location: 'Spartanburg, S.C.', venueName: 'Fifth Third Park' })
  })

  it('a page that builds its schedule in the browser is unreadable, not empty', () => {
    const html = fixture('unreadable-skeleton.html')
    expect(parseWmtSchedule(html, 2027)).toEqual([])
    expect(isUnreadableSchedulePage(html)).toBe(true)
    expect(isUnreadableSchedulePage('<html><head><title>2027 Baseball Schedule</title></head><body></body></html>')).toBe(false)
  })
})

describe('robots.txt', () => {
  const robots = 'User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /services/\nDisallow: /*print=true*\nAllow: /\n'
  it('applies only the rules for every crawler', () => {
    const rules = robotsDisallows(robots)
    expect(rules).toEqual(['/services/', '/*print=true*'])
    expect(robotsBlocks(rules, '/sports/baseball/schedule/2027?grid=true')).toBe(false)
    expect(robotsBlocks(rules, '/sports/baseball/schedule/2027?print=true')).toBe(true)
    expect(robotsBlocks(rules, '/services/responsive-calendar.ashx')).toBe(true)
  })
})

describe('seasons and URLs', () => {
  it('looks ahead to next spring from August', () => {
    expect(upcomingSeason(new Date('2026-10-16T12:00:00Z'))).toBe(2027)
    expect(upcomingSeason(new Date('2027-03-01T12:00:00Z'))).toBe(2027)
    expect(upcomingSeason(new Date('2027-07-31T12:00:00Z'))).toBe(2027)
    expect(upcomingSeason(new Date('2027-08-01T12:00:00Z'))).toBe(2028)
  })

  it('tries the text table, then the grid, on SIDEARM sites', () => {
    expect(scheduleUrls({ platform: 'sidearm', host: 'example.edu', sport: 'baseball' }, 2027, true)).toEqual([
      'https://example.edu/sports/baseball/schedule/text/2027',
      'https://example.edu/sports/baseball/schedule/2027?grid=true',
    ])
  })
})

describe('fetchSchoolSchedule', () => {
  const school = 'Texas'
  const host = NCAA_SCHEDULE_SOURCES[school]!.host
  const page = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } })
  const fakeFetch = (routes: Record<string, () => Response>) => async (url: string) => {
    const route = Object.entries(routes).find(([k]) => url.endsWith(k))
    return route ? route[1]() : page('not found', 404)
  }
  const now = new Date('2026-10-16T12:00:00Z')

  it('returns the season\'s games', async () => {
    const r = await fetchSchoolSchedule(school, {
      now,
      fetchFn: fakeFetch({ '/robots.txt': () => page('User-agent: *\nAllow: /'), '/schedule/text/2027': () => page(fixture('sidearm-text-2027.html')) }),
    })
    expect(r.status).toBe('ok')
    expect(r.games).toHaveLength(6)
    expect(r.sourceUrl).toBe(`https://${host}/sports/baseball/schedule/text/2027`)
  })

  it('says "not published yet" when the site only has last season', async () => {
    const r = await fetchSchoolSchedule(school, {
      now,
      fetchFn: fakeFetch({ '/schedule/text/2027': () => page(fixture('sidearm-grid-2026.html')) }),
    })
    expect(r.status).toBe('empty')
    expect(r.message).toBe('Texas has no 2027 games published yet.')
  })

  it('reports a page it cannot read as an error', async () => {
    const r = await fetchSchoolSchedule(school, {
      now,
      fetchFn: fakeFetch({ '/schedule/text/2027': () => page(fixture('unreadable-skeleton.html')) }),
    })
    expect(r.status).toBe('error')
    expect(r.message).toContain('no games could be read')
  })

  it('never reads a path robots.txt disallows', async () => {
    const seen: string[] = []
    const r = await fetchSchoolSchedule(school, {
      now,
      fetchFn: async (url: string) => {
        seen.push(url)
        return url.endsWith('/robots.txt') ? page('User-agent: *\nDisallow: /sports/') : page('')
      },
    })
    expect(r.status).toBe('error')
    expect(r.message).toContain('robots.txt does not allow')
    expect(seen).toEqual([`https://${host}/robots.txt`])
  })

  it('explains schools without a readable public page', async () => {
    const r = await fetchSchoolSchedule('Notre Dame', { now, fetchFn: fakeFetch({}) })
    expect(r.status).toBe('no-source')
    expect(r.message).toContain('builds its schedule in the browser')
    const unknown = await fetchSchoolSchedule('Nowhere State', { now, fetchFn: fakeFetch({}) })
    expect(unknown.message).toBe('No schedule source is set up for Nowhere State.')
  })
})
