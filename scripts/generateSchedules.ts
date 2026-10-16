/**
 * Generate static schedule data for NCAA (official athletics sites) and HS
 * (MaxPreps) players.
 *
 * The NCAA file is the app's last-resort copy: the live app reads each
 * school's official site through /api/ncaa-schedules, and only falls back to
 * this bundle when that fails. Both use the same reader
 * (api/_lib/ncaaSchedule.ts), so the bundle matches what the app shows.
 *
 * Run:  npx tsx scripts/generateSchedules.ts
 *       npx tsx scripts/generateSchedules.ts --ncaa-only [--season=2027]
 *       npx tsx scripts/generateSchedules.ts --hs-only
 *
 * A school whose site gives no games this run keeps its previous bundled
 * games, and the file is not rewritten at all when no school returns games.
 *
 * Output:
 *   src/data/ncaaSchedules.generated.ts
 *   src/data/hsSchedules.generated.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { parse as parseHTML } from 'node-html-parser'
import { fetchSchoolSchedule, upcomingSeason, type NcaaSourceGame } from '../api/_lib/ncaaSchedule'
import { NCAA_SCHEDULE_SOURCES } from '../api/_data/ncaaSources'
import { BUNDLED_NCAA_SCHEDULES } from '../src/data/ncaaSchedules.generated'
import { MAXPREPS_SLUGS } from '../src/data/maxprepsSlugs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const OUT_DIR = path.resolve(__dirname, '../src/data')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures internal schedule generator)',
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (attempt === retries) throw err
      const delay = attempt * 2000
      console.warn(`  Retry ${attempt}/${retries} after ${delay}ms...`)
      await sleep(delay)
    }
  }
  throw new Error('unreachable')
}

// ---------------------------------------------------------------------------
// NCAA bundle shape (what src/data/ncaaSchedules.generated.ts exports)
// ---------------------------------------------------------------------------
interface BundledNcaaSchedule {
  school: string
  season: number
  sourceUrl: string
  fetchedAt: number
  games: NcaaSourceGame[]
}

/** Older bundles were D1Baseball-shaped (isHome, venueCity). */
function toBundled(school: string, raw: unknown): BundledNcaaSchedule | null {
  const r = raw as { season?: number; sourceUrl?: string; slug?: string; fetchedAt?: number; games?: Array<Record<string, unknown>> }
  if (!r?.games?.length) return null
  if (typeof r.season === 'number') return r as BundledNcaaSchedule
  const games: NcaaSourceGame[] = r.games.map((g) => ({
    date: String(g.date),
    startTime: null,
    timeText: '',
    side: g.isHome ? 'home' : 'away',
    opponent: String(g.opponent ?? ''),
    location: String(g.venueCity ?? ''),
    venueName: String(g.venueName ?? ''),
    exhibition: false,
    tournament: '',
    status: 'scheduled',
  }))
  const year = parseInt(games[0]!.date.slice(0, 4), 10)
  return { school, season: year, sourceUrl: r.slug ? `https://d1baseball.com/team/${r.slug}/schedule/` : '', fetchedAt: r.fetchedAt ?? 0, games }
}

// ---------------------------------------------------------------------------
// MaxPreps parsing (ported from src/lib/maxpreps.ts for node-html-parser)
// ---------------------------------------------------------------------------
interface MaxPrepsGame {
  date: string
  time: string | null
  isHome: boolean
  opponent: string
  gameUrl: string | null
}

interface MaxPrepsSchedule {
  school: string
  slug: string
  teamName: string
  games: MaxPrepsGame[]
  fetchedAt: number
}

