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

export const HEARTBEAT_ORIGIN = 'https://sv-heartbeat.vercel.app'
export const HEARTBEAT_SUMMARY_URL = `${HEARTBEAT_ORIGIN}/api/heartbeat/summary`

type Env = Record<string, string | undefined>

/** `Authorization: Bearer <HEARTBEAT_READ_TOKEN>` when set, else no header. */
export function heartbeatReadHeaders(env: Env = process.env): Record<string, string> {
  const token = (env.HEARTBEAT_READ_TOKEN ?? '').trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function heartbeatTokenConfigured(env: Env = process.env): boolean {
  return (env.HEARTBEAT_READ_TOKEN ?? '').trim().length > 0
}

/** Same shape as health-monitor's Finding (structural). */
export interface HeartbeatAccessFinding {
  severity: 'critical' | 'warning'
  code: boolean
  what: string
  how: string
  todo: string
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
 *  - 401/403: Travel Hub is locked out now. Reported every run (it is broken).
 *  - 200 with `x-sv-auth: would-401 ...`: heartbeat is in observe mode and says
 *    this call would fail once it enforces. Reported only on the weekly run
 *    (`weekly`), so the reminder is not daily noise.
 *  - Anything else (up, down, or no gate deployed yet): null. Plain outages
 *    stay with the existing "Heartbeat summary API returned ..." finding.
 */
export function heartbeatAccessFinding(
  probe: HeartbeatProbe,
  opts: { tokenSet: boolean; weekly: boolean; envUrl: string },
): HeartbeatAccessFinding | null {
  const fix = `In Vercel (${opts.envUrl}) set HEARTBEAT_READ_TOKEN (Production, Sensitive, no VITE_ prefix) to the value paired with sv-travel-hub in sv-heartbeat's HEARTBEAT_READ_TOKENS, then redeploy Travel Hub.`

  if (probe.status === 401 || probe.status === 403) {
    let how: string
    let todo = fix
    if (probe.status === 403) {
      how = 'Heartbeat answered HTTP 403 to the health check: it recognized Travel Hub\'s read token but did not allow it for the summary page.'
      todo = 'Check that sv-heartbeat still lets read tokens call /api/heartbeat/summary (READ_TOKEN_PATHS in its src/lib/authGate.ts).'
    } else if (opts.tokenSet) {
      how = 'Heartbeat answered HTTP 401 to the health check even though HEARTBEAT_READ_TOKEN is set, so the value does not match Heartbeat\'s list.'
      todo = `Re-copy the value. ${fix}`
    } else {
      how = 'Heartbeat answered HTTP 401 to the health check, and HEARTBEAT_READ_TOKEN is not set on Travel Hub.'
    }
    return {
      severity: 'warning',
      code: false,
      what: 'Travel Hub is locked out of Heartbeat, so the Monday recap has no overdue list.',
      how,
      todo,
    }
  }

  if (probe.status === 200 && opts.weekly && /^would-40[13]/i.test(probe.svAuth ?? '')) {
    return {
      severity: 'warning',
      code: false,
      what: 'Heartbeat will lock Travel Hub out when it switches to enforce.',
      how: opts.tokenSet
        ? 'Heartbeat is in observe mode and reports that Travel Hub\'s read token would be refused.'
        : 'Heartbeat is in observe mode and reports that Travel Hub\'s calls carry no read token.',
      todo: opts.tokenSet ? `Re-copy the value. ${fix}` : fix,
    }
  }

  return null
}
