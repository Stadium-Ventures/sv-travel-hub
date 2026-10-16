import { describe, it, expect } from 'vitest'
import type { RosterPlayer } from '../../types/roster'
import { applyOverrides, pruneOverrides, playerKey, overrideKeyForName, isOverrideFresh, OVERRIDE_MAX_AGE_MS } from '../rosterOverrides'

const NOW = Date.parse('2026-10-16T12:00:00Z')
const fresh = new Date(NOW - 3600_000).toISOString()

// Synthetic players only.
function player(name: string, slug?: string): RosterPlayer {
  return {
    ...(slug ? { slug } : {}),
    playerName: name,
    normalizedName: name.toLowerCase(),
    org: 'Test Org',
    level: 'Pro',
    isJuco: false,
    mlbPlayerId: null,
    pgPlayerId: null,
    position: 'SS',
    state: 'FL',
    draftClass: '',
    tier: 1,
    leadAgent: '',
    visitTarget2026: 5,
    visitsCompleted: 0,
    lastVisitDate: null,
    visitsRemaining: 5,
    status: '',
  }
}

describe('visit overrides keyed by slug', () => {
  it('playerKey prefers slug, falls back to display name', () => {
    expect(playerKey(player('Test One', 'test-one'))).toBe('test-one')
    expect(playerKey(player('Test One'))).toBe('Test One')
  })

  it('applies slug-keyed overrides and ignores a renamed display name', () => {
    const renamed = player('T. One', 'test-one')
    const [p] = applyOverrides([renamed], { 'test-one': { visitsCompleted: 2, lastVisitDate: '2026-06-01', appliedAt: fresh } }, NOW)
    expect(p!.visitsCompleted).toBe(2)
    expect(p!.visitsRemaining).toBe(3)
  })

  it('moves a legacy name-keyed override onto the slug on the first registry load', () => {
    const pruned = pruneOverrides(
      { 'Test One': { visitsCompleted: 1, lastVisitDate: null, appliedAt: fresh }, 'Gone Player': { visitsCompleted: 4, lastVisitDate: null, appliedAt: fresh } },
      [player('Test One', 'test-one')],
      NOW,
    )
    expect(pruned).toEqual({ 'test-one': { visitsCompleted: 1, lastVisitDate: null, appliedAt: fresh } })
  })

  it('writes new overrides under the slug when the caller only knows the name', () => {
    const players = [player('Test One', 'test-one'), player('Legacy Two')]
    expect(overrideKeyForName(players, 'Test One')).toBe('test-one')
    expect(overrideKeyForName(players, 'Legacy Two')).toBe('Legacy Two')
    expect(overrideKeyForName(players, 'Unknown')).toBe('Unknown')
  })
})

describe('visit override age limit', () => {
  const stale = new Date(NOW - OVERRIDE_MAX_AGE_MS - 60_000).toISOString()

  it('an override older than the limit stops applying, so the roster count shows', () => {
    const p = { ...player('Test One', 'test-one'), visitsCompleted: 4 }
    const [out] = applyOverrides([p], { 'test-one': { visitsCompleted: 1, lastVisitDate: null, appliedAt: stale } }, NOW)
    expect(out!.visitsCompleted).toBe(4)
  })

  it('prune drops expired and unstamped overrides, keeps fresh ones', () => {
    const pruned = pruneOverrides(
      {
        'test-one': { visitsCompleted: 1, lastVisitDate: null, appliedAt: stale },
        'test-two': { visitsCompleted: 2, lastVisitDate: null },
        'test-three': { visitsCompleted: 3, lastVisitDate: null, appliedAt: fresh },
      },
      [player('Test One', 'test-one'), player('Test Two', 'test-two'), player('Test Three', 'test-three')],
      NOW,
    )
    expect(Object.keys(pruned)).toEqual(['test-three'])
  })

  it('isOverrideFresh is true inside the window and false for bad stamps', () => {
    expect(isOverrideFresh({ visitsCompleted: 1, lastVisitDate: null, appliedAt: fresh }, NOW)).toBe(true)
    expect(isOverrideFresh({ visitsCompleted: 1, lastVisitDate: null, appliedAt: 'nope' }, NOW)).toBe(false)
    expect(isOverrideFresh({ visitsCompleted: 1, lastVisitDate: null }, NOW)).toBe(false)
  })
})
