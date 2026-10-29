// Roster moves from the MLB Transactions API, folded into team assignments.
//
// The daily check used to replay every move since Feb 1 against the current
// assignment, honor a rehab stint as a move, and drop the "activated from
// the injured list" that ended it as a paper move. Every run re-pinned
// rehabbed big leaguers to their rehab affiliate and logged each option and
// recall of the season again as a fresh "Moved" row (2026-10-16). The
// rules below fix both:
//   - a rehab stint never moves anyone (rehabStore models it),
//   - an activation or reinstatement moves the player to the club that
//     filed it,
//   - trades, waiver claims, Rule 5 picks and signings move the player to
//     the named club, even in another organization,
//   - releases, free agency and retirement clear the assignment,
//   - the result is reported as ONE net change per player (start vs end).
// The fold's end state depends only on the last move that counts, so running
// it twice over the same transactions changes nothing the second time.
import type { MLBTransaction } from './mlbApi'

export interface MoveTeam {
  teamId: number
  sportId: number
  teamName: string
  parentOrgId: number
}

export interface MoveAssignment {
  teamId: number
  sportId: number
  teamName: string
  source?: string
}

export type MoveEffect = 'move' | 'release' | 'ignore'

/** Released, elected free agency ("Declared Free Agency"), retired. */
const RELEASE_CODES = new Set(['REL', 'DFA', 'RET'])
/** Moves that put the player on the named club. */
const MOVE_CODES = new Set(['OPT', 'CU', 'SE', 'PUR', 'OUT', 'RTN', 'CLW', 'TR', 'R5', 'R5M', 'SFA', 'SGN', 'ACQ', 'ASG'])
/** typeDesc to typeCode, for records that arrive without a code. */
const CODE_BY_DESC: Record<string, string> = {
  'Released': 'REL',
  'Declared Free Agency': 'DFA',
  'Retired': 'RET',
  'Optioned': 'OPT',
  'Recalled': 'CU',
  'Selected': 'SE',
  'Purchase': 'PUR',
  'Outrighted': 'OUT',
  'Returned': 'RTN',
  'Claimed Off Waivers': 'CLW',
  'Trade': 'TR',
  'Rule 5 Selection': 'R5',
  'Rule 5 Draft Minors': 'R5M',
  'Signed as Free Agent': 'SFA',
  'Signed': 'SGN',
  'Acquired': 'ACQ',
  'Assigned': 'ASG',
  'Status Change': 'SC',
}

export function transactionCode(t: MLBTransaction): string {
  return t.typeCode ?? CODE_BY_DESC[t.typeDesc] ?? ''
}

/** What a transaction does to a player's assignment. `dest` is the club the
 *  transaction names (toTeam) resolved against the affiliate tree; a club
 *  outside it (winter league, national team, Fall League) never counts. */
export function classifyTransaction(t: MLBTransaction, dest: MoveTeam | undefined): MoveEffect {
  if (!dest) return 'ignore'
  const text = `${t.typeDesc} ${t.description ?? ''}`
  if (/rehab/i.test(text)) return 'ignore'
  const code = transactionCode(t)
  if (RELEASE_CODES.has(code)) return 'release'
  // Status changes are mostly IL placements and list bookkeeping. Only an
  // activation or reinstatement says where the player is now.
  if (code === 'SC') return /\b(activated|reinstated)\b/i.test(t.description ?? '') ? 'move' : 'ignore'
  // "Assigned" to the big-league club is paperwork (non-roster camp
  // invites, minor league contracts); to an affiliate it is a real move.
  if (code === 'ASG') return dest.sportId === 1 ? 'ignore' : 'move'
  if (MOVE_CODES.has(code)) return 'move'
  return 'ignore' // number changes, designations for assignment, loans, suspensions
}

export interface NetMove {
  playerName: string
  from?: MoveAssignment
  /** Undefined when the player left affiliated ball. */
  to?: MoveAssignment
  kind: 'moved' | 'released'
  /** The transaction that produced the end state. */
  transaction: MLBTransaction
}

function sortKey(t: MLBTransaction): string {
  return t.effectiveDate || t.date
}

/** Fold transactions into assignments and report one net change per player.
 *  `players` maps MLB ids to roster names; transactions for anyone else are
 *  skipped. Unchanged assignments are returned as the same objects. */
