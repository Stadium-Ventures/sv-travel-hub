import type { RosterPlayer, PlayerLevel } from '../types/roster'
import { TIER_VISIT_TARGETS } from '../types/roster'
import { fetchWithTimeout } from './fetchWithTimeout'

/** sv-registry's roster projection door. Contract: sv-registry
 *  sops/roster-projection-adoption.md + api/roster-projection.js.
 *  Rows are keyed by `slug` (and `mlb_id`); `name` is display only. The
 *  projection never carries contact data (phone/email/parents/DOB/age) and
 *  this loader refuses a payload that does not assert that. */
export const DEFAULT_REGISTRY_ROSTER_URL = 'https://sv-registry.vercel.app/api/roster-projection'

/** Fail closed below this many client rows. The projection carries ~99 rows
 *  and the sheet ~88; a response far below that is a broken build or a
 *  truncated read, and pruning every persisted store against it would drop
 *  real clients. Override with VITE_ROSTER_MIN_ROWS. */
export const DEFAULT_MIN_ROWS = 50

export interface ProjectionVisits {
  target_2026?: number | null
  observed_2026_count?: number | null
  last_observed?: string | null
}

export interface ProjectionRow {
  slug: string
  name: string
  mlb_id?: number | string | null
  tier?: string | null // pro | amt | coach (NOT the visit tier)
  level?: string | null
  org?: string | null
  team?: string | null
  affiliate?: string | null
  priority_tier?: number | null // the sheet's 1-4 "Tier"
  lead_agent?: string | null
  visits?: ProjectionVisits | null
  is_client?: boolean
  career_status?: string | null // active | retired
  is_coach?: boolean
  position?: string | null
  draft_class?: string | number | null
  home_state?: string | null
  high_school?: string | null
  sheet_status?: string | null // Retired | Injured | Free Agent | ''
  sheet_level?: string | null // Pro | NCAA | HS | JUCO ...
  [extra: string]: unknown
}

export interface ProjectionMeta {
  generated_at: string
  contains_no_contact_data?: boolean
  [extra: string]: unknown
}

export interface RegistryRosterResult {
  players: RosterPlayer[]
  warnings: string[]
  generatedAt: string
}

/** No credential, or the registry rejected it (401). Re-authenticate. */
export class RosterAuthError extends Error {
  readonly status: number | null
  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'RosterAuthError'
    this.status = status
  }
}

/** The credential is valid but not granted this door (403). Escalate; retrying won't help. */
export class RosterScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RosterScopeError'
  }
}

/** The payload broke the contract (shape, contact-data assertion, row floor). */
export class RosterContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RosterContractError'
  }
}

const HS_LEVELS = new Set(['hs', 'high school'])
const NCAA_LEVELS = new Set(['ncaa', 'college', 'd1', 'd2', 'd3', 'naia'])
const JUCO_LEVELS = new Set(['juco', 'junior college'])

/** `sheet_level` is the sheet-compatible bucket (Pro/NCAA/HS/JUCO); `level`
 *  is the finer registry value (MLB, AAA, High-A, Rookie, NCAA, HS, ...).
 *  Anything that isn't HS / NCAA / JUCO is professional baseball. */
