// Season-turn checks (weekly, Mondays or ?force=1): the windows where a new
// season's schedules have to show up before trips get planned.
//
//   Nov 16 to Feb 15  Pro: next season's spring training games are in MLB's
//                     schedule for every client organization.
//   Dec 1 to May 31   HS/JUCO: the schedule sheet the hub reads has the new
//                     season's games. Through January that means "enter
//                     them"; from February on, a sheet with only last season
//                     usually means the hub still points at last year's tab.
//   Jan 5 to May 15   HS/JUCO: every high school client's school has this
//                     season's games in the sheet (about six weeks' notice
//                     before mid-February openers).
import { headerIndex, monthDay, normalizeIsoDate, parseCsv } from './csv.js'
import { MLB_BASE } from './mlbClient.js'
import { weekly } from './monitorCopy.js'
import type { FetchJson, Finding, RosterClient } from './monitorTypes.js'
import { CSV_TEAM_INFO } from '../_data/hsTeams.js'

/** HS and college seasons run Feb to Jun, so "the upcoming season" is next
 *  calendar year from October on and the current year before that. */
export function upcomingSeasonYear(now: Date): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
}

/** Dec 1 to May 31. */
export function isHsSeasonWindow(now: Date): boolean {
  const m = now.getUTCMonth()
  return m === 11 || m <= 4
}

/** Jan 5 to May 15. */
export function isHsClientWindow(now: Date): boolean {
  const md = monthDay(now)
  return md >= 105 && md <= 515
}

/** Nov 16 to Feb 15. */
export function isSpringTurnWindow(now: Date): boolean {
  const md = monthDay(now)
  return md >= 1116 || md <= 215
}

/** The HS/JUCO sheet is hand-entered, so a sheet that still only has last
 *  spring's games passes every plumbing check while HS clients silently show
 *  nothing. */
export function checkHsSheetSeason(scheduleCsv: string, now: Date): Finding[] {
  const rows = parseCsv(scheduleCsv)
  if (rows.length < 2) return []
  const iDate = headerIndex(rows[0]!, ['date', 'game date'])
  const iLevel = headerIndex(rows[0]!, ['level', 'player level'])
  if (iDate < 0 || iLevel < 0) return []

  const season = upcomingSeasonYear(now)
  let hsRows = 0
  let latest = ''
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const level = (row[iLevel] ?? '').toLowerCase().trim()
    const isHs = level.includes('hs') || level.includes('high school') || level.includes('juco') || level.includes('junior college')
    if (!isHs) continue
    hsRows++
    const d = normalizeIsoDate((row[iDate] ?? '').trim())
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > latest) latest = d
  }
  // No HS rows at all is a plumbing problem the sheet probe owns.
  if (hsRows === 0) return []
  if (latest >= `${season}-01-01`) return []
  const m = now.getUTCMonth()
  const afterJanuary = m >= 1 && m <= 4
  return [afterJanuary ? weekly.hsStillLastSeason(season, latest) : weekly.hsSeasonNotEntered(season, latest)]
}

/** The spring training season to look for: next year from November on. */
export function springSeason(now: Date): number {
  return now.getUTCMonth() >= 10 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
}

/** Next season's spring training games are in MLB's schedule for every
 *  client organization. One small call for the whole league (only team ids
 *  are requested), so it also tells "MLB hasn't posted anything" apart from
 *  "one organization is missing". MLB unreachable → silent (the MLB probe
 *  reports outages). */
export async function checkSpringTraining(
  orgIds: number[],
  orgName: (id: number) => string,
  now: Date,
  fetchJson: FetchJson,
): Promise<Finding[]> {
  if (orgIds.length === 0) return []
  const season = springSeason(now)
  let data: { dates?: Array<{ games?: Array<{ teams?: { home?: { team?: { id?: number } }; away?: { team?: { id?: number } } } }> }> }
  try {
    data = await fetchJson(`${MLB_BASE}/schedule?sportId=1&gameType=S&startDate=${season}-02-01&endDate=${season}-04-15&fields=dates,games,teams,away,home,team,id`) as typeof data
  } catch {
    return []
  }
  const withGames = new Set<number>()
  for (const day of data.dates ?? []) {
    for (const g of day.games ?? []) {
      const h = g.teams?.home?.team?.id
      const a = g.teams?.away?.team?.id
      if (typeof h === 'number') withGames.add(h)
      if (typeof a === 'number') withGames.add(a)
    }
  }
  const missing = [...new Set(orgIds)].filter((id) => !withGames.has(id))
  if (missing.length === 0) return []
  return [weekly.springTrainingMissing(season, missing.map(orgName).sort(), withGames.size > 0)]
}

const INACTIVE = /retired|free agent/i

function isHsLevel(c: RosterClient): boolean {
  return c.level === 'HS' || /juco|junior college/i.test(c.levelRaw)
}

/** Every high school and JUCO client's school has this season's games in
 *  the sheet. Mirrors how the app matches: a sheet Team maps to a roster
 *  school through the school table, or by the same name. Silent when the
 *  sheet has no games for the season at all (checkHsSheetSeason owns that,
 *  and listing every client again would only repeat it). */
export function checkHsClientCoverage(scheduleCsv: string, clients: RosterClient[], now: Date): Finding[] {
  const rows = parseCsv(scheduleCsv)
  if (rows.length < 2) return []
  const iTeam = headerIndex(rows[0]!, ['team'])
  const iDate = headerIndex(rows[0]!, ['date', 'game date'])
  const iLevel = headerIndex(rows[0]!, ['level', 'player level'])
  if (iTeam < 0 || iDate < 0 || iLevel < 0) return []

  const season = upcomingSeasonYear(now)
  const schoolsWithGames = new Set<string>()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const level = (row[iLevel] ?? '').toLowerCase().trim()
    const isHs = level.includes('hs') || level.includes('high school') || level.includes('juco') || level.includes('junior college')
    if (!isHs) continue
    const d = normalizeIsoDate((row[iDate] ?? '').trim())
    if (!d.startsWith(`${season}-`)) continue
    const team = (row[iTeam] ?? '').trim()
    if (!team) continue
    const info = CSV_TEAM_INFO[team]
    const school = info ? info.key.split('|')[0]! : team
    schoolsWithGames.add(school.toLowerCase().trim())
  }
  if (schoolsWithGames.size === 0) return []

  const missing = clients
    .filter((c) => isHsLevel(c) && !c.isCoach && !INACTIVE.test(c.status))
    .filter((c) => !c.org.trim() || !schoolsWithGames.has(c.org.toLowerCase().trim()))
    .map((c) => ({ name: c.name, school: c.org.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return missing.length > 0 ? [weekly.hsClientsMissing(season, missing)] : []
}
