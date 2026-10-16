// NCAA schedule checks for the health monitor (api/health-monitor.ts wires
// it in). Findings use the monitor's shape: what broke, how we know, what
// to do, in plain English.
//
// When it speaks:
//   Jan 15 to Jun 30   the college season: a client school with no readable
//                      games, or with no schedule source at all.
//   Sep 1 to Nov 30    fall ball: only a source that is broken (a page that
//                      can't be read); "nothing published yet" is normal.
//   otherwise          silent.
// Quiet when healthy, like the rest of the monitor.

import { fetchSchoolSchedule, type NcaaSchoolSchedule } from './ncaaSchedule.js'
import { NCAA_SCHEDULE_SOURCES, NCAA_NO_PUBLIC_SOURCE } from '../_data/ncaaSources.js'

export interface NcaaFinding {
  /** Which problem this is; the monitor keys its same-run re-check on it. */
  kind: 'no-source' | 'unreadable' | 'empty'
  /** Short headline for the Slack post. */
  title: string
  /** Schools behind the finding. */
  schools: string[]
  severity: 'critical' | 'warning'
  code: boolean
  what: string
  how: string
  todo: string
}

export interface NcaaCheckOptions {
  /** Client schools (canonical names) to check. Defaults to every school
   *  with a source. Pass the roster's NCAA schools so only real gaps alert. */
  schools?: string[]
  /** Published Client Game Schedule CSV text, when the monitor has it: a
   *  school with no source but games in the sheet is covered. */
  sheetCsvText?: string
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>
}

function monthDay(d: Date): number {
  return (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

/** Quoted-field-aware CSV rows (the sheet quotes "City, ST" locations). */
function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQuote = false
      else cur += c
    } else if (c === '"') inQuote = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}

/** How many NCAA games the sheet has for a school in the season window. */
export function sheetGameCount(csvText: string | undefined, school: string, from: string, to: string): number {
  if (!csvText) return 0
  const [header = [], ...rows] = csvRows(csvText)
  const cols = header.map((h) => h.trim().toLowerCase())
  const iTeam = cols.indexOf('team'), iLevel = cols.indexOf('level'), iDate = cols.indexOf('date')
  if (iTeam < 0 || iLevel < 0 || iDate < 0) return 0
  const names = new Set([school.toLowerCase(), school.replace(/ State$/, ' St.').toLowerCase()])
  const seen = new Set<string>()
  for (const cells of rows) {
    if ((cells[iLevel] ?? '').trim().toUpperCase() !== 'NCAA') continue
    if (!names.has((cells[iTeam] ?? '').trim().toLowerCase())) continue
    const m = (cells[iDate] ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (!m) continue
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!
    const iso = `${y}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`
    if (iso >= from && iso <= to) seen.add(iso)
  }
  return seen.size
}

export async function checkNcaaSchedules(now: Date, opts: NcaaCheckOptions = {}): Promise<NcaaFinding[]> {
  const md = monthDay(now)
  const spring = md >= 115 && md <= 630
  const fall = md >= 901 && md <= 1130
  if (!spring && !fall) return []

  const schools = [...new Set(opts.schools ?? Object.keys(NCAA_SCHEDULE_SOURCES))]
  const season = spring ? now.getUTCFullYear() : now.getUTCFullYear() + 1
  const from = `${season - 1}-08-01`
  const to = `${season}-07-31`

  // Six at a time keeps a full client list well inside the monitor's
  // function time limit (each school is one to four page reads).
  const results: NcaaSchoolSchedule[] = []
  const queue = [...schools]
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
    while (queue.length) {
      const school = queue.shift()!
      results.push(await fetchSchoolSchedule(school, { season, now, fetchFn: opts.fetchFn, timeoutMs: 8000 }))
    }
  }))
  results.sort((a, b) => schools.indexOf(a.school) - schools.indexOf(b.school))

  const findings: NcaaFinding[] = []

  const noSource = results.filter((r) => r.status === 'no-source' && sheetGameCount(opts.sheetCsvText, r.school, from, to) === 0)
  if (spring && noSource.length > 0) {
    const named = noSource.map((r) => r.school)
    const known = named.filter((s) => NCAA_NO_PUBLIC_SOURCE[s])
    findings.push({
      kind: 'no-source',
      title: `${named.length} college ${named.length === 1 ? 'school has' : 'schools have'} no schedule in the hub`,
      schools: named,
      severity: 'warning',
      code: known.length < named.length,
      what: `College games for ${named.join(', ')} won't show in the Travel Hub. ${named.length === 1 ? 'That school has' : 'Those schools have'} no schedule the app can read, and the Client Game Schedule sheet has no games for ${named.length === 1 ? 'it' : 'them'} this season.`,
      how: noSource.map((r) => r.message).join(' '),
      todo: known.length === named.length
        ? `Type the games into the Client Game Schedule sheet (Level NCAA). The app shows sheet games for schools without a readable site.`
        : `Open sv-travel-hub in Claude Code and add the school's athletics site to the college schedule sources. Until then, type the games into the Client Game Schedule sheet (Level NCAA).`,
    })
  }

  const broken = results.filter((r) => r.status === 'error')
  const emptyInSeason = spring ? results.filter((r) => r.status === 'empty') : []
  if (broken.length > 0) {
    findings.push({
      kind: 'unreadable',
      title: `${broken.length} college schedule ${broken.length === 1 ? 'page' : 'pages'} can't be read`,
      schools: broken.map((r) => r.school),
      severity: 'warning',
      code: true,
      what: `College games for ${broken.map((r) => r.school).join(', ')} may be missing or out of date in the Travel Hub. The schedule ${broken.length === 1 ? 'page' : 'pages'} could not be read.`,
      how: broken.map((r) => `${r.message}${r.sourceUrl ? ` (${r.sourceUrl})` : ''}`).join(' '),
      todo: 'Open sv-travel-hub in Claude Code and check the college schedule reader against the page (the site may have changed its layout or address). Meanwhile the app shows sheet games or its last saved copy.',
    })
  }
  if (emptyInSeason.length > 0) {
    findings.push({
      kind: 'empty',
      title: `${emptyInSeason.length} college ${emptyInSeason.length === 1 ? 'school shows' : 'schools show'} no games mid-season`,
      schools: emptyInSeason.map((r) => r.school),
      severity: 'warning',
      code: true,
      what: `No ${season} games found for ${emptyInSeason.map((r) => r.school).join(', ')}, in the middle of the college season.`,
      how: `The schedule ${emptyInSeason.length === 1 ? 'page loads' : 'pages load'} but list no ${season} games: ${emptyInSeason.map((r) => r.sourceUrl).filter(Boolean).join(', ')}.`,
      todo: 'Open the page. If the games are there, open sv-travel-hub in Claude Code to fix the college schedule reader; if the site moved the schedule, update its address in the college schedule sources.',
    })
  }
  return findings
}
