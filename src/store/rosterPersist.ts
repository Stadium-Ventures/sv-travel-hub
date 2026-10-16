import { PII_PLAYER_KEYS } from '../types/roster'

/** Persist version for the `sv-travel-roster` localStorage key.
 *  v0 (builds before 2026-09-24) stored every player's DOB, age, phone,
 *  email and parent names in plain localStorage. v1 never does. Bumping the
 *  version makes zustand run migrateRosterPersist() on every browser that
 *  still holds an older snapshot, and zustand rewrites the key afterwards, so
 *  the contact data is wiped on first load of the new build.
 *  v2 (2026-10-16) stamps visit overrides with appliedAt so they can expire. */
export const ROSTER_PERSIST_VERSION = 2

/** Copy of a persisted player with every contact/PII key removed. Works on
 *  untyped input because it runs on snapshots written by older builds. */
export function scrubPlayer<T extends object>(player: T): T {
  const out: Record<string, unknown> = { ...(player as Record<string, unknown>) }
  for (const k of PII_PLAYER_KEYS) delete out[k]
  return out as T
}

/** Overrides written before v2 carry no appliedAt. Stamp them with the
 *  migration time: they get one full age window, during which any successful
 *  Heartbeat fetch rewrites them, instead of vanishing the moment this build
 *  loads. */
function stampOverrides(raw: unknown, nowIso: string): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = v && typeof v === 'object' && !('appliedAt' in v) ? { ...v, appliedAt: nowIso } : v
  }
  return out
}

/** zustand `persist` migrate hook for `sv-travel-roster`. */
export function migrateRosterPersist(persisted: unknown, fromVersion: number, nowIso = new Date().toISOString()): unknown {
  if (!persisted || typeof persisted !== 'object') return persisted
  const p = persisted as Record<string, unknown>
  const players = Array.isArray(p.players)
    ? (p.players as unknown[]).filter((x): x is object => !!x && typeof x === 'object').map(scrubPlayer)
    : []
  const out: Record<string, unknown> = { ...p, players }
  if (fromVersion < 2 && 'visitOverrides' in p) out.visitOverrides = stampOverrides(p.visitOverrides, nowIso)
  return out
}
