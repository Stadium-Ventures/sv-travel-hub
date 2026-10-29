import { planAssignmentRecheck } from '../lib/assignmentRecheck'
import { resolveMLBTeamId } from '../data/aliases'
import { useRosterStore } from './rosterStore'
import { useScheduleStore } from './scheduleStore'

/** Run Check Assignments on its own when it is due (see lib/assignmentRecheck)
 *  and return the clubs that gained or lost a client, so the caller can
 *  rebuild their games. Returns [] when nothing ran or nothing changed. */
export async function recheckAssignmentsIfDue(now = Date.now()): Promise<number[]> {
  const players = useRosterStore.getState().players
  if (players.length === 0) return []
  let sched = useScheduleStore.getState()
  if (sched.autoAssignLoading) return [] // a check is already running
  // Let a moves check in flight land first, so the two don't race.
  if (sched.rosterMovesLoading) {
    await new Promise<void>((resolve) => {
      const unsub = useScheduleStore.subscribe((s) => {
        if (!s.rosterMovesLoading) { unsub(); resolve() }
      })
    })
    sched = useScheduleStore.getState()
  }
  if (sched.affiliates.length === 0) {
    await sched.fetchAffiliates()
    sched = useScheduleStore.getState()
    if (sched.affiliates.length === 0) return []
  }
  const orgOfTeam = new Map(sched.affiliates.map((a) => [a.teamId, a.parentOrgId]))
  const plan = planAssignmentRecheck({
    players,
    assignments: sched.playerTeamAssignments,
    releases: sched.rosterReleases ?? {},
    orgOfTeam: (id) => orgOfTeam.get(id),
    orgOfName: (org) => resolveMLBTeamId(org, sched.customMlbAliases),
    fullCheckAt: sched.assignmentsVerifiedAt,
    recheckedAt: sched.assignmentsRecheckedAt,
    now,
  })
  if (!plan) return []
  const before = sched.playerTeamAssignments
  await sched.autoAssignPlayers(plan.kind === 'full' ? { keepManual: true } : { only: plan.names, keepManual: true })
  const after = useScheduleStore.getState().playerTeamAssignments
  const changed = new Set<number>()
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[name]
    const a = after[name]
    if (b?.teamId === a?.teamId) continue
    if (b) changed.add(b.teamId)
    if (a) changed.add(a.teamId)
  }
  return [...changed]
}
