import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RosterPlayer } from '../../types/roster'

// Review 2026-10-16, items 2, 4 and 5:
// 2. A failure after signing in (403, outage) left the "Sign in" bar up.
// 4. A roster far smaller than the last good one must not prune anything.
// 5. A client whose display name changed between rosters (sheet spelling vs
//    registry canon) keeps their name-keyed state instead of being pruned.

const sheetFetch = vi.fn()
vi.mock('../../lib/csv', () => ({ fetchRoster: () => sheetFetch() }))

// Minimal stand-ins for the name-keyed stores: real setState semantics, and
// a prune that records it ran.
const prunes: string[] = []
function fakeStore<T extends object>(name: string, initial: T) {
  let state = { ...initial, pruneRemovedPlayers: () => { prunes.push(name) } }
  return {
    getState: () => state,
    setState: (patch: Partial<T>) => { state = { ...state, ...patch } },
    reset: (next: T) => { state = { ...next, pruneRemovedPlayers: () => { prunes.push(name) } } },
  }
}
const schedule = fakeStore('schedule', { playerTeamAssignments: {} as Record<string, unknown>, aflAssignments: {} as Record<string, unknown> })
const trip = fakeStore('trip', { priorityPlayers: [] as string[] })
const rehab = fakeStore('rehab', { windows: {} as Record<string, unknown> })
const summer = fakeStore('summer', {})
vi.mock('../scheduleStore', () => ({ useScheduleStore: schedule }))
vi.mock('../tripStore', () => ({ useTripStore: trip }))
vi.mock('../rehabStore', () => ({ useRehabStore: rehab }))
vi.mock('../summerStore', () => ({ useSummerStore: summer }))

const { useRosterStore } = await import('../rosterStore')
const { useDiagnosticsStore } = await import('../diagnosticsStore')
const { __setIdTokenForTests } = await import('../../lib/googleAuth')

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
const freshToken = () => fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, hd: 'stadium-ventures.com' })

// Synthetic players only.
function player(i: number, over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    playerName: `Test Player ${i}`, normalizedName: `test player ${i}`, org: 'Test U', level: 'Pro', isJuco: false,
    mlbPlayerId: 900000 + i, pgPlayerId: null, position: 'SS', state: 'FL', draftClass: '', tier: 2, leadAgent: '',
    visitTarget2026: 3, visitsCompleted: 0, lastVisitDate: null, visitsRemaining: 3, status: '',
    ...over,
  }
}
const roster = (n: number) => Array.from({ length: n }, (_, i) => player(i + 1))

