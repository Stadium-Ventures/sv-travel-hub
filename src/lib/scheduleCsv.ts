/**
 * Fetch and parse the SV Client Game Schedule CSV at runtime.
 * Returns data in MaxPrepsSchedule format so the existing scheduleStore
 * code can consume it without changes.
 *
 * Parsing helpers + CSV_TEAM_INFO are shared with the offline validator
 * (scripts/generateHsFromCsv.ts) via src/lib/hsCsvShared.ts.
 */
import Papa from 'papaparse'
import type { MaxPrepsSchedule, MaxPrepsGame } from './maxpreps'
import { MAXPREPS_SLUGS } from '../data/maxprepsSlugs'
import { debugLog } from './debugLog'
import { HS_VENUE_COORDS } from '../data/hsVenueCoords'
import { fetchWithTimeout } from './fetchWithTimeout'
import {
  CSV_TEAM_INFO,
  parseDate,
  parseGameTime,
  isHomeGame,
  resolveHeaders,
  REQUIRED_HEADERS,
} from './hsCsvShared'

const SCHEDULE_CSV_URL = import.meta.env.VITE_SCHEDULE_CSV_URL as string | undefined

interface CsvRow {
  [key: string]: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScheduleCsvResult {
  schedules: Map<string, MaxPrepsSchedule>
  /** CSV Team names present in the sheet but missing from CSV_TEAM_INFO. */
  unmappedTeams: string[]
  /** Non-fatal issues (unresolved optional columns, 0-row conditions, …). */
  warnings: string[]
  /** Number of HS/JUCO rows found (before team mapping). */
  hsRowCount: number
}

/**
 * Fetch the SV Client Game Schedule CSV and parse HS entries
 * into MaxPrepsSchedule format (compatible with existing store code).
 */
export async function fetchScheduleCsv(): Promise<ScheduleCsvResult> {
  if (!SCHEDULE_CSV_URL) {
    throw new Error('VITE_SCHEDULE_CSV_URL is not configured. Add it to your .env file.')
  }

  const res = await fetchWithTimeout(SCHEDULE_CSV_URL, { timeoutMs: 15000 })
  if (!res.ok) throw new Error(`Schedule CSV fetch failed: ${res.status}`)
  const text = await res.text()

  return parseScheduleCsv(text)
}

/**
 * Parse CSV text into schedule data (also used for testing).
 *
 * Throws (rather than returning empty data) when the content is clearly not
 * the expected CSV — HTML body (Google login/interstitial page), Papa parse
 * errors, or missing required headers — so callers surface a "feed broken"
 * error instead of misreporting every school as missing from the sheet.
 */
export function parseScheduleCsv(csvText: string): ScheduleCsvResult {
  // (a) HTML instead of CSV — usually a Google auth/interstitial page
  if (csvText.trimStart().startsWith('<')) {
    throw new Error(
      'Schedule CSV returned HTML instead of CSV — the Google Sheet may require login or the publish link changed. Check VITE_SCHEDULE_CSV_URL.',
    )
  }

  const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true })

  // (b) Structural parse errors
  if (parsed.errors.length > 0) {
    const sample = parsed.errors
      .slice(0, 3)
      .map((e) => `${e.code ?? e.type}${e.row != null ? ` (row ${e.row})` : ''}: ${e.message}`)
      .join('; ')
    throw new Error(`Schedule CSV failed to parse (${parsed.errors.length} error(s)): ${sample}`)
  }

  // (c) Required headers must be resolvable
  const fields = parsed.meta.fields ?? []
  const { columns, missing } = resolveHeaders(fields)
  const missingRequired = REQUIRED_HEADERS.filter((h) => missing.includes(h))
  if (missingRequired.length > 0) {
    throw new Error(
      `Schedule CSV is missing required column(s): ${missingRequired.join(', ')}. Found headers: ${fields.join(', ')}`,
    )
  }

  const warnings: string[] = []
  const missingOptional = missing.filter((h) => !(REQUIRED_HEADERS as readonly string[]).includes(h))
  if (missingOptional.length > 0) {
    warnings.push(
      `Schedule CSV column(s) could not be resolved: ${missingOptional.join(', ')} — game times/opponents/home detection may degrade. Check the sheet headers.`,
    )
  }

  // Column accessor via resolved header names (case/whitespace-insensitive)
  const col = (row: CsvRow, logical: string): string => {
    const actual = columns[logical]
    return actual ? (row[actual] ?? '') : ''
  }

  const csvLevels = new Set(['HS', 'JUCO', 'JUNIOR COLLEGE'])
  const hsRows = parsed.data.filter((r) => csvLevels.has(col(r, 'Level').trim().toUpperCase()))

  if (parsed.data.length > 0 && hsRows.length === 0) {
    warnings.push(
      `Schedule CSV parsed OK (${parsed.data.length} rows) but contained 0 HS/JUCO rows — check the Level column values in the sheet.`,
    )
  }

  const schoolGames = new Map<string, { csvTeam: string; rosterOrg: string; games: MaxPrepsGame[] }>()
  const unmappedTeams: string[] = []

  for (const row of hsRows) {
    const csvTeam = col(row, 'Team').trim()
    if (!csvTeam) continue

    const teamInfo = CSV_TEAM_INFO[csvTeam]
    if (!teamInfo) {
      if (!unmappedTeams.includes(csvTeam)) unmappedTeams.push(csvTeam)
      continue
    }

    const key = teamInfo.key
    const rosterOrg = key.split('|')[0]!
    const dateStr = parseDate(col(row, 'Date'))
    if (!dateStr) continue

    const location = col(row, 'Location')
    const timeStr = parseGameTime(dateStr, col(row, 'Time (Local time)'), location)
    const ballpark = col(row, 'Ballpark').trim()
    const opponent = col(row, 'Opponent').trim()

    const game: MaxPrepsGame = {
      date: dateStr,
      time: timeStr,
      isHome: isHomeGame(csvTeam, rosterOrg, ballpark, opponent, location, teamInfo),
      opponent: opponent.replace(/^(@\s+|vs\s+)/i, '').trim(),
      gameUrl: null,
    }

    const existing = schoolGames.get(key)
    if (existing) {
      existing.games.push(game)
    } else {
      schoolGames.set(key, { csvTeam, rosterOrg, games: [game] })
    }
  }

  // Build MaxPrepsSchedule output
  const now = Date.now()
  const schedules = new Map<string, MaxPrepsSchedule>()

  for (const [key, { csvTeam, games }] of schoolGames) {
    games.sort((a, b) => a.date.localeCompare(b.date))

    // Deduplicate (same date + opponent)
    const seen = new Set<string>()
    const uniqueGames = games.filter(g => {
      const id = `${g.date}|${g.opponent}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    const slug = MAXPREPS_SLUGS[key] ?? ''
    const venueCoords = HS_VENUE_COORDS[key]
    const homeVenue = venueCoords
      ? { name: venueCoords.name, lat: venueCoords.lat, lng: venueCoords.lng }
      : undefined

    schedules.set(key, {
      school: key,
      slug,
      teamName: csvTeam,
      games: uniqueGames,
      fetchedAt: now,
      homeVenue,
    })
  }

  if (unmappedTeams.length > 0) {
    console.warn('[HS-CSV] Unmapped teams in schedule CSV:', unmappedTeams)
  }

  debugLog(`[HS-CSV] Parsed ${schedules.size} schools, ${[...schedules.values()].reduce((n, s) => n + s.games.length, 0)} games`)

  return { schedules, unmappedTeams, warnings, hsRowCount: hsRows.length }
}
