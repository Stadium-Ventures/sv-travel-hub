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
 * Clear EVERYTHING — all sv-travel localStorage keys including Zustand stores.
 * Use with caution: this resets all settings and assignments.
 */
export function clearAllData(): void {
  const keys = Object.keys(localStorage).filter((k) => k.startsWith('sv-travel'))
  for (const key of keys) {
    localStorage.removeItem(key)
  }
}