beforeEach(() => {
  sheetFetch.mockReset()
  prunes.length = 0
  __setIdTokenForTests(null)
  useDiagnosticsStore.getState().clearAll()
  schedule.reset({ playerTeamAssignments: {}, aflAssignments: {} })
  trip.reset({ priorityPlayers: [] })
  rehab.reset({ windows: {} })
  useRosterStore.setState({
    players: [], loading: false, error: null, needsSignIn: false, source: null,
    visitOverrides: {}, lastGoodCount: null, shrinkBlocked: null, renameSeed: [],
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __setIdTokenForTests(null)
})

describe('registry sign-in bar clears on any outcome after sign-in', () => {
  const outcomes: Array<[string, () => Promise<Response>, RegExp]> = [
    ['403 access', async () => new Response('{}', { status: 403 }), /403/],
    ['HTTP 500', async () => new Response('boom', { status: 500 }), /500/],
    ['network error', async () => { throw new TypeError('Failed to fetch') }, /Failed to fetch/],
  ]
  for (const [label, respond, errorText] of outcomes) {
    it(`${label}: needsSignIn goes false and the real error shows`, async () => {
      vi.stubEnv('VITE_ROSTER_SOURCE', 'registry')
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
      await useRosterStore.getState().fetchRoster()
      expect(useRosterStore.getState().needsSignIn).toBe(true)

      __setIdTokenForTests(freshToken())
      vi.stubGlobal('fetch', vi.fn(respond))
      await useRosterStore.getState().fetchRoster()
      const s = useRosterStore.getState()
      expect(s.needsSignIn).toBe(false)
      expect(s.error).toMatch(errorText)
    })
  }

  it('an expired token on Refresh keeps the loaded roster and asks for sign-in without an error', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', 'registry')
    useRosterStore.setState({ players: roster(60), source: 'registry' })
    __setIdTokenForTests(fakeJwt({ exp: 1, hd: 'stadium-ventures.com' }))
    vi.stubGlobal('fetch', vi.fn())
    await useRosterStore.getState().fetchRoster()
    const s = useRosterStore.getState()
    expect(s.players).toHaveLength(60)
    expect(s.needsSignIn).toBe(true)
    expect(s.error).toBeNull()
  })
})

describe('sharp-drop guard', () => {
  it('shows a roster more than a quarter smaller but prunes nothing, keeps the last good count and files a plain warning', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', 'sheet')
    useRosterStore.setState({
      players: roster(60),
      lastGoodCount: 60,
      visitOverrides: { 'Test Player 50': { visitsCompleted: 2, lastVisitDate: null, appliedAt: new Date().toISOString() } },
    })
    sheetFetch.mockResolvedValue({ players: roster(40), warnings: [] })

    await useRosterStore.getState().fetchRoster()

    const s = useRosterStore.getState()
    expect(s.players).toHaveLength(40)
    expect(s.shrinkBlocked).toEqual({ count: 40, previous: 60 })
    expect(s.error).toBeNull()
    expect(s.lastGoodCount).toBe(60)
    expect(s.visitOverrides['Test Player 50']).toBeDefined()
    expect(prunes).toEqual([])
    const issues = useDiagnosticsStore.getState().issues
    expect(issues).toHaveLength(1)
    expect(issues[0]!.level).toBe('warning')
    expect(issues[0]!.message).toMatch(/40 clients, down from 60/)
    expect(issues[0]!.message).not.toMatch(/[–—…]|\.\.\./)
  })

  it('a smaller drop goes through', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', 'sheet')
    useRosterStore.setState({ players: roster(60), lastGoodCount: 60 })
    sheetFetch.mockResolvedValue({ players: roster(50), warnings: [] })
    await useRosterStore.getState().fetchRoster()
    expect(useRosterStore.getState().players).toHaveLength(50)
    expect(useRosterStore.getState().lastGoodCount).toBe(50)
    expect(prunes).toEqual(['schedule', 'trip', 'rehab', 'summer'])
  })

  it('uses the persisted count when the roster itself is not persisted (registry source)', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', 'sheet')
    useRosterStore.setState({ players: [], lastGoodCount: 92 })
    sheetFetch.mockResolvedValue({ players: roster(55), warnings: [] })
    await useRosterStore.getState().fetchRoster()
    // Shown, so the app isn't empty on every reload, but still guarded.
    expect(useRosterStore.getState().players).toHaveLength(55)
    expect(useRosterStore.getState().shrinkBlocked).toEqual({ count: 55, previous: 92 })
    expect(useRosterStore.getState().lastGoodCount).toBe(92)
    expect(prunes).toEqual([])
  })

  it('"Confirm the smaller roster" accepts it and prunes', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', 'sheet')
    useRosterStore.setState({ players: roster(60), lastGoodCount: 60 })
    sheetFetch.mockResolvedValue({ players: roster(40), warnings: [] })
    await useRosterStore.getState().fetchRoster()
    expect(useRosterStore.getState().shrinkBlocked).not.toBeNull()

    await useRosterStore.getState().acceptSmallerRoster()
    const s = useRosterStore.getState()
    expect(s.players).toHaveLength(40)
    expect(s.shrinkBlocked).toBeNull()
    expect(s.error).toBeNull()
    expect(s.lastGoodCount).toBe(40)
    expect(prunes).toEqual(['schedule', 'trip', 'rehab', 'summer'])

    // The override is one-shot: the next ordinary fetch is guarded again.
    sheetFetch.mockResolvedValue({ players: roster(20), warnings: [] })
    await useRosterStore.getState().fetchRoster()
    expect(useRosterStore.getState().shrinkBlocked).toEqual({ count: 20, previous: 40 })
    expect(useRosterStore.getState().lastGoodCount).toBe(40)
    expect(prunes).toEqual(['schedule', 'trip', 'rehab', 'summer'])
  })
})

describe('renamed clients keep their name-keyed state', () => {
  it('carries assignments, priority picks, rehab windows and visit overrides to the new name (same MLB id)', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', 'sheet')
    const before = roster(60)
    useRosterStore.setState({
      players: before,
      lastGoodCount: 60,
      visitOverrides: { 'Test Player 1': { visitsCompleted: 2, lastVisitDate: null, appliedAt: new Date().toISOString() } },
    })
    schedule.reset({ playerTeamAssignments: { 'Test Player 1': { teamId: 1 } }, aflAssignments: { 'Test Player 1': { teamId: 2 } } })
    trip.reset({ priorityPlayers: ['Test Player 1', 'Test Player 2'] })
    rehab.reset({ windows: { 'test player 1': { w: 1 } } })

    const after = roster(60)
    after[0] = player(1, { playerName: 'Renamed Player 1', normalizedName: 'renamed player 1' })
    sheetFetch.mockResolvedValue({ players: after, warnings: [] })
    await useRosterStore.getState().fetchRoster()

    expect(schedule.getState().playerTeamAssignments).toEqual({ 'Renamed Player 1': { teamId: 1 } })
    expect(schedule.getState().aflAssignments).toEqual({ 'Renamed Player 1': { teamId: 2 } })
    expect(trip.getState().priorityPlayers).toEqual(['Renamed Player 1', 'Test Player 2'])
    expect(rehab.getState().windows).toEqual({ 'renamed player 1': { w: 1 } })
    const s = useRosterStore.getState()
    expect(s.visitOverrides['Renamed Player 1']).toMatchObject({ visitsCompleted: 2 })
    expect(s.players[0]!.visitsCompleted).toBe(2)
  })

  it('the first registry load uses the sheet snapshot seed (slug or MLB id) and then clears it', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', 'sheet') // sheet fetch stands in for the registry result here
    useRosterStore.setState({
      players: [],
      renameSeed: [{ mlbPlayerId: 900001, playerName: 'Sheet Spelling 1' }],
    })
    trip.reset({ priorityPlayers: ['Sheet Spelling 1'] })
    sheetFetch.mockResolvedValue({ players: roster(60), warnings: [] })
    await useRosterStore.getState().fetchRoster()
    expect(trip.getState().priorityPlayers).toEqual(['Test Player 1'])
    expect(useRosterStore.getState().renameSeed).toEqual([])
  })
})
