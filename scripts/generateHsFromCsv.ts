/**
 * Validate the SV Client Game Schedule CSV (HS/JUCO rows).
 *
 * Formerly this script generated src/data/hsSchedules.generated.ts
 * (BUNDLED_HS_SCHEDULES), but nothing imports that at runtime anymore — the
 * app fetches and parses the CSV live via src/lib/scheduleCsv.ts. This script
 * is now a pure validation/reporting tool that exercises the SAME shared
 * parsing helpers (src/lib/hsCsvShared.ts) as the runtime parser, so a green
 * run here means the live parse will behave the same way.
 *
 * Run:  npx tsx scripts/generateHsFromCsv.ts
 *       npx tsx scripts/generateHsFromCsv.ts --fetch   (download fresh CSV first)
 *
 * Input: src/data/clientSchedule.csv
 * Exit codes: 0 = OK (warnings allowed), 1 = hard failure (HTML body,
 * parse errors, missing required headers, or zero HS/JUCO rows).
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import Papa from 'papaparse'
import { MAXPREPS_SLUGS } from '../src/data/maxprepsSlugs'
import { HS_VENUE_COORDS } from '../src/data/hsVenueCoords'
import {
  CSV_TEAM_INFO,
  parseDate,
  parseGameTime,
  isHomeGame,
  resolveHeaders,
  REQUIRED_HEADERS,
} from '../src/lib/hsCsvShared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '../src/data')
const CSV_PATH = path.resolve(DATA_DIR, 'clientSchedule.csv')

const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSLL54GdIgGGKitqbfAEG4KxgFP3ft_NzoeA-o1OGh17J3LJI-AYEGV_mB1qr-SVBL-n8CGTzZoXq3J/pub?gid=446091585&single=true&output=csv'

interface CsvRow {
  [key: string]: string
}

interface HsGame {
  date: string
  time: string | null
  isHome: boolean
  opponent: string
  gameUrl: string | null
}

let hardFailures = 0
let warningCount = 0

function fail(msg: string) {
  hardFailures++
  console.error(`✗ ${msg}`)
}

function warn(msg: string) {
  warningCount++
  console.warn(`⚠ ${msg}`)
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

  // --- Content validation (mirrors parseScheduleCsv's hard failures) ---
  if (csvText.trimStart().startsWith('<')) {
    fail('CSV body starts with "<" — this is HTML (Google login/interstitial page), not CSV')
    process.exit(1)
  }

  const parsed = Papa.parse<CsvRow>(csvText, { header: true, skipEmptyLines: true })

  if (parsed.errors.length > 0) {
    fail(`CSV parse errors (${parsed.errors.length}):`)
    for (const e of parsed.errors.slice(0, 5)) {
      console.error(`    ${e.code ?? e.type}${e.row != null ? ` (row ${e.row})` : ''}: ${e.message}`)
    }
  }

  const fields = parsed.meta.fields ?? []
  const { columns, missing } = resolveHeaders(fields)
  const missingRequired = REQUIRED_HEADERS.filter((h) => missing.includes(h))
  if (missingRequired.length > 0) {
    fail(`Missing required column(s): ${missingRequired.join(', ')} — found headers: ${fields.join(', ')}`)
  }
  const missingOptional = missing.filter((h) => !(REQUIRED_HEADERS as readonly string[]).includes(h))
  if (missingOptional.length > 0) {
    warn(`Unresolved optional column(s): ${missingOptional.join(', ')}`)
  }

  if (hardFailures > 0) {
    console.error('\nValidation FAILED — the runtime parser would reject this CSV.')
    process.exit(1)
  }

  const col = (row: CsvRow, logical: string): string => {
    const actual = columns[logical]
    return actual ? (row[actual] ?? '') : ''
  }

  // Filter to HS + JUCO rows (both use CSV schedule path, not MLB API or D1Baseball)
  const csvLevels = new Set(['HS', 'JUCO', 'JUNIOR COLLEGE'])
  const hsRows = parsed.data.filter((r) => csvLevels.has(col(r, 'Level').trim().toUpperCase()))
  console.log(`\nFound ${hsRows.length} HS/JUCO game rows across ${new Set(hsRows.map((r) => col(r, 'Team'))).size} teams\n`)

  if (hsRows.length === 0) {
    fail('CSV parsed OK but contains 0 HS/JUCO rows — check the Level column values')
    process.exit(1)
  }

  // Group games by school key using the shared helpers
  const schoolGames = new Map<string, { csvTeam: string; rosterOrg: string; games: HsGame[] }>()
  const unmappedTeams = new Set<string>()
  const badDates = new Set<string>()
  let unparsedTimes = 0

  for (const row of hsRows) {
    const csvTeam = col(row, 'Team').trim()
    if (!csvTeam) continue

    const teamInfo = CSV_TEAM_INFO[csvTeam]
    if (!teamInfo) {
      unmappedTeams.add(csvTeam)
      continue
    }

    const key = teamInfo.key
    const rosterOrg = key.split('|')[0]!
    const rawDate = col(row, 'Date')
    const dateStr = parseDate(rawDate)
    if (!dateStr) {
      if (rawDate.trim()) badDates.add(`${csvTeam}: "${rawDate}"`)
      continue
    }

    const location = col(row, 'Location')
    const rawTime = col(row, 'Time (Local time)')
    const timeStr = parseGameTime(dateStr, rawTime, location)
    if (!timeStr && rawTime && rawTime !== 'TBD') unparsedTimes++
    const ballpark = col(row, 'Ballpark').trim()
    const opponent = col(row, 'Opponent').trim()

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
    warn(`Unmapped CSV teams (add to CSV_TEAM_INFO in src/lib/hsCsvShared.ts): ${[...unmappedTeams].join(', ')}`)
  }
  if (badDates.size > 0) {
    warn(`Unparseable dates (rows skipped): ${[...badDates].slice(0, 10).join('; ')}${badDates.size > 10 ? ` …and ${badDates.size - 10} more` : ''}`)
  }
  if (unparsedTimes > 0) {
    warn(`${unparsedTimes} row(s) had a non-TBD time that couldn't be parsed`)
  }

  // Per-school report
  let totalGames = 0
  for (const [key, { games }] of schoolGames) {
    games.sort((a, b) => a.date.localeCompare(b.date))

    // Deduplicate (same date + opponent = same game seen from different clients)
    const seen = new Set<string>()
    const uniqueGames = games.filter((g) => {
      const id = `${g.date}|${g.opponent}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    const slug = MAXPREPS_SLUGS[key] ?? ''
    const venueCoords = HS_VENUE_COORDS[key]

    totalGames += uniqueGames.length
    const homeCount = uniqueGames.filter((g) => g.isHome).length
    console.log(
      `  ${key.padEnd(28)} ${String(uniqueGames.length).padStart(3)} games (${homeCount} home, ${uniqueGames.length - homeCount} away)` +
        (venueCoords ? ` [${venueCoords.lat.toFixed(2)},${venueCoords.lng.toFixed(2)}]` : ' [no venue]') +
        (slug ? '' : ' [no MaxPreps slug]'),
    )
    if (!venueCoords) {
      warn(`${key}: no entry in HS_VENUE_COORDS — home games will need a geocoded fallback at runtime`)
    }
  }

  console.log(`\nTotal: ${schoolGames.size} schools, ${totalGames} games`)

  // Check for schools in roster but missing from CSV
  const rosterKeys = new Set(Object.keys(HS_VENUE_COORDS))
  const csvKeys = new Set(schoolGames.keys())
  const missingFromCsv = [...rosterKeys].filter((k) => !csvKeys.has(k))
  if (missingFromCsv.length > 0) {
    warn(`Schools in hsVenueCoords but not in CSV: ${missingFromCsv.join(', ')}`)
  }

  console.log(warningCount > 0 ? `\nValidation passed with ${warningCount} warning(s).` : '\nValidation passed.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
