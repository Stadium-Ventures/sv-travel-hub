import type { RosterPlayer } from '../types/roster'

export interface VisitOverride {
  visitsCompleted: number
  lastVisitDate: string | null
  /** When it was written (ISO). Overrides older than OVERRIDE_MAX_AGE_MS stop
   *  applying, so the roster's own visit count shows instead. */
  appliedAt?: string
}

/** Seven days. Heartbeat rewrites every override on each successful fetch,
 *  and the app refetches Heartbeat every 6 hours of use, so a signed-in viewer
 *  never gets near this. An override a week old means Heartbeat has not been
 *  reachable (or nobody signed in) for a week; by then the roster's own count
 *  (the registry rebuilds daily, the sheet is kept by hand) is the better
 *  number, and keeping the old override would freeze it. */
export const OVERRIDE_MAX_AGE_MS = 7 * 24 * 3600_000

export function isOverrideFresh(o: VisitOverride, nowMs = Date.now()): boolean {
  if (!o.appliedAt) return false
  const t = Date.parse(o.appliedAt)
  return Number.isFinite(t) && nowMs - t <= OVERRIDE_MAX_AGE_MS
}

/** Stable key for a player: the registry slug when we have one (registry
 *  source, or a sheet that carries a slug column), else the display name
 *  (legacy sheet). Joins key on slug, never on display name, wherever the
 *  slug is available. */
export function playerKey(p: Pick<RosterPlayer, 'slug' | 'playerName'>): string {
  return p.slug || p.playerName
}

export function applyOverrides(players: RosterPlayer[], overrides: Record<string, VisitOverride>, nowMs = Date.now()): RosterPlayer[] {
  return players.map((p) => {
    const override = overrides[playerKey(p)] ?? overrides[p.playerName]
    if (!override || !isOverrideFresh(override, nowMs)) return p
    return {
      ...p,
      visitsCompleted: override.visitsCompleted,
      lastVisitDate: override.lastVisitDate,
      visitsRemaining: Math.max(0, p.visitTarget2026 - override.visitsCompleted),
    }
  })
}

/** Keep fresh overrides for players still on the roster, re-keyed to
 *  playerKey. A name-keyed override written before the slug existed moves to
 *  the slug the first time the registry roster loads, so nothing is lost on
 *  the flip. Expired overrides are dropped. */
export function pruneOverrides(overrides: Record<string, VisitOverride>, players: RosterPlayer[], nowMs = Date.now()): Record<string, VisitOverride> {
  const out: Record<string, VisitOverride> = {}
  for (const p of players) {
    const key = playerKey(p)
    const hit = overrides[key] ?? overrides[p.playerName]
    if (hit && isOverrideFresh(hit, nowMs)) out[key] = hit
  }
  return out
}

/** Key to write an override under, given the display name callers pass
 *  (heartbeatStore matches Heartbeat's name-only records to roster players). */
export function overrideKeyForName(players: RosterPlayer[], playerName: string): string {
  const p = players.find((x) => x.playerName === playerName)
  return p ? playerKey(p) : playerName
}
