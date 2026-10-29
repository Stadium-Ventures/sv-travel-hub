// When the app re-checks clients' teams against live MLB rosters on its own.
//
// Check Assignments used to run automatically only in a browser with no
// teams at all. After that, only the daily moves check ran, so a new pro
// client never got a team, a fixed Org in sv-registry never reached the
// app, and two browsers could show different teams for the same client
// (2026-10-29). The rules below:
//   - every client, once a week (hand-set teams are left alone),
//   - otherwise, once a day, just the clients with an MLB id who have no
//     team, or whose team is outside the organization sv-registry lists.
// Clients the transactions say were released stay off: they have no team
// on purpose until a roster lists them again.

export const FULL_RECHECK_MS = 7 * 24 * 3600_000
export const CLIENT_RECHECK_MS = 24 * 3600_000

export type RecheckPlan = { kind: 'full' } | { kind: 'clients'; names: string[] } | null

export interface RecheckInput {
  players: Array<{ playerName: string; level: string; mlbPlayerId: number | null; org: string }>
  assignments: Record<string, { teamId: number; source?: string }>
  releases: Record<string, unknown>
  /** Parent organization id of a club, from the affiliate list. */
  orgOfTeam: (teamId: number) => number | undefined
  /** Organization id for a roster Org name, null when it isn't an MLB org. */
  orgOfName: (org: string) => number | null
  /** Last full Check Assignments. */
  fullCheckAt: number | null
  /** Last automatic re-check of any kind. */
  recheckedAt: number | null
  now: number
}

/** Clients whose team should be looked up again: an MLB id but no team, or a
 *  team outside the organization sv-registry lists. */
export function clientsNeedingTeamCheck(input: Omit<RecheckInput, 'fullCheckAt' | 'recheckedAt' | 'now'>): string[] {
  const out: string[] = []
  for (const p of input.players) {
    if (p.level !== 'Pro' || !p.mlbPlayerId) continue
    if (p.playerName in input.releases) continue
    const a = input.assignments[p.playerName]
    if (a?.source === 'manual') continue
    if (!a) {
      out.push(p.playerName)
      continue
    }
    const teamOrg = input.orgOfTeam(a.teamId)
    const listedOrg = input.orgOfName(p.org)
    if (teamOrg && listedOrg && teamOrg !== listedOrg) out.push(p.playerName)
  }
  return out
}

export function planAssignmentRecheck(input: RecheckInput): RecheckPlan {
  if (!input.players.some((p) => p.level === 'Pro')) return null
  if (!input.fullCheckAt || input.now - input.fullCheckAt > FULL_RECHECK_MS) return { kind: 'full' }
  if (input.recheckedAt && input.now - input.recheckedAt <= CLIENT_RECHECK_MS) return null
  const names = clientsNeedingTeamCheck(input)
  return names.length > 0 ? { kind: 'clients', names } : null
}
