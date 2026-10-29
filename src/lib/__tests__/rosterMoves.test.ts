import { describe, it, expect } from 'vitest'
import {
  applyRosterMoves,
  classifyTransaction,
  orgChangeWarning,
  playerMovesWindowStart,
  releaseFromMove,
  releaseWarning,
  rosterMovesWindowStart,
  schedulesStaleAfterMoves,
  type MoveAssignment,
  type MoveTeam,
} from '../rosterMoves'
import type { MLBTransaction } from '../mlbApi'
import { TXNS_2026, AFFILIATES } from './fixtures/rosterMoves2026'

const CLIENTS = [
  { playerName: 'Player A', mlbPlayerId: 1001 },
  { playerName: 'Player B', mlbPlayerId: 1002 },
  { playerName: 'Player C', mlbPlayerId: 1003 },
]
const ABQ: MoveAssignment = { teamId: 342, sportId: 11, teamName: 'Albuquerque Isotopes' }
const WOR: MoveAssignment = { teamId: 533, sportId: 11, teamName: 'Worcester Red Sox' }
const COL: MoveAssignment = { teamId: 115, sportId: 1, teamName: 'Colorado Rockies' }
const BOS: MoveAssignment = { teamId: 111, sportId: 1, teamName: 'Boston Red Sox' }

const extraTeams: MoveTeam[] = [
  { teamId: 136, sportId: 1, teamName: 'Seattle Mariners', parentOrgId: 136 },
  { teamId: 133, sportId: 1, teamName: 'Athletics', parentOrgId: 133 },
  { teamId: 451, sportId: 11, teamName: 'Iowa Cubs', parentOrgId: 112 },
]
const byId = new Map([...AFFILIATES, ...extraTeams].map((t) => [t.teamId, t]))
const lookup = (id: number) => byId.get(id)

function txn(partial: Partial<MLBTransaction> & { typeCode: string; toTeam: { id: number; name: string } }): MLBTransaction {
  return {
    player: { id: 1001, fullName: 'Player A' },
    typeDesc: '',
    date: partial.effectiveDate ?? '2026-12-01',
    effectiveDate: '2026-12-01',
    ...partial,
  }
}

describe('applyRosterMoves on the 2026 transactions', () => {
  it('ends Player A and Player B on their MLB clubs and Player C on the Rockies', () => {
    // The persisted state Kent's browser had: both Rockies at Albuquerque,
    // Player B pinned to Worcester by his June rehab stint.
    const start = { 'Player A': ABQ, 'Player C': ABQ, 'Player B': WOR }
    const { assignments, changes } = applyRosterMoves(TXNS_2026, CLIENTS, start, lookup)
    expect(assignments['Player A']?.teamId).toBe(115)
    expect(assignments['Player C']?.teamId).toBe(115)
    expect(assignments['Player B']?.teamId).toBe(111)
    // One row per player, not one per option and recall.
    expect(changes.map((c) => c.playerName).sort()).toEqual(['Player A', 'Player B', 'Player C'])
    expect(changes.every((c) => c.kind === 'moved')).toBe(true)
  })

  it('logs nothing on a second run over the same transactions', () => {
    const start = { 'Player A': ABQ, 'Player C': ABQ, 'Player B': WOR }
    const first = applyRosterMoves(TXNS_2026, CLIENTS, start, lookup)
    const second = applyRosterMoves(TXNS_2026, CLIENTS, first.assignments, lookup)
    expect(second.changes).toEqual([])
    expect(second.assignments).toEqual(first.assignments)
  })

  it('agrees with Check Assignments (MLB clubs) and so logs nothing', () => {
    const start = { 'Player A': COL, 'Player C': COL, 'Player B': BOS }
    const { changes } = applyRosterMoves(TXNS_2026, CLIENTS, start, lookup)
    expect(changes).toEqual([])
  })

  it('never moves anyone for a rehab stint', () => {
    const rehabs = TXNS_2026.filter((t) => /rehab/i.test(t.description ?? ''))
    expect(rehabs.length).toBe(2)
    const { changes } = applyRosterMoves(rehabs, CLIENTS, { 'Player A': COL, 'Player B': BOS }, lookup)
    expect(changes).toEqual([])
  })
})

