import { describe, it, expect, vi } from 'vitest'
import {
  mapProjectionRow,
  mapLevel,
  projectionToRoster,
  fetchRegistryRoster,
  RosterAuthError,
  RosterScopeError,
  RosterContractError,
  DEFAULT_MIN_ROWS,
  type ProjectionRow,
} from '../registryRoster'

// Synthetic fixtures only. No real player data anywhere in this file.
function row(i: number, over: Partial<ProjectionRow> = {}): ProjectionRow {
  return {
    slug: `test-player-${i}`,
    name: `Test Player ${i}`,
    mlb_id: null,
    tier: 'amt',
    level: 'NCAA',
    sheet_level: 'NCAA',
    org: 'Test University',
    team: null,
    affiliate: null,
    priority_tier: 2,
    lead_agent: 'Agent A',
    visits: { target_2026: 3, observed_2026_count: 1, last_observed: '2026-05-01' },
    is_client: true,
    career_status: 'active',
    is_coach: false,
    position: 'SS',
    draft_class: '2027',
    home_state: 'GA',
    high_school: 'Test High',
    sheet_status: '',
    ...over,
  }
}

function payload(rows: ProjectionRow[], meta: Record<string, unknown> = {}) {
  return { _meta: { generated_at: '2026-09-24T12:00:00.000Z', contains_no_contact_data: true, rows: rows.length, ...meta }, rows }
}

const many = (n: number, over: (i: number) => Partial<ProjectionRow> = () => ({})) =>
  Array.from({ length: n }, (_, i) => row(i + 1, over(i + 1)))

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('mapProjectionRow', () => {
  it('maps projection fields onto RosterPlayer', () => {
    const p = mapProjectionRow(row(1, { mlb_id: 123456, priority_tier: 1, sheet_level: 'Pro', level: 'AA', org: 'Test Org' }))
    expect(p).toMatchObject({
      slug: 'test-player-1',
      playerName: 'Test Player 1',
      normalizedName: 'test player 1',
      org: 'Test Org',
      level: 'Pro',
      isJuco: false,
      mlbPlayerId: 123456,
      pgPlayerId: null,
      position: 'SS',
      state: 'GA',
      draftClass: '2027',
      tier: 1,
      leadAgent: 'Agent A',
      visitTarget2026: 3,
      visitsCompleted: 1,
      lastVisitDate: '2026-05-01',
      visitsRemaining: 2,
      status: '',
    })
  })

  it('uses priority_tier (1-4), never the pro/amt/coach tier', () => {
    expect(mapProjectionRow(row(1, { tier: 'pro', priority_tier: 3 })).tier).toBe(3)
  })

  it('defaults a missing priority tier to T2 with a warning, and derives the visit target', () => {
    const warnings: string[] = []
    const p = mapProjectionRow(row(1, { priority_tier: null, visits: null }), warnings)
    expect(p.tier).toBe(2)
    expect(p.visitTarget2026).toBe(3) // TIER_VISIT_TARGETS[2]
    expect(p.visitsCompleted).toBe(0)
    expect(p.lastVisitDate).toBeNull()
    expect(warnings.some((w) => w.includes('T2'))).toBe(true)
  })

  it('maps sheet_status, falling back to career_status=retired', () => {
    expect(mapProjectionRow(row(1, { sheet_status: 'Injured' })).status).toBe('Injured')
    expect(mapProjectionRow(row(1, { sheet_status: '', career_status: 'retired' })).status).toBe('Retired')
  })

  it('never copies contact or unknown fields, even if a row carries them', () => {
    const tainted = row(1, { phone: 'x', email: 'x', father: 'x', mother: 'x', dob: 'x', age: 1, contact: { phone: 'x' } } as Partial<ProjectionRow>)
    const p = mapProjectionRow(tainted) as unknown as Record<string, unknown>
    for (const k of ['phone', 'email', 'father', 'mother', 'dob', 'age', 'contact']) expect(p).not.toHaveProperty(k)
  })
})

describe('mapLevel', () => {
  it('buckets registry levels into Pro / NCAA / HS and keeps JUCO', () => {
    expect(mapLevel({ sheet_level: 'HS' }).level).toBe('HS')
    expect(mapLevel({ sheet_level: 'JUCO' })).toMatchObject({ level: 'NCAA', isJuco: true })
    expect(mapLevel({ sheet_level: 'NCAA' })).toMatchObject({ level: 'NCAA', isJuco: false })
    for (const l of ['MLB', 'AAA', 'AA', 'High-A', 'Low-A', 'Rookie', 'Winter Leagues', 'Pro']) {
      expect(mapLevel({ sheet_level: null, level: l }).level).toBe('Pro')
    }
  })
})

