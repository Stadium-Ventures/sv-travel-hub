// Browser side of the NCAA schedules: asks the app's own /api/ncaa-schedules
// endpoint (which reads each school's official athletics site, see
// api/_lib/ncaaSchedule.ts) and decides what to show when that fails.
//
// Order of preference for each school:
//   1. the official site, through the endpoint (CDN-cached for hours)
//   2. games typed into the Client Game Schedule sheet, when the official
//      site can't be read or has nothing for the season yet
//   3. the last good official copy this browser saw
//   4. the bundled snapshot (src/data/ncaaSchedules.generated.ts)
// "Nothing published yet" is a normal offseason answer, not a failure.

import type { NcaaSchoolSchedule } from '../../api/_lib/ncaaSchedule'
import { upcomingSeason } from '../../api/_lib/ncaaSchedule'
import { BUNDLED_NCAA_SCHEDULES } from '../data/ncaaSchedules.generated'
import { NCAA_NEUTRAL_SITES } from '../data/ncaaNeutralSites'
import type { NcaaSchedule, UnresolvedNcaaGame, Venue } from './ncaaEvents'
import { fetchNcaaSheetGames } from './ncaaSheetGames'
import { fetchWithTimeout } from './fetchWithTimeout'

const SAVED_KEY = 'sv-travel-ncaa-official-v1'
const PLACES_KEY = 'sv-travel-ncaa-places-v1'

export type NcaaNoticeKind = 'empty' | 'error' | 'no-source'

/** Something the Data health panel should say about one school. */
export interface NcaaNotice {
  school: string
  kind: NcaaNoticeKind
  message: string
  /** What is being shown instead. */
  fallback: 'sheet' | 'saved' | 'bundled' | 'none'
  fallbackFetchedAt?: number
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the copy is only a fallback.
  }
}

function saveOfficial(schedule: NcaaSchedule) {
  const all = readJson<Record<string, NcaaSchedule>>(SAVED_KEY) ?? {}
  all[schedule.school] = schedule
  writeJson(SAVED_KEY, all)
}

function savedOfficial(school: string, season: number): NcaaSchedule | null {
  const s = readJson<Record<string, NcaaSchedule>>(SAVED_KEY)?.[school]
  return s && s.season === season && s.games.length > 0 ? s : null
}

function bundled(school: string): NcaaSchedule | null {
  const b = BUNDLED_NCAA_SCHEDULES[school]
  return b && b.games.length > 0 ? { ...b, origin: 'bundled' } : null
}

async function askEndpoint(school: string, season: number): Promise<NcaaSchoolSchedule | null> {
  try {
    const res = await fetchWithTimeout(`/api/ncaa-schedules?school=${encodeURIComponent(school)}&season=${season}`, { timeoutMs: 45000 })
    if (res.status === 404) {
      return { school, season, status: 'no-source', message: `No schedule source is set up for ${school}.`, sourceUrl: '', games: [], fetchedAt: Date.now() }
    }
    if (!res.ok) return null
    return (await res.json()) as NcaaSchoolSchedule
  } catch {
    return null
  }
}

/** One school's schedule plus a notice when it isn't the live official one. */
export async function fetchNcaaSchedule(
  school: string,
  season: number = upcomingSeason(),
): Promise<{ schedule: NcaaSchedule | null; notice: NcaaNotice | null }> {
  const live = await askEndpoint(school, season)
  if (live?.status === 'ok') {
    const schedule: NcaaSchedule = { school, season, origin: 'official', sourceUrl: live.sourceUrl, games: live.games, fetchedAt: live.fetchedAt }
    saveOfficial(schedule)
    return { schedule, notice: null }
  }

  const kind: NcaaNoticeKind = live?.status === 'empty' ? 'empty' : live?.status === 'no-source' ? 'no-source' : 'error'
  const message = live?.message
    || `Could not reach the app's schedule service for ${school}. Check the connection and reload.`

  const sheet = (await fetchNcaaSheetGames()).get(school)
  const sheetGames = sheet?.filter((g) => g.date >= `${season - 1}-08-01` && g.date <= `${season}-07-31`) ?? []
  if (sheetGames.length > 0) {
    return {
      schedule: { school, season, origin: 'sheet', sourceUrl: '', games: sheetGames, fetchedAt: Date.now() },
      notice: { school, kind, message, fallback: 'sheet' },
    }
  }
  if (kind === 'empty') {
    // Offseason: a real, empty answer. Nothing to fall back to.
    return { schedule: { school, season, origin: 'official', sourceUrl: live?.sourceUrl ?? '', games: [], fetchedAt: Date.now() }, notice: { school, kind, message, fallback: 'none' } }
  }
  const saved = savedOfficial(school, season)
  if (saved) return { schedule: saved, notice: { school, kind, message, fallback: 'saved', fallbackFetchedAt: saved.fetchedAt } }
  const snap = bundled(school)
  if (snap) return { schedule: snap, notice: { school, kind, message, fallback: 'bundled', fallbackFetchedAt: snap.fetchedAt } }
  return { schedule: null, notice: { school, kind, message, fallback: 'none' } }
}

