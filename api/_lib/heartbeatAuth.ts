// Server-side credentials for sv-heartbeat's API (the two Vercel crons).
//
// sv-heartbeat is gating every /api route (heartbeat cutover patch 0001). A
// server consumer passes with `Authorization: Bearer <read token>`, where the
// token is this app's entry in heartbeat's HEARTBEAT_READ_TOKENS
// (`sv-travel-hub:<token>`). Here it lives in HEARTBEAT_READ_TOKEN: a
// server-only Vercel env var, marked Sensitive, NEVER `VITE_`-prefixed (that
// would bake it into the public bundle) and never committed (public repo).
//
// Unset means "send the request exactly as before", so this is safe to deploy
// while heartbeat is still open or observing.
import type { Finding } from './monitorTypes.js'

export const HEARTBEAT_ORIGIN = 'https://sv-heartbeat.vercel.app'
export const HEARTBEAT_SUMMARY_URL = `${HEARTBEAT_ORIGIN}/api/heartbeat/summary`
/** The three Heartbeat pages the app reads (src/store/heartbeatStore.ts). */
export const HEARTBEAT_APP_URLS = {
  summary: HEARTBEAT_SUMMARY_URL,
  visitPriority: `${HEARTBEAT_ORIGIN}/api/heartbeat/visit-priority`,
  visitCounts: `${HEARTBEAT_ORIGIN}/api/heartbeat/visit-counts`,
} as const

type Env = Record<string, string | undefined>

/** `Authorization: Bearer <HEARTBEAT_READ_TOKEN>` when set, else no header. */
export function heartbeatReadHeaders(env: Env = process.env): Record<string, string> {
  const token = (env.HEARTBEAT_READ_TOKEN ?? '').trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function heartbeatTokenConfigured(env: Env = process.env): boolean {
  return (env.HEARTBEAT_READ_TOKEN ?? '').trim().length > 0
}

export interface HeartbeatProbe {
  /** HTTP status, or null when the request never got an answer. */
  status: number | null
  /** Heartbeat's `x-sv-auth` verdict header (set by its auth gate), if any. */
  svAuth: string | null
}

/**
 * The plain-English finding for a Heartbeat access problem, or null.
 *
 * Only the weekly recap reads Heartbeat with this server key (the app's users
 * sign in with Google), so the monitor asks for this only while the recap
 * runs.
 *
 *  - 401/403: Travel Hub is locked out now. Reported every run (it is broken).
 *  - 200 with `x-sv-auth: would-401 ...`: heartbeat is in observe mode and says
 *    this call would fail once it enforces. Reported only on the weekly run
 *    (`weekly`), so the reminder is not daily noise.
 *  - Anything else (up, down, or no gate deployed yet): null. Plain outages
 *    stay with the monitor's "Heartbeat didn't answer" finding.
 */
export function heartbeatAccessFinding(
  probe: HeartbeatProbe,
  opts: { tokenSet: boolean; weekly: boolean; envUrl: string },
): Finding | null {
  const fix = `In Vercel (${opts.envUrl}) add the Heartbeat read key that Heartbeat's settings pair with sv-travel-hub (server-only, marked Sensitive), then redeploy Travel Hub.`

  if (probe.status === 401 || probe.status === 403) {
    let how: string
    let todo = fix
    if (probe.status === 403) {
      how = "Heartbeat recognized Travel Hub's read key this morning but didn't allow it to fetch the visit summary."
      todo = 'Open sv-heartbeat in Claude Code and check that read keys may still fetch the visit summary.'
    } else if (opts.tokenSet) {
      how = "Heartbeat turned the health check away this morning even though Travel Hub has a Heartbeat read key, so the key doesn't match Heartbeat's list."
      todo = `Re-copy the key. ${fix}`
    } else {
      how = 'Heartbeat turned the health check away this morning, and Travel Hub has no Heartbeat read key set.'
    }
    return {
      key: 'heartbeat:locked-out',
      severity: 'warning',
      code: false,
      title: 'Travel Hub is locked out of Heartbeat',
      what: 'Travel Hub is locked out of Heartbeat, so the Monday recap has no overdue list.',
      how,
      todo,
    }
  }

  if (probe.status === 200 && opts.weekly && /^would-40[13]/i.test(probe.svAuth ?? '')) {
    return {
      key: 'heartbeat:will-lock-out',
      severity: 'warning',
      code: false,
      title: 'Heartbeat will lock Travel Hub out',
      what: 'Heartbeat will lock Travel Hub out when it starts enforcing sign-in, and the Monday recap will lose its overdue list.',
      how: opts.tokenSet
        ? "Heartbeat is in watch-only mode and reports that Travel Hub's read key would be refused."
        : "Heartbeat is in watch-only mode and reports that Travel Hub's calls carry no read key.",
      todo: opts.tokenSet ? `Re-copy the key. ${fix}` : fix,
    }
  }

  return null
}