describe('classifyTransaction', () => {
  const col = lookup(115)!
  const abq = lookup(342)!
  it('honors an IL activation back to the MLB club', () => {
    const t = txn({ typeCode: 'SC', typeDesc: 'Status Change', toTeam: { id: 115, name: 'Colorado Rockies' }, description: 'Colorado Rockies activated RHP Player A from the 15-day injured list.' })
    expect(classifyTransaction(t, col)).toBe('move')
  })
  it('ignores IL placements and other status bookkeeping', () => {
    const t = txn({ typeCode: 'SC', typeDesc: 'Status Change', toTeam: { id: 115, name: 'Colorado Rockies' }, description: 'Colorado Rockies placed RHP Player A on the 15-day injured list.' })
    expect(classifyTransaction(t, col)).toBe('ignore')
  })
  it('treats "Assigned" to the big club as paperwork and to an affiliate as a move', () => {
    expect(classifyTransaction(txn({ typeCode: 'ASG', typeDesc: 'Assigned', toTeam: { id: 115, name: 'Colorado Rockies' }, description: 'Colorado Rockies invited non-roster RHP Player A to spring training.' }), col)).toBe('ignore')
    expect(classifyTransaction(txn({ typeCode: 'ASG', typeDesc: 'Assigned', toTeam: { id: 342, name: 'Albuquerque Isotopes' }, description: 'RHP Player A assigned to Albuquerque Isotopes.' }), abq)).toBe('move')
  })
  it('ignores clubs outside the affiliate tree (winter ball, national teams)', () => {
    const t = txn({ typeCode: 'SC', typeDesc: 'Status Change', toTeam: { id: 940, name: 'United States' }, description: 'United States activated RHP Player B.' })
    expect(classifyTransaction(t, undefined)).toBe('ignore')
  })
  it('reads releases, free agency and retirement as leaving the club', () => {
    for (const typeCode of ['REL', 'DFA', 'RET']) {
      expect(classifyTransaction(txn({ typeCode, toTeam: { id: 342, name: 'Albuquerque Isotopes' } }), abq)).toBe('release')
    }
  })
})

describe('applyRosterMoves across organizations and releases', () => {
  const gordon = [{ playerName: 'Player A', mlbPlayerId: 1001 }]

  it('moves a traded player to the club the trade names', () => {
    const trade = txn({ typeCode: 'TR', typeDesc: 'Trade', fromTeam: { id: 115, name: 'Colorado Rockies' }, toTeam: { id: 136, name: 'Seattle Mariners' }, description: 'Colorado Rockies traded RHP Player A to Seattle Mariners.' })
    const { assignments, changes } = applyRosterMoves([trade], gordon, { 'Player A': COL }, lookup)
    expect(assignments['Player A']).toEqual({ teamId: 136, sportId: 1, teamName: 'Seattle Mariners' })
    expect(changes[0]).toMatchObject({ kind: 'moved', from: COL })
  })

  it('moves a Rule 5 pick to the drafting club', () => {
    const r5 = txn({ typeCode: 'R5', typeDesc: 'Rule 5 Selection', toTeam: { id: 133, name: 'Athletics' }, description: 'Athletics purchased contract of RHP Player A in the Rule 5 Draft.' })
    const { assignments } = applyRosterMoves([r5], gordon, { 'Player A': ABQ }, lookup)
    expect(assignments['Player A']?.teamId).toBe(133)
  })

  it('clears the team on free agency instead of keeping the old club', () => {
    const fa = txn({ typeCode: 'DFA', typeDesc: 'Declared Free Agency', toTeam: { id: 451, name: 'Iowa Cubs' }, effectiveDate: '2025-11-06', description: 'LF Player D elected free agency.' })
    const { assignments, changes } = applyRosterMoves([fa], gordon, { 'Player A': ABQ }, lookup)
    expect(assignments['Player A']).toBeUndefined()
    expect(changes[0]!.kind).toBe('released')
    const release = releaseFromMove(changes[0]!)
    expect(release).toEqual({ date: '2025-11-06', teamName: 'Iowa Cubs', typeCode: 'DFA' })
  })

  it('a later signing re-places a released player', () => {
    const rel = txn({ typeCode: 'REL', typeDesc: 'Released', toTeam: { id: 342, name: 'Albuquerque Isotopes' }, effectiveDate: '2026-08-03' })
    const signed = txn({ typeCode: 'ASG', typeDesc: 'Assigned', toTeam: { id: 451, name: 'Iowa Cubs' }, effectiveDate: '2026-08-08', description: 'RHP Player A assigned to Iowa Cubs.' })
    const { assignments } = applyRosterMoves([signed, rel], gordon, { 'Player A': ABQ }, lookup)
    expect(assignments['Player A']?.teamId).toBe(451)
  })

  it('breaks same-day ties by posting order (activated, then optioned)', () => {
    const activated = txn({ id: 1, typeCode: 'SC', typeDesc: 'Status Change', toTeam: { id: 115, name: 'Colorado Rockies' }, effectiveDate: '2026-06-30', description: 'Colorado Rockies activated RHP Player A from the 60-day injured list.' })
    const optioned = txn({ id: 2, typeCode: 'OPT', typeDesc: 'Optioned', toTeam: { id: 342, name: 'Albuquerque Isotopes' }, effectiveDate: '2026-06-30' })
    const { assignments } = applyRosterMoves([optioned, activated], gordon, { 'Player A': COL }, lookup)
    expect(assignments['Player A']?.teamId).toBe(342)
  })
})

