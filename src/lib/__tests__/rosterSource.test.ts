import { describe, it, expect } from 'vitest'
import { parseRosterSource } from '../rosterSource'
import { isTokenFresh, decodeJwtPayload, getIdToken, __setIdTokenForTests } from '../googleAuth'

function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

describe('ROSTER_SOURCE switch (browser)', () => {
  it('defaults to sheet', () => {
    expect(parseRosterSource(undefined)).toBe('sheet')
    expect(parseRosterSource('')).toBe('sheet')
    expect(parseRosterSource(' Sheet ')).toBe('sheet')
  })
  it('accepts registry', () => {
    expect(parseRosterSource('registry')).toBe('registry')
  })
  it('throws on a typo instead of silently reading the sheet', () => {
    expect(() => parseRosterSource('regsitry')).toThrow(/VITE_ROSTER_SOURCE/)
  })
})

describe('Google ID token handling (memory only)', () => {
  const now = Date.UTC(2026, 8, 24, 12)
  it('decodes the payload and checks expiry with skew', () => {
    const t = fakeJwt({ exp: now / 1000 + 3600, hd: 'stadium-ventures.com' })
    expect(decodeJwtPayload(t)?.hd).toBe('stadium-ventures.com')
    expect(isTokenFresh(t, now)).toBe(true)
    expect(isTokenFresh(fakeJwt({ exp: now / 1000 + 30 }), now)).toBe(false)
    expect(isTokenFresh(null, now)).toBe(false)
    expect(isTokenFresh('garbage', now)).toBe(false)
  })
  it('getIdToken drops an expired token (so the loader fails with "sign in")', () => {
    __setIdTokenForTests(fakeJwt({ exp: 1 }))
    expect(getIdToken()).toBeNull()
    const fresh = fakeJwt({ exp: Date.now() / 1000 + 3600 })
    __setIdTokenForTests(fresh)
    expect(getIdToken()).toBe(fresh)
    __setIdTokenForTests(null)
  })
})
