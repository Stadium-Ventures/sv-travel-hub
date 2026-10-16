// NCAA games typed into the SV Client Game Schedule sheet, used for a school
// only when its official athletics site can't be read (no source set up, or
// the site is down or changed). The sheet has one row per client per game,
// so rows are collapsed to one game per school, date, opponent and time.

import Papa from 'papaparse'
import type { NcaaSourceGame } from '../../api/_lib/ncaaSchedule'
import { resolveNcaaName } from '../data/aliases'
import { parseDate } from './hsCsvShared'
import { cityOf, homeCityOf, resolveTeamVenue, sharesWord } from './ncaaEvents'
import { fetchWithTimeout } from './fetchWithTimeout'

const SCHEDULE_CSV_URL = import.meta.env.VITE_SCHEDULE_CSV_URL as string | undefined

/** Sheet "Team" values are short forms ("Ohio St.", "Florida St."). */
export function sheetTeamToSchool(team: string): string | null {
  const t = team.trim()
  return resolveNcaaName(t) ?? resolveNcaaName(t.replace(/\bSt\.$/, 'State')) ?? null
}

function headerOf(fields: string[], name: string): string | undefined {
  return fields.find((f) => f.trim().toLowerCase() === name.toLowerCase())
    ?? fields.find((f) => f.trim().toLowerCase().startsWith(name.toLowerCase()))
}

/** school → games, from the sheet's NCAA rows. */
export function parseNcaaSheetRows(csvText: string): Map<string, NcaaSourceGame[]> {
  const out = new Map<string, NcaaSourceGame[]>()
  if (/^\s*</.test(csvText)) return out
  const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true })
  const fields = parsed.meta.fields ?? []
  const h = {
    team: headerOf(fields, 'Team'), level: headerOf(fields, 'Level'), date: headerOf(fields, 'Date'),
    location: headerOf(fields, 'Location'), time: headerOf(fields, 'Time'), opponent: headerOf(fields, 'Opponent'),
    ballpark: headerOf(fields, 'Ballpark'),
  }
  if (!h.team || !h.level || !h.date) return out
  const seen = new Set<string>()
  const raw = new Map<string, Array<{ date: string; location: string; ballpark: string; opponent: string; time: string }>>()
  for (const row of parsed.data) {
    if ((row[h.level] ?? '').trim().toUpperCase() !== 'NCAA') continue
    const school = sheetTeamToSchool(row[h.team] ?? '')
    const date = parseDate(row[h.date] ?? '')
    const opponent = (h.opponent ? row[h.opponent] ?? '' : '').replace(/^(@|at|vs\.?)\s+/i, '').trim()
    if (!school || !date || !opponent) continue
    const time = (h.time ? row[h.time] ?? '' : '').trim()
    const key = `${school}|${date}|${opponent.toLowerCase()}|${time}`
    if (seen.has(key)) continue
    seen.add(key)
    const list = raw.get(school) ?? []
    list.push({ date, location: (h.location ? row[h.location] ?? '' : '').trim(), ballpark: (h.ballpark ? row[h.ballpark] ?? '' : '').trim(), opponent, time })
    raw.set(school, list)
  }
  for (const [school, rows] of raw) {
    // The sheet has no home/away column: the school's most common city is
    // home, a game at the opponent's own ballpark is away, and anything else
    // is placed by its town (labelled neutral).
    const asHome = rows.map((r) => ({ side: 'home' as const, location: r.location } as NcaaSourceGame))
    const homeCity = homeCityOf(asHome)
    const games: NcaaSourceGame[] = rows.map((r) => {
      const atHome = !!r.location && cityOf(r.location) === homeCity
      const opp = resolveTeamVenue(r.opponent)
      const atTheirPark = !!opp && !!r.ballpark && sharesWord(r.ballpark, opp.name)
      const side = atHome ? 'home' : atTheirPark ? 'away' : 'neutral'
      const month = parseInt(r.date.slice(5, 7), 10)
      return {
        date: r.date,
        startTime: null,
        timeText: r.time,
        side,
        opponent: r.opponent,
        location: r.location,
        venueName: r.ballpark,
        exhibition: month >= 8,
        tournament: '',
        status: 'scheduled',
      }
    })
    games.sort((a, b) => a.date.localeCompare(b.date))
    out.set(school, games)
  }
  return out
}

let sheetPromise: Promise<Map<string, NcaaSourceGame[]>> | null = null

/** The sheet's NCAA games, fetched at most once per page load. An empty map
 *  when the sheet isn't configured or can't be read. */
export function fetchNcaaSheetGames(): Promise<Map<string, NcaaSourceGame[]>> {
  if (!sheetPromise) {
    sheetPromise = (async () => {
      if (!SCHEDULE_CSV_URL) return new Map()
      try {
        const res = await fetchWithTimeout(SCHEDULE_CSV_URL, { timeoutMs: 15000 })
        if (!res.ok) return new Map()
        return parseNcaaSheetRows(await res.text())
      } catch {
        return new Map()
      }
    })()
  }
  return sheetPromise
}
