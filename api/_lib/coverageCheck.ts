// Client coverage check, run daily by the health monitor.
//
// The other checks ask "is each data source up?". This one asks the question
// Kent actually cares about: "can the hub show every pro client's games?" It
// looks each pro client up in MLB's records and flags the clients the hub
// would silently get wrong or drop:
//
//  (a) no MLB id on our roster, and no exact name match on any roster in
//      their organization, so the app can't find their team at all;
//  (b) MLB's organization for them differs from our roster's (a trade the
//      registry hasn't caught yet, or an MLB id that points at someone else),
//      or MLB has no player under the id on file;
//  (c) in season (Mar to Sep, plus Oct 1 to Nov 15 for Arizona Fall League
//      clients), their team plays in the next 7 days at a U.S. field with no
//      map location in MLB's data or in the hub's fallback table, so those
//      games never reach the map;
//  (d) they're on an Arizona Fall League roster but our roster has no MLB id
//      for them, so the app can't put them on their fall club.
//
// Injured, retired and free-agent clients (and coaches) are skipped. MLB is
// asked in batches through a per-pass cache, so a run costs a handful of
// requests. When MLB itself is unreachable this check stays quiet: the
// monitor's separate MLB probe owns outages.
//
// Every result is an issue with a stable key. The monitor re-runs the check
// after a short pause and posts only the issues seen both times.
import { fallbackVenueCoords as defaultVenueFallback } from '../_data/proVenueFallback.js'
import type { VenueFallbackInput } from '../_data/proVenueFallback.js'
import { isoDay, joinList, monthDay, plural } from './csv.js'
import {
  HttpError,
  MLB_BASE,
  loadAffiliates,
  loadAflClubs,
  loadOrgIndex,
  loadRoster,
  type Club,
  type OrgIndex,
} from './mlbClient.js'
import type { FetchJson, Finding, RosterClient } from './monitorTypes.js'
import { isFreeAgentToWatch, isSkippedClient } from './rosterClients.js'

export type CoverageIssue =
  | { kind: 'no-id-no-match'; key: string; client: string; org: string; orgKnown: boolean }
  | { kind: 'org-mismatch'; key: string; client: string; rosterOrg: string; mlbOrg: string; freeAgent?: boolean }
  | { kind: 'unknown-id'; key: string; client: string }
  | { kind: 'unmapped-venue'; key: string; client: string; venueId: number; venue: string; place: string; games: number }
  | { kind: 'afl-no-id'; key: string; client: string; club: string; mlbId: number }
  | { kind: 'lookup-failed'; key: string }

export interface CoverageOptions {
  now: Date
  fetchJson: FetchJson
  /** Injected in tests; defaults to the hub's real fallback table. */
  venueFallback?: (input: VenueFallbackInput) => { lat: number; lng: number } | null
}

/** Sport ids whose rosters the app searches by name: MLB (active roster),
 *  Triple-A to Single-A, and the complex leagues. "Prospects" and
 *  "Organization" placeholder clubs (21) play no games, so a name found only
 *  there still leaves the client with nothing on the map. */
const NAME_SEARCH_SPORTS = new Set([1, 11, 12, 13, 14, 16])
const SCHEDULE_SPORTS = '1,11,12,13,14,16,17'
const PEOPLE_BATCH = 50
const SCHEDULE_BATCH = 25

/** Mar to Sep (UTC). */
export function isProSeason(now: Date): boolean {
  const m = now.getUTCMonth()
  return m >= 2 && m <= 8
}

/** Fall league games: Oct 1 to Nov 15. */
export function isAflGameWindow(now: Date): boolean {
  const md = monthDay(now)
  return md >= 1001 && md <= 1115
}

/** Fall league rosters exist from early September to the league's end. */
export function isAflRosterWindow(now: Date): boolean {
  const md = monthDay(now)
  return md >= 901 && md <= 1120
}

/** Exact match the way the app does it (lowercase, trimmed). */
function appNameKey(s: string): string {
  return s.toLowerCase().trim()
}

/** Looser person-name key for the fall roster search: accents, periods and
 *  spacing don't matter ("José Pérez Jr." = "Jose Perez Jr"). */
export function personKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

interface VenueLocation {
  city?: string
  state?: string
  stateAbbrev?: string
  country?: string
  defaultCoordinates?: { latitude?: number; longitude?: number }
}

