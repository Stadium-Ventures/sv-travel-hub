import type { RosterPlayer } from '../types/roster'

// Guards that run before a fresh roster is allowed to prune the app's
// persisted, name-keyed state (team assignments, priority picks, rehab
// windows, summer placements, visit overrides). Pruning is permanent, so a
// roster that looks broken must not drive it.

/** A roster with more than this fraction fewer clients than the last good one
 *  is shown but not trusted to remove anyone until staff confirm it. A real
 *  one-step cut that size is rare; a broken sheet view or a truncated
 *  registry build is not. */
export const MAX_ROSTER_DROP = 0.25

export function isSharpDrop(previous: number | null, next: number): boolean {
  if (!previous || previous <= 0) return false
  return next < previous * (1 - MAX_ROSTER_DROP)
}

/** Plain-English explanation for the Roster tab and diagnostics. */
export function sharpDropMessage(next: number, previous: number): string {
  return `The roster came back with ${next} clients, down from ${previous} last time. That is more than a quarter fewer, which usually means a broken sheet or registry build. The app is showing the smaller roster but has kept everyone's saved teams, trip picks and visit counts. If clients really were removed, click "Confirm the smaller roster". Otherwise tell Tom in #sv-automation.`
}

/** Just enough of a player to recognise them under a new display name. */
export interface RenameSeedEntry {
  slug?: string
  mlbPlayerId: number | null
  playerName: string
}

export function renameSeedFrom(players: Array<Partial<RosterPlayer>>): RenameSeedEntry[] {
  const out: RenameSeedEntry[] = []
  for (const p of players) {
    if (!p || typeof p.playerName !== 'string' || !p.playerName) continue
    if (!p.slug && !p.mlbPlayerId) continue // nothing to recognise them by
    out.push({ ...(p.slug ? { slug: p.slug } : {}), mlbPlayerId: p.mlbPlayerId ?? null, playerName: p.playerName })
  }
  return out
}

/** Old display name → new display name for players present in both rosters
 *  (same slug, else same MLB id) whose name changed, e.g. the sheet's
 *  spelling vs the registry's canon name. Skips a rename when the old name is
 *  still in use by someone in the new roster. */
export function findRenames(prior: RenameSeedEntry[], next: RosterPlayer[]): Record<string, string> {
  const bySlug = new Map<string, string>()
  const byMlb = new Map<number, string>()
  for (const p of prior) {
    if (p.slug) bySlug.set(p.slug, p.playerName)
    if (p.mlbPlayerId) byMlb.set(p.mlbPlayerId, p.playerName)
  }
  const nextNames = new Set(next.map((p) => p.playerName))
  const out: Record<string, string> = {}
  for (const p of next) {
    const old = (p.slug ? bySlug.get(p.slug) : undefined) ?? (p.mlbPlayerId ? byMlb.get(p.mlbPlayerId) : undefined)
    if (!old || old === p.playerName || nextNames.has(old) || old in out) continue
    out[old] = p.playerName
  }
  return out
}

/** Copy of a name-keyed record with renamed keys moved. An entry already
 *  under the new key wins. `keyOf` maps a display name to the record's key
 *  (e.g. lowercased for rehab windows). */
export function renameKeys<T>(
  rec: Record<string, T>,
  renames: Record<string, string>,
  keyOf: (name: string) => string = (n) => n,
): Record<string, T> {
  const out = { ...rec }
  let changed = false
  for (const [oldName, newName] of Object.entries(renames)) {
    const from = keyOf(oldName)
    const to = keyOf(newName)
    if (!(from in out) || from === to) continue
    if (!(to in out)) out[to] = out[from]!
    delete out[from]
    changed = true
  }
  return changed ? out : rec
}