export function mapLevel(row: Pick<ProjectionRow, 'sheet_level' | 'level'>): { level: PlayerLevel; isJuco: boolean; raw: string } {
  const raw = String(row.sheet_level || row.level || '').trim()
  const lower = raw.toLowerCase()
  if (HS_LEVELS.has(lower)) return { level: 'HS', isJuco: false, raw }
  if (JUCO_LEVELS.has(lower)) return { level: 'NCAA', isJuco: true, raw }
  if (NCAA_LEVELS.has(lower)) return { level: 'NCAA', isJuco: false, raw }
  return { level: 'Pro', isJuco: false, raw }
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseInt(v, 10)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** One projection row -> RosterPlayer. Builds the object field by field from
 *  an allowlist, so an unexpected extra field in a row (including any contact
 *  field) can never reach the app or its storage. */
export function mapProjectionRow(row: ProjectionRow, warnings: string[] = []): RosterPlayer {
  const playerName = str(row.name)
  const { level, isJuco, raw: levelRaw } = mapLevel(row)
  if (!levelRaw) warnings.push(`${playerName}: no level in the registry, defaulted to Pro`)

  let tier = toInt(row.priority_tier)
  if (tier === null) {
    warnings.push(`${playerName}: no priority tier in the registry, defaulted to T2`)
    tier = 2
  }

  const visits = row.visits ?? {}
  const visitTarget2026 = toInt(visits.target_2026) ?? TIER_VISIT_TARGETS[tier] ?? 0
  const visitsCompleted = toInt(visits.observed_2026_count) ?? 0
  const status = str(row.sheet_status) || (str(row.career_status).toLowerCase() === 'retired' ? 'Retired' : '')

  return {
    slug: str(row.slug),
    playerName,
    normalizedName: normalizeName(playerName),
    org: str(row.org),
    level,
    isJuco,
    mlbPlayerId: toInt(row.mlb_id),
    pgPlayerId: null, // not in canon
    position: str(row.position),
    state: str(row.home_state),
    draftClass: str(row.draft_class),
    tier,
    leadAgent: str(row.lead_agent),
    visitTarget2026,
    visitsCompleted,
    lastVisitDate: str(visits.last_observed) || null,
    visitsRemaining: Math.max(0, visitTarget2026 - visitsCompleted),
    status,
  }
}

/** Validate a projection payload and turn it into the app's roster. Throws
 *  RosterContractError rather than returning a partial roster. */
export function projectionToRoster(json: unknown, opts: { minRows?: number; generatedAtHeader?: string | null } = {}): RegistryRosterResult {
  const minRows = opts.minRows ?? DEFAULT_MIN_ROWS
  if (!json || typeof json !== 'object') throw new RosterContractError('Registry roster: response is not a JSON object')
  const { _meta, rows } = json as { _meta?: ProjectionMeta; rows?: unknown }
  if (!_meta || typeof _meta !== 'object') throw new RosterContractError('Registry roster: response has no _meta')
  if (_meta.contains_no_contact_data !== true) {
    throw new RosterContractError('Registry roster: _meta.contains_no_contact_data is not true; refusing to load')
  }
  if (!Array.isArray(rows)) throw new RosterContractError('Registry roster: response has no rows array')
  if (rows.length < minRows) {
    throw new RosterContractError(
      `Registry roster returned ${rows.length} rows, below the fail-closed floor of ${minRows}. Keeping the previous roster; report this in #sv-automation.`,
    )
  }

  const warnings: string[] = []
  const players: RosterPlayer[] = []
  const seen = new Set<string>()
  for (const r of rows as ProjectionRow[]) {
    if (!r || typeof r !== 'object') continue
    const slug = str(r.slug)
    if (!slug || !str(r.name)) {
      warnings.push('Registry roster: skipped a row with no slug or name')
      continue
    }
    if (seen.has(slug)) {
      warnings.push(`Registry roster: duplicate slug "${slug}", kept the first`)
      continue
    }
    seen.add(slug)
    if (r.is_client === false) continue // former clients are excluded at source; belt and braces
    if (r.is_coach === true) continue // same rule as the sheet's "Is Coach" filter
    players.push(mapProjectionRow(r, warnings))
  }

  const generatedAt = str(_meta.generated_at) || str(opts.generatedAtHeader)
  if (!generatedAt) warnings.push('Registry roster: no generated_at; freshness unknown')
  return { players, warnings, generatedAt }
}

export interface FetchRegistryRosterOptions {
  getToken: () => string | null | Promise<string | null>
  url?: string
  minRows?: number
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}

export async function fetchRegistryRoster(opts: FetchRegistryRosterOptions): Promise<RegistryRosterResult> {
  const token = await opts.getToken()
  if (!token) {
    throw new RosterAuthError('Sign in with your @stadium-ventures.com Google account to load the roster.')
  }
  const url = opts.url || DEFAULT_REGISTRY_ROSTER_URL
  const doFetch = opts.fetchImpl ?? ((u: string, init: RequestInit) => fetchWithTimeout(u, { ...init, timeoutMs: 15000 }))
  const res = await doFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    credentials: 'omit',
  })
  if (res.status === 401) throw new RosterAuthError('Your sign-in expired or was rejected by the registry. Sign in again.', 401)
  if (res.status === 403) {
    throw new RosterScopeError('The registry rejected this account for the roster (403). This needs an access grant, not a retry.')
  }
  if (!res.ok) throw new Error(`Registry roster fetch failed: HTTP ${res.status}`)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new RosterContractError('Registry roster: response was not JSON')
  }
  return projectionToRoster(json, { minRows: opts.minRows, generatedAtHeader: res.headers.get('X-Roster-Generated-At') })
}
