/**
 * Generate HS schedule data from the SV Client Game Schedule CSV.
 *
 * Replaces MaxPreps scraping with reliable, manually-curated schedule data.
 * The output format is identical to what generateSchedules.ts produces,
 * so no downstream code changes are needed.
 *
 * Run:  npx tsx scripts/generateHsFromCsv.ts
 *       npx tsx scripts/generateHsFromCsv.ts --fetch   (download fresh CSV first)
 *
 * Input:  src/data/clientSchedule.csv
 * Output: src/data/hsSchedules.generated.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import Papa from 'papaparse'
import { MAXPREPS_SLUGS } from '../src/data/maxprepsSlugs'
import { HS_VENUE_COORDS } from '../src/data/hsVenueCoords'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT_DIR = path.resolve(__dirname, '../src/data')
const CSV_PATH = path.resolve(OUT_DIR, 'clientSchedule.csv')

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSLL54GdIgGGKitqbfAEG4KxgFP3ft_NzoeA-o1OGh17J3LJI-AYEGV_mB1qr-SVBL-n8CGTzZoXq3J/pub?gid=446091585&single=true&output=csv'

// ---------------------------------------------------------------------------
// CSV team name → roster org|state key
// Only entries that differ from the direct "${Team}|${state}" key need mapping.
// ---------------------------------------------------------------------------
interface TeamInfo {
  key: string           // roster org|state key
  homeCity?: string     // for isHome fallback when ballpark is empty
  homeBallparks?: string[] // additional ballpark names that indicate home
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
  "St. Joseph's Prep": { key: "St. Joseph's Prep|PA", homeCity: 'Philadelphia', homeBallparks: ["St. Joseph's", "SJP"] },
  'Stony Brook': { key: 'Stony Brook|NY', homeCity: 'Stony Brook' },
  'Suwannee': { key: 'Suwannee|FL', homeCity: 'Live Oak' },
  'Timber Creek': { key: 'Timber Creek|FL', homeCity: 'Orlando' },
  'Trinity': { key: 'Trinity|KY', homeCity: 'Louisville' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CsvRow {
  Client: string
  Team: string
  Level: string
  Date: string
  Location: string
  'Time (Local time)': string
  Opponent: string
  Ballpark: string
  bg_accuracy: string
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

/** Convert "6:30 PM" local time to UTC ISO string, accounting for timezone */
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
      const normAliases = teamInfo.homeBallparks.map(a => a.toLowerCase())
      if (normAliases.some(a => normBallpark.includes(a) || a.includes(normBallpark))) {
        return true
      }
    }
  }

  // Fallback: if ballpark is empty/TBD and location matches home city → home
  if ((!ballpark || ballpark === 'TBD') && teamInfo.homeCity) {
    const city = location.replace(/"/g, '').split(',')[0]?.trim().toLowerCase() ?? ''
    if (city === teamInfo.homeCity.toLowerCase()) return true
  }

  return false
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface HsGame {
  date: string
  time: string | null
  isHome: boolean
  opponent: string
  gameUrl: string | null
}

interface HsSchedule {
  school: string
  slug: string
  teamName: string
  games: HsGame[]
  fetchedAt: number
  homeVenue?: { name: string; lat: number; lng: number }
}

async function main() {
  const args = process.argv.slice(2)

  // Optionally fetch fresh CSV
  if (args.includes('--fetch')) {
    console.log('Fetching fresh CSV from Google Sheets...')
    const res = await fetch(CSV_URL, { redirect: 'follow' })
    if (!res.ok) throw new Error(`Failed to fetch CSV: ${res.status}`)
    const text = await res.text()
    fs.writeFileSync(CSV_PATH, text, 'utf-8')
    console.log(`  Saved ${CSV_PATH} (${text.split('\n').length} lines)`)
  }

  // Read CSV
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found at ${CSV_PATH}`)
    console.error('Run with --fetch to download, or place the CSV manually.')
    process.exit(1)
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf-8')
  const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true })

  if (parsed.errors.length > 0) {
    console.warn('CSV parse warnings:', parsed.errors.slice(0, 5))
  }

  // Filter to HS rows only
  const hsRows = parsed.data.filter(r => r.Level?.trim().toUpperCase() === 'HS')
  console.log(`\nFound ${hsRows.length} HS game rows across ${new Set(hsRows.map(r => r.Team)).size} teams\n`)

  // Group games by school key
  const schoolGames = new Map<string, { csvTeam: string; rosterOrg: string; games: HsGame[] }>()
  const unmappedTeams = new Set<string>()

  for (const row of hsRows) {
    const csvTeam = row.Team?.trim()
    if (!csvTeam) continue

    const teamInfo = CSV_TEAM_INFO[csvTeam]
    if (!teamInfo) {
      unmappedTeams.add(csvTeam)
      continue
    }

    const key = teamInfo.key
    const rosterOrg = key.split('|')[0]!
    const dateStr = parseDate(row.Date ?? '')
    if (!dateStr) continue

    const location = row.Location ?? ''
    const locationState = extractState(location)
    const timeStr = parseGameTime(dateStr, row['Time (Local time)'] ?? '', locationState)
    const ballpark = row.Ballpark?.trim() ?? ''
    const opponent = row.Opponent?.trim() ?? ''

    const game: HsGame = {
      date: dateStr,
      time: timeStr,
      isHome: isHomeGame(csvTeam, rosterOrg, ballpark, opponent, location, teamInfo),
      opponent: opponent.replace(/^(@\s+|vs\s+)/i, '').trim(), // strip @/vs prefix
      gameUrl: null,
    }

    const existing = schoolGames.get(key)
    if (existing) {
      existing.games.push(game)
    } else {
      schoolGames.set(key, { csvTeam, rosterOrg, games: [game] })
    }
  }

  if (unmappedTeams.size > 0) {
    console.warn(`⚠ Unmapped CSV teams (add to CSV_TEAM_TO_KEY): ${[...unmappedTeams].join(', ')}`)
  }

  // Build output
  const now = Date.now()
  const results: Record<string, HsSchedule> = {}
  let totalGames = 0

  for (const [key, { csvTeam, rosterOrg, games }] of schoolGames) {
    // Sort games by date
    games.sort((a, b) => a.date.localeCompare(b.date))

    // Deduplicate (same date + opponent = same game seen from different clients)
    const seen = new Set<string>()
    const uniqueGames = games.filter(g => {
      const id = `${g.date}|${g.opponent}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    // Look up MaxPreps slug (for sourceUrl display)
    const slug = MAXPREPS_SLUGS[key] ?? ''

    // Look up home venue coords
    const venueCoords = HS_VENUE_COORDS[key]
    const homeVenue = venueCoords
      ? { name: venueCoords.name, lat: venueCoords.lat, lng: venueCoords.lng }
      : undefined

    results[key] = {
      school: key,
      slug,
      teamName: csvTeam,
      games: uniqueGames,
      fetchedAt: now,
      homeVenue,
    }

    totalGames += uniqueGames.length
    const homeCount = uniqueGames.filter(g => g.isHome).length
    console.log(
      `  ${key.padEnd(28)} ${String(uniqueGames.length).padStart(3)} games (${homeCount} home, ${uniqueGames.length - homeCount} away)` +
        (homeVenue ? ` [${homeVenue.lat.toFixed(2)},${homeVenue.lng.toFixed(2)}]` : ' [no venue]'),
    )
  }

  console.log(`\nTotal: ${schoolGames.size} schools, ${totalGames} games`)

  // Write output file (inline type to avoid circular import with maxpreps.ts)
  const json = JSON.stringify(results, null, 2)
  const content = `// Auto-generated by scripts/generateHsFromCsv.ts — do not edit
// Source: SV Client Game Schedule (Google Sheets CSV)
// Generated: ${new Date().toISOString()}
// Type inlined to avoid circular import (maxpreps.ts imports this file)
interface HsSchedule {
  school: string; slug: string; teamName: string; fetchedAt: number
  games: Array<{ date: string; time: string | null; isHome: boolean; opponent: string; gameUrl: string | null }>
  homeVenue?: { name: string; lat: number; lng: number }
}

export const BUNDLED_HS_SCHEDULES: Record<string, HsSchedule> = ${json}
`
  const outPath = path.join(OUT_DIR, 'hsSchedules.generated.ts')
  fs.writeFileSync(outPath, content, 'utf-8')
  console.log(`\nWrote ${outPath} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`)

  // Check for schools in roster but missing from CSV
  const rosterKeys = new Set(Object.keys(HS_VENUE_COORDS))
  const csvKeys = new Set(schoolGames.keys())
  const missingFromCsv = [...rosterKeys].filter(k => !csvKeys.has(k))
  if (missingFromCsv.length > 0) {
    console.warn(`\n⚠ Schools in hsVenueCoords but not in CSV: ${missingFromCsv.join(', ')}`)
  }

  console.log('\nDone!')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
