import { keys as idbKeys, del as idbDel } from 'idb-keyval'

/**
 * Clear all localStorage caches used by the app.
 * This does NOT clear Zustand persisted state (settings, assignments, etc.)
 * — only the schedule/geocode/routing caches that can cause stale data.
 */
export function clearScheduleCaches(): void {
  const cacheKeys = [
    'sv-travel-d1baseball-cache',
    'sv-travel-maxpreps-cache',
    'sv-travel-geocode-cache',
    'sv-travel-drivetime-cache',
    'sv-travel-d1-discovered-slugs',
    'sv-travel-maxpreps-discovered-slugs',
  ]
  for (const key of cacheKeys) {
    localStorage.removeItem(key)
  }
}

/**
 * Clear EVERYTHING — all sv-travel localStorage keys including Zustand stores,
 * plus the IndexedDB-persisted stores (sv-travel-schedule, sv-travel-summer —
 * see idbStorage.ts: they live as keys in idb-keyval's default DB, not in
 * localStorage, so clearing localStorage alone leaves proGames and summer
 * assignments behind). Use with caution: this resets all settings and
 * assignments.
 */
export async function clearAllData(): Promise<void> {
  const lsKeys = Object.keys(localStorage).filter((k) => k.startsWith('sv-travel'))
  for (const key of lsKeys) {
    localStorage.removeItem(key)
  }
  try {
    const allIdbKeys = await idbKeys()
    await Promise.all(
      allIdbKeys
        .filter((k): k is string => typeof k === 'string' && k.startsWith('sv-travel'))
        .map((k) => idbDel(k)),
    )
  } catch {
    // IndexedDB unavailable (e.g. private mode) — localStorage is already cleared
  }
}
