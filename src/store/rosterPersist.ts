import { PII_PLAYER_KEYS } from '../types/roster'

/** Persist version for the `sv-travel-roster` localStorage key.
 *  v0 (builds before 2026-09-24) stored every player's DOB, age, phone,
 *  email and parent names in plain localStorage. v1 never does. Bumping the
 *  version makes zustand run migrateRosterPersist() on every browser that
 *  still holds a v0 snapshot, and zustand rewrites the key afterwards, so the
 *  contact data is wiped on first load of the new build. */
export const ROSTER_PERSIST_VERSION = 1

/** Copy of a persisted player with every contact/PII key removed. Works on
 *  untyped input because it runs on snapshots written by older builds. */
export function scrubPlayer<T extends object>(player: T): T {
  const out: Record<string, unknown> = { ...(player as Record<string, unknown>) }
  for (const k of PII_PLAYER_KEYS) delete out[k]
  return out as T
}

/** zustand `persist` migrate hook for `sv-travel-roster`. */
export function migrateRosterPersist(persisted: unknown, _fromVersion: number): unknown {
  if (!persisted || typeof persisted !== 'object') return persisted
  const p = persisted as Record<string, unknown>
  const players = Array.isArray(p.players)
    ? (p.players as unknown[]).filter((x): x is object => !!x && typeof x === 'object').map(scrubPlayer)
    : []
  return { ...p, players }
}
