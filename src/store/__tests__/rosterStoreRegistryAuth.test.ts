import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __setIdTokenForTests, onAuthChange, peekIdToken } from '../../lib/googleAuth'
import { REGISTRY_REJECTED_MESSAGE, useRosterStore } from '../rosterStore'

// Known issue 2 in the cutover kit: on a registry 401 the store called
// invalidateIdToken(), One Tap auto-select re-signed, the sign-in bar
// refetched, and a persistent 401 looped. On a 401 the store must show the
// error and keep the token (no auth-change event, no second request).

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
const freshToken = () => fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, hd: 'stadium-ventures.com' })

function stubFetch(status: number) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.stubEnv('VITE_ROSTER_SOURCE', 'registry')
  __setIdTokenForTests(null)
  useRosterStore.setState({ loading: false, error: null, needsSignIn: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __setIdTokenForTests(null)
})

describe('rosterStore on the registry source: 401 handling', () => {
  it('401 with a fresh token: shows the error, keeps the token, does not re-prompt or refetch', async () => {
    const token = freshToken()
    __setIdTokenForTests(token)
    const fetchMock = stubFetch(401)
    const authEvents = vi.fn()
    const off = onAuthChange(authEvents)

    await useRosterStore.getState().fetchRoster()
    await new Promise((r) => setTimeout(r, 20))
    off()

    const s = useRosterStore.getState()
    expect(s.error).toBe(REGISTRY_REJECTED_MESSAGE)
    expect(s.needsSignIn).toBe(false) // no sign-in bar: signing in again will not fix a config 401
    expect(s.loading).toBe(false)
    expect(peekIdToken()).toBe(token) // not invalidated
    expect(authEvents).not.toHaveBeenCalled() // nothing to trigger a One Tap refetch
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${token}`)
  })

  it('the error text is plain: no emojis, long dashes or ellipses', () => {
    expect(REGISTRY_REJECTED_MESSAGE).not.toMatch(/[–—…]|\.\.\.|\p{Extended_Pictographic}/u)
  })

  it('no token: asks for sign-in and sends no request', async () => {
    const fetchMock = stubFetch(200)
    await useRosterStore.getState().fetchRoster()
    const s = useRosterStore.getState()
    expect(s.needsSignIn).toBe(true)
    expect(s.error).toMatch(/Sign in/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403 is an access problem: no sign-in bar, token kept', async () => {
    const token = freshToken()
    __setIdTokenForTests(token)
    stubFetch(403)
    await useRosterStore.getState().fetchRoster()
    const s = useRosterStore.getState()
    expect(s.needsSignIn).toBe(false)
    expect(s.error).toMatch(/403/)
    expect(peekIdToken()).toBe(token)
  })
})
