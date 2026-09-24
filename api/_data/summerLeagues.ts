// Summer collegiate league metadata. Shared by the React app (src/data
// re-exports it) and api/health-monitor.ts; see api/_data/ncaaSchools.ts for
// why shared tables live under api/.
//
// MLB-API leagues (CCBL, MLB Draft League, Appalachian League) expose their
// schedules through statsapi.mlb.com — same backend as MLB/MiLB. Identifiers
// confirmed via dugout-pulse team 2026-06-09: CCBL leagueId=565,
// MLBD leagueId=5536, Appalachian leagueId=120.
//
// PrestoSports leagues (PGCBL, NECBL, FCBL) are scrapable HTML; not currently
// wired — we surface a "no live schedule" notice for SV players in these.
//
// Northwoods (NWDS) and Coastal Plain (COPL) are manual entries — too few
// SV players to justify scraper investment, and Northwoods ToS forbids it.

export type SummerLeagueCode = 'CCBL' | 'MLBD' | 'APP' | 'PGCBL' | 'NECBL' | 'FCBL' | 'NWDS' | 'COPL'
export type SummerLeagueSource = 'mlb-api' | 'presto' | 'manual'

export interface SummerLeagueMeta {
  code: SummerLeagueCode
  name: string
  source: SummerLeagueSource
  // MLB Stats API leagueId for source='mlb-api'
  mlbApiLeagueId?: number
  // PrestoSports site host for source='presto'
  prestoHost?: string
}

export const SUMMER_LEAGUES: Record<SummerLeagueCode, SummerLeagueMeta> = {
  CCBL: { code: 'CCBL', name: 'Cape Cod Baseball League', source: 'mlb-api', mlbApiLeagueId: 565 },
  MLBD: { code: 'MLBD', name: 'MLB Draft League', source: 'mlb-api', mlbApiLeagueId: 5536 },
  APP:  { code: 'APP',  name: 'Appalachian League', source: 'mlb-api', mlbApiLeagueId: 120 },
  PGCBL: { code: 'PGCBL', name: 'Perfect Game Collegiate Baseball League', source: 'presto', prestoHost: 'pgcbl.com' },
  NECBL: { code: 'NECBL', name: 'New England Collegiate Baseball League', source: 'presto', prestoHost: 'necbl.com' },
  FCBL: { code: 'FCBL', name: 'Futures Collegiate Baseball League', source: 'presto', prestoHost: 'thefuturesleague.com' },
  NWDS: { code: 'NWDS', name: 'Northwoods League', source: 'manual' },
  COPL: { code: 'COPL', name: 'Coastal Plain League', source: 'manual' },
}

// Default summer window. Several leagues start before Jun 1 (PGCBL May 29,
// FCBL May 27, NWDS May 25) so the start is pulled back to May 20. MLBD runs
// until Sept 2 (pro half), so we extend the end to Aug 31. Configurable in
// summerStore if Kent wants a tighter or wider window.
export const DEFAULT_SUMMER_WINDOW = {
  startMonth: 4, // May (0-indexed)
  startDay: 20,
  endMonth: 7,  // Aug (0-indexed)
  endDay: 31,
}

export function isInSummerWindow(date: Date = new Date()): boolean {
  const m = date.getMonth()
  const d = date.getDate()
  const afterStart = m > DEFAULT_SUMMER_WINDOW.startMonth ||
    (m === DEFAULT_SUMMER_WINDOW.startMonth && d >= DEFAULT_SUMMER_WINDOW.startDay)
  const beforeEnd = m < DEFAULT_SUMMER_WINDOW.endMonth ||
    (m === DEFAULT_SUMMER_WINDOW.endMonth && d <= DEFAULT_SUMMER_WINDOW.endDay)
  return afterStart && beforeEnd
}

// Statuses on the assignment sheet that mean "don't include this player in
// summer trip planning." Match case-insensitively.
export const INACTIVE_SUMMER_STATUSES = ['shut down', 'injured', 'out', 'released', 'cut']

export function isSummerStatusActive(status: string): boolean {
  const s = status.toLowerCase().trim()
  if (!s) return true
  return !INACTIVE_SUMMER_STATUSES.some((bad) => s.includes(bad))
}

// ─── Summer Ball Placement sheet rows ─────────────────────────────────────────
//
// Sheet shape (one section per draft class):
//   "<YYYY> Draft Players,,,,,,"                   <- section header
//   "Player,School,Team,League,Status,Contact,"    <- column header
//   "Riley Goodman,SC,Harwich Mariners,CCBL,Confirmed,..."  <- data
//
// Pure (rows in, placements out) so the app and the health monitor parse the
// sheet identically.

export interface SummerPlacementRow {
  playerName: string
  school: string
  summerTeam: string
  league: SummerLeagueCode
  status: string
  contact?: string
  active: boolean         // false if Shut Down / Injured / Out
}

const SECTION_HEADER_RE = /^\s*\d{4}\s+Draft\s+Players\s*$/i
const COLUMN_HEADER_RE = /^\s*player\s*$/i
const NEED_PLACEMENT_RE = /^\s*NEED\s+PLACEMENT\s*$/i

export function parseSummerLeague(raw: string): SummerLeagueCode | null {
  const code = raw.toUpperCase().trim()
  if (!code) return null
  if (code in SUMMER_LEAGUES) return code as SummerLeagueCode
  if (code === 'CCB') return 'CCBL'
  if (code === 'NORTHWOODS') return 'NWDS'
  if (code === 'COASTAL PLAIN') return 'COPL'
  if (code === 'APPY' || code === 'APPALACHIAN') return 'APP'
  return null
}

export function parseSummerPlacementRows(rows: string[][]): { placements: SummerPlacementRow[]; warnings: string[] } {
  const placements: SummerPlacementRow[] = []
  const warnings: string[] = []
  for (const row of rows) {
    if (!row || row.length === 0) continue
    const first = (row[0] ?? '').trim()
    if (!first) continue
    if (SECTION_HEADER_RE.test(first) || COLUMN_HEADER_RE.test(first) || NEED_PLACEMENT_RE.test(first)) continue

    const playerName = first
    const school = (row[1] ?? '').trim()
    const summerTeam = (row[2] ?? '').trim()
    const leagueRaw = (row[3] ?? '').trim()
    const status = (row[4] ?? '').trim()
    const contact = (row[5] ?? '').trim() || undefined

    // No team and no league is an incomplete placement; skip silently.
    if (!summerTeam && !leagueRaw) continue

    const league = parseSummerLeague(leagueRaw)
    if (!league) {
      if (leagueRaw) warnings.push(`${playerName}: unknown league "${leagueRaw}" — skipped`)
      continue
    }
    if (!summerTeam) {
      warnings.push(`${playerName}: ${leagueRaw} assignment missing team name — skipped`)
      continue
    }
    placements.push({ playerName, school, summerTeam, league, status, contact, active: isSummerStatusActive(status) })
  }
  return { placements, warnings }
}