function parseMaxPrepsHtml(html: string, schoolName: string): { teamName: string; games: MaxPrepsGame[] } {
  const root = parseHTML(html)
  const games: MaxPrepsGame[] = []
  let teamName = schoolName

  const scripts = root.querySelectorAll('script[type="application/ld+json"]')
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? '')
      if (data['@type'] === 'ProfilePage' && data.mainEntity) {
        const entity = data.mainEntity
        if (entity['@type'] === 'SportsTeam') {
          teamName = entity.name ?? teamName
          const events = entity.event ?? []
          for (const event of events) {
            if (event['@type'] !== 'SportsEvent') continue

            const startDate = event.startDate
            if (!startDate) continue

            const dateMatch = startDate.match(/^(\d{4}-\d{2}-\d{2})/)
            if (!dateMatch) continue
            const date = dateMatch[1]!

            const timeMatch = startDate.match(/T(\d{2}:\d{2}:\d{2})/)
            const time = timeMatch ? startDate : null

            const homeTeamName = event.homeTeam?.name ?? ''
            const awayTeamName = event.awayTeam?.name ?? ''

            const schoolLower = schoolName.toLowerCase()
            const teamNameLower = teamName.toLowerCase()
            const homeLower = homeTeamName.toLowerCase()

            const isHome =
              homeLower.includes(schoolLower) ||
              homeLower.includes(teamNameLower) ||
              schoolLower.includes(homeLower.split(' ')[0] ?? '')

            const opponent = isHome ? awayTeamName : homeTeamName
            const gameUrl = event.url ?? null

            games.push({ date, time, isHome, opponent, gameUrl })
          }
        }
      }
    } catch {
      // Skip malformed JSON-LD blocks
    }
  }

  // Fallback: extract SportsEvent data from inline React/Next.js data
  // MaxPreps embeds complete SportsEvent objects throughout the HTML
  if (games.length < 15) {
    // Match complete SportsEvent blocks with startDate, homeTeam, and awayTeam
    const eventRegex = /"@type":"SportsEvent"[^}]*?"startDate":"([^"]+)"[^}]*?"homeTeam":\{"@type":"SportsTeam","name":"([^"]+)"\}[^}]*?"awayTeam":\{"@type":"SportsTeam","name":"([^"]+)"\}/g
    const inlineGames: MaxPrepsGame[] = []
    let match: RegExpExecArray | null

    while ((match = eventRegex.exec(html)) !== null) {
      const startDate = match[1]!
      const dateOnly = startDate.slice(0, 10)
      const homeTeam = match[2]!
      const awayTeam = match[3]!

      const schoolLower = schoolName.toLowerCase()
      const homeLower = homeTeam.toLowerCase()
      const isHome = homeLower.includes(schoolLower) || schoolLower.includes(homeLower.split(' ')[0] ?? '')
      const opponent = isHome ? awayTeam : homeTeam

      inlineGames.push({ date: dateOnly, time: startDate, isHome, opponent, gameUrl: null })
    }

    if (inlineGames.length > games.length) {
      // Also extract team name
      const teamMatch = html.match(/"SportsTeam","name":"([^"]+)"/)
      if (teamMatch) teamName = teamMatch[1]!
      return { teamName, games: inlineGames }
    }
  }

  return { teamName, games }
}

// ---------------------------------------------------------------------------
// Read all NCAA schedules from the official athletics sites
// ---------------------------------------------------------------------------
async function scrapeNcaaSchedules(season: number): Promise<{ data: Record<string, BundledNcaaSchedule>; fresh: number }> {
  const schools = Object.keys(NCAA_SCHEDULE_SOURCES)
  const data: Record<string, BundledNcaaSchedule> = {}
  for (const [school, raw] of Object.entries(BUNDLED_NCAA_SCHEDULES)) {
    const prev = toBundled(school, raw)
    if (prev) data[school] = prev
  }
  let fresh = 0
  let totalGames = 0
  console.log(`\nReading ${schools.length} NCAA ${season} schedules from official athletics sites...\n`)
  for (let i = 0; i < schools.length; i++) {
    const school = schools[i]!
    process.stdout.write(`  [${i + 1}/${schools.length}] ${school}...`)
    const result = await fetchSchoolSchedule(school, { season })
    if (result.status === 'ok' && result.games.length > 0) {
      data[school] = { school, season, sourceUrl: result.sourceUrl, fetchedAt: result.fetchedAt, games: result.games }
      fresh++
      totalGames += result.games.length
      console.log(` ${result.games.length} games`)
    } else {
      console.log(` ${result.status}: ${result.message}${data[school] ? ' Kept the previous bundled games.' : ''}`)
    }
    // Be polite: one school at a time, a second apart.
    if (i < schools.length - 1) await sleep(1000)
  }
  console.log(`\nNCAA: ${fresh}/${schools.length} schools read, ${totalGames} games`)
  return { data, fresh }
}

// ---------------------------------------------------------------------------
// Geocode an HS school's home venue using Nominatim
// ---------------------------------------------------------------------------
async function geocodeHsVenue(
  teamName: string,
  slug: string,
): Promise<{ name: string; lat: number; lng: number } | null> {
  // Extract city/state from the slug: "fl/orlando/timber-creek-wolves" → "Orlando, FL"
  const slugParts = slug.split('/')
  const state = slugParts[0]?.toUpperCase() ?? ''
  const city = slugParts[1]?.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) ?? ''

  // Extract just the school name without mascot: "Etowah Eagles" → "Etowah"
  const schoolBase = teamName.replace(/\s+(High School|Prep|Academy|Christian|Episcopal).*$/i, '')

  const queries = [
    `${teamName}, ${city}, ${state}`,
    `${schoolBase} High School, ${city}, ${state}`,
    `${city}, ${state}`,
  ]

  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        q,
        format: 'json',
        limit: '1',
        countrycodes: 'us',
      })
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
        headers: { 'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures schedule generator)' },
      })
      if (!res.ok) continue
      const results = await res.json() as Array<{ lat: string; lon: string; display_name: string }>
      if (results.length > 0) {
        const lat = parseFloat(results[0]!.lat)
        const lng = parseFloat(results[0]!.lon)
        // Validate continental US
        if (lat >= 24.5 && lat <= 49.5 && lng >= -125.0 && lng <= -66.5) {
          return { name: `${teamName} Field`, lat, lng }
        }
      }
    } catch {
      continue
    }
    // Rate limit Nominatim
    await sleep(1200)
  }
  return null
}

