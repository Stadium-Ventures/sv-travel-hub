import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { RosterPlayer } from '../../types/roster'

// Pre-merge checks for the ROSTER_SOURCE switch (PR #9):
// 1. With VITE_ROSTER_SOURCE unset the store reads the sheet and never calls
//    the registry, so merging is a no-op until the env var is set.
// 2. On the registry source, a failure after a good load keeps the roster on
//    screen (no empty map), makes exactly one request, and never reads the
//    sheet behind the viewer's back.

const sheetFetch = vi.fn()
vi.mock('../../lib/csv', () => ({ fetchRoster: () => sheetFetch() }))

// The other stores prune against the roster on success; keep them inert here.
vi.mock('../scheduleStore', () => ({ useScheduleStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))
vi.mock('../tripStore', () => ({ useTripStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))
vi.mock('../rehabStore', () => ({ useRehabStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))
vi.mock('../summerStore', () => ({ useSummerStore: { getState: () => ({ pruneRemovedPlayers: () => {} }) } }))

const { useRosterStore } = await import('../rosterStore')
const { __setIdTokenForTests } = await import('../../lib/googleAuth')

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
const freshToken = () => fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, hd: 'stadium-ventures.com' })

// Synthetic fixture only.
function player(i: number): RosterPlayer {
  return {
    playerName: `Test Player ${i}`,
    slug: `test-player-${i}`,
    org: 'Test University',
    level: 'NCAA',
    tier: 2,
    visitsCompleted: 0,
    visitTarget: 3,
    lastVisitDate: null,
  } as unknown as RosterPlayer
}
const previousRoster = Array.from({ length: 60 }, (_, i) => player(i + 1))

beforeEach(() => {
  sheetFetch.mockReset()
  __setIdTokenForTests(null)
  useRosterStore.setState({ players: [], loading: false, error: null, needsSignIn: false, source: null })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __setIdTokenForTests(null)
})

describe('default source', () => {
  it('reads the sheet and never calls the registry when VITE_ROSTER_SOURCE is unset', async () => {
    vi.stubEnv('VITE_ROSTER_SOURCE', '')
    sheetFetch.mockResolvedValue({ players: previousRoster, warnings: [] })
    const net = vi.fn()
    vi.stubGlobal('fetch', net)

    await useRosterStore.getState().fetchRoster()

    const s = useRosterStore.getState()
    expect(sheetFetch).toHaveBeenCalledTimes(1)
    expect(net).not.toHaveBeenCalled()
    expect(s.source).toBe('sheet')
    expect(s.players).toHaveLength(60)
    expect(s.needsSignIn).toBe(false)
  })
})

describe('registry failure after a good load', () => {
  const failures: Array<[string, () => Promise<Response>]> = [
    ['HTTP 500', async () => new Response('boom', { status: 500 })],
    ['network error', async () => { throw new TypeError('Failed to fetch') }],
    ['short roster below the floor', async () => new Response(JSON.stringify({
      _meta: { generated_at: '2026-10-01T00:00:00Z', contains_no_contact_data: true, rows: 3 },
      rows: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })],
  ]

  for (const [label, respond] of failures) {
    it(`${label}: keeps the previous roster, one request, no sheet read`, async () => {
      vi.stubEnv('VITE_ROSTER_SOURCE', 'registry')
      __setIdTokenForTests(freshToken())
      useRosterStore.setState({ players: previousRoster, source: 'registry' })
      const net = vi.fn(respond)
      vi.stubGlobal('fetch', net)

      await useRosterStore.getState().fetchRoster()
      await new Promise((r) => setTimeout(r, 20))

      const s = useRosterStore.getState()
      expect(s.players).toHaveLength(60)
      expect(s.error).toBeTruthy()
      expect(s.loading).toBe(false)
      expect(s.needsSignIn).toBe(false)
      expect(net).toHaveBeenCalledTimes(1)
      expect(sheetFetch).not.toHaveBeenCalled()
    })
  }
})
