// Dev-only debug logging. No-ops in production builds so verbose [HS-*] /
// pipeline traces don't bury real console output (e.g. the Slack dry-run JSON).
// Enable in a prod build by setting `localStorage.svDebug = '1'` and reloading.
const enabled =
  import.meta.env.DEV ||
  (() => { try { return localStorage.getItem('svDebug') === '1' } catch { return false } })()

export function debugLog(...args: unknown[]): void {
  if (enabled) console.log(...args)
}
