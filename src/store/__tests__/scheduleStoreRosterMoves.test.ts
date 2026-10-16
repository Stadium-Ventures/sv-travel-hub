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
    gamePk, gameDate: `${date}T23:00:00Z`, officialDate: date,
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
      'Player A elected free agency from the Albuquerque Isotopes on Nov 6, 2026. Removed from Pro schedules. Update the roster sheet.',
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
