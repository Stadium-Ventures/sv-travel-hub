import { describe, it, expect } from 'vitest'
import type { RosterPlayer } from '../../types/roster'
import { isSharpDrop, sharpDropMessage, findRenames, renameKeys, renameSeedFrom } from '../rosterSafety'

// Synthetic players only.
function player(name: string, over: Partial<RosterPlayer> = {}): RosterPlayer {
  return {
    playerName: name, normalizedName: name.toLowerCase(), org: 'Test U', level: 'Pro', isJuco: false,
    mlbPlayerId: null, pgPlayerId: null, position: 'SS', state: 'FL', draftClass: '', tier: 2, leadAgent: '',
    visitTarget2026: 3, visitsCompleted: 0, lastVisitDate: null, visitsRemaining: 3, status: '',
    ...over,
  }
}

describe('isSharpDrop', () => {
  it('flags more than a quarter fewer clients, not a quarter or less', () => {
    expect(isSharpDrop(100, 74)).toBe(true)
    expect(isSharpDrop(100, 75)).toBe(false)
    expect(isSharpDrop(100, 120)).toBe(false)
  })
  it('never flags without a previous count', () => {
    expect(isSharpDrop(null, 1)).toBe(false)
    expect(isSharpDrop(0, 1)).toBe(false)
  })
  it('message is plain text: no long dashes, ellipses or emojis', () => {
    expect(sharpDropMessage(40, 60)).not.toMatch(/[–—…]|\.\.\.|\p{Extended_Pictographic}/u)
  })
})

describe('findRenames', () => {
  it('matches by slug first, then MLB id', () => {
    const prior = renameSeedFrom([
      player('Old Slug Name', { slug: 'p-one' }),
      player('Old Mlb Name', { mlbPlayerId: 123 }),
      player('Same Name', { mlbPlayerId: 456 }),
    ])
    const next = [
      player('New Slug Name', { slug: 'p-one' }),
      player('New Mlb Name', { mlbPlayerId: 123 }),
      player('Same Name', { mlbPlayerId: 456 }),
    ]
    expect(findRenames(prior, next)).toEqual({ 'Old Slug Name': 'New Slug Name', 'Old Mlb Name': 'New Mlb Name' })
  })

  it('skips a rename when the old name still belongs to someone on the new roster', () => {
    const prior = renameSeedFrom([player('Taken', { mlbPlayerId: 1 })])
    const next = [player('Moved', { mlbPlayerId: 1 }), player('Taken', { mlbPlayerId: 2 })]
    expect(findRenames(prior, next)).toEqual({})
  })

  it('a seed keeps only players it can recognise', () => {
    expect(renameSeedFrom([player('No Ids'), player('Has Id', { mlbPlayerId: 7 })])).toEqual([
      { mlbPlayerId: 7, playerName: 'Has Id' },
    ])
  })
})

describe('renameKeys', () => {
  it('moves keys, keeps an entry already under the new name, and maps keys via keyOf', () => {
    expect(renameKeys({ Old: 1, Other: 2 }, { Old: 'New' })).toEqual({ New: 1, Other: 2 })
    expect(renameKeys({ Old: 1, New: 9 }, { Old: 'New' })).toEqual({ New: 9 })
    expect(renameKeys({ 'old name': 1 }, { 'Old Name': 'New Name' }, (n) => n.toLowerCase())).toEqual({ 'new name': 1 })
  })
  it('returns the same object when nothing moved', () => {
    const rec = { A: 1 }
    expect(renameKeys(rec, { B: 'C' })).toBe(rec)
  })
})
