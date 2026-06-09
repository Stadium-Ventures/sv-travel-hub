// Parses a manual summer-schedule CSV (Northwoods, Coastal Plain, NECBL, FCBL,
// and any other league where automated ingestion isn't worth building yet).
//
// Expected sheet shape — one row per game:
//
//   Player,Team,League,Date,Time,Home/Away,Opponent,Venue,VenueLat,VenueLng
//   Brooks Wright,Willmar Stringers,NWDS,2026-06-15,7:05 PM,Home,Mankato MoonDogs,Bill Taunton Stadium,45.1219,-95.0428
//
// Lat/Lng are required so the trip engine can place the venue without
// geocoding. Kent can copy/paste coordinates from Google Maps. If lat/lng are
// blank or zero, the game is dropped and a warning surfaces in Diagnostics.

import Papa from 'papaparse'
import { fetchWithTimeout } from './fetchWithTimeout'
import type { GameEvent } from '../types/schedule'
import type { SummerLeagueCode } from '../data/summerLeagues'
import { SUMMER_LEAGUES } from '../data/summerLeagues'

const MANUAL_CSV_URL = import.meta.env.VITE_SUMMER_MANUAL_CSV_URL as string | undefined

interface ManualRow {
  [k: string]: string
}

function pick(row: ManualRow, keys: string[]): string {
  for (const k of keys) {
    const m = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k.toLowerCase())
    if (m && row[m]) return row[m].trim()
  }
  return ''
}

export interface ManualScheduleResult {
  games: GameEvent[]
  warnings: string[]
  fetchedAt: string
}

export function isManualCsvConfigured(): boolean {
  return Boolean(MANUAL_CSV_URL)
}

export async function fetchManualSummerSchedule(): Promise<ManualScheduleResult> {
  if (!MANUAL_CSV_URL) {
    return { games: [], warnings: [], fetchedAt: new Date().toISOString() }
  }

  const res = await fetchWithTimeout(MANUAL_CSV_URL, { timeoutMs: 10000 })
  if (!res.ok) throw new Error(`Manual summer schedule fetch failed: ${res.status}`)
  const text = await res.text()

  const parsed = Papa.parse<ManualRow>(text, { header: true, skipEmptyLines: true })
  const warnings: string[] = []

  // Group rows by date+venue+league — multiple SV players at the same game
  // share a single GameEvent.
  const grouped = new Map<string, {
    date: string
    time: string
    homeTeam: string
    awayTeam: string
    isHome: boolean
    venueName: string
    lat: number
    lng: number
    league: SummerLeagueCode
    players: string[]
  }>()

  for (const row of parsed.data) {
    const playerName = pick(row, ['Player', 'Player Name', 'Name'])
    if (!playerName) continue
    const team = pick(row, ['Team', 'Summer Team'])
    const leagueRaw = pick(row, ['League']).toUpperCase()
    const date = pick(row, ['Date'])
    const time = pick(row, ['Time', 'Start Time'])
    const homeAwayRaw = pick(row, ['Home/Away', 'HomeAway', 'H/A', 'Location']).toLowerCase()
    const opponent = pick(row, ['Opponent'])
    const venueName = pick(row, ['Venue', 'Venue Name'])
    const latStr = pick(row, ['VenueLat', 'Lat', 'Latitude'])
    const lngStr = pick(row, ['VenueLng', 'Lng', 'Longitude', 'Lon'])

    if (!team) { warnings.push(`${playerName}: row missing Team — skipped`); continue }
    if (!leagueRaw || !(leagueRaw in SUMMER_LEAGUES)) {
      warnings.push(`${playerName}: unknown league "${leagueRaw}" — skipped`)
      continue
    }
    if (!date) { warnings.push(`${playerName} @ ${team}: row missing Date — skipped`); continue }
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) {
      warnings.push(`${playerName} @ ${team} on ${date}: VenueLat/VenueLng required — skipped`)
      continue
    }

    const isHome = homeAwayRaw.startsWith('h') // "home", "H"
    const league = leagueRaw as SummerLeagueCode
    const key = `${date}|${lat.toFixed(4)},${lng.toFixed(4)}|${league}`
    const existing = grouped.get(key)
    if (existing) {
      if (!existing.players.includes(playerName)) existing.players.push(playerName)
    } else {
      grouped.set(key, {
        date,
        time,
        homeTeam: isHome ? team : opponent || 'TBD',
        awayTeam: isHome ? opponent || 'TBD' : team,
        isHome,
        venueName: venueName || 'TBD',
        lat,
        lng,
        league,
        players: [playerName],
      })
    }
  }

  const games: GameEvent[] = []
  for (const [key, g] of grouped) {
    const isoDate = g.date.length === 10 ? g.date : g.date.slice(0, 10)
    const dateObj = new Date(`${isoDate}T12:00:00Z`)
    if (isNaN(dateObj.getTime())) {
      warnings.push(`Skipped row group ${key}: invalid date "${g.date}"`)
      continue
    }
    // Combine date + time into a best-effort ISO timestamp (UTC noon if no time)
    let isoTime = `${isoDate}T18:00:00Z`
    const tm = g.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
    if (tm) {
      let h = parseInt(tm[1]!, 10)
      const m = parseInt(tm[2]!, 10)
      const ampm = (tm[3] ?? '').toUpperCase()
      if (ampm === 'PM' && h < 12) h += 12
      if (ampm === 'AM' && h === 12) h = 0
      // Assume Eastern Time (treat as UTC-4 in summer)
      isoTime = `${isoDate}T${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
    }

    games.push({
      id: `manual-${g.league}-${key.replace(/[|,]/g, '-')}`,
      date: isoDate,
      dayOfWeek: dateObj.getUTCDay(),
      time: isoTime,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      isHome: g.isHome,
      venue: { name: g.venueName, coords: { lat: g.lat, lng: g.lng } },
      // Reuse 'ncaa-lookup' as the source bucket since the trip engine
      // already handles confidence + display for non-MLB sources. The
      // confidenceNote tells Kent it's from the manual sheet.
      source: 'ncaa-lookup',
      playerNames: g.players,
      confidence: 'high',
      confidenceNote: `${SUMMER_LEAGUES[g.league].name} (${g.league}) — manual entry`,
    })
  }

  return { games, warnings, fetchedAt: new Date().toISOString() }
}
