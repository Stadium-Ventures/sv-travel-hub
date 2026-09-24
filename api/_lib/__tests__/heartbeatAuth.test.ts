import { describe, it, expect } from 'vitest'
import { heartbeatAccessFinding, heartbeatReadHeaders, heartbeatTokenConfigured } from '../heartbeatAuth'

// Synthetic value only; never a real token.
const FAKE = 'test-read-token-0123456789abcdef'
const ENV_URL = 'https://vercel.example/env'

describe('heartbeatReadHeaders (server-only HEARTBEAT_READ_TOKEN)', () => {
  it('sends no Authorization header when the token is absent (no-op before heartbeat gates)', () => {
    expect(heartbeatReadHeaders({})).toEqual({})
    expect(heartbeatReadHeaders({ HEARTBEAT_READ_TOKEN: '   ' })).toEqual({})
    expect(heartbeatTokenConfigured({})).toBe(false)
  })
  it('sends Bearer <token> when set, trimmed', () => {
    expect(heartbeatReadHeaders({ HEARTBEAT_READ_TOKEN: ` ${FAKE}\n` })).toEqual({ Authorization: `Bearer ${FAKE}` })
    expect(heartbeatTokenConfigured({ HEARTBEAT_READ_TOKEN: FAKE })).toBe(true)
  })
  it('never reads a VITE_ variant (that would be a bundled secret)', () => {
    expect(heartbeatReadHeaders({ VITE_HEARTBEAT_READ_TOKEN: FAKE })).toEqual({})
  })
})

describe('heartbeatAccessFinding', () => {
  const base = { tokenSet: false, weekly: false, envUrl: ENV_URL }

  it('is silent when heartbeat answers normally, with or without a gate header', () => {
    expect(heartbeatAccessFinding({ status: 200, svAuth: null }, base)).toBeNull()
    expect(heartbeatAccessFinding({ status: 200, svAuth: 'ok (read-token:sv-travel-hub)' }, { ...base, weekly: true })).toBeNull()
  })

  it('leaves plain outages to the existing finding', () => {
    expect(heartbeatAccessFinding({ status: 503, svAuth: null }, base)).toBeNull()
    expect(heartbeatAccessFinding({ status: null, svAuth: null }, base)).toBeNull()
  })

  it('401 with no token: lockout, tells you to set HEARTBEAT_READ_TOKEN, every run', () => {
    const f = heartbeatAccessFinding({ status: 401, svAuth: 'denied (no credential)' }, base)
    expect(f).not.toBeNull()
    expect(f!.what).toMatch(/locked out of Heartbeat/)
    expect(f!.how).toMatch(/HTTP 401.*not set/)
    expect(f!.todo).toMatch(/HEARTBEAT_READ_TOKEN/)
    expect(f!.todo).toMatch(/no VITE_ prefix/)
    expect(f!.todo).toContain(ENV_URL)
    expect(f!.code).toBe(false)
  })

  it('401 with a token set: says the value does not match', () => {
    const f = heartbeatAccessFinding({ status: 401, svAuth: null }, { ...base, tokenSet: true })
    expect(f!.how).toMatch(/even though HEARTBEAT_READ_TOKEN is set/)
    expect(f!.todo).toMatch(/^Re-copy/)
  })

  it('403: points at the heartbeat read-token path list', () => {
    const f = heartbeatAccessFinding({ status: 403, svAuth: null }, { ...base, tokenSet: true })
    expect(f!.how).toMatch(/403/)
    expect(f!.todo).toMatch(/READ_TOKEN_PATHS/)
  })

  it('observe-mode would-401: weekly heads-up only', () => {
    const probe = { status: 200, svAuth: 'would-401: no credential' }
    expect(heartbeatAccessFinding(probe, base)).toBeNull()
    const f = heartbeatAccessFinding(probe, { ...base, weekly: true })
    expect(f!.what).toMatch(/will lock Travel Hub out/)
    expect(f!.how).toMatch(/no read token/)
    const g = heartbeatAccessFinding({ status: 200, svAuth: 'would-401: unknown bearer' }, { ...base, weekly: true, tokenSet: true })
    expect(g!.how).toMatch(/would be refused/)
  })

  it('findings use plain text: no long dashes or ellipses', () => {
    const all = [
      heartbeatAccessFinding({ status: 401, svAuth: null }, base),
      heartbeatAccessFinding({ status: 401, svAuth: null }, { ...base, tokenSet: true }),
      heartbeatAccessFinding({ status: 403, svAuth: null }, base),
      heartbeatAccessFinding({ status: 200, svAuth: 'would-401: x' }, { ...base, weekly: true }),
    ]
    for (const f of all) {
      const text = `${f!.what} ${f!.how} ${f!.todo}`
      expect(text).not.toMatch(/[–—…]|\.\.\./)
    }
  })
})
