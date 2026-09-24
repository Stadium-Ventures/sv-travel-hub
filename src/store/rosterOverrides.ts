import type { RosterPlayer } from '../types/roster'

export interface VisitOverride {
  visitsCompleted: number
  lastVisitDate: string | null
}

/** Stable key for a player: the registry slug when we have one (registry
 *  source, or a sheet that carries a slug column), else the display name
 *  (legacy sheet). Joins key on slug, never on display name, wherever the
 *  slug is available. */
export function playerKey(p: Pick<RosterPlayer, 'slug' | 'playerName'>): string {
  return p.slug || p.playerName
}

export function applyOverrides(players: RosterPlayer[], overrides: Record<string, VisitOverride>): RosterPlayer[] {
  return players.map((p) => {
    const override = overrides[playerKey(p)] ?? overrides[p.playerName]
    if (!override) return p
    return {
      ...p,
      visitsCompleted: override.visitsCompleted,
      lastVisitDate: override.lastVisitDate,
      visitsRemaining: Math.max(0, p.visitTarget2026 - override.visitsCompleted),
    }
  })
}

/** Keep overrides for players still on the roster, re-keyed to playerKey.
 *  A name-keyed override written before the slug existed moves to the slug
 *  the first time the registry roster loads, so nothing is lost on the flip. */
export function pruneOverrides(overrides: Record<string, VisitOverride>, players: RosterPlayer[]): Record<string, VisitOverride> {
  const out: Record<string, VisitOverride> = {}
  for (const p of players) {
    const key = playerKey(p)
    const hit = overrides[key] ?? overrides[p.playerName]
    if (hit) out[key] = hit
  }
  return out
}

/** Key to write an override under, given the display name callers pass
 *  (heartbeatStore matches Heartbeat's name-only records to roster players). */
export function overrideKeyForName(players: RosterPlayer[], playerName: string): string {
  const p = players.find((x) => x.playerName === playerName)
  return p ? playerKey(p) : playerName
}