describe('projectionToRoster', () => {
  it('returns players keyed by slug plus generated_at', () => {
    const r = projectionToRoster(payload(many(DEFAULT_MIN_ROWS)))
    expect(r.players).toHaveLength(DEFAULT_MIN_ROWS)
    expect(new Set(r.players.map((p) => p.slug)).size).toBe(DEFAULT_MIN_ROWS)
    expect(r.generatedAt).toBe('2026-09-24T12:00:00.000Z')
  })

  it('drops coaches and former clients, like the sheet coach filter', () => {
    const rows = many(DEFAULT_MIN_ROWS, (i) => (i === 1 ? { is_coach: true } : i === 2 ? { is_client: false } : {}))
    const r = projectionToRoster(payload(rows))
    expect(r.players.map((p) => p.slug)).not.toContain('test-player-1')
    expect(r.players.map((p) => p.slug)).not.toContain('test-player-2')
    expect(r.players).toHaveLength(DEFAULT_MIN_ROWS - 2)
  })

  it('skips duplicate slugs and slug-less rows with a warning', () => {
    const rows = [...many(DEFAULT_MIN_ROWS), row(1), row(0, { slug: '' })]
    const r = projectionToRoster(payload(rows))
    expect(r.players).toHaveLength(DEFAULT_MIN_ROWS)
    expect(r.warnings.some((w) => w.includes('duplicate slug'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('no slug'))).toBe(true)
  })

  it('fails closed below the row floor', () => {
    expect(() => projectionToRoster(payload(many(DEFAULT_MIN_ROWS - 1)))).toThrow(RosterContractError)
    expect(() => projectionToRoster(payload(many(5)), { minRows: 10 })).toThrow(/below the fail-closed floor of 10/)
    expect(projectionToRoster(payload(many(5)), { minRows: 5 }).players).toHaveLength(5)
  })

  it('refuses a payload that does not assert contains_no_contact_data', () => {
    expect(() => projectionToRoster(payload(many(DEFAULT_MIN_ROWS), { contains_no_contact_data: false }))).toThrow(/contains_no_contact_data/)
    expect(() => projectionToRoster({ rows: many(DEFAULT_MIN_ROWS) })).toThrow(/_meta/)
    expect(() => projectionToRoster('nope')).toThrow(RosterContractError)
  })

  it('falls back to the X-Roster-Generated-At header for freshness', () => {
    const body = payload(many(5), { generated_at: '' })
    expect(projectionToRoster(body, { minRows: 5, generatedAtHeader: '2026-09-24T00:00:00Z' }).generatedAt).toBe('2026-09-24T00:00:00Z')
  })
})

describe('fetchRegistryRoster', () => {
  it('fails with RosterAuthError and makes no request when there is no token', async () => {
    const fetchImpl = vi.fn()
    await expect(fetchRegistryRoster({ getToken: () => null, fetchImpl })).rejects.toBeInstanceOf(RosterAuthError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the ID token as a Bearer credential, no cookies, no cache', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(payload(many(DEFAULT_MIN_ROWS))))
    const r = await fetchRegistryRoster({ getToken: async () => 'id.token.value', fetchImpl, url: 'https://registry.test/api/roster-projection' })
    expect(r.players).toHaveLength(DEFAULT_MIN_ROWS)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://registry.test/api/roster-projection')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer id.token.value')
    expect(init.cache).toBe('no-store')
    expect(init.credentials).toBe('omit')
  })

  it('maps 401 to RosterAuthError(401) and 403 to RosterScopeError', async () => {
    const e401 = await fetchRegistryRoster({ getToken: () => 't', fetchImpl: async () => jsonResponse({}, 401) }).catch((e) => e)
    expect(e401).toBeInstanceOf(RosterAuthError)
    expect((e401 as RosterAuthError).status).toBe(401)
    await expect(fetchRegistryRoster({ getToken: () => 't', fetchImpl: async () => jsonResponse({}, 403) })).rejects.toBeInstanceOf(RosterScopeError)
    await expect(fetchRegistryRoster({ getToken: () => 't', fetchImpl: async () => jsonResponse({}, 500) })).rejects.toThrow(/HTTP 500/)
  })

  it('fails closed on a short response instead of returning a partial roster', async () => {
    await expect(
      fetchRegistryRoster({ getToken: () => 't', minRows: 10, fetchImpl: async () => jsonResponse(payload(many(3))) }),
    ).rejects.toBeInstanceOf(RosterContractError)
  })
})
