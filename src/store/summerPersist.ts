/** Persist version for the `sv-travel-summer` store.
 *  v1 (builds before 2026-10-16) kept the Summer Ball Placement sheet's
 *  Contact column on every assignment. v2 never reads it. Bumping the version
 *  makes zustand run migrateSummerPersist() on every browser that still holds
 *  a v1 snapshot and rewrite it, so the contact text is wiped on first load
 *  of the new build (same approach as sv-travel-roster v1). */
export const SUMMER_PERSIST_VERSION = 2

function scrubAssignment(a: unknown): unknown {
  if (!a || typeof a !== 'object') return a
  const out = { ...(a as Record<string, unknown>) }
  delete out.contact
  return out
}

/** zustand `persist` migrate hook for `sv-travel-summer`. Works on untyped
 *  input because it runs on snapshots written by older builds. */
export function migrateSummerPersist(persisted: unknown, _fromVersion: number): unknown {
  if (!persisted || typeof persisted !== 'object') return persisted
  const p = persisted as Record<string, unknown>
  const out: Record<string, unknown> = { ...p }
  if (Array.isArray(p.assignments)) out.assignments = p.assignments.map(scrubAssignment)
  if (p.byPlayer && typeof p.byPlayer === 'object') {
    out.byPlayer = Object.fromEntries(
      Object.entries(p.byPlayer as Record<string, unknown>).map(([k, v]) => [k, scrubAssignment(v)]),
    )
  }
  return out
}
