import { describe, it, expect } from 'vitest'
import { coverageFindings, personKey, runCoverageCheck, type CoverageIssue } from '../coverageCheck'
import { buildOrgIndex, HttpError } from '../mlbClient'
import { isSkippedClient, parseRosterClients } from '../rosterClients'
import type { RosterClient } from '../monitorTypes'

// Fixtures only: invented people, invented MLB ids (9000xx), invented venues.
// Club names and ids are MLB's real public club list.

const MLB_TEAMS = {
  teams: [
    { id: 147, name: 'New York Yankees', teamName: 'Yankees', clubName: 'Yankees', shortName: 'NY Yankees', abbreviation: 'NYY', locationName: 'Bronx', franchiseName: 'New York' },
    { id: 121, name: 'New York Mets', teamName: 'Mets', clubName: 'Mets', shortName: 'NY Mets', abbreviation: 'NYM', locationName: 'Flushing', franchiseName: 'New York' },
    { id: 112, name: 'Chicago Cubs', teamName: 'Cubs', clubName: 'Cubs', shortName: 'Chi Cubs', abbreviation: 'CHC', locationName: 'Chicago', franchiseName: 'Chicago' },
    { id: 145, name: 'Chicago White Sox', teamName: 'White Sox', clubName: 'White Sox', shortName: 'Chi White Sox', abbreviation: 'CWS', locationName: 'Chicago', franchiseName: 'Chicago' },
    { id: 133, name: 'Athletics', teamName: 'Athletics', clubName: 'Athletics', shortName: 'Athletics', abbreviation: 'ATH', locationName: 'Sacramento', franchiseName: 'Athletics' },
    { id: 113, name: 'Cincinnati Reds', teamName: 'Reds', clubName: 'Reds', shortName: 'Cincinnati', abbreviation: 'CIN', locationName: 'Cincinnati', franchiseName: 'Cincinnati' },
  ],
}

function client(name: string, over: Partial<RosterClient> = {}): RosterClient {
  return { name, mlbId: null, org: 'New York Yankees', affiliate: '', level: 'Pro', levelRaw: 'Pro', status: '', isCoach: false, ...over }
}

type Route = [RegExp, unknown | ((url: string) => unknown)]

/** A FetchJson over fixture routes; records every URL. A route value that is
 *  an Error is thrown. */
function fakeFetch(routes: Route[]) {
  const calls: string[] = []
  const fetchJson = async (url: string) => {
    calls.push(url)
    for (const [re, body] of routes) {
      if (!re.test(url)) continue
      const v = typeof body === 'function' ? (body as (u: string) => unknown)(url) : body
      if (v instanceof Error) throw v
      return v
    }
    throw new Error(`no fixture for ${url}`)
  }
  return { fetchJson, calls }
}

function people(list: Array<{ id: number; currentTeam?: Record<string, unknown> }>) {
  return (url: string) => {
    const ids = new Set((/personIds=([\d,]+)/.exec(url)?.[1] ?? '').split(',').map(Number))
    const hit = list.filter((p) => ids.has(p.id))
    return hit.length > 0 ? { people: hit } : new HttpError(404, url)
  }
}

const JULY = new Date('2026-07-01T13:00:00Z')
const DECEMBER = new Date('2026-12-02T13:00:00Z')
const OCTOBER = new Date('2026-10-14T13:00:00Z')
const noFallback = () => null

function kinds(issues: CoverageIssue[]) {
  return issues.map((i) => i.kind).sort()
}

describe('org index (roster org names → MLB club ids)', () => {
  const idx = buildOrgIndex(MLB_TEAMS.teams)
  it('resolves full names, nicknames and abbreviations', () => {
    expect(idx.resolve('New York Yankees')).toBe(147)
    expect(idx.resolve('yankees')).toBe(147)
    expect(idx.resolve('NYM')).toBe(121)
    expect(idx.resolve('St. Louis')).toBeNull()
  })
  it("handles a relocated club's old city and the A's spellings", () => {
    expect(idx.resolve('Oakland Athletics')).toBe(133)
    expect(idx.resolve("A's")).toBe(133)
  })
  it('drops a key two clubs share instead of guessing', () => {
    expect(idx.resolve('Chicago')).toBeNull()
    expect(idx.resolve('Chicago White Sox')).toBe(145)
  })
})