export function applyRosterMoves(
  transactions: MLBTransaction[],
  players: Array<{ playerName: string; mlbPlayerId: number }>,
  assignments: Record<string, MoveAssignment>,
  lookupTeam: (teamId: number) => MoveTeam | undefined,
): { assignments: Record<string, MoveAssignment>; changes: NetMove[] } {
  const nameById = new Map<number, string>()
  for (const p of players) if (p.mlbPlayerId > 0) nameById.set(p.mlbPlayerId, p.playerName)

  const ordered = transactions
    .filter((t) => nameById.has(t.player.id) && t.toTeam)
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (a.id ?? 0) - (b.id ?? 0))

  const state = new Map<string, MoveAssignment | undefined>()
  const decisive = new Map<string, MLBTransaction>()
  for (const t of ordered) {
    const name = nameById.get(t.player.id)!
    const dest = lookupTeam(t.toTeam!.id)
    const effect = classifyTransaction(t, dest)
    if (effect === 'ignore') continue
    const current = state.has(name) ? state.get(name) : assignments[name]
    if (effect === 'release') {
      state.set(name, undefined)
      decisive.set(name, t)
      continue
    }
    if (current?.teamId !== dest!.teamId) {
      state.set(name, { teamId: dest!.teamId, sportId: dest!.sportId, teamName: dest!.teamName })
    } else if (!state.has(name)) {
      state.set(name, current)
    }
    decisive.set(name, t)
  }

  const next: Record<string, MoveAssignment> = { ...assignments }
  const changes: NetMove[] = []
  for (const [name, end] of state) {
    const start = assignments[name]
    if (start?.teamId === end?.teamId) continue
    if (end) next[name] = end
    else delete next[name]
    changes.push({ playerName: name, from: start, to: end, kind: end ? 'moved' : 'released', transaction: decisive.get(name)! })
  }
  return { assignments: next, changes }
}

/** The "Assignments changed, schedules may be stale" banner. Shows only
 *  while the newest reassignment is newer than the last time Pro games were
 *  rebuilt; reloading (or the automatic rebuild after a move) clears it. */
export function schedulesStaleAfterMoves(
  log: Array<{ action: string; timestamp: number }>,
  proFetchedAt: number | null,
  proGamesBuiltAt: number | null,
): boolean {
  const lastMove = Math.max(0, ...log.filter((e) => e.action === 'reassigned').map((e) => e.timestamp))
  if (lastMove === 0) return false
  return lastMove > Math.max(proFetchedAt ?? 0, proGamesBuiltAt ?? 0)
}

/** First day of the transaction look-back: a year ago, or the last time
 *  live rosters were checked (Check Assignments) if that is more recent.
 *  Live rosters are the better source, so only moves posted since then can
 *  override them. Never after today, so the range is never inverted (the
 *  old Feb 1 start was in the future every January). */
export function rosterMovesWindowStart(now: Date, verifiedAt: number | null): string {
  const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
  let start = yearAgo
  if (verifiedAt && verifiedAt > yearAgo.getTime()) start = new Date(Math.min(verifiedAt, now.getTime()))
  return start.toISOString().split('T')[0]!
}

/** One client's look-back start. A client counts as checked only when a live
 *  roster placed him, so one Check Assignments could not find (traded to a
 *  club outside his listed organization, say) keeps his older start and the
 *  trade is still read on the next moves check. Before, one check moved
 *  everyone's start to that day and a trade filed the day before was never
 *  seen (2026-10-29). `perPlayer` is null in a browser that has not run a
 *  check since per-client times were kept; then the last full check stands
 *  in for clients who had a team. */
export function playerMovesWindowStart(
  now: Date,
  playerName: string,
  perPlayer: Record<string, number> | null,
  fullCheckAt: number | null,
  hasAssignment: boolean,
): string {
  const verifiedAt = perPlayer ? (perPlayer[playerName] ?? null) : (hasAssignment ? fullCheckAt : null)
  return rosterMovesWindowStart(now, verifiedAt)
}

/** A client the transactions say left affiliated ball. Kept until a live
 *  roster or a later transaction shows him on a club again, so Check
 *  Assignments doesn't quietly restore the old team. */
export interface RosterRelease {
  date: string
  teamName: string
  typeCode: string
}

export function releaseFromMove(move: NetMove): RosterRelease {
  const t = move.transaction
  return {
    date: t.effectiveDate || t.date,
    teamName: t.toTeam?.name ?? move.from?.teamName ?? '',
    typeCode: transactionCode(t),
  }
}

function monthDayLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return iso
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** Diagnostics text for a release, free agency or retirement. */
export function releaseWarning(playerName: string, r: RosterRelease): string {
  const what = r.typeCode === 'RET'
    ? 'retired'
    : r.typeCode === 'DFA'
      ? `elected free agency from the ${r.teamName}`
      : `was released by the ${r.teamName}`
  return `${playerName} ${what} on ${monthDayLabel(r.date)}. Removed from Pro schedules. If his status with SV changed, update his record in sv-registry.`
}

/** Diagnostics text when transactions put a client in a different
 *  organization than the roster's Org (trade, waiver claim, Rule 5). The
 *  roster comes from sv-registry, and spring training and the team checks
 *  already follow the new club, so the fix is the registry record only. */
export function orgChangeWarning(playerName: string, rosterOrg: string, newOrgName: string, teamName: string): string {
  return `${playerName} is with the ${newOrgName} organization now, but sv-registry still says ${rosterOrg}. Showing ${teamName} games, and spring training follows the new club. If sv-registry still says ${rosterOrg} in a few days, update his organization there.`
}
