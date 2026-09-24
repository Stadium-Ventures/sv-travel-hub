import { describe, it, expect } from 'vitest'
import { rosterSource, rosterCsvRequest, checkRowFloor, RosterConfigError, DEFAULT_MIN_ROWS } from '../rosterSource'

describe('ROSTER_SOURCE switch (serverless crons)', () => {
  it('defaults to the sheet and needs VITE_ROSTER_CSV_URL there', () => {
    expect(rosterSource({})).toBe('sheet')
    expect(() => rosterCsvRequest({})).toThrow(RosterConfigError)
    const r = rosterCsvRequest({ VITE_ROSTER_CSV_URL: 'https://sheet.test/pub?output=csv' })
    expect(r).toMatchObject({ source: 'sheet', url: 'https://sheet.test/pub?output=csv', headers: {} })
  })

  it('registry: uses the CSV door with the service token as Bearer', () => {
    const r = rosterCsvRequest({ VITE_ROSTER_SOURCE: 'registry', SV_REGISTRY_ROSTER_TOKEN: 'svt_test', VITE_ROSTER_CSV_URL: 'https://sheet.test' })
    expect(r.source).toBe('registry')
    expect(r.url).toBe('https://sv-registry.vercel.app/api/roster-projection?format=csv')
    expect(r.headers.Authorization).toBe('Bearer svt_test')
    expect(r.label).not.toContain('svt_')
  })

  it('registry without a token fails closed, never falls back to the sheet URL', () => {
    let err: unknown
    try {
      rosterCsvRequest({ VITE_ROSTER_SOURCE: 'registry', VITE_ROSTER_CSV_URL: 'https://sheet.test' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(RosterConfigError)
    expect((err as RosterConfigError).todo).toContain('mint-service-token.cjs mint sv-travel-hub --scopes read:roster-projection')
  })

  it('ROSTER_SOURCE overrides VITE_ROSTER_SOURCE; typos throw', () => {
    expect(rosterSource({ ROSTER_SOURCE: 'sheet', VITE_ROSTER_SOURCE: 'registry' })).toBe('sheet')
    expect(() => rosterSource({ VITE_ROSTER_SOURCE: 'both' })).toThrow(RosterConfigError)
  })

  it('honours a custom registry URL', () => {
    const r = rosterCsvRequest({ VITE_ROSTER_SOURCE: 'registry', SV_REGISTRY_ROSTER_TOKEN: 't', REGISTRY_ROSTER_URL: 'https://reg.test/api/roster-projection?view=working' })
    expect(r.url).toBe('https://reg.test/api/roster-projection?view=working&format=csv')
  })

  it('fails closed below the row floor on the registry source only', () => {
    expect(checkRowFloor('registry', DEFAULT_MIN_ROWS - 1, {})).toMatch(/fail-closed/)
    expect(checkRowFloor('registry', DEFAULT_MIN_ROWS, {})).toBeNull()
    expect(checkRowFloor('sheet', 0, {})).toBeNull()
    expect(checkRowFloor('registry', 20, { ROSTER_MIN_ROWS: '10' })).toBeNull()
  })
})