/** Only U.S. fields count: the hub is a driving app, and the fallback table
 *  leaves Dominican complexes and winter-league parks out on purpose. A venue
 *  with no country at all is treated as U.S. (we only look at clients' own
 *  U.S.-based clubs). */
function isUsVenue(loc: VenueLocation | undefined): boolean {
  const c = (loc?.country ?? '').trim().toLowerCase()
  return c === '' || c === 'usa' || c === 'us' || c === 'united states'
}

function hasCoords(loc: VenueLocation | undefined): boolean {
  const c = loc?.defaultCoordinates
  return typeof c?.latitude === 'number' && typeof c?.longitude === 'number'
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

interface Person {
  id: number
  currentTeam?: { id?: number; name?: string; parentOrgId?: number }
}

interface AflRosters {
  /** MLB id → fall club. */
  clubOf: Map<number, Club>
  /** personKey(name) → fall club + MLB id. */
  byName: Map<string, { club: Club; id: number }>
}

/** Batched currentTeam lookup. `unanswered` holds ids whose batch failed. */
async function lookupPeople(fetchJson: FetchJson, ids: number[]): Promise<{ people: Map<number, Person>; unanswered: Set<number> }> {
  const people = new Map<number, Person>()
  const unanswered = new Set<number>()
  await Promise.all(chunk(ids, PEOPLE_BATCH).map(async (batch) => {
    try {
      const data = await fetchJson(`${MLB_BASE}/people?personIds=${batch.join(',')}&hydrate=currentTeam`) as { people?: Person[] }
      for (const p of data.people ?? []) if (typeof p.id === 'number') people.set(p.id, p)
    } catch (e) {
      // MLB answers a batch of nothing but unknown ids with "not found";
      // that is an answer (none of them exist), not an outage.
      if (e instanceof HttpError && e.status === 404) return
      for (const id of batch) unanswered.add(id)
    }
  }))
  return { people, unanswered }
}

/** The six fall league rosters, or null when the club list is unreachable
 *  (the weekly fall league check and the MLB probe cover that). */
async function loadAflRosters(fetchJson: FetchJson, season: number): Promise<AflRosters | null> {
  try {
    const clubs = await loadAflClubs(fetchJson, season)
    const rosters = await Promise.all(clubs.map((club) =>
      loadRoster(fetchJson, club.id, season).then((entries) => ({ club, entries })).catch(() => null)))
    const out: AflRosters = { clubOf: new Map(), byName: new Map() }
    for (const r of rosters) {
      if (!r) continue
      for (const e of r.entries) {
        out.clubOf.set(e.id, r.club)
        out.byName.set(personKey(e.fullName), { club: r.club, id: e.id })
      }
    }
    return out
  } catch {
    return null
  }
}

/** For each org: exact name (app-style key) → club, across the rosters the
 *  app searches. An org maps to null when nothing could be read (offseason or
 *  outage): unknown, not missing. */
async function searchOrgRosters(fetchJson: FetchJson, orgIds: number[], season: number): Promise<Map<number, Map<string, Club> | null>> {
  const out = new Map<number, Map<string, Club> | null>()
  if (orgIds.length === 0) return out
  let affiliates: Awaited<ReturnType<typeof loadAffiliates>>
  try {
    affiliates = await loadAffiliates(fetchJson, orgIds, season)
  } catch {
    for (const org of orgIds) out.set(org, null)
    return out
  }
  await Promise.all(orgIds.map(async (org) => {
    const clubs = affiliates.filter((t) => t.parentOrgId === org && NAME_SEARCH_SPORTS.has(t.sportId))
    const rosters = await Promise.all(clubs.map((club) =>
      loadRoster(fetchJson, club.id, season, club.sportId === 1 ? 'active' : 'fullRoster')
        .then((entries) => ({ club, entries }))
        .catch(() => null)))
    const byName = new Map<string, Club>()
    let players = 0
    for (const r of rosters) {
      if (!r) continue
      players += r.entries.length
      for (const e of r.entries) if (!byName.has(appNameKey(e.fullName))) byName.set(appNameKey(e.fullName), r.club)
    }
    out.set(org, players > 0 ? byName : null)
  }))
  return out
}

export async function runCoverageCheck(clients: RosterClient[], opts: CoverageOptions): Promise<CoverageIssue[]> {
  const { now, fetchJson } = opts
  const venueFallback = opts.venueFallback ?? defaultVenueFallback
  const season = now.getUTCFullYear()
  const pros = clients.filter((c) => c.level === 'Pro' && !isSkippedClient(c))
  // Free agents are only looked up to see whether a new club signed them.
  const freeAgents = clients.filter(isFreeAgentToWatch)
  if (pros.length === 0 && freeAgents.length === 0) return []
  const withId = [...pros.filter((c) => c.mlbId != null), ...freeAgents]
  const freeAgentNames = new Set(freeAgents.map((c) => c.name))
  const noId = pros.filter((c) => c.mlbId == null)

  // Everything that doesn't need the club list starts at once.
  const orgsP = loadOrgIndex(fetchJson, season).catch(() => null)
  const peopleP = lookupPeople(fetchJson, withId.map((c) => c.mlbId!))
  const aflP = isAflRosterWindow(now) ? loadAflRosters(fetchJson, season) : Promise.resolve(null)

  const orgs: OrgIndex | null = await orgsP
  if (!orgs) return [] // MLB unreachable: the monitor's MLB probe reports outages

  // (a) No MLB id: the app falls back to an exact name match on the org's
  // rosters. Mirror that search.
  const issues: CoverageIssue[] = []
  const noIdByOrg = new Map<number, RosterClient[]>()
  for (const c of noId) {
    const org = orgs.resolve(c.org)
    if (org == null) {
      issues.push({ kind: 'no-id-no-match', key: `no-id:${appNameKey(c.name)}`, client: c.name, org: c.org, orgKnown: false })
      continue
    }
    const list = noIdByOrg.get(org)
    if (list) list.push(c)
    else noIdByOrg.set(org, [c])
  }
  const [{ people, unanswered }, afl, search] = await Promise.all([
    peopleP,
    aflP,
    searchOrgRosters(fetchJson, [...noIdByOrg.keys()], season),
  ])

  /** Client name → the club whose schedule the hub would show for them. */
  const teamOf = new Map<string, Club>()

  // (b) MLB's organization vs ours.
  const answered = withId.filter((c) => !unanswered.has(c.mlbId!))
  if (withId.length > 0 && (answered.length === 0 || (people.size === 0 && answered.length > 1))) {
    // Every lookup failed, or MLB "knows" none of our clients: the lookup is
    // broken, not the roster. One finding instead of one per client.
    issues.push({ kind: 'lookup-failed', key: 'lookup-failed' })
  } else {
    for (const c of answered) {
      const p = people.get(c.mlbId!)
      if (!p) {
        issues.push({ kind: 'unknown-id', key: `unknown-id:${c.mlbId}`, client: c.name })
        continue
      }
      const ct = p.currentTeam
      if (!ct || typeof ct.id !== 'number') continue // no current club: nothing to compare
      const freeAgent = freeAgentNames.has(c.name)
      if (!freeAgent) teamOf.set(c.name, { id: ct.id, name: ct.name ?? '', sportId: 0 })
      // Minor leaguers (and fall leaguers) carry their org as parentOrgId; a
      // big leaguer's club IS the org. A winter-league club has neither.
      const mlbOrg = ct.parentOrgId ?? (orgs.ids.has(ct.id) ? ct.id : null)
      if (mlbOrg == null) continue
      if (orgs.resolve(c.org) !== mlbOrg) {
        issues.push({
          kind: 'org-mismatch',
          key: `org:${c.mlbId}:${mlbOrg}`,
          client: c.name,
          rosterOrg: c.org,
          mlbOrg: orgs.name(mlbOrg),
          ...(freeAgent ? { freeAgent: true } : {}),
        })
      }
    }
  }

  // (a) continued: who the name search found, and who it didn't.
  for (const [org, list] of noIdByOrg) {
    const byName = search.get(org)
    if (!byName) continue
    for (const c of list) {
      const hit = byName.get(appNameKey(c.name))
      if (hit) teamOf.set(c.name, hit)
      else issues.push({ kind: 'no-id-no-match', key: `no-id:${appNameKey(c.name)}`, client: c.name, org: orgs.name(org), orgKnown: true })
    }
  }

  // (d) On a fall league roster, but no MLB id on ours.
  if (afl) {
    for (const c of noId) {
      const hit = afl.byName.get(personKey(c.name))
      if (hit) issues.push({ kind: 'afl-no-id', key: `afl-no-id:${hit.id}`, client: c.name, club: hit.club.name, mlbId: hit.id })
    }
  }
  const aflClubOf = afl?.clubOf ?? new Map<number, Club>()

  // (c) Games in the next 7 days at a U.S. field the map can't place.
  const proSeason = isProSeason(now)
  const aflGames = isAflGameWindow(now)
  if (proSeason || aflGames) {
    const clientsByTeam = new Map<number, string[]>()
    for (const c of pros) {
      const team = proSeason ? teamOf.get(c.name) : (c.mlbId != null ? aflClubOf.get(c.mlbId) : undefined)
      if (!team || /^DSL\b/i.test(team.name)) continue // Dominican complexes are out of scope
      const list = clientsByTeam.get(team.id)
      if (list) list.push(c.name)
      else clientsByTeam.set(team.id, [c.name])
    }
    if (clientsByTeam.size > 0) {
      const start = isoDay(now)
      const end = isoDay(new Date(now.getTime() + 6 * 86_400_000))
      const venueIssues = new Map<string, Extract<CoverageIssue, { kind: 'unmapped-venue' }>>()
      await Promise.all(chunk([...clientsByTeam.keys()], SCHEDULE_BATCH).map(async (ids) => {
        let data: { dates?: Array<{ games?: ScheduleGame[] }> }
        try {
          data = await fetchJson(`${MLB_BASE}/schedule?teamId=${ids.join(',')}&sportId=${SCHEDULE_SPORTS}&startDate=${start}&endDate=${end}&hydrate=venue(location)`) as typeof data
        } catch {
          return
        }
        for (const day of data.dates ?? []) {
          for (const g of day.games ?? []) {
            const v = g.venue
            if (!v || typeof v.id !== 'number') continue
            if (hasCoords(v.location) || !isUsVenue(v.location)) continue
            if (venueFallback({ venueId: v.id, venueName: v.name, city: v.location?.city })) continue
            const place = [v.location?.city, v.location?.stateAbbrev ?? v.location?.state].filter(Boolean).join(', ')
            const teamIds = new Set([g.teams?.home?.team?.id, g.teams?.away?.team?.id])
            for (const tid of teamIds) {
              if (typeof tid !== 'number') continue
              for (const client of clientsByTeam.get(tid) ?? []) {
                const key = `venue:${v.id}:${appNameKey(client)}`
                const prev = venueIssues.get(key)
                if (prev) prev.games++
                else venueIssues.set(key, { kind: 'unmapped-venue', key, client, venueId: v.id, venue: v.name ?? 'an unnamed field', place, games: 1 })
              }
            }
          }
        }
      }))
      issues.push(...venueIssues.values())
    }
  }

  return issues
}

interface ScheduleGame {
  teams?: { home?: { team?: { id?: number } }; away?: { team?: { id?: number } } }
  venue?: { id?: number; name?: string; location?: VenueLocation }
}

// ─── Alert copy ──────────────────────────────────────────────────────────────

function finding(key: string, code: boolean, title: string, what: string, how: string, todo: string, issueKeys: string[]): Finding {
  return { key: `coverage:${key}`, severity: 'warning', code, title, what, how, todo, partial: true, issueKeys }
}

/** Turn coverage issues into one finding per kind. */
export function coverageFindings(issues: CoverageIssue[]): Finding[] {
  const out: Finding[] = []
  const of = <K extends CoverageIssue['kind']>(kind: K) =>
    issues.filter((i): i is Extract<CoverageIssue, { kind: K }> => i.kind === kind)
      .sort((a, b) => ('client' in a && 'client' in b ? a.client.localeCompare(b.client) : 0))

  const venues = of('unmapped-venue')
  if (venues.length > 0) {
    const clients = [...new Set(venues.map((v) => v.client))]
    const fields = new Map<number, string>()
    for (const v of venues) fields.set(v.venueId, v.place ? `${v.venue} (${v.place})` : v.venue)
    const n = clients.length
    out.push(finding(
      'venue', true,
      `${n} ${plural(n, 'client has', 'clients have')} games the map can't place`,
      `${joinList(clients)} ${plural(n, 'has', 'have')} games in the next week that the hub can't place on the map, so those games don't show.`,
      `This morning's coverage check found their team playing at ${plural(fields.size, 'a field', 'fields')} with no map location: ${joinList([...fields.values()])}.`,
      'Open sv-travel-hub in Claude Code and add the field to the venue fallback table.',
      venues.map((v) => v.key),
    ))
  }

  const mismatches = of('org-mismatch')
  const unknownIds = of('unknown-id')
  if (mismatches.length + unknownIds.length > 0) {
    const n = mismatches.length + unknownIds.length
    const parts: string[] = []
    const signed = mismatches.filter((m) => m.freeAgent)
    const moved = mismatches.filter((m) => !m.freeAgent)
    if (moved.length > 0) {
      parts.push(`MLB lists a different organization than our roster for ${joinList(moved.map((m) =>
        `${m.client} (roster: ${m.rosterOrg || 'none'}, MLB: ${m.mlbOrg})`))}, so the hub may be showing the wrong team's games.`)
    }
    if (signed.length > 0) {
      parts.push(`${joinList(signed.map((m) => `${m.client} (last with ${m.rosterOrg}, now ${m.mlbOrg})`))} ${plural(signed.length, 'is', 'are')} listed as a free agent on our roster, but MLB now has ${plural(signed.length, 'him', 'them')} with a new organization, so ${plural(signed.length, 'he probably signed', 'they probably signed')} there. Update ${plural(signed.length, 'his', 'their')} status and organization in sv-registry.`)
    }
    if (unknownIds.length > 0) {
      parts.push(`MLB has no player under the id on file for ${joinList(unknownIds.map((u) => u.client))}, so the hub can't find their team.`)
    }
    out.push(finding(
      'org', false,
      `${n} ${plural(n, "client's", "clients'")} MLB details don't match our roster`,
      parts.join(' '),
      "This morning's coverage check compared each pro client's organization with MLB's current team listing.",
      "Check that each client's MLB player id in sv-registry belongs to the right player. If a client changed organizations in the last day, this clears by itself once sv-registry catches up (it checks every few hours).",
      [...mismatches, ...unknownIds].map((i) => i.key),
    ))
  }

  const noMatch = of('no-id-no-match')
  if (noMatch.length > 0) {
    const n = noMatch.length
    const known = noMatch.filter((i) => i.orgKnown)
    const unknown = noMatch.filter((i) => !i.orgKnown)
    const parts: string[] = []
    if (known.length > 0) {
      parts.push(`${joinList(known.map((i) => `${i.client} (${i.org})`))} ${plural(known.length, 'has', 'have')} no MLB player id on file, and the hub can't find that exact name on any team in ${plural(known.length, 'that organization', 'their organization')}.`)
    }
    if (unknown.length > 0) {
      parts.push(`${joinList(unknown.map((i) => (i.org ? `${i.client} (listed as "${i.org}")` : `${i.client} (no organization listed)`)))} ${plural(unknown.length, 'has', 'have')} no MLB player id on file and no MLB organization the hub recognizes.`)
    }
    out.push(finding(
      'no-id', false,
      `${n} ${plural(n, "client can't", "clients can't")} be matched to a team`,
      `${parts.join(' ')} Their games don't show in the hub.`,
      "This morning's coverage check searched every team roster in the client's organization for the name on our roster.",
      "Add each client's MLB player id to their record in sv-registry (it's the number at the end of their mlb.com player page), and fix the organization if it's wrong. The hub picks it up on its next roster load.",
      noMatch.map((i) => i.key),
    ))
  }

  const afl = of('afl-no-id')
  if (afl.length > 0) {
    const n = afl.length
    out.push(finding(
      'afl-no-id', false,
      `${n} fall league ${plural(n, 'client is', 'clients are')} missing an MLB id`,
      `${joinList(afl.map((a) => `${a.client} (${a.club})`))} ${plural(n, 'is', 'are')} on an Arizona Fall League roster, but our roster has no MLB player id for them, so the hub can't show their fall games.`,
      n === 1
        ? `This morning's coverage check found the name on the club's roster in MLB's records, under MLB player id ${afl[0]!.mlbId}.`
        : `This morning's coverage check found the names on the clubs' rosters in MLB's records, under MLB player ids ${joinList(afl.map((a) => `${a.mlbId} (${a.client})`))}.`,
      `Add the MLB player ${plural(n, 'id', 'ids')} to ${plural(n, "the client's record", "the clients' records")} in sv-registry.`,
      afl.map((a) => a.key),
    ))
  }

  if (issues.some((i) => i.kind === 'lookup-failed')) {
    out.push(finding(
      'lookup-failed', true,
      "The client coverage check couldn't look clients up",
      "This morning's coverage check couldn't look pro clients up in MLB's records, so nobody knows whether every client's games are showing.",
      "MLB's stats service answered the club list but failed the client lookup on both tries this morning.",
      "If MLB's service is down this clears by itself. If it shows up again tomorrow, open sv-travel-hub in Claude Code: MLB may have changed how it answers player lookups.",
      ['lookup-failed'],
    ))
  }
  return out
}
