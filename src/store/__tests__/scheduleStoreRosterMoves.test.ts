import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The schedule store persists to IndexedDB, which node doesn't have.
vi.mock('../../lib/idbStorage', () => ({
  idbStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}))

import { useScheduleStore, type PlayerTeamAssignment } from '../scheduleStore'
import { useRosterStore } from '../rosterStore'
import { useDiagnosticsStore } from '../diagnosticsStore'
import type { RosterPlayer } from '../../types/roster'
import type { MLBAffiliate, MLBGameRaw } from '../../lib/mlbApi'
import { TXNS_2026, AFFILIATES } from '../../lib/__tests__/fixtures/rosterMoves2026'

function player(playerName: string, mlbPlayerId: number, org: string): RosterPlayer {
  return {
    playerName, normalizedName: playerName.toLowerCase(), org, level: 'Pro', isJuco: false,
    mlbPlayerId, pgPlayerId: null, position: 'P', state: '', draftClass: '', tier: 2, leadAgent: '',
    visitTarget2026: 0, visitsCompleted: 0, lastVisitDate: null, visitsRemaining: 0, status: '',
  }
}

const affiliates: MLBAffiliate[] = AFFILIATES.map((a) => ({ ...a, sportName: '' }))
const ABQ: PlayerTeamAssignment = { teamId: 342, sportId: 11, teamName: 'Albuquerque Isotopes', source: 'milb-roster' }
const WOR: PlayerTeamAssignment = { teamId: 533, sportId: 11, teamName: 'Worcester Red Sox', source: 'milb-roster' }

function game(gamePk: number, date: string, homeId: number, homeName: string): MLBGameRaw {
  return {
    gamePk, gameDate: `${date}T23:00:00Z`, officialDate: date, gameType: 'R',
    teams: { home: { team: { id: homeId, name: homeName } }, away: { team: { id: 1, name: 'Visitors' } } },
    venue: { id: 1, name: `${homeName} Park`, location: { defaultCoordinates: { latitude: 39.7, longitude: -105 } } },
    status: { detailedState: 'Scheduled' },
  }
}

// The API's raw shape for the transactions endpoint.
const rawTxns = TXNS_2026.map((t) => ({ ...t, person: t.player }))

