import { describe, it, expect } from 'vitest'
import { parseSummerPlacementRows } from '../../data/summerLeagues'

describe('parseSummerPlacementRows', () => {
  it('skips section and column headers, NEED PLACEMENT, and blank placements', () => {
    const rows = [
      ['2027 Draft Players', '', '', '', ''],
      ['Player', 'School', 'Team', 'League', 'Status'],
      ['Riley Goodman', 'SC', 'Harwich Mariners', 'CCBL', 'Confirmed'],
      ['Zack Johnson', 'Alabama', 'Amsterdam Mohawks', 'PGCBL', 'Shut Down'],
      ['NEED PLACEMENT', '', '', '', ''],
      ['Nobody Yet', 'UCLA', '', '', ''],
    ]
    const { placements, warnings } = parseSummerPlacementRows(rows)
    expect(placements.map((p) => p.playerName)).toEqual(['Riley Goodman', 'Zack Johnson'])
    expect(placements[0]!.league).toBe('CCBL')
    expect(placements[1]!.active).toBe(false)
    expect(warnings).toEqual([])
  })

  it('maps league aliases and warns on unknown leagues or missing teams', () => {
    const { placements, warnings } = parseSummerPlacementRows([
      ['A Player', 'X', 'Willmar Stringers', 'Northwoods', ''],
      ['B Player', 'X', 'Some Team', 'Mystery League', ''],
      ['C Player', 'X', '', 'CCBL', ''],
    ])
    expect(placements.map((p) => p.league)).toEqual(['NWDS'])
    expect(warnings).toHaveLength(2)
  })
})
