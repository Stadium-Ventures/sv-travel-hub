// Summer collegiate league metadata.
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
