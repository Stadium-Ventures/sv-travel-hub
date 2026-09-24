import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __setIdTokenForTests, peekIdToken } from '../../lib/googleAuth'
import { classifyHeartbeatAuth, heartbeatAuthMessage, heartbeatRequestInit, proactiveSignInEnabled } from '../../lib/heartbeatAuth'
import { useHeartbeatStore } from '../heartbeatStore'

// Synthetic unsigned JWT; heartbeat verifies real ones, the page only reads exp.
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}
const freshToken = () => fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600, hd: 'stadium-ventures.com' })

type Call = { url: string; init?: RequestInit }

function stubFetch(statusFor: (url: string) => number) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const status = statusFor(url)
    const body = url.endsWith('/visit-priority') ? { priorities: [] } : url.endsWith('/summary') ? { players: [] } : {}
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }))
  return calls
}

function authHeader(c: Call): string | undefined {
  const h = c.init?.headers as Record<string, string> | undefined
  return h?.Authorization
}

beforeEach(() => {
  __setIdTokenForTests(null)
  useHeartbeatStore.setState({ loading: false, error: null, authState: 'ok', lastFetchSentToken: false })
})
afterEach(() => {
  vi.unstubAllGlobals()
  __setIdTokenForTests(null)
})

describe('heartbeatAuth helpers', () => {
  it('builds a Bearer only when there is a token', () => {
    expect(heartbeatRequestInit(null)).toEqual({})
    expect(heartbeatRequestInit('abc')).toEqual({ headers: { Authorization: 'Bearer abc' } })
  })
  it('classifies 401/403 by whether a token was sent', () => {
    expect(classifyHeartbeatAuth(200, false)).toBeNull()
    expect(classifyHeartbeatAuth(500, true)).toBeNull()
    expect(classifyHeartbeatAuth(401, false)).toBe('signed-out')
    expect(classifyHeartbeatAuth(401, true)).toBe('denied')
    expect(classifyHeartbeatAuth(403, true)).toBe('denied')
  })
  it('messages are plain text with no emojis, long dashes or ellipses', () => {
    for (const m of [heartbeatAuthMessage('signed-out'), heartbeatAuthMessage('denied', 401)]) {
      expect(m).toBeTruthy()
      expect(m!).not.toMatch(/[–—…]|\.\.\.|\p{Extended_Pictographic}/u)
    }
    expect(heartbeatAuthMessage('ok')).toBeNull()
  })
  it('proactive sign-in is off unless VITE_HEARTBEAT_SIGN_IN is 1/true', () => {
    expect(proactiveSignInEnabled(undefined)).toBe(false)
    expect(proactiveSignInEnabled('')).toBe(false)
    expect(proactiveSignInEnabled('0')).toBe(false)
    expect(proactiveSignInEnabled('1')).toBe(true)
    expect(proactiveSignInEnabled(' TRUE ')).toBe(true)
  })
})

describe('heartbeatStore.fetchHeartbeat credentials', () => {
  it('signed out: sends the same credential-less requests as before (no-op)', async () => {
    const calls = stubFetch(() => 200)
    await useHeartbeatStore.getState().fetchHeartbeat()
    expect(calls).toHaveLength(3)
    for (const c of calls) expect(authHeader(c)).toBeUndefined()
    const s = useHeartbeatStore.getState()
    expect(s.authState).toBe('ok')
    expect(s.lastFetchSentToken).toBe(false)
    expect(s.error).toBeNull()
  })

  it('signed in: sends the Google ID token as Bearer on all three calls', async () => {
    const t = freshToken()
    __setIdTokenForTests(t)
    const calls = stubFetch(() => 200)
    await useHeartbeatStore.getState().fetchHeartbeat()
    expect(calls).toHaveLength(3)
    for (const c of calls) expect(authHeader(c)).toBe(`Bearer ${t}`)
    expect(useHeartbeatStore.getState().lastFetchSentToken).toBe(true)
  })

  it('an expired token is not sent', async () => {
    __setIdTokenForTests(fakeJwt({ exp: 1 }))
    const calls = stubFetch(() => 200)
    await useHeartbeatStore.getState().fetchHeartbeat()
    for (const c of calls) expect(authHeader(c)).toBeUndefined()
  })

  it('401 with no token: asks for sign-in, one request per endpoint (no retry)', async () => {
    const calls = stubFetch(() => 401)
    await useHeartbeatStore.getState().fetchHeartbeat()
    expect(calls).toHaveLength(3)
    const s = useHeartbeatStore.getState()
    expect(s.authState).toBe('signed-out')
    expect(s.error).toMatch(/sign in/)
    expect(s.loading).toBe(false)
  })

  it('401 with a fresh token: shows the error and KEEPS the token (no One Tap re-sign loop)', async () => {
    const t = freshToken()
    __setIdTokenForTests(t)
    const calls = stubFetch((url) => (url.endsWith('/summary') ? 401 : 200))
    await useHeartbeatStore.getState().fetchHeartbeat()
    expect(calls).toHaveLength(3)
    const s = useHeartbeatStore.getState()
    expect(s.authState).toBe('denied')
    expect(s.error).toMatch(/HTTP 401/)
    expect(peekIdToken()).toBe(t)
  })

  it('recovers to ok on the next good answer', async () => {
    stubFetch(() => 401)
    await useHeartbeatStore.getState().fetchHeartbeat()
    expect(useHeartbeatStore.getState().authState).toBe('signed-out')
    vi.unstubAllGlobals()
    __setIdTokenForTests(freshToken())
    stubFetch(() => 200)
    await useHeartbeatStore.getState().fetchHeartbeat()
    expect(useHeartbeatStore.getState().authState).toBe('ok')
    expect(useHeartbeatStore.getState().error).toBeNull()
  })
})