describe('rosterMovesWindowStart', () => {
  it('is never after today, including in January', () => {
    const jan = new Date('2027-01-15T15:00:00Z')
    expect(rosterMovesWindowStart(jan, null)).toBe('2026-01-15')
  })
  it('starts at the last live roster check when that is more recent', () => {
    const now = new Date('2026-12-10T15:00:00Z')
    expect(rosterMovesWindowStart(now, Date.parse('2026-12-01T18:00:00Z'))).toBe('2026-12-01')
    // A check older than a year doesn't widen the window.
    expect(rosterMovesWindowStart(now, Date.parse('2025-01-01T18:00:00Z'))).toBe('2025-12-10')
  })
})

describe('schedulesStaleAfterMoves', () => {
  const log = [{ action: 'reassigned', timestamp: 1000 }, { action: 'assigned', timestamp: 1000 }]
  it('shows until Pro games are rebuilt after the move', () => {
    expect(schedulesStaleAfterMoves(log, 500, null)).toBe(true)
    expect(schedulesStaleAfterMoves(log, 500, 1500)).toBe(false)
    expect(schedulesStaleAfterMoves(log, 2000, null)).toBe(false)
  })
  it('never shows without a reassignment', () => {
    expect(schedulesStaleAfterMoves([{ action: 'assigned', timestamp: 1000 }], null, null)).toBe(false)
  })
})

describe('warning copy', () => {
  it('is plain text with no emojis, long dashes or ellipses', () => {
    const msgs = [
      releaseWarning('Player D', { date: '2025-11-06', teamName: 'Iowa Cubs', typeCode: 'DFA' }),
      releaseWarning('Player E', { date: '2026-08-18', teamName: 'Arkansas Travelers', typeCode: 'RET' }),
      releaseWarning('Player A', { date: '2026-08-03', teamName: 'Albuquerque Isotopes', typeCode: 'REL' }),
      orgChangeWarning('Player A', 'Colorado Rockies', 'Seattle Mariners', 'Seattle Mariners'),
    ]
    expect(msgs[0]).toBe('Player D elected free agency from the Iowa Cubs on Nov 6, 2025. Removed from Pro schedules. If his status with SV changed, update his record in sv-registry.')
    expect(msgs[1]).toBe('Player E retired on Aug 18, 2026. Removed from Pro schedules. If his status with SV changed, update his record in sv-registry.')
    for (const m of msgs) expect(m).not.toMatch(/[–—…]|\.\.\.|\p{Extended_Pictographic}/u)
  })
})

describe('playerMovesWindowStart', () => {
  const now = new Date('2026-11-10T15:00:00Z')
  const fullCheck = Date.parse('2026-11-08T15:00:00Z')

  it('reads each client from the last time a live roster placed him', () => {
    expect(playerMovesWindowStart(now, 'Player A', { 'Player A': Date.parse('2026-11-09T12:00:00Z') }, fullCheck, true)).toBe('2026-11-09')
  })

  it('keeps a year of look-back for a client no check has placed, even after a full check', () => {
    // Traded the day before a Check Assignments that could not find him:
    // the trade must still be read.
    expect(playerMovesWindowStart(now, 'Player B', { 'Player A': fullCheck }, fullCheck, true)).toBe('2025-11-10')
  })

  it('falls back to the last full check for a client with a team in a browser without per-client times', () => {
    expect(playerMovesWindowStart(now, 'Player A', null, fullCheck, true)).toBe('2026-11-08')
    expect(playerMovesWindowStart(now, 'Player B', null, fullCheck, false)).toBe('2025-11-10')
  })
})