type Route = (url: string) => unknown
function stubFetch(route: Route) {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    urls.push(input)
    return new Response(JSON.stringify(route(input) ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return urls
}

beforeEach(() => {
  useDiagnosticsStore.getState().clearAll()
  useRosterStore.setState({
    players: [
      player('Player A', 1001, 'Colorado Rockies'),
      player('Player C', 1003, 'Colorado Rockies'),
      player('Player B', 1002, 'Boston Red Sox'),
    ],
    shrinkBlocked: null,
  })
  useScheduleStore.setState({
    affiliates,
    playerTeamAssignments: { 'Player A': ABQ, 'Player C': ABQ, 'Player B': WOR },
    aflAssignments: {},
    assignmentLog: [],
    rosterMoves: [],
    rosterMovesLoading: false,
    rosterMovesCheckedAt: null,
    rosterReleases: {},
    assignmentsVerifiedAt: null,
    playerVerifiedAt: null,
    assignmentsRecheckedAt: null,
    autoAssignLoading: false,
    schedulesLoading: false,
    proFetchedAt: 1,
    proGamesBuiltAt: 1,
    proSchedules: {
      115: [game(1, '2027-03-25', 115, 'Colorado Rockies')],
      342: [game(2, '2027-03-26', 342, 'Albuquerque Isotopes')],
      111: [game(3, '2027-03-25', 111, 'Boston Red Sox')],
      533: [game(4, '2027-03-26', 533, 'Worcester Red Sox')],
    },
    proGames: [],
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('checkRosterMoves', () => {
  it('ends on the MLB clubs, logs one row per player, rebuilds games, and is quiet on a second run', async () => {
    const urls = stubFetch((url) => (url.includes('/transactions?') ? { transactions: rawTxns } : {}))
    await useScheduleStore.getState().checkRosterMoves()

    const s = useScheduleStore.getState()
    expect(urls.some((u) => u.includes('/transactions?playerId='))).toBe(true)
    expect(s.playerTeamAssignments['Player A']?.teamId).toBe(115)
    expect(s.playerTeamAssignments['Player C']?.teamId).toBe(115)
    expect(s.playerTeamAssignments['Player B']?.teamId).toBe(111)
    expect(s.assignmentLog).toHaveLength(3)
    expect(s.assignmentLog.every((e) => e.action === 'reassigned')).toBe(true)

    // Games were rebuilt for the new clubs without a manual reload, so the
    // stale-schedules banner has nothing to show.
    const gordonGames = s.proGames.filter((g) => g.playerNames.includes('Player A'))
    expect(gordonGames.map((g) => g.homeTeam)).toEqual(['Colorado Rockies'])
    expect(s.proGamesBuiltAt! >= s.assignmentLog[0]!.timestamp).toBe(true)

    await useScheduleStore.getState().checkRosterMoves()
    expect(useScheduleStore.getState().assignmentLog).toHaveLength(3)
  })

  it('clears a client who elected free agency, warns staff, and Check Assignments keeps it cleared', async () => {
    const fa = {
      id: 999, person: { id: 1001, fullName: 'Player A' }, toTeam: { id: 342, name: 'Albuquerque Isotopes' },
      typeCode: 'DFA', typeDesc: 'Declared Free Agency', date: '2026-11-06', effectiveDate: '2026-11-06',
      description: 'RHP Player A elected free agency.',
    }
    stubFetch((url) => (url.includes('/transactions?') ? { transactions: [...rawTxns, fa] } : {}))
    await useScheduleStore.getState().checkRosterMoves()

    let s = useScheduleStore.getState()
    expect(s.playerTeamAssignments['Player A']).toBeUndefined()
    expect(s.rosterReleases['Player A']).toMatchObject({ typeCode: 'DFA', teamName: 'Albuquerque Isotopes' })
    const warnings = useDiagnosticsStore.getState().issues.filter((i) => i.source === 'moves')
    expect(warnings.map((w) => w.message)).toContain(
      'Player A elected free agency from the Albuquerque Isotopes on Nov 6, 2026. Removed from Pro schedules. If his status with SV changed, update his record in sv-registry.',
    )

    // Live rosters don't list him anywhere: the old team must not come back.
    useScheduleStore.setState({ playerTeamAssignments: { ...s.playerTeamAssignments, 'Player A': ABQ } })
    stubFetch(() => ({ roster: [] }))
    await useScheduleStore.getState().autoAssignPlayers()
    s = useScheduleStore.getState()
    expect(s.playerTeamAssignments['Player A']).toBeUndefined()
    expect(s.rosterReleases['Player A']).toBeDefined()
  })

  it('warns when a trade puts a client in a different org than the roster sheet', async () => {
    useScheduleStore.setState({
      affiliates: [...affiliates, { teamId: 136, teamName: 'Seattle Mariners', sportId: 1, sportName: '', parentOrgId: 136 }],
    })
    const trade = {
      id: 1000, person: { id: 1003, fullName: 'Player C' }, fromTeam: { id: 115, name: 'Colorado Rockies' },
      toTeam: { id: 136, name: 'Seattle Mariners' }, typeCode: 'TR', typeDesc: 'Trade',
      date: '2026-12-02', effectiveDate: '2026-12-02', description: 'Colorado Rockies traded RF Player C to Seattle Mariners.',
    }
    stubFetch((url) => (url.includes('/transactions?') ? { transactions: [...rawTxns, trade] } : {}))
    await useScheduleStore.getState().checkRosterMoves()
    expect(useScheduleStore.getState().playerTeamAssignments['Player C']?.teamId).toBe(136)
    const msgs = useDiagnosticsStore.getState().issues.filter((i) => i.source === 'moves').map((i) => i.message)
    expect(msgs.some((m) => m.startsWith('Player C is with the Seattle Mariners organization now'))).toBe(true)
  })
})

describe('autoAssignPlayers in spring training mode', () => {
  it('puts 40-man players on the big-league club instead of estimating from last year', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-02-10T15:00:00Z'))
    useRosterStore.setState({
      players: [
        player('Player A', 1001, 'Colorado Rockies'),
        player('Player C', 1003, 'Colorado Rockies'),
        player('Prospect Player', 900001, 'Colorado Rockies'),
      ],
    })
    useScheduleStore.setState({ playerTeamAssignments: {} })
    const person = (id: number, fullName: string) => ({ person: { id, fullName }, position: { code: 'P' }, status: { code: 'A' } })
    stubFetch((url) => {
      if (url.includes('/teams/115/roster?rosterType=active') || url.includes('/teams/115/roster?rosterType=40Man')) {
        return { roster: [person(1001, 'Player A'), person(1003, 'Player C')] }
      }
      // Last season's full lists name everyone who passed through, options
      // and rehab stints included.
      if (url.includes('/teams/342/roster?rosterType=fullRoster&season=2026')) {
        return { roster: [person(1001, 'Player A'), person(1003, 'Player C')] }
      }
      if (url.includes('/teams/538/roster?rosterType=fullRoster&season=2026')) {
        return { roster: [person(900001, 'Prospect Player')] }
      }
      return { roster: [] }
    })
    await useScheduleStore.getState().autoAssignPlayers()
    const a = useScheduleStore.getState().playerTeamAssignments
    expect(a['Player A']).toMatchObject({ teamId: 115, source: 'mlb-roster' })
    expect(a['Player C']).toMatchObject({ teamId: 115, source: 'mlb-roster' })
    // Not on the 40-man: still estimated, one level up from last year (AA to AAA).
    expect(a['Prospect Player']).toMatchObject({ teamId: 342, source: 'estimated' })
    expect(useScheduleStore.getState().assignmentsVerifiedAt).toBe(Date.parse('2027-02-10T15:00:00Z'))
  })
})

describe('teams keep up with moves (2026-10-29)', () => {
  const SEA = { teamId: 136, teamName: 'Seattle Mariners', sportId: 1, sportName: '', parentOrgId: 136 }
  const TAC = { teamId: 529, teamName: 'Tacoma Rainiers', sportId: 11, sportName: '', parentOrgId: 136 }
  const person = (id: number, fullName: string) => ({ person: { id, fullName }, position: { code: 'P' }, status: { code: 'A' } })

  it('still reads a trade filed before a Check Assignments that could not find the client', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-05T15:00:00Z'))
    const checkedAt = Date.parse('2026-12-03T15:00:00Z')
    useScheduleStore.setState({
      affiliates: [...affiliates, SEA],
      assignmentsVerifiedAt: checkedAt,
      // Player C wasn't on any roster his listed org searched: no time.
      playerVerifiedAt: { 'Player A': checkedAt, 'Player B': checkedAt },
    })
    const trade = {
      id: 1000, person: { id: 1003, fullName: 'Player C' }, fromTeam: { id: 115, name: 'Colorado Rockies' },
      toTeam: { id: 136, name: 'Seattle Mariners' }, typeCode: 'TR', typeDesc: 'Trade',
      date: '2026-12-02', effectiveDate: '2026-12-02', description: 'Colorado Rockies traded RF Player C to Seattle Mariners.',
    }
    const urls = stubFetch((url) => {
      if (!url.includes('/transactions?')) return {}
      const start = /startDate=([\d-]+)/.exec(url)![1]!
      return { transactions: start <= '2026-12-02' ? [trade] : [] }
    })
    await useScheduleStore.getState().checkRosterMoves()

    const txUrls = urls.filter((u) => u.includes('/transactions?'))
    expect(txUrls).toHaveLength(2)
    expect(txUrls.some((u) => u.includes('playerId=1003') && u.includes('startDate=2025-12-05'))).toBe(true)
    expect(txUrls.some((u) => u.includes('startDate=2026-12-03') && !u.includes('1003'))).toBe(true)
    expect(useScheduleStore.getState().playerTeamAssignments['Player C']?.teamId).toBe(136)
  })

  it('re-checks only the client whose team is outside his listed org, searching both orgs, and leaves the rest alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-15T15:00:00Z'))
    const { recheckAssignmentsIfDue } = await import('../recheckAssignments')
    const handSet: PlayerTeamAssignment = { ...WOR, source: 'manual' }
    const traded: PlayerTeamAssignment = { teamId: 136, sportId: 1, teamName: 'Seattle Mariners' } // set by the moves check
    useScheduleStore.setState({
      affiliates: [...affiliates, SEA, TAC],
      playerTeamAssignments: { 'Player A': ABQ, 'Player C': traded, 'Player B': handSet },
      assignmentsVerifiedAt: Date.parse('2026-07-13T15:00:00Z'),
      assignmentsRecheckedAt: null,
      playerVerifiedAt: {},
      autoAssignResult: { assigned: 3, confirmed: 3, estimated: 0, notFound: [] },
    })
    const urls = stubFetch((url) => (url.includes('/teams/529/roster') ? { roster: [person(1003, 'Player C')] } : { roster: [] }))

    const changed = await recheckAssignmentsIfDue()

    const s = useScheduleStore.getState()
    expect(s.playerTeamAssignments['Player C']).toMatchObject({ teamId: 529, source: 'milb-roster' })
    expect(s.playerTeamAssignments['Player A']).toBe(ABQ)
    expect(s.playerTeamAssignments['Player B']).toBe(handSet)
    expect(changed.sort()).toEqual([136, 529])
    // Searched the new org's rosters, not just the listed one.
    expect(urls.some((u) => u.includes('/teams/529/roster'))).toBe(true)
    expect(s.playerVerifiedAt).toEqual({ 'Player C': Date.parse('2026-07-15T15:00:00Z') })
    // A few-client run is not a full check.
    expect(s.assignmentsVerifiedAt).toBe(Date.parse('2026-07-13T15:00:00Z'))
    expect(s.assignmentsRecheckedAt).toBe(Date.parse('2026-07-15T15:00:00Z'))
    expect(s.autoAssignResult).toMatchObject({ assigned: 3 })

    // Same day again: nothing is due.
    expect(await recheckAssignmentsIfDue()).toEqual([])
  })

  it('runs a full check once a week, leaving hand-set teams alone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-15T15:00:00Z'))
    const { recheckAssignmentsIfDue } = await import('../recheckAssignments')
    const handSet: PlayerTeamAssignment = { ...WOR, source: 'manual' }
    useScheduleStore.setState({
      playerTeamAssignments: { 'Player A': ABQ, 'Player C': ABQ, 'Player B': handSet },
      assignmentsVerifiedAt: Date.parse('2026-07-01T15:00:00Z'),
      playerVerifiedAt: null,
    })
    stubFetch((url) => (url.includes('/teams/342/roster') ? { roster: [person(1001, 'Player A'), person(1003, 'Player C')] } : { roster: [] }))
    await recheckAssignmentsIfDue()
    const s = useScheduleStore.getState()
    expect(s.assignmentsVerifiedAt).toBe(Date.parse('2026-07-15T15:00:00Z'))
    expect(s.playerTeamAssignments['Player B']).toBe(handSet)
    expect(Object.keys(s.playerVerifiedAt ?? {}).sort()).toEqual(['Player A', 'Player C'])
  })

  it('does not prune anyone while a much smaller roster is waiting to be confirmed', () => {
    useRosterStore.setState({ players: [player('Player A', 1001, 'Colorado Rockies')], shrinkBlocked: { count: 1, previous: 3 } })
    useScheduleStore.getState().pruneRemovedPlayers()
    expect(Object.keys(useScheduleStore.getState().playerTeamAssignments).sort()).toEqual(['Player A', 'Player B', 'Player C'])
    useRosterStore.setState({ shrinkBlocked: null })
    useScheduleStore.getState().pruneRemovedPlayers()
    expect(Object.keys(useScheduleStore.getState().playerTeamAssignments)).toEqual(['Player A'])
  })
})
