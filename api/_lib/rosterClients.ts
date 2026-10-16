// Parse the roster CSV (the registry's sheet-shaped CSV door, or the legacy
// sheet: same headers) into the fields the health monitor's checks use.
import { parseCsv, headerIndex } from './csv.js'
import type { RosterClient } from './monitorTypes.js'

/** Same level buckets as the recap and the app: anything that isn't HS,
 *  college or JUCO is professional baseball. */
export function rosterLevel(raw: string): RosterClient['level'] {
  const l = raw.toLowerCase().trim()
  if (l.includes('hs') || l.includes('high school')) return 'HS'
  if (l.includes('ncaa') || l.includes('college') || l.includes('juco') || l.includes('junior')) return 'NCAA'
  return 'Pro'
}

function parseId(raw: string): number | null {
  const s = raw.trim().replace(/^'/, '')
  if (!/^\d+$/.test(s)) return null
  const n = parseInt(s, 10)
  return n > 0 ? n : null
}

export function parseRosterClients(csv: string): RosterClient[] {
  const rows = parseCsv(csv)
  if (rows.length < 2) return []
  const header = rows[0]!
  const iName = headerIndex(header, ['player name', 'name', 'player'])
  const iId = headerIndex(header, ['mlb_id', 'mlb id', 'mlbid'])
  const iOrg = headerIndex(header, ['org', 'organization', 'team', 'school'])
  const iAff = headerIndex(header, ['affiliate', 'affiliate team'])
  const iLevel = headerIndex(header, ['level', 'player level'])
  const iStatus = headerIndex(header, ['status', 'player status'])
  const iCoach = headerIndex(header, ['is coach', 'iscoach'])
  if (iName < 0) return []
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '')
  const out: RosterClient[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const name = cell(row, iName)
    if (!name) continue
    const levelRaw = cell(row, iLevel)
    const coach = cell(row, iCoach).toLowerCase()
    out.push({
      name,
      mlbId: parseId(cell(row, iId)),
      org: cell(row, iOrg),
      affiliate: cell(row, iAff),
      level: rosterLevel(levelRaw),
      levelRaw,
      status: cell(row, iStatus),
      isCoach: coach === 'yes' || coach === 'y' || coach === 'true',
    })
  }
  return out
}

const SKIPPED_STATUSES = new Set(['injured', 'retired', 'free agent'])

/** Clients the coverage checks leave alone: injured, retired or free-agent
 *  clients have no team games to show, and coaches aren't players. (The
 *  registry also writes Org = "Retired" for retired rows.) */
export function isSkippedClient(c: RosterClient): boolean {
  if (c.isCoach) return true
  if (SKIPPED_STATUSES.has(c.status.toLowerCase().trim())) return true
  return c.org.toLowerCase().trim() === 'retired'
}