describe('roster parsing', () => {
  it('reads the registry CSV headers and skips injured, retired, free-agent and coach rows', () => {
    const csv = [
      'Player Name,MLB_ID,slug,Org,Affiliate,Level,MiLB Level,Status,Tier,Is Coach',
      'Test Player One,900001,test-player-one,New York Yankees,Tampa Tarpons,Pro,Low-A,,2,No',
      'Test Player Two,,test-player-two,Retired,,Pro,,Retired,3,No',
      'Test Player Three,900003,test-player-three,New York Mets,,Pro,,Injured,2,No',
      'Test Coach,,test-coach,Sample College,,NCAA,,,4,Yes',
      'Test Player Four,900004,test-player-four,New York Mets,,Pro,,Free Agent,2,No',
      'Test Player Five,,test-player-five,Sample College,,NCAA,,,2,No',
    ].join('\r\n')
    const rows = parseRosterClients(csv)
    expect(rows).toHaveLength(6)
    expect(rows[0]).toMatchObject({ name: 'Test Player One', mlbId: 900001, org: 'New York Yankees', level: 'Pro', status: '' })
    expect(rows[5]).toMatchObject({ level: 'NCAA', mlbId: null })
    expect(rows.map(isSkippedClient)).toEqual([false, true, true, true, true, false])
  })
})