export interface NcaaFetchResult {
  schedules: Map<string, NcaaSchedule>
  /** Schools with nothing at all to show (no live, sheet, saved or bundled copy). */
  failedSchools: string[]
  notices: NcaaNotice[]
}

export async function fetchAllNcaaSchedules(
  schools: string[],
  onProgress?: (completed: number, total: number) => void,
): Promise<NcaaFetchResult> {
  const unique = [...new Set(schools)]
  const schedules = new Map<string, NcaaSchedule>()
  const failedSchools: string[] = []
  const notices: NcaaNotice[] = []
  const season = upcomingSeason()
  let done = 0
  const queue = [...unique]
  // A few at a time: each is one cached request to our own endpoint.
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const school = queue.shift()!
      const { schedule, notice } = await fetchNcaaSchedule(school, season)
      if (schedule) schedules.set(school, schedule)
      else failedSchools.push(school)
      if (notice) notices.push(notice)
      done++
      onProgress?.(done, unique.length)
    }
  }))
  return { schedules, failedSchools, notices }
}

// ─── Places (neutral sites, unknown opponents' parks) ───────────────────────

interface CachedPlace { name: string; coords: { lat: number; lng: number } | null; at: number }
const MISS_RETRY_MS = 7 * 24 * 60 * 60 * 1000

/** Known place for a placeKey: the bundled neutral-site table, then this
 *  browser's geocode cache. */
export function lookupPlace(key: string): Venue | null {
  const site = NCAA_NEUTRAL_SITES[key]
  if (site) return { name: site.name, coords: site.coords }
  const cached = readJson<Record<string, CachedPlace>>(PLACES_KEY)?.[key]
  return cached?.coords ? { name: cached.name, coords: cached.coords } : null
}

/** Geocode up to `max` unknown places with OpenStreetMap Nominatim (one
 *  request a second, per its usage policy) and cache the answers. Returns
 *  how many were found. Misses are remembered for a week. */
export async function geocodePlaces(unresolved: UnresolvedNcaaGame[], max: number): Promise<number> {
  const cache = readJson<Record<string, CachedPlace>>(PLACES_KEY) ?? {}
  const todo = new Map<string, UnresolvedNcaaGame>()
  for (const u of unresolved) {
    const c = cache[u.key]
    if (c && (c.coords || Date.now() - c.at < MISS_RETRY_MS)) continue
    if (!todo.has(u.key)) todo.set(u.key, u)
  }
  let found = 0
  let n = 0
  for (const [key, u] of todo) {
    if (n++ >= max) break
    let coords: { lat: number; lng: number } | null = null
    try {
      const params = new URLSearchParams({ q: u.query, format: 'json', limit: '1' })
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`)
      if (res.ok) {
        const hits = await res.json() as Array<{ lat: string; lon: string }>
        if (hits[0]) coords = { lat: parseFloat(hits[0].lat), lng: parseFloat(hits[0].lon) }
      }
    } catch {
      // Network trouble: try again next load.
      continue
    }
    cache[key] = { name: u.game.venueName || u.game.location || `${u.game.opponent} ballpark`, coords, at: Date.now() }
    if (coords) found++
    writeJson(PLACES_KEY, cache)
    await new Promise((r) => setTimeout(r, 1100))
  }
  return found
}
