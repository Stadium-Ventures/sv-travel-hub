// Parses the Summer Ball Placement Google Sheet (published as CSV) into a
// player -> summer team assignment map.
//
// Sheet shape (one section per draft class):
//   "<YYYY> Draft Players,,,,,,"           <- section header
//   "Player,School,Team,League,Status,Contact,"   <- column header
//   "Riley Goodman,SC,Harwich Mariners,CCBL,Confirmed,..."  <- data
//   "...empty rows separate sections..."
//
// Strategy: ignore any row whose first cell looks like a section header or
// column header; treat everything else as a data row. The League column drives
// which scraper/API will fetch the team's schedule.

import Papa from 'papaparse'
import { fetchWithTimeout } from './fetchWithTimeout'
import type { SummerLeagueCode } from '../data/summerLeagues'
import { SUMMER_LEAGUES, isSummerStatusActive } from '../data/summerLeagues'

const SUMMER_CSV_URL = import.meta.env.VITE_SUMMER_CSV_URL as string | undefined

export interface SummerAssignment {
  playerName: string
  school: string          // college (e.g. "Vandy", "GT")
  summerTeam: string      // e.g. "Hyannis Harbor Hawks"
  league: SummerLeagueCode
  status: string          // raw status string from sheet
  contact?: string
  active: boolean         // derived — false if Shut Down / Injured / Out
}

export interface SummerAssignmentResult {
  assignments: SummerAssignment[]
  warnings: string[]
  fetchedAt: string
}

// Rows we should never treat as player data.
const SECTION_HEADER_RE = /^\s*\d{4}\s+Draft\s+Players\s*$/i
const COLUMN_HEADER_RE = /^\s*player\s*$/i
const NEED_PLACEMENT_RE = /^\s*NEED\s+PLACEMENT\s*$/i

function parseLeague(raw: string, playerName: string, warnings: string[]): SummerLeagueCode | null {
  const code = raw.toUpperCase().trim()
  if (!code) return null
  if (code in SUMMER_LEAGUES) return code as SummerLeagueCode
  // Try common aliases
  if (code === 'CCB') return 'CCBL'
  if (code === 'NORTHWOODS') return 'NWDS'
  if (code === 'COASTAL PLAIN') return 'COPL'
  warnings.push(`${playerName}: unknown league "${raw}" — skipped`)
  return null
}

export async function fetchSummerAssignments(): Promise<SummerAssignmentResult> {
  if (!SUMMER_CSV_URL) {
    throw new Error('VITE_SUMMER_CSV_URL is not configured. Add it to your .env file.')
  }

  const res = await fetchWithTimeout(SUMMER_CSV_URL, { timeoutMs: 10000 })
  if (!res.ok) throw new Error(`Summer assignments fetch failed: ${res.status}`)
  const text = await res.text()

  // Parse without headers — the sheet uses repeated section headers, so we
  // walk rows by position.
  const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true })
  const warnings: string[] = []
  const assignments: SummerAssignment[] = []

  for (const row of parsed.data) {
    if (!row || row.length === 0) continue
    const first = (row[0] ?? '').trim()
    if (!first) continue
    if (SECTION_HEADER_RE.test(first)) continue
    if (COLUMN_HEADER_RE.test(first)) continue
    if (NEED_PLACEMENT_RE.test(first)) continue

    const playerName = first
    const school = (row[1] ?? '').trim()
    const summerTeam = (row[2] ?? '').trim()
    const leagueRaw = (row[3] ?? '').trim()
    const status = (row[4] ?? '').trim()
    const contact = (row[5] ?? '').trim() || undefined

    // A row with no team + no league is just an incomplete placement; skip silently.
    if (!summerTeam && !leagueRaw) continue

    const league = parseLeague(leagueRaw, playerName, warnings)
    if (!league) continue

    if (!summerTeam) {
      warnings.push(`${playerName}: ${leagueRaw} assignment missing team name — skipped`)
      continue
    }

    assignments.push({
      playerName,
      school,
      summerTeam,
      league,
      status,
      contact,
      active: isSummerStatusActive(status),
    })
  }

  return {
    assignments,
    warnings,
    fetchedAt: new Date().toISOString(),
  }
}
