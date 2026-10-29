import { describe, it, expect } from 'vitest'
import { planAssignmentRecheck, clientsNeedingTeamCheck, FULL_RECHECK_MS, CLIENT_RECHECK_MS, type RecheckInput } from '../assignmentRecheck'

// Synthetic clients and invented org ids only.
const NOW = Date.parse('2026-11-10T15:00:00Z')
const DAY = 24 * 3600_000
const ORG_A = 1
const ORG_B = 2
const teamOrg: Record<number, number> = { 10: ORG_A, 11: ORG_A, 20: ORG_B }
const orgByName: Record<string, number> = { 'Org A': ORG_A, 'Org B': ORG_B }

function input(over: Partial<RecheckInput> = {}): RecheckInput {
  return {
    players: [
      { playerName: 'Placed Player', level: 'Pro', mlbPlayerId: 900001, org: 'Org A' },
      { playerName: 'New Player', level: 'Pro', mlbPlayerId: 900002, org: 'Org A' },
      { playerName: 'Traded Player', level: 'Pro', mlbPlayerId: 900003, org: 'Org A' },
      { playerName: 'College Player', level: 'NCAA', mlbPlayerId: null, org: 'Sample U' },
    ],
    assignments: {
      'Placed Player': { teamId: 11, source: 'milb-roster' },
      'Traded Player': { teamId: 20 },
    },
    releases: {},
    orgOfTeam: (id) => teamOrg[id],
    orgOfName: (org) => orgByName[org] ?? null,
    fullCheckAt: NOW - 2 * DAY,
    recheckedAt: NOW - 2 * DAY,
    now: NOW,
    ...over,
  }
}

describe('clientsNeedingTeamCheck', () => {
  it('picks clients with no team or a team outside their listed organization', () => {
    expect(clientsNeedingTeamCheck(input())).toEqual(['New Player', 'Traded Player'])
  })

  it('leaves hand-set teams, released clients and clients without an MLB id alone', () => {
    const names = clientsNeedingTeamCheck(input({
      players: [
        { playerName: 'Hand Set', level: 'Pro', mlbPlayerId: 900004, org: 'Org A' },
        { playerName: 'Released Player', level: 'Pro', mlbPlayerId: 900005, org: 'Org A' },
        { playerName: 'No Id', level: 'Pro', mlbPlayerId: null, org: 'Org A' },
      ],
      assignments: { 'Hand Set': { teamId: 20, source: 'manual' } },
      releases: { 'Released Player': {} },
    }))
    expect(names).toEqual([])
  })

  it('does not compare when the listed Org is not an MLB organization', () => {
    const names = clientsNeedingTeamCheck(input({
      players: [{ playerName: 'Odd Org', level: 'Pro', mlbPlayerId: 900006, org: 'Somewhere' }],
      assignments: { 'Odd Org': { teamId: 20 } },
    }))
    expect(names).toEqual([])
  })
})

describe('planAssignmentRecheck', () => {
  it('runs a full check when none ran yet or the last one is over a week old', () => {
    expect(planAssignmentRecheck(input({ fullCheckAt: null }))).toEqual({ kind: 'full' })
    expect(planAssignmentRecheck(input({ fullCheckAt: NOW - FULL_RECHECK_MS - 1 }))).toEqual({ kind: 'full' })
  })

  it('otherwise checks just the clients that need it, at most once a day', () => {
    expect(planAssignmentRecheck(input())).toEqual({ kind: 'clients', names: ['New Player', 'Traded Player'] })
    expect(planAssignmentRecheck(input({ recheckedAt: NOW - CLIENT_RECHECK_MS + 1000 }))).toBeNull()
    expect(planAssignmentRecheck(input({ recheckedAt: null }))).toEqual({ kind: 'clients', names: ['New Player', 'Traded Player'] })
  })

  it('does nothing when every client is placed in his listed organization', () => {
    expect(planAssignmentRecheck(input({
      assignments: {
        'Placed Player': { teamId: 11, source: 'milb-roster' },
        'New Player': { teamId: 10, source: 'milb-roster' },
        'Traded Player': { teamId: 10, source: 'milb-roster' },
      },
    }))).toBeNull()
  })

  it('does nothing without pro clients', () => {
    expect(planAssignmentRecheck(input({ players: [{ playerName: 'College Player', level: 'NCAA', mlbPlayerId: null, org: 'Sample U' }], fullCheckAt: null }))).toBeNull()
  })
})
