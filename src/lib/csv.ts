import Papa from 'papaparse'
import type { RosterPlayer, PlayerLevel } from '../types/roster'
import { TIER_VISIT_TARGETS } from '../types/roster'
import { fetchWithTimeout } from './fetchWithTimeout'

const ROSTER_CSV_URL = import.meta.env.VITE_ROSTER_CSV_URL as string | undefined

interface RosterRow {
  [key: string]: string
}

export function findColumn(row: RosterRow, candidates: string[]): string {
  const keys = Object.keys(row)
  for (const c of candidates) {
    const cl = c.toLowerCase()
    // Exact header match FIRST, prefix matches only as fallback. A single
    // combined pass let a new "Org Temp" sheet column shadow "Org" (it comes
    // first and prefix-matches), blanking every player's org (2026-07-23).
    const exact = keys.find((k) => k.trim().toLowerCase() === cl)
    if (exact && row[exact]) return row[exact].trim()
    // Prefix match handles "State (High School)" matching "State"
    const prefix = keys.find((k) => {
      const kl = k.trim().toLowerCase()
      return kl.startsWith(cl + ' ') || kl.startsWith(cl + '(')
    })
    if (prefix && row[prefix]) return row[prefix].trim()
  }
  return ''
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function parseLevel(raw: string): PlayerLevel {
  const lower = raw.toLowerCase().trim()
  if (lower === 'pro' || lower === 'professional' || lower === 'mlb' || lower === 'milb') return 'Pro'
  if (lower === 'ncaa' || lower === 'college' || lower === 'juco' || lower === 'junior college') return 'NCAA'
  if (lower === 'hs' || lower === 'high school') return 'HS'
  return 'Pro' // default
}

function parseNumber(raw: string): number | null {
  if (!raw || raw === 'N/A' || raw === '-') return null
  const n = parseInt(raw, 10)
  return isNaN(n) ? null : n
}

export interface RosterParseResult {
  players: RosterPlayer[]
  warnings: string[]
}

export async function fetchRoster(): Promise<RosterParseResult> {
  if (!ROSTER_CSV_URL) {
    throw new Error('VITE_ROSTER_CSV_URL is not configured. Add it to your .env file.')
  }

  // no-store: a browser serving a months-old cached copy of the published
  // CSV looks exactly like a healthy fetch, but with yesterday's columns.
  const res = await fetchWithTimeout(ROSTER_CSV_URL, { timeoutMs: 10000, cache: 'no-store' })
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`)
  const text = await res.text()

  // Google can answer 200 with a sign-in/redirect PAGE instead of the CSV
  // (browser not signed into an account with sheet access). Parsing that
  // HTML "succeeds" with garbage rows and everything downstream fails
  // quietly — fail loudly here instead.
  if (/^\s*</.test(text)) {
    throw new Error('Roster sheet returned a web page instead of CSV — this browser may not have access to the sheet (Google sign-in?)')
  }

  const parsed = Papa.parse<RosterRow>(text, { header: true, skipEmptyLines: true })
  const warnings: string[] = []

  // Validate expected columns exist in the sheet
  if (parsed.data.length > 0) {
    const sampleRow = parsed.data[0]!
    const colNames = Object.keys(sampleRow).map((k) => k.trim().toLowerCase())
    const requiredGroups: Array<{ label: string; candidates: string[] }> = [
      { label: 'Name', candidates: ['name', 'player name', 'player'] },
      { label: 'Org', candidates: ['org', 'organization', 'team', 'school'] },
      { label: 'Level', candidates: ['level', 'player level'] },
      { label: 'Tier', candidates: ['tier', 'player tier'] },
    ]
    for (const { label, candidates } of requiredGroups) {
      const found = candidates.some((c) => colNames.some((k) => k === c || k.startsWith(c + ' ') || k.startsWith(c + '(')))
      if (!found) {
        warnings.push(`Sheet may be missing "${label}" column — expected one of: ${candidates.join(', ')}`)
      }
    }
  }

  const players = parsed.data
    .filter((r) => findColumn(r, ['Name', 'Player Name', 'Player']))
    // Drop coaches — the sheet flags them with "Is Coach: Yes" but they
    // aren't players to plan visits around. Kent's feedback 2026-06-08.
    .filter((r) => {
      const isCoach = findColumn(r, ['Is Coach', 'IsCoach', 'Coach', 'Role'])
      const v = isCoach.toLowerCase().trim()
      return !(v === 'yes' || v === 'y' || v === 'true' || v === 'coach' || v === 'head coach' || v === 'assistant coach')
    })
    .map((r) => {
      const playerName = findColumn(r, ['Name', 'Player Name', 'Player'])

      // Track defaulted values
      const levelRaw = findColumn(r, ['Level', 'Player Level'])
      const level = parseLevel(levelRaw)
      const isJuco = ['juco', 'junior college'].includes(levelRaw.toLowerCase().trim())
      if (levelRaw && level === 'Pro' && !['pro', 'professional', 'mlb', 'milb'].includes(levelRaw.toLowerCase().trim())) {
        warnings.push(`${playerName}: unrecognized level "${levelRaw}" — defaulted to Pro`)
      }

      const tierRaw = findColumn(r, ['Tier', 'Player Tier'])
      const tier = parseNumber(tierRaw) ?? 2
      if (!tierRaw || tierRaw === '' || tierRaw === '-') {
        warnings.push(`${playerName}: no tier specified — defaulted to T2`)
      }

      const visitTarget = TIER_VISIT_TARGETS[tier] ?? 0
      const visitTargetRaw = parseNumber(findColumn(r, ['2026 Visit Target', 'Visit Target', 'Visits Target']))
      const visitsCompleted = parseNumber(findColumn(r, ['Visits Completed', 'Visits', 'In-Person Visits'])) ?? 0
      const lastVisit = findColumn(r, ['Last Visit Date', 'Last Visit', 'Last In-Person'])
      const ageRaw = findColumn(r, ['Age'])
      const dobRaw = findColumn(r, ['DOB', 'Date of Birth', 'Birthday'])

      return {
        playerName,
        normalizedName: normalizeName(playerName),
        org: findColumn(r, ['Org', 'Organization', 'Team', 'School']),
        level,
        isJuco,
        mlbPlayerId: parseNumber(findColumn(r, ['MLB_ID', 'MLB Id', 'MLB ID', 'MLBId'])),
        pgPlayerId: parseNumber(findColumn(r, ['PG_ID', 'PG Id', 'PG ID', 'PG Player ID', 'Perfect Game ID', 'PerfectGameId'])),
        position: findColumn(r, ['Position', 'Pos']),
        state: findColumn(r, ['State', 'Home State']),
        draftClass: findColumn(r, ['Draft Class', 'Class', 'Draft Year']),
        tier,
        leadAgent: findColumn(r, ['Lead Agent', 'Agent', 'Lead']),
        visitTarget2026: visitTargetRaw ?? visitTarget,
        visitsCompleted,
        lastVisitDate: lastVisit || null,
        visitsRemaining: Math.max(0, (visitTargetRaw ?? visitTarget) - visitsCompleted),
        dob: dobRaw,
        age: parseNumber(ageRaw),
        phone: findColumn(r, ['Phone', 'Cell', 'Phone Number']),
        email: findColumn(r, ['Email', 'Email Address']),
        father: findColumn(r, ['Father', "Father's Name", 'Dad']),
        mother: findColumn(r, ['Mother', "Mother's Name", 'Mom']),
        status: findColumn(r, ['Status', 'Player Status', 'Availability', 'Notes']),
      }
    })

  return { players, warnings }
}
