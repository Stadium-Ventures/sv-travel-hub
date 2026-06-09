// Schedule fetcher for summer leagues that ride on the MLB Stats API
// (CCBL leagueId=565, MLB Draft League leagueId=5536). Reuses fetchWithRetry +
// the same /schedule endpoint as MLB/MiLB; the partner-league sportId is
// auto-discovered via /teams?leagueId=… so we don't have to hardcode it.

import { fetchWithTimeout } from './fetchWithTimeout'
import type { MLBGameRaw } from './mlbApi'

const MLB_BASE = 'https://statsapi.mlb.com/api/v1'

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_RETRY_ATTEMPTS = 3

async function fetchWithRetry(url: string, options?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options)
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastError = e
    }
    if (attempt < MAX_RETRY_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
  throw lastError
}

export interface PartnerLeagueTeam {
  teamId: number
  teamName: string
  /** All known names: official, short, location, etc. — used to match against the assignment sheet. */
  aliases: string[]
  sportId: number
  leagueId: number
}

/**
 * Discover all teams in a partner league (CCBL or MLB Draft League) for a
 * given season. Returns the sportId implicitly via each team — the partner
 * league sportId is not the same as MLB (1) or MiLB (11-14) and varies by
 * league, so we read it off the response rather than hardcoding.
 */
export async function fetchPartnerLeagueTeams(leagueId: number, season: number): Promise<PartnerLeagueTeam[]> {
  const url = `${MLB_BASE}/teams?leagueIds=${leagueId}&season=${season}`
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`Partner league teams fetch failed (${leagueId}): ${res.status}`)
  const data = await res.json()

  return (data.teams ?? []).map((t: Record<string, unknown>) => {
    const sport = t.sport as Record<string, unknown> | undefined
    const aliases: string[] = []
    const push = (s: unknown) => {
      if (typeof s === 'string' && s.trim()) aliases.push(s.trim())
    }
    push(t.name)
    push(t.teamName)
    push(t.shortName)
    push(t.locationName)
    push(t.clubName)
    push(t.franchiseName)
    return {
      teamId: t.id as number,
      teamName: (t.name as string) ?? (t.teamName as string) ?? `Team ${t.id}`,
      aliases: [...new Set(aliases)],
      sportId: (sport?.id as number) ?? 0,
      leagueId,
    } satisfies PartnerLeagueTeam
  }).filter((t: PartnerLeagueTeam) => t.sportId > 0)
}

/**
 * Fetch schedule for one partner-league team. Uses the same hydration as the
 * MLB/MiLB fetcher so we get venue coords + probable pitcher in one call.
 */
export async function fetchPartnerLeagueSchedule(
  team: PartnerLeagueTeam,
  startDate: string,
  endDate: string,
): Promise<MLBGameRaw[]> {
  const url = `${MLB_BASE}/schedule?sportId=${team.sportId}&teamId=${team.teamId}&startDate=${startDate}&endDate=${endDate}&hydrate=venue(location),probablePitcher`
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`Partner league schedule fetch failed (team ${team.teamId}): ${res.status}`)
  const data = await res.json()
  const games: MLBGameRaw[] = []
  for (const date of data.dates ?? []) {
    for (const game of date.games ?? []) games.push(game)
  }
  return games
}

/**
 * Match a summer-team name (as written on the assignment sheet) against the
 * teams returned by the MLB API. Tolerates the kinds of name variation we see
 * on the sheet ("Hyannis Harbor Hawks" vs "Hyannis"). Returns null if no
 * reasonable match found — caller surfaces a warning.
 */
export function matchTeamByName(sheetName: string, teams: PartnerLeagueTeam[]): PartnerLeagueTeam | null {
  const target = normalizeTeamName(sheetName)
  if (!target) return null

  // Exact match on any alias first
  for (const t of teams) {
    if (t.aliases.some((a) => normalizeTeamName(a) === target)) return t
  }
  // Then: target contains alias, or alias contains target
  for (const t of teams) {
    if (t.aliases.some((a) => {
      const n = normalizeTeamName(a)
      return n.includes(target) || target.includes(n)
    })) return t
  }
  return null
}

function normalizeTeamName(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}
