import { describe, it, expect } from 'vitest'
import type { RosterPlayer } from '../../types/roster'
import { applyOverrides, pruneOverrides, playerKey, overrideKeyForName } from '../rosterOverrides'

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
    const [p] = applyOverrides([renamed], { 'test-one': { visitsCompleted: 2, lastVisitDate: '2026-06-01' } })
    expect(p!.visitsCompleted).toBe(2)
    expect(p!.visitsRemaining).toBe(3)
  })

  it('moves a legacy name-keyed override onto the slug on the first registry load', () => {
    const pruned = pruneOverrides(
      { 'Test One': { visitsCompleted: 1, lastVisitDate: null }, 'Gone Player': { visitsCompleted: 4, lastVisitDate: null } },
      [player('Test One', 'test-one')],
    )
    expect(pruned).toEqual({ 'test-one': { visitsCompleted: 1, lastVisitDate: null } })
  })

  it('writes new overrides under the slug when the caller only knows the name', () => {
    const players = [player('Test One', 'test-one'), player('Legacy Two')]
    expect(overrideKeyForName(players, 'Test One')).toBe('test-one')
    expect(overrideKeyForName(players, 'Legacy Two')).toBe('Legacy Two')
    expect(overrideKeyForName(players, 'Unknown')).toBe('Unknown')
  })
})
