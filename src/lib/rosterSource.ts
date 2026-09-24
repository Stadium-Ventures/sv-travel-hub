/** The ROSTER_SOURCE switch (SV Way rule 5: rollback is a config revert).
 *
 *   VITE_ROSTER_SOURCE=sheet     (default) published SV_Roster_Master CSV via
 *                                VITE_ROSTER_CSV_URL, exactly as before.
 *   VITE_ROSTER_SOURCE=registry  sv-registry's authenticated roster projection
 *                                (GET /api/roster-projection) with the signed-in
 *                                user's Google ID token. NEVER falls back to the
 *                                sheet: a registry failure is shown, not hidden.
 *
 * Vite only exposes VITE_-prefixed vars to the browser, and they are baked in
 * at build time, so flipping the switch needs a redeploy. The serverless
 * functions read the same variable (api/_lib/rosterSource.ts), so one Vercel
 * env var moves the whole app. */
export type RosterSource = 'sheet' | 'registry'

export function parseRosterSource(raw: string | undefined | null): RosterSource {
  const v = (raw ?? '').trim().toLowerCase()
  if (v === '' || v === 'sheet') return 'sheet'
  if (v === 'registry') return 'registry'
  // A typo must not silently mean "sheet" (that would be a hidden fallback).
  throw new Error(`VITE_ROSTER_SOURCE must be "sheet" or "registry" (got "${raw}")`)
}

export function getRosterSource(): RosterSource {
  return parseRosterSource(import.meta.env.VITE_ROSTER_SOURCE as string | undefined)
}

/** Non-throwing variant for places that only need a hint (persistence). */
export function getRosterSourceOrNull(): RosterSource | null {
  try { return getRosterSource() } catch { return null }
}