describe('runCoverageCheck: organization (b)', () => {
  it('flags a client whose MLB organization differs from the roster, and only that one', async () => {
    const { fetchJson } = fakeFetch([
      [/teams\?sportId=1&/, MLB_TEAMS],
      [/\/people\?/, people([
        { id: 900001, currentTeam: { id: 587, name: 'Tampa Tarpons', parentOrgId: 147 } }, // matches
        { id: 900002, currentTeam: { id: 113, name: 'Cincinnati Reds' } }, // big leaguer, traded
        { id: 900003, currentTeam: { id: 999, name: 'Winter Club' } }, // no org to compare
      ])],
      [/\/schedule\?/, { dates: [] }],
    ])
    const issues = await runCoverageCheck([
      client('Test Player One', { mlbId: 900001 }),
      client('Test Player Two', { mlbId: 900002 }),
      client('Test Player Three', { mlbId: 900003 }),
    ], { now: DECEMBER, fetchJson, venueFallback: noFallback })
    expect(issues).toEqual([
      { kind: 'org-mismatch', key: 'org:900002:113', client: 'Test Player Two', rosterOrg: 'New York Yankees', mlbOrg: 'Cincinnati Reds' },
    ])
  })

  it('flags an id MLB has never heard of', async () => {
    const { fetchJson } = fakeFetch([
      [/teams\?sportId=1&/, MLB_TEAMS],
      [/\/people\?/, people([{ id: 900001, currentTeam: { id: 147, name: 'New York Yankees' } }])],
    ])
    const issues = await runCoverageCheck([
      client('Test Player One', { mlbId: 900001 }),
      client('Test Player Two', { mlbId: 900099 }),
    ], { now: DECEMBER, fetchJson })
    expect(issues).toEqual([{ kind: 'unknown-id', key: 'unknown-id:900099', client: 'Test Player Two' }])
  })

  it('reports one blind-lookup issue, not one per client, when the lookup fails', async () => {
    const { fetchJson } = fakeFetch([
      [/teams\?sportId=1&/, MLB_TEAMS],
      [/\/people\?/, new Error('timeout')],
    ])
    const issues = await runCoverageCheck([
      client('Test Player One', { mlbId: 900001 }),
      client('Test Player Two', { mlbId: 900002 }),
    ], { now: DECEMBER, fetchJson })
    expect(issues).toEqual([{ kind: 'lookup-failed', key: 'lookup-failed' }])
  })

  it('stays quiet when MLB itself is down (the MLB probe owns outages)', async () => {
    const { fetchJson } = fakeFetch([[/./, new Error('down')]])
    expect(await runCoverageCheck([client('Test Player One', { mlbId: 900001 })], { now: JULY, fetchJson })).toEqual([])
  })

  it('never looks up injured or retired clients, free agents with no organization or id, coaches, or amateurs', async () => {
    const { fetchJson, calls } = fakeFetch([[/teams\?sportId=1&/, MLB_TEAMS]])
    const issues = await runCoverageCheck([
      client('Test Player One', { mlbId: 900001, status: 'Injured' }),
      client('Test Player Two', { mlbId: 900002, status: 'Retired', org: 'Retired' }),
      client('Test Player Three', { mlbId: 900003, status: 'Free Agent', org: 'Free Agent' }),
      client('Test Player Five', { status: 'Free Agent' }),
      client('Test Coach', { isCoach: true }),
      client('Test Player Four', { level: 'NCAA', org: 'Sample College' }),
    ], { now: JULY, fetchJson })
    expect(issues).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('runCoverageCheck: free agents', () => {
  it('flags a free agent MLB now lists with a new organization, and not one still with his old club', async () => {
    const { fetchJson, calls } = fakeFetch([
      [/teams\?sportId=1&/, MLB_TEAMS],
      [/\/people\?/, people([
        // MLB keeps the old club as the current team until he signs.
        { id: 900001, currentTeam: { id: 587, name: 'Tampa Tarpons', parentOrgId: 147 } },
        { id: 900002, currentTeam: { id: 113, name: 'Cincinnati Reds' } },
      ])],
      [/\/schedule\?/, { dates: [] }],
    ])
    const issues = await runCoverageCheck([
      client('Test Player One', { mlbId: 900001, status: 'Free Agent' }),
      client('Test Player Two', { mlbId: 900002, status: 'Free Agent' }),
    ], { now: JULY, fetchJson, venueFallback: noFallback })
    expect(issues).toEqual([
      { kind: 'org-mismatch', key: 'org:900002:113', client: 'Test Player Two', rosterOrg: 'New York Yankees', mlbOrg: 'Cincinnati Reds', freeAgent: true },
    ])
    // Free agents are never placed on a team's schedule by the check.
    expect(calls.some((u) => u.includes('/schedule?'))).toBe(false)
  })

  it('says a free agent probably signed, in plain words', () => {
    const [f] = coverageFindings([
      { kind: 'org-mismatch', key: 'org:1:113', client: 'Test Player Two', rosterOrg: 'New York Yankees', mlbOrg: 'Cincinnati Reds', freeAgent: true },
    ])
    expect(f!.what).toBe('Test Player Two (last with New York Yankees, now Cincinnati Reds) is listed as a free agent on our roster, but MLB now has him with a new organization, so he probably signed there. Update his status and organization in sv-registry.')
    expect(f!.what).not.toMatch(/[–—…]|\.\.\.|\p{Extended_Pictographic}/u)
  })
})

describe('runCoverageCheck: no MLB id (a)', () => {
  const routes = (rosterFor: (teamId: number) => unknown): Route[] => [
    [/teams\?sportId=1&/, MLB_TEAMS],
    [/teams\/affiliates\?/, { teams: [
      { id: 147, name: 'New York Yankees', sport: { id: 1 } },
      { id: 531, name: 'Scranton/Wilkes-Barre RailRiders', sport: { id: 11 }, parentOrgId: 147 },
      { id: 475, name: 'FCL Yankees', sport: { id: 16 }, parentOrgId: 147 },
      { id: 3309, name: 'Yankees Organization', sport: { id: 21 }, parentOrgId: 147 },
    ] }],
    [/teams\/(\d+)\/roster/, (url: string) => rosterFor(Number(/teams\/(\d+)\/roster/.exec(url)![1]))],
  ]
  const entry = (id: number, fullName: string) => ({ person: { id, fullName } })

  it('is fine when the exact name is on a roster in the organization', async () => {
    const { fetchJson, calls } = fakeFetch(routes((t) => ({ roster: t === 475 ? [entry(900010, 'Test Player One')] : [entry(900011, 'Someone Else')] })))
    expect(await runCoverageCheck([client('Test Player One')], { now: DECEMBER, fetchJson })).toEqual([])
    expect(calls.some((u) => u.includes('teams/147/roster?rosterType=active'))).toBe(true)
    expect(calls.some((u) => u.includes('teams/3309/'))).toBe(false) // placeholder clubs play no games
  })

  it('flags a client with no id whose name is on no roster', async () => {
    const { fetchJson } = fakeFetch(routes(() => ({ roster: [entry(900011, 'Someone Else')] })))
    const issues = await runCoverageCheck([client('Test Player One')], { now: DECEMBER, fetchJson })
    expect(issues).toEqual([{ kind: 'no-id-no-match', key: 'no-id:test player one', client: 'Test Player One', org: 'New York Yankees', orgKnown: true }])
  })

  it('says nothing when the rosters are empty or unreadable (offseason, outage)', async () => {
    const { fetchJson } = fakeFetch(routes(() => new Error('down')))
    expect(await runCoverageCheck([client('Test Player One')], { now: DECEMBER, fetchJson })).toEqual([])
  })

  it('flags a client with no id and an organization nobody recognizes', async () => {
    const { fetchJson } = fakeFetch(routes(() => ({ roster: [] })))
    const issues = await runCoverageCheck([client('Test Player One', { org: 'Sample Independent Club' })], { now: DECEMBER, fetchJson })
    expect(issues).toMatchObject([{ kind: 'no-id-no-match', orgKnown: false, org: 'Sample Independent Club' }])
  })
})

describe('runCoverageCheck: fields the map cannot place (c)', () => {
  const venueGame = (homeId: number, awayId: number, venue: Record<string, unknown>) => ({
    teams: { home: { team: { id: homeId } }, away: { team: { id: awayId } } }, venue,
  })
  const schedule = {
    dates: [
      { games: [
        venueGame(587, 999, { id: 99001, name: 'Sample Field', location: { city: 'Sampletown', stateAbbrev: 'FL', country: 'USA' } }),
        venueGame(999, 587, { id: 99002, name: 'Mapped Park', location: { city: 'Elsewhere', country: 'USA', defaultCoordinates: { latitude: 27.9, longitude: -82.5 } } }),
        venueGame(611, 999, { id: 99003, name: 'Sample DR Complex', location: { city: 'Boca Chica', country: 'DOM' } }),
      ] },
      { games: [
        venueGame(587, 999, { id: 99001, name: 'Sample Field', location: { city: 'Sampletown', stateAbbrev: 'FL', country: 'USA' } }),
      ] },
    ],
  }
  const routes: Route[] = [
    [/teams\?sportId=1&/, MLB_TEAMS],
    [/\/people\?/, people([
      { id: 900001, currentTeam: { id: 587, name: 'Tampa Tarpons', parentOrgId: 147 } },
      { id: 900002, currentTeam: { id: 611, name: 'DSL Sample Club', parentOrgId: 147 } },
    ])],
    [/\/schedule\?/, schedule],
  ]

  it('in season, flags a U.S. field with no location that the fallback table lacks, counting games', async () => {
    const { fetchJson, calls } = fakeFetch(routes)
    const issues = await runCoverageCheck([
      client('Test Player One', { mlbId: 900001 }),
      client('Test Player Two', { mlbId: 900002 }), // Dominican complex: out of scope
    ], { now: JULY, fetchJson, venueFallback: noFallback })
    expect(issues).toEqual([{
      kind: 'unmapped-venue', key: 'venue:99001:test player one', client: 'Test Player One',
      venueId: 99001, venue: 'Sample Field', place: 'Sampletown, FL', games: 2,
    }])
    const sched = calls.find((u) => u.includes('/schedule?'))!
    expect(sched).toContain('startDate=2026-07-01&endDate=2026-07-07')
    expect(sched).not.toContain('611') // DSL club never even asked for
  })

  it('a field the fallback table knows is fine', async () => {
    const { fetchJson } = fakeFetch(routes)
    const issues = await runCoverageCheck([client('Test Player One', { mlbId: 900001 })], {
      now: JULY, fetchJson, venueFallback: ({ venueId }) => (venueId === 99001 ? { lat: 1, lng: 2 } : null),
    })
    expect(issues).toEqual([])
  })

  it('out of season it does not ask for schedules at all', async () => {
    const { fetchJson, calls } = fakeFetch(routes)
    expect(await runCoverageCheck([client('Test Player One', { mlbId: 900001 })], { now: DECEMBER, fetchJson, venueFallback: noFallback })).toEqual([])
    expect(calls.some((u) => u.includes('/schedule?'))).toBe(false)
  })
})

describe('runCoverageCheck: Arizona Fall League (c, d)', () => {
  const routes: Route[] = [
    [/teams\?sportId=1&/, MLB_TEAMS],
    [/teams\?sportId=17&/, { teams: [
      { id: 454, name: 'Glendale Desert Dogs', league: { name: 'Arizona Fall League' } },
      { id: 777, name: 'Sample Winter Club', league: { name: 'Sample Winter League' } },
    ] }],
    [/teams\/454\/roster/, { roster: [
      { person: { id: 900001, fullName: 'Test Player One' } },
      { person: { id: 900005, fullName: 'Renée Fíxture Jr.' } },
    ] }],
    [/\/people\?/, people([
      { id: 900001, currentTeam: { id: 454, name: 'Glendale Desert Dogs', parentOrgId: 147 } },
      { id: 900002, currentTeam: { id: 587, name: 'Tampa Tarpons', parentOrgId: 147 } },
    ])],
    [/teams\/affiliates/, { teams: [] }],
    [/\/schedule\?/, (url: string) => {
      expect(url).toContain('teamId=454&') // only the fall club, not the regular-season club
      return { dates: [{ games: [{
        teams: { home: { team: { id: 454 } }, away: { team: { id: 999 } } },
        venue: { id: 99010, name: 'Sample Fall Park', location: { city: 'Glendale', stateAbbrev: 'AZ', country: 'USA' } },
      }] }] }
    }],
  ]

  it('in October, flags the fall club field and a fall leaguer with no MLB id (accent-insensitive)', async () => {
    const { fetchJson } = fakeFetch(routes)
    const issues = await runCoverageCheck([
      client('Test Player One', { mlbId: 900001 }),
      client('Test Player Two', { mlbId: 900002 }),
      client('Renee Fixture Jr', { mlbId: null }),
    ], { now: OCTOBER, fetchJson, venueFallback: noFallback })
    expect(kinds(issues)).toEqual(['afl-no-id', 'unmapped-venue'])
    expect(issues.find((i) => i.kind === 'afl-no-id')).toMatchObject({ client: 'Renee Fixture Jr', club: 'Glendale Desert Dogs', mlbId: 900005 })
    expect(issues.find((i) => i.kind === 'unmapped-venue')).toMatchObject({ client: 'Test Player One', venue: 'Sample Fall Park' })
  })

  it('personKey ignores accents, periods and spacing', () => {
    expect(personKey(' Renée  Fíxture Jr. ')).toBe(personKey('Renee Fixture Jr'))
  })
})

describe('coverageFindings (alert copy)', () => {
  const issues: CoverageIssue[] = [
    { kind: 'unmapped-venue', key: 'venue:1:a', client: 'Test Player One', venueId: 1, venue: 'Sample Field', place: 'Sampletown, FL', games: 2 },
    { kind: 'unmapped-venue', key: 'venue:1:b', client: 'Test Player Two', venueId: 1, venue: 'Sample Field', place: 'Sampletown, FL', games: 2 },
    { kind: 'org-mismatch', key: 'org:1:113', client: 'Test Player Three', rosterOrg: 'New York Yankees', mlbOrg: 'Cincinnati Reds' },
    { kind: 'no-id-no-match', key: 'no-id:x', client: 'Test Player Four', org: 'New York Mets', orgKnown: true },
    { kind: 'afl-no-id', key: 'afl-no-id:9', client: 'Test Player Five', club: 'Glendale Desert Dogs', mlbId: 900009 },
  ]

  it('one finding per kind, each partial and carrying its item keys', () => {
    const fs = coverageFindings(issues)
    expect(fs.map((f) => f.key)).toEqual(['coverage:venue', 'coverage:org', 'coverage:no-id', 'coverage:afl-no-id'])
    expect(fs.every((f) => f.partial)).toBe(true)
    expect(fs[0]!.issueKeys).toEqual(['venue:1:a', 'venue:1:b'])
  })

  it('reads like the example alert', () => {
    const venue = coverageFindings(issues)[0]!
    expect(venue.title).toBe("2 clients have games the map can't place")
    expect(venue.what).toBe("Test Player One and Test Player Two have games in the next week that the hub can't place on the map, so those games don't show.")
    expect(venue.how).toContain('Sample Field (Sampletown, FL)')
    expect(venue.todo).toBe('Open sv-travel-hub in Claude Code and add the field to the venue fallback table.')
    expect(venue.code).toBe(true)
    const org = coverageFindings(issues)[1]!
    expect(org.what).toContain('Test Player Three (roster: New York Yankees, MLB: Cincinnati Reds)')
    expect(org.code).toBe(false)
  })

  it('no issues, no findings', () => {
    expect(coverageFindings([])).toEqual([])
  })
})
