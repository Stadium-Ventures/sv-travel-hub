// MLB Stats API helpers for the health monitor: one cached, retrying,
// concurrency-capped JSON fetcher per run pass, plus the lookups the coverage
// and season checks share (MLB clubs, Arizona Fall League clubs, rosters).
import type { FetchJson } from './monitorTypes.js'

export const MLB_BASE = 'https://statsapi.mlb.com/api/v1'
const USER_AGENT = 'SVTravelHub/HealthMonitor'

/** Arizona Fall League clubs live under this sport id with every winter
 *  league, so they are picked out by league name. */
export const AFL_SPORT_ID = 17

export class HttpError extends Error {
  readonly status: number
  constructor(status: number, url: string) {
    super(`HTTP ${status} from ${new URL(url).pathname}`)
    this.name = 'HttpError'
    this.status = status
  }
}

export interface FetchJsonOptions {
  /** Per-attempt timeout. */
  timeoutMs?: number
  /** Attempts per URL (network errors, 429 and 5xx are retried). */
  attempts?: number
  /** Max requests in flight at once, so a big roster never floods MLB. */
  concurrency?: number
  retryPauseMs?: number
  fetchImpl?: typeof fetch
}

/** A FetchJson with an in-memory cache keyed by URL: the coverage, AFL and
 *  season checks ask for some of the same MLB pages, and each is fetched once
 *  per pass. Create a new one for each pass so the re-check really re-asks. */
export function createFetchJson(opts: FetchJsonOptions = {}): FetchJson {
  const timeoutMs = opts.timeoutMs ?? 8_000
  const attempts = opts.attempts ?? 2
  const concurrency = opts.concurrency ?? 8
  const retryPauseMs = opts.retryPauseMs ?? 500
  const doFetch = opts.fetchImpl ?? fetch
  const cache = new Map<string, Promise<unknown>>()

  let active = 0
  const waiting: Array<() => void> = []
  const acquire = () => new Promise<void>((resolve) => {
    if (active < concurrency) { active++; resolve() } else waiting.push(() => { active++; resolve() })
  })
  const release = () => {
    active--
    const next = waiting.shift()
    if (next) next()
  }

  async function load(url: string): Promise<unknown> {
    let lastErr: unknown = new Error('not fetched')
    for (let i = 0; i < attempts; i++) {
      await acquire()
      try {
        const res = await doFetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) })
        if (res.ok) return await res.json()
        lastErr = new HttpError(res.status, url)
        // A 4xx other than rate limiting won't change on a retry.
        if (res.status < 500 && res.status !== 429) throw lastErr
      } catch (e) {
        if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e
        lastErr = e
      } finally {
        release()
      }
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, retryPauseMs))
    }
    throw lastErr
  }

  return (url: string) => {
    let p = cache.get(url)
    if (!p) {
      p = load(url)
      cache.set(url, p)
    }
    return p
  }
}

// ─── MLB clubs ───────────────────────────────────────────────────────────────

export interface MlbTeam {
  id: number
  name: string
  teamName?: string
  clubName?: string
  shortName?: string
  abbreviation?: string
  locationName?: string
  franchiseName?: string
}

export interface OrgIndex {
  /** MLB club id for a roster org name ("New York Yankees", "Yankees",
   *  "NYY", "Oakland Athletics"), or null. */
  resolve(org: string): number | null
  /** Display name for a club id. */
  name(id: number): string
  /** The 30 MLB club ids. */
  ids: Set<number>
}