// ---------------------------------------------------------------------------
// Scrape all HS schedules
// ---------------------------------------------------------------------------
async function scrapeHsSchedules(): Promise<Record<string, MaxPrepsSchedule>> {
  const entries = Object.entries(MAXPREPS_SLUGS)
  const results: Record<string, MaxPrepsSchedule> = {}
  const now = Date.now()
  let totalGames = 0
  let geocodedCount = 0

  console.log(`\nScraping ${entries.length} HS schedules from MaxPreps...\n`)

  for (let i = 0; i < entries.length; i++) {
    const [key, slug] = entries[i]!
    const org = key.split('|')[0]!
    process.stdout.write(`  [${i + 1}/${entries.length}] ${key}...`)

    try {
      const url = `https://www.maxpreps.com/${slug}/baseball/schedule/`
      const html = await fetchWithRetry(url)
      const { teamName, games } = parseMaxPrepsHtml(html, org)

      // Geocode home venue
      const homeVenue = await geocodeHsVenue(teamName, slug)
      if (homeVenue) geocodedCount++

      results[key] = { school: key, slug, teamName, games, fetchedAt: now, homeVenue: homeVenue ?? undefined }
      totalGames += games.length
      console.log(` ${games.length} games (${teamName})${homeVenue ? ` [${homeVenue.lat.toFixed(2)},${homeVenue.lng.toFixed(2)}]` : ' [no venue]'}`)
    } catch (err) {
      console.log(` FAILED: ${err instanceof Error ? err.message : err}`)
    }

    // Be polite — 1s delay between requests
    if (i < entries.length - 1) await sleep(1000)
  }

  console.log(`\nHS: ${Object.keys(results).length}/${entries.length} schools, ${totalGames} total games, ${geocodedCount} venues geocoded`)
  return results
}

// ---------------------------------------------------------------------------
// Write output files
// ---------------------------------------------------------------------------
function writeNcaaFile(data: Record<string, BundledNcaaSchedule>) {
  const outPath = path.join(OUT_DIR, 'ncaaSchedules.generated.ts')
  // One game per line keeps the file (and the app bundle) small and diffs readable.
  const json = '{\n' + Object.entries(data).map(([school, s]) => [
    `  ${JSON.stringify(school)}: {`,
    `    "school": ${JSON.stringify(s.school)}, "season": ${s.season}, "sourceUrl": ${JSON.stringify(s.sourceUrl)}, "fetchedAt": ${s.fetchedAt},`,
    `    "games": [`,
    s.games.map((g) => `      ${JSON.stringify(g)}`).join(',\n'),
    `    ]`,
    `  }`,
  ].join('\n')).join(',\n') + '\n}'
  const content = `// Auto-generated by scripts/generateSchedules.ts. Do not edit.
// Generated: ${new Date().toISOString()}
// Last-resort copy of each school's schedule from its official athletics
// site; the app reads the live schedules through /api/ncaa-schedules.
import type { NcaaSourceGame } from '../../api/_lib/ncaaSchedule'

interface BundledNcaaSchedule {
  school: string
  season: number
  sourceUrl: string
  fetchedAt: number
  games: NcaaSourceGame[]
}

export const BUNDLED_NCAA_SCHEDULES: Record<string, BundledNcaaSchedule> = ${json}
`
  fs.writeFileSync(outPath, content, 'utf-8')
  console.log(`\nWrote ${outPath} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`)
}

function writeHsFile(data: Record<string, MaxPrepsSchedule>) {
  const outPath = path.join(OUT_DIR, 'hsSchedules.generated.ts')
  const json = JSON.stringify(data, null, 2)
  const content = `// Auto-generated by scripts/generateSchedules.ts — do not edit
// Generated: ${new Date().toISOString()}
import type { MaxPrepsSchedule } from '../lib/maxpreps'

export const BUNDLED_HS_SCHEDULES: Record<string, MaxPrepsSchedule> = ${json}
`
  fs.writeFileSync(outPath, content, 'utf-8')
  console.log(`Wrote ${outPath} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const ncaaOnly = args.includes('--ncaa-only')
  const hsOnly = args.includes('--hs-only')
  const doNcaa = !hsOnly
  const doHs = !ncaaOnly

  console.log('=== SV Travel Hub Schedule Generator ===')

  if (doNcaa) {
    const seasonArg = args.find((a) => a.startsWith('--season='))
    const season = seasonArg ? parseInt(seasonArg.split('=')[1]!, 10) : upcomingSeason()
    const { data, fresh } = await scrapeNcaaSchedules(season)
    if (fresh === 0) {
      console.error('\nNo school returned games. Not rewriting the NCAA bundle (the sites may be down or changed).')
      process.exitCode = 1
    } else {
      writeNcaaFile(data)
    }
  }

  if (doHs) {
    const hs = await scrapeHsSchedules()
    writeHsFile(hs)
  }

  console.log('\nDone!')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
