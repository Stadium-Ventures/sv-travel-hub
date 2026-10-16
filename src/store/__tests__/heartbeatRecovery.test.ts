import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RosterPlayer } from '../../types/roster'

// Review 2026-10-16, items 1 and 3:
// 1. After a token-less attempt ('signed-out'), signing in and then hitting
//    an outage left the bar offering a sign-in that refetched nothing.
// 2. Heartbeat visit counts that arrived before the (registry) roster were
//    dropped for the whole session.

// rosterStore prunes the other stores on success; keep them inert here.
vi.mock('../scheduleStore', () => ({ useScheduleStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))
vi.mock('../tripStore', () => ({ useTripStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))
vi.mock('../rehabStore', () => ({ useRehabStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))
vi.mock('../summerStore', () => ({ useSummerStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))

const { useHeartbeatStore, shouldRefetchOnSignIn } = await import('../heartbeatStore')
const { useRosterStore } = await import('../rosterStore')
const { __setIdTokenForTests } = await import('../../lib/googleAuth')

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
const freshToken = () => fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, hd: 'stadium-ventures.com' })

function stubHeartbeat(status: number, visitCounts: Record<string, unknown> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const body = url.endsWith('/visit-priority') ? { priorities: [] }
      : url.endsWith('/summary') ? { players: [] }
      : visitCounts
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }))
}

// Synthetic player only.
function player(name: string): RosterPlayer {
  return {
    playerName: name, normalizedName: name.toLowerCase(), org: 'Test U', level: 'NCAA', isJuco: false,
    mlbPlayerId: null, pgPlayerId: null, position: 'SS', state: 'FL', draftClass: '', tier: 2, leadAgent: '',
    visitTarget2026: 3, visitsCompleted: 0, lastVisitDate: null, visitsRemaining: 3, status: '',
  }
}

beforeEach(() => {
  __setIdTokenForTests(null)
  useHeartbeatStore.setState({ loading: false, error: null, authState: 'ok', lastFetchSentToken: false })
  useRosterStore.setState({ players: [], visitOverrides: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  __setIdTokenForTests(null)
})

describe('Heartbeat sign-in recovery', () => {
  it('an outage after signing in clears the sign-in state and lets the next credential refetch', async () => {
    stubHeartbeat(200)
    await useHeartbeatStore.getState().fetchHeartbeat()
    expect(useHeartbeatStore.getState().authState).toBe('signed-out')

    __setIdTokenForTests(freshToken())
    vi.unstubAllGlobals()
    stubHeartbeat(404)
    await useHeartbeatStore.getState().fetchHeartbeat()
    let s = useHeartbeatStore.getState()
    expect(s.authState).toBe('ok') // no sign-in bar for a non-auth failure
    expect(s.error).toMatch(/404/)
    expect(shouldRefetchOnSignIn(s)).toBe(true)

    vi.unstubAllGlobals()
    stubHeartbeat(200)
    await useHeartbeatStore.getState().fetchHeartbeat()
    s = useHeartbeatStore.getState()
    expect(s.authState).toBe('ok')
    expect(s.error).toBeNull()
    expect(shouldRefetchOnSignIn(s)).toBe(false)
  })

  it('never refetches on a new credential after Heartbeat turned the token down', async () => {
    __setIdTokenForTests(freshToken())
    stubHeartbeat(401)
    await useHeartbeatStore.getState().fetchHeartbeat()
    const s = useHeartbeatStore.getState()
    expect(s.authState).toBe('denied')
    expect(shouldRefetchOnSignIn(s)).toBe(false)
  })

  it('a token-less attempt always refetches once a credential arrives', () => {
    expect(shouldRefetchOnSignIn({ loading: false, authState: 'signed-out', lastFetchSentToken: false, error: 'x' })).toBe(true)
    expect(shouldRefetchOnSignIn({ loading: true, authState: 'signed-out', lastFetchSentToken: false, error: 'x' })).toBe(false)
  })
})

describe('Heartbeat visit counts vs an empty roster', () => {
  it('applies the counts once the roster arrives instead of dropping them', async () => {
    __setIdTokenForTests(freshToken())
    stubHeartbeat(200, {
      'Test Player': { name: 'Test Player', calendarYear: 2, lastVisitDate: '2026-10-01T15:00:00Z' },
    })
    await useHeartbeatStore.getState().fetchHeartbeat()
    await new Promise((r) => setTimeout(r, 150)) // past the deferred apply
    expect(useRosterStore.getState().visitOverrides).toEqual({})

    useRosterStore.setState({ players: [player('Test Player')] })
    const s = useRosterStore.getState()
    expect(s.visitOverrides['Test Player']).toMatchObject({ visitsCompleted: 2, lastVisitDate: '2026-10-01' })
    expect(typeof s.visitOverrides['Test Player']!.appliedAt).toBe('string')
    expect(s.players[0]!.visitsCompleted).toBe(2)
  })
})