function normOrg(s: string): string {
  return s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Spellings the live club list can't produce on its own. */
const ORG_ALIASES: Record<string, string> = {
  'a s': 'athletics',
  'as': 'athletics',
  'oakland as': 'athletics',
  'cleveland indians': 'guardians',
  'indians': 'guardians',
}

/** Resolve roster org names against the live MLB club list (the app's own
 *  alias table lives in src/, which serverless functions can't import). Every
 *  name field of every club is a key; a key two clubs share ("Chicago") is
 *  dropped as ambiguous. As a last step "<anything> <club nickname>" matches
 *  when exactly one club has that nickname, which covers a relocated club's
 *  old city ("Oakland Athletics"). */
export function buildOrgIndex(teams: MlbTeam[]): OrgIndex {
  const byKey = new Map<string, number>()
  const ambiguous = new Set<string>()
  const names = new Map<number, string>()
  const nicknames = new Map<string, number>()
  const add = (raw: string | undefined, id: number) => {
    if (!raw) return
    const k = normOrg(raw)
    if (!k || ambiguous.has(k)) return
    const prev = byKey.get(k)
    if (prev !== undefined && prev !== id) { byKey.delete(k); ambiguous.add(k); return }
    byKey.set(k, id)
  }
  for (const t of teams) {
    names.set(t.id, t.name)
    for (const v of [t.name, t.teamName, t.clubName, t.shortName, t.abbreviation, t.franchiseName]) add(v, t.id)
    if (t.locationName && t.teamName) add(`${t.locationName} ${t.teamName}`, t.id)
    if (t.teamName) nicknames.set(normOrg(t.teamName), t.id)
  }
  return {
    resolve(org: string): number | null {
      let k = normOrg(org)
      if (!k) return null
      k = ORG_ALIASES[k] ?? k
      const hit = byKey.get(k)
      if (hit !== undefined) return hit
      const nick = nicknames.get(k)
      if (nick !== undefined) return nick
      const words = k.split(' ')
      for (let i = 1; i < words.length; i++) {
        const tail = words.slice(i).join(' ')
        const id = nicknames.get(tail)
        if (id !== undefined) return id
      }
      return null
    },
    name(id: number): string {
      return names.get(id) ?? `club ${id}`
    },
    ids: new Set(teams.map((t) => t.id)),
  }
}

export async function loadOrgIndex(fetchJson: FetchJson, season: number): Promise<OrgIndex> {
  const data = await fetchJson(`${MLB_BASE}/teams?sportId=1&season=${season}`) as { teams?: MlbTeam[] }
  const teams = (data.teams ?? []).filter((t) => typeof t.id === 'number' && typeof t.name === 'string')
  if (teams.length === 0) throw new Error('MLB club list came back empty')
  return buildOrgIndex(teams)
}

// ─── Clubs and rosters ───────────────────────────────────────────────────────

export interface Club {
  id: number
  name: string
  sportId: number
}

export interface RosterEntry {
  id: number
  fullName: string
  /** Parent org id, when the roster says (AFL rosters do). */
  parentTeamId?: number
}

/** The six Arizona Fall League clubs for a season (throws when MLB fails). */
export async function loadAflClubs(fetchJson: FetchJson, season: number): Promise<Club[]> {
  const data = await fetchJson(`${MLB_BASE}/teams?sportId=${AFL_SPORT_ID}&season=${season}`) as {
    teams?: Array<{ id: number; name: string; league?: { name?: string } }>
  }
  return (data.teams ?? [])
    .filter((t) => /arizona fall league/i.test(t.league?.name ?? ''))
    .map((t) => ({ id: t.id, name: t.name, sportId: AFL_SPORT_ID }))
}

/** Affiliated clubs for some orgs. The endpoint also returns complex-league,
 *  Dominican and "Prospects"/"Organization" placeholder clubs whatever the
 *  sportIds filter says, so callers filter by sportId. */
export async function loadAffiliates(fetchJson: FetchJson, orgIds: number[], season: number): Promise<Array<Club & { parentOrgId: number }>> {
  if (orgIds.length === 0) return []
  const data = await fetchJson(`${MLB_BASE}/teams/affiliates?teamIds=${[...orgIds].sort((a, b) => a - b).join(',')}&season=${season}`) as {
    teams?: Array<{ id: number; name: string; sport?: { id?: number }; parentOrgId?: number }>
  }
  return (data.teams ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    sportId: t.sport?.id ?? 0,
    parentOrgId: t.parentOrgId ?? t.id,
  }))
}

export async function loadRoster(fetchJson: FetchJson, teamId: number, season: number, rosterType: 'fullRoster' | 'active' = 'fullRoster'): Promise<RosterEntry[]> {
  const data = await fetchJson(`${MLB_BASE}/teams/${teamId}/roster?rosterType=${rosterType}&season=${season}`) as {
    roster?: Array<{ person?: { id?: number; fullName?: string }; parentTeamId?: number }>
  }
  const out: RosterEntry[] = []
  for (const r of data.roster ?? []) {
    if (typeof r.person?.id !== 'number' || !r.person.fullName) continue
    out.push({ id: r.person.id, fullName: r.person.fullName, parentTeamId: r.parentTeamId })
  }
  return out
}
