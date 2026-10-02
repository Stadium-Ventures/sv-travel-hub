// Server-side half of the ROSTER_SOURCE switch (browser half:
// src/lib/rosterSource.ts). The Vercel crons (slack-recap, health-monitor)
// have no signed-in person, so on the registry source they authenticate with
// a registry-minted svt_ service token scoped read:roster-projection, held
// ONLY in a server-side Vercel env var (SV_REGISTRY_ROSTER_TOKEN). It must
// never be VITE_-prefixed (that would bake it into the public bundle) and
// never be committed: this repo is public.
//
// They read the registry's sheet-shaped CSV (`?format=csv`, same headers as
// SV_Roster_Master: Player Name, Org, Level, Tier, Affiliate, ...) so their
// existing CSV parsers keep working; the only change is the URL + bearer.

export type RosterSource = 'sheet' | 'registry'

export const DEFAULT_REGISTRY_ROSTER_URL = 'https://sv-registry.vercel.app/api/roster-projection'
export const DEFAULT_MIN_ROWS = 50

type Env = Record<string, string | undefined>

export class RosterConfigError extends Error {
  readonly source: RosterSource | null
  readonly todo: string
  constructor(message: string, source: RosterSource | null, todo: string) {
    super(message)
    this.name = 'RosterConfigError'
    this.source = source
    this.todo = todo
  }
}

/** ROSTER_SOURCE (server-only override) or VITE_ROSTER_SOURCE (the one var
 *  that also drives the browser). Default sheet. A typo throws rather than
 *  quietly meaning "sheet". */
export function rosterSource(env: Env = process.env): RosterSource {
  const raw = env.ROSTER_SOURCE ?? env.VITE_ROSTER_SOURCE ?? ''
  const v = raw.trim().toLowerCase()
  if (v === '' || v === 'sheet') return 'sheet'
  if (v === 'registry') return 'registry'
  throw new RosterConfigError(
    `ROSTER_SOURCE/VITE_ROSTER_SOURCE is "${raw}", not "sheet" or "registry".`,
    null,
    'Set VITE_ROSTER_SOURCE to sheet or registry in Vercel and redeploy.',
  )
}

export interface RosterCsvRequest {
  source: RosterSource
  url: string
  headers: Record<string, string>
  /** Human label for alerts, never containing the token or the sheet URL. */
  label: string
}

/** How to fetch the roster as CSV on the configured source. Throws
 *  RosterConfigError (with an operator todo) when the source is unusable.
 *  There is no cross-source fallback. */
export function rosterCsvRequest(env: Env = process.env): RosterCsvRequest {
  const source = rosterSource(env)
  if (source === 'sheet') {
    const url = env.VITE_ROSTER_CSV_URL
    if (!url) {
      throw new RosterConfigError(
        'VITE_ROSTER_CSV_URL is not set on the deployment.',
        'sheet',
        'Set VITE_ROSTER_CSV_URL to the published roster sheet CSV in Vercel, or switch VITE_ROSTER_SOURCE=registry.',
      )
    }
    return { source, url, headers: {}, label: 'The roster Google Sheet CSV' }
  }
  const token = (env.SV_REGISTRY_ROSTER_TOKEN ?? '').trim()
  if (!token) {
    throw new RosterConfigError(
      'VITE_ROSTER_SOURCE=registry but SV_REGISTRY_ROSTER_TOKEN is not set, so the crons cannot authenticate to sv-registry.',
      'registry',
      'Mint a token in sv-registry (`node scripts/mint-service-token.cjs mint sv-travel-hub --scopes read:roster-projection`), set it as SV_REGISTRY_ROSTER_TOKEN (Production, server-only, NOT VITE_) in Vercel and redeploy. Or roll back with VITE_ROSTER_SOURCE=sheet.',
    )
  }
  const base = env.REGISTRY_ROSTER_URL || env.VITE_REGISTRY_ROSTER_URL || DEFAULT_REGISTRY_ROSTER_URL
  const u = new URL(base)
  u.searchParams.set('format', 'csv')
  return {
    source,
    url: u.toString(),
    headers: { Authorization: `Bearer ${token}` },
    label: 'The sv-registry roster projection (CSV door)',
  }
}

export function minRows(env: Env = process.env): number {
  const n = parseInt(env.ROSTER_MIN_ROWS ?? env.VITE_ROSTER_MIN_ROWS ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_ROWS
}

/** Fail closed on a short registry roster (a truncated or broken build must
 *  not drive a recap). Returns an error string, or null when fine. The sheet
 *  source keeps its existing behaviour (no floor). */
export function checkRowFloor(source: RosterSource, dataRows: number, env: Env = process.env): string | null {
  if (source !== 'registry') return null
  const floor = minRows(env)
  return dataRows < floor ? `only ${dataRows} roster rows (fail-closed floor is ${floor})` : null
}

/** What a registry HTTP status means, for alert copy. */
export function explainRegistryStatus(status: number): string {
  if (status === 401) return 'HTTP 401: the SV_REGISTRY_ROSTER_TOKEN is missing, revoked or mistyped. Re-mint it (revoke + mint) and update Vercel.'
  if (status === 403) return 'HTTP 403: the token is valid but not scoped read:roster-projection. Re-mint with --scopes read:roster-projection; do not retry.'
  return `HTTP ${status} from sv-registry.`
}
