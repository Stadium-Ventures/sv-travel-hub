/**
 * Generate static schedule data for NCAA (D1Baseball) and HS (MaxPreps) players.
 *
 * College and HS players don't get traded/promoted mid-season, so their schedules
 * are stable once published. This script scrapes them server-side (no CORS proxy
 * needed) and writes static TypeScript files that the app imports instantly.
 *
 * Run:  npx tsx scripts/generateSchedules.ts
 *       npx tsx scripts/generateSchedules.ts --ncaa-only
 *       npx tsx scripts/generateSchedules.ts --hs-only
 *
 * Output:
 *   src/data/ncaaSchedules.generated.ts
 *   src/data/hsSchedules.generated.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { parse as parseHTML } from 'node-html-parser'
import { D1_BASEBALL_SLUGS } from '../src/data/d1baseballSlugs'
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
// D1Baseball parsing (ported from src/lib/d1baseball.ts for node-html-parser)
// ---------------------------------------------------------------------------
interface D1Game {
  date: string
  isHome: boolean
  opponent: string
  opponentSlug: string
  venueName: string
  venueCity: string
}

interface D1Schedule {
  school: string
  slug: string
  games: D1Game[]
  fetchedAt: number
}

function parseD1Html(html: string): D1Game[] {
  const root = parseHTML(html)
  const games: D1Game[] = []

  const rows = root.querySelectorAll('table tbody tr')
  for (const row of rows) {
    const cells = row.querySelectorAll('td')
    if (cells.length < 4) continue

    const dateLink = cells[0]?.querySelector('a')
    if (!dateLink) continue
    const href = dateLink.getAttribute('href') ?? ''
    const dateMatch = href.match(/date=(\d{4})(\d{2})(\d{2})/)
    if (!dateMatch) continue
    const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`

    const locText = cells[1]?.textContent?.trim() ?? ''
    const isHome = locText === 'vs'

    const teamName = cells[2]?.querySelector('.team-name')?.textContent?.trim() ?? ''
    const teamLink = cells[2]?.querySelector('a.team-logo-name')?.getAttribute('href') ?? ''
    const slugMatch = teamLink.match(/\/team\/([^/]+)\//)
    const opponentSlug = slugMatch ? slugMatch[1]! : ''

    const venueText = cells[cells.length - 1]?.textContent?.trim() ?? ''
    const venueParts = venueText.split(',').map((s) => s.trim())
    const venueName = venueParts.length >= 3 ? venueParts.slice(2).join(', ') : venueText
    const venueCity = venueParts.length >= 2 ? `${venueParts[0]}, ${venueParts[1]}` : ''

    if (date && teamName) {
      games.push({ date, isHome, opponent: teamName, opponentSlug, venueName, venueCity })
    }
  }

  return games
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

  return { teamName, games }
}

// ---------------------------------------------------------------------------
// Scrape all NCAA schedules
// ---------------------------------------------------------------------------
async function scrapeNcaaSchedules(): Promise<Record<string, D1Schedule>> {
  const entries = Object.entries(D1_BASEBALL_SLUGS)
  const results: Record<string, D1Schedule> = {}
  const now = Date.now()
  let totalGames = 0

  console.log(`\nScraping ${entries.length} NCAA schedules from D1Baseball...\n`)

  for (let i = 0; i < entries.length; i++) {
    const [school, slug] = entries[i]!
    process.stdout.write(`  [${i + 1}/${entries.length}] ${school}...`)

    try {
      const url = `https://d1baseball.com/team/${slug}/schedule/`
      const html = await fetchWithRetry(url)
      const games = parseD1Html(html)

      results[school] = { school, slug, games, fetchedAt: now }
      totalGames += games.length
      console.log(` ${games.length} games`)
    } catch (err) {
      console.log(` FAILED: ${err instanceof Error ? err.message : err}`)
    }

    // Be polite — 1s delay between requests
    if (i < entries.length - 1) await sleep(1000)
  }

  console.log(`\nNCAA: ${Object.keys(results).length}/${entries.length} schools, ${totalGames} total games`)
  return results
}

// ---------------------------------------------------------------------------
// Scrape all HS schedules
// ---------------------------------------------------------------------------
async function scrapeHsSchedules(): Promise<Record<string, MaxPrepsSchedule>> {
  const entries = Object.entries(MAXPREPS_SLUGS)
  const results: Record<string, MaxPrepsSchedule> = {}
  const now = Date.now()
  let totalGames = 0

  console.log(`\nScraping ${entries.length} HS schedules from MaxPreps...\n`)

  for (let i = 0; i < entries.length; i++) {
    const [key, slug] = entries[i]!
    const org = key.split('|')[0]!
    process.stdout.write(`  [${i + 1}/${entries.length}] ${key}...`)

    try {
      const url = `https://www.maxpreps.com/${slug}/baseball/schedule/`
      const html = await fetchWithRetry(url)
      const { teamName, games } = parseMaxPrepsHtml(html, org)

      results[key] = { school: key, slug, teamName, games, fetchedAt: now }
      totalGames += games.length
      console.log(` ${games.length} games (${teamName})`)
    } catch (err) {
      console.log(` FAILED: ${err instanceof Error ? err.message : err}`)
    }

    // Be polite — 1s delay between requests
    if (i < entries.length - 1) await sleep(1000)
  }

  console.log(`\nHS: ${Object.keys(results).length}/${entries.length} schools, ${totalGames} total games`)
  return results
}

// ---------------------------------------------------------------------------
// Write output files
// ---------------------------------------------------------------------------
function writeNcaaFile(data: Record<string, D1Schedule>) {
  const outPath = path.join(OUT_DIR, 'ncaaSchedules.generated.ts')
  const json = JSON.stringify(data, null, 2)
  const content = `// Auto-generated by scripts/generateSchedules.ts — do not edit
// Generated: ${new Date().toISOString()}
import type { D1Schedule } from '../lib/d1baseball'

export const BUNDLED_NCAA_SCHEDULES: Record<string, D1Schedule> = ${json}
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
    const ncaa = await scrapeNcaaSchedules()
    writeNcaaFile(ncaa)
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
