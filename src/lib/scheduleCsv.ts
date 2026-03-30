/**
 * Fetch and parse the SV Client Game Schedule CSV at runtime.
 * Returns data in MaxPrepsSchedule format so the existing scheduleStore
 * code can consume it without changes.
 */
import Papa from 'papaparse'
import type { MaxPrepsSchedule, MaxPrepsGame } from './maxpreps'
import { MAXPREPS_SLUGS } from '../data/maxprepsSlugs'
import { HS_VENUE_COORDS } from '../data/hsVenueCoords'
import { fetchWithTimeout } from './fetchWithTimeout'

const SCHEDULE_CSV_URL = import.meta.env.VITE_SCHEDULE_CSV_URL as string | undefined

// ---------------------------------------------------------------------------
// CSV team name → roster org|state key + home detection metadata
// ---------------------------------------------------------------------------
interface TeamInfo {
  key: string
  homeCity?: string
  homeBallparks?: string[]
}

const CSV_TEAM_INFO: Record<string, TeamInfo> = {
  'Briarcrest': { key: 'Briarcrest|TN', homeCity: 'Eads' },
  'Cardinal Gibbons': { key: 'Cardinal Gibbons|NC', homeCity: 'Raleigh' },
  'Cartersville': { key: 'Cartersville|GA', homeCity: 'Cartersville' },
  'Catholic': { key: 'B.R. Catholic|LA', homeCity: 'Baton Rouge' },
  'Christ Church': { key: 'Christ Church|SC', homeCity: 'Greenville', homeBallparks: ['CCES'] },
  'Coral Springs Charter': { key: 'Coral Springs Charter|FL', homeCity: 'Coral Springs' },
  'Etowah': { key: 'Etowah|GA', homeCity: 'Woodstock' },
  'Hernando': { key: 'Hernando|MS', homeCity: 'Hernando' },
  'Hun School': { key: 'The Hun School|NJ', homeCity: 'Princeton', homeBallparks: ['Hun'] },
  'IMG': { key: 'IMG|FL', homeCity: 'Bradenton', homeBallparks: ['IMG'] },
  'Iona Prep': { key: 'Iona Prep|NY', homeCity: 'New Rochelle' },
  'James Island': { key: 'James Island|SC', homeCity: 'Charleston' },
  'Mill Creek': { key: 'Mill Creek|GA', homeCity: 'Hoschton' },
  'Muskego': { key: 'Muskego|WI', homeCity: 'Muskego' },
  'North Broward Prep': { key: 'N. Broward Prep|FL', homeCity: 'Coconut Creek' },
  'Sarasota': { key: 'Sarasota HS|FL', homeCity: 'Sarasota' },
  'South Walton': { key: 'South Walton|FL', homeCity: 'Santa Rosa Beach' },
  'Spotswood': { key: 'Spotswood|VA', homeCity: 'Penn Laird' },
  "St. Joseph's Prep": { key: "St. Joseph's Prep|PA", homeCity: 'Philadelphia', homeBallparks: ["St. Joseph's", 'SJP'] },
  'Stony Brook': { key: 'Stony Brook|NY', homeCity: 'Stony Brook' },
  'Suwannee': { key: 'Suwannee|FL', homeCity: 'Live Oak' },
  'Timber Creek': { key: 'Timber Creek|FL', homeCity: 'Orlando' },
  'Trinity': { key: 'Trinity|KY', homeCity: 'Louisville' },
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface CsvRow {
  [key: string]: string
}

/** "3/3/26" → "2026-03-03" */
function parseDate(csvDate: string): string {
  const parts = csvDate.trim().split('/')
  if (parts.length !== 3) return ''
  const [m, d, y] = parts
  return `20${y!.padStart(2, '0')}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`
}

/** Extract state abbreviation from "City, ST" location string */
function extractState(location: string): string {
  const parts = location.replace(/"/g, '').split(',').map(s => s.trim())
  return parts[parts.length - 1] ?? ''
}

/** Convert "6:30 PM" local time to UTC ISO string */
function parseGameTime(dateStr: string, timeStr: string, locationState: string): string | null {
  if (!timeStr || timeStr === 'TBD' || timeStr === '') return null

  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!match) return null

  let hours = parseInt(match[1]!)
  const minutes = parseInt(match[2]!)
  if (match[3]!.toUpperCase() === 'PM' && hours !== 12) hours += 12
  if (match[3]!.toUpperCase() === 'AM' && hours === 12) hours = 0

  const [yearStr, monthStr, dayStr] = dateStr.split('-')
  const year = parseInt(yearStr!)
  const month = parseInt(monthStr!)
  const day = parseInt(dayStr!)

  // DST 2026: Mar 8 → Nov 1
  const isDST =
    (month > 3 || (month === 3 && day >= 8)) &&
    (month < 11 || (month === 11 && day < 1))

  const centralStates = new Set(['WI', 'TN', 'LA', 'MS', 'AL', 'TX', 'IL', 'MN', 'IA', 'MO', 'AR', 'OK', 'KS', 'NE'])
  const utcAdd = centralStates.has(locationState)
    ? (isDST ? 5 : 6)
    : (isDST ? 4 : 5)

  let utcHours = hours + utcAdd
  let dateAdjust = 0
  if (utcHours >= 24) {
    utcHours -= 24
    dateAdjust = 1
  }

  let finalDate = dateStr
  if (dateAdjust > 0) {
    const d = new Date(Date.UTC(year, month - 1, day + dateAdjust))
    finalDate = d.toISOString().split('T')[0]!
  }

  return `${finalDate}T${String(utcHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+00:00`
}

/** Determine if a game is a home game */
function isHomeGame(
  csvTeam: string,
  rosterOrg: string,
  ballpark: string,
  opponent: string,
  location: string,
  teamInfo: TeamInfo,
): boolean {
  if (opponent.trim().startsWith('@')) return false
  if (opponent.trim().startsWith('vs ')) return true
  if (ballpark === 'Spring Training' || opponent === 'Spring Training') return false

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+(hs|high school|field|academy)$/i, '')
      .trim()

  if (ballpark && ballpark !== 'TBD') {
    const normBallpark = normalize(ballpark)
    const normCsvTeam = normalize(csvTeam)
    const normRosterOrg = normalize(rosterOrg)

    if (
      normBallpark.includes(normCsvTeam) ||
      normBallpark.includes(normRosterOrg) ||
      normCsvTeam.includes(normBallpark) ||
      normRosterOrg.includes(normBallpark)
    ) {
      return true
    }

    if (teamInfo.homeBallparks) {
      const normAliases = teamInfo.homeBallparks.map(a => a.toLowerCase())
      if (normAliases.some(a => normBallpark.includes(a) || a.includes(normBallpark))) {
        return true
      }
    }
  }

  // Fallback: empty/TBD ballpark + location matches home city → home
  if ((!ballpark || ballpark === 'TBD') && teamInfo.homeCity) {
    const city = location.replace(/"/g, '').split(',')[0]?.trim().toLowerCase() ?? ''
    if (city === teamInfo.homeCity.toLowerCase()) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ScheduleCsvResult {
  schedules: Map<string, MaxPrepsSchedule>
  unmappedTeams: string[]
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

/** Parse CSV text into schedule data (also used for testing) */
export function parseScheduleCsv(csvText: string): ScheduleCsvResult {
  const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true })

  const hsRows = parsed.data.filter(r => (r['Level'] ?? '').trim().toUpperCase() === 'HS')

  const schoolGames = new Map<string, { csvTeam: string; rosterOrg: string; games: MaxPrepsGame[] }>()
  const unmappedTeams: string[] = []

  for (const row of hsRows) {
    const csvTeam = (row['Team'] ?? '').trim()
    if (!csvTeam) continue

    const teamInfo = CSV_TEAM_INFO[csvTeam]
    if (!teamInfo) {
      if (!unmappedTeams.includes(csvTeam)) unmappedTeams.push(csvTeam)
      continue
    }

    const key = teamInfo.key
    const rosterOrg = key.split('|')[0]!
    const dateStr = parseDate(row['Date'] ?? '')
    if (!dateStr) continue

    const location = row['Location'] ?? ''
    const locationState = extractState(location)
    const timeStr = parseGameTime(dateStr, row['Time (Local time)'] ?? '', locationState)
    const ballpark = (row['Ballpark'] ?? '').trim()
    const opponent = (row['Opponent'] ?? '').trim()

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

  console.log(`[HS-CSV] Parsed ${schedules.size} schools, ${[...schedules.values()].reduce((n, s) => n + s.games.length, 0)} games`)

  return { schedules, unmappedTeams }
}
