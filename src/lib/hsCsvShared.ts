/**
 * Shared HS/JUCO schedule-CSV parsing pieces used by BOTH the runtime parser
 * (src/lib/scheduleCsv.ts) and the offline validator script
 * (scripts/generateHsFromCsv.ts). Keep this module free of browser-only or
 * Vite-only globals (no import.meta.env, no DOM) so it runs under tsx too.
 */

// ---------------------------------------------------------------------------
// CSV team name → roster org|state key + home detection metadata
// ---------------------------------------------------------------------------
export interface TeamInfo {
  key: string           // roster org|state key
  homeCity?: string     // for isHome fallback when ballpark is empty
  homeBallparks?: string[] // additional ballpark names that indicate home
}

export const CSV_TEAM_INFO: Record<string, TeamInfo> = {
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
  'SCF': { key: 'SCF|FL', homeCity: 'Bradenton', homeBallparks: ['Robert C. Wynn'] },
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

/**
 * "3/3/26" or "3/3/2026" → "2026-03-03". Returns '' for anything that
 * doesn't look like a real M/D/Y date (garbage, missing parts, bad ranges).
 */
export function parseDate(csvDate: string): string {
  const parts = csvDate.trim().split('/')
  if (parts.length !== 3) return ''
  const [m, d, y] = parts as [string, string, string]
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return ''

  let year: string
  if (/^\d{4}$/.test(y)) year = y
  else if (/^\d{2}$/.test(y)) year = `20${y}`
  else return ''

  const monthNum = parseInt(m)
  const dayNum = parseInt(d)
  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31) return ''

  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** Extract state abbreviation from "City, ST" location string */
export function extractState(location: string): string {
  const parts = location.replace(/"/g, '').split(',').map(s => s.trim())
  return parts[parts.length - 1] ?? ''
}

/** Extract the city portion from "City, ST" location string */
export function extractCity(location: string): string {
  return location.replace(/"/g, '').split(',')[0]?.trim() ?? ''
}

/** Day-of-month of the nth Sunday of a month (month is 1-based). */
function nthSunday(year: number, month: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0 = Sunday
  const firstSunday = firstDow === 0 ? 1 : 8 - firstDow
  return firstSunday + (n - 1) * 7
}

/** US DST window for the given year: second Sunday of March → first Sunday of November. */
export function isUsDst(year: number, month: number, day: number): boolean {
  if (month < 3 || month > 11) return false
  if (month > 3 && month < 11) return true
  if (month === 3) return day >= nthSunday(year, 3, 2)
  return day < nthSunday(year, 11, 1) // month === 11
}

// States treated as Central time. NOTE: TN is blanket-Central here because our
// only TN school (Briarcrest, Eads — Memphis area) is Central; eastern TN
// (Chattanooga, Knoxville) is actually Eastern — add a city-level override
// below if a school there ever lands on the roster.
const CENTRAL_STATES = new Set(['WI', 'TN', 'LA', 'MS', 'AL', 'TX', 'IL', 'MN', 'IA', 'MO', 'AR', 'OK', 'KS', 'NE'])

// City-level Central-time overrides for states that default to Eastern.
// The FL panhandle west of the Apalachicola River is Central — covers
// South Walton HS (Santa Rosa Beach) and nearby game sites.
const CENTRAL_CITY_OVERRIDES = new Set([
  'santa rosa beach', // South Walton HS home city (FL panhandle)
  'south walton',
  'miramar beach',
  'freeport',
  'destin',
  'panama city',
  'panama city beach',
  'pensacola',
  'fort walton beach',
  'niceville',
  'crestview',
])

/**
 * Convert "6:30 PM" local time to a UTC ISO string, using the game location
 * ("City, ST") to pick Eastern vs Central and the parsed date's year to
 * compute the DST window.
 */
export function parseGameTime(dateStr: string, timeStr: string, location: string): string | null {
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

  const isDST = isUsDst(year, month, day)

  const locationState = extractState(location)
  const locationCity = extractCity(location).toLowerCase()
  const isCentral = CENTRAL_STATES.has(locationState) || CENTRAL_CITY_OVERRIDES.has(locationCity)
  const utcAdd = isCentral
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
export function isHomeGame(
  csvTeam: string,
  rosterOrg: string,
  ballpark: string,
  opponent: string,
  location: string,
  teamInfo: TeamInfo,
): boolean {
  // Explicit away indicator: opponent starts with "@"
  if (opponent.trim().startsWith('@')) return false
  // Explicit home indicator: opponent starts with "vs" (used by SJP, Trinity)
  if (opponent.trim().startsWith('vs ')) return true
  // Spring training / neutral site
  if (ballpark === 'Spring Training' || opponent === 'Spring Training') return false

  const normalize = (s: string) =>
    s.toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+(hs|high school|field|academy)$/i, '')
      .trim()

  // Check ballpark against team name / roster org
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

    // Check school-specific home ballpark names (e.g., "CCES" for Christ Church)
    if (teamInfo.homeBallparks) {
      const normAliases = teamInfo.homeBallparks.map(normalize)
      if (normAliases.some(a => normBallpark.includes(a) || a.includes(normBallpark))) {
        return true
      }
    }
  }

  // Fallback: if ballpark is empty/TBD and location matches home city → home
  if ((!ballpark || ballpark === 'TBD') && teamInfo.homeCity) {
    const city = extractCity(location).toLowerCase()
    if (city === teamInfo.homeCity.toLowerCase()) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Fuzzy header resolution
// ---------------------------------------------------------------------------

/** Logical column → accepted header spellings (compared case/whitespace-insensitively). */
export const HEADER_ALIASES: Record<string, string[]> = {
  Team: ['team', 'school'],
  Level: ['level'],
  Date: ['date', 'game date'],
  'Time (Local time)': ['time (local time)', 'time (local)', 'time', 'local time', 'start time', 'game time'],
  Ballpark: ['ballpark', 'venue', 'field', 'stadium'],
  Opponent: ['opponent', 'opp', 'vs'],
  Location: ['location', 'city, state', 'city/state', 'city'],
}

export const REQUIRED_HEADERS = ['Team', 'Level', 'Date'] as const

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface ResolvedHeaders {
  /** Logical column name → actual header field present in the CSV. */
  columns: Record<string, string>
  /** Logical columns that could not be resolved to any header. */
  missing: string[]
}

/**
 * Resolve the CSV's actual header fields against HEADER_ALIASES so that
 * renames like "Time (local)" or trailing whitespace don't silently break
 * column lookups. Same pattern as pick() in summerManualSchedule.ts.
 */
export function resolveHeaders(fields: string[]): ResolvedHeaders {
  const normalized = fields.map((f) => ({ raw: f, norm: normalizeHeader(f) }))
  const columns: Record<string, string> = {}
  const missing: string[] = []

  for (const [logical, aliases] of Object.entries(HEADER_ALIASES)) {
    let found: string | undefined
    for (const alias of aliases) {
      const match = normalized.find((f) => f.norm === alias)
      if (match) { found = match.raw; break }
    }
    if (found) columns[logical] = found
    else missing.push(logical)
  }

  return { columns, missing }
}
