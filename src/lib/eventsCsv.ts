// Fetch + parse the team's "SV Summer Coverage" sheet (published CSV) into
// non-game events for the map. Same source the Slack recap uses. Columns:
// Tier · Event · Location · Start Date · End Date · SV Staff · SV Clients Attending
import Papa from 'papaparse'
import { fetchWithTimeout } from './fetchWithTimeout'

const EVENTS_CSV_URL = (import.meta.env.VITE_EVENTS_CSV_URL as string | undefined)
  ?? 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSWoPys4nn-twC2weVoG-DlOHu9JhzXZgYVMJXNmJwPFbNbsLPgzjMzHVK2nUNfLbp7h10itgnAlTPU/pub?output=csv'

export interface SvEvent {
  event: string
  tier: number | null
  city: string
  state: string
  startDate: string  // YYYY-MM-DD
  endDate: string
  staff: string      // who's attending (SV Staff)
  clients: string[]  // SV Clients Attending
  travels: boolean   // staff assigned and not "Stream" (i.e. someone physically goes)
}

/** "Atlanta GA" → {city:'Atlanta', state:'GA'}; "Philly" → {city:'Philly', state:''}. */
function splitLocation(loc: string): { city: string; state: string } {
  const t = (loc ?? '').trim().split(/\s+/)
  if (t.length >= 2 && /^[A-Z]{2}$/.test(t[t.length - 1]!)) {
    return { city: t.slice(0, -1).join(' '), state: t[t.length - 1]! }
  }
  return { city: (loc ?? '').trim(), state: '' }
}

/** Accepts M/D/YYYY or YYYY-MM-DD, returns YYYY-MM-DD ('' if unparseable). */
function normIso(s: string): string {
  const v = (s ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`
  return ''
}

/** Case-insensitive header lookup against a parsed row object. */
function pick(row: Record<string, string>, name: string): string {
  const k = Object.keys(row).find((h) => h.trim().toLowerCase() === name)
  return k ? (row[k] ?? '').trim() : ''
}

export async function fetchEvents(): Promise<SvEvent[]> {
  if (!EVENTS_CSV_URL) return []
  try {
    const res = await fetchWithTimeout(EVENTS_CSV_URL, { timeoutMs: 10000 })
    if (!res.ok) return []
    const text = await res.text()
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
    const out: SvEvent[] = []
    for (const row of parsed.data) {
      const event = pick(row, 'event')
      if (!event) continue
      const { city, state } = splitLocation(pick(row, 'location'))
      const staff = pick(row, 'sv staff')
      const staffLower = staff.toLowerCase()
      const tierNum = parseInt(pick(row, 'tier'), 10)
      out.push({
        event,
        tier: Number.isFinite(tierNum) ? tierNum : null,
        city,
        state,
        startDate: normIso(pick(row, 'start date')),
        endDate: normIso(pick(row, 'end date')),
        staff,
        clients: pick(row, 'sv clients attending').split(',').map((s) => s.trim()).filter(Boolean),
        travels: staff !== '' && staffLower !== 'stream',
      })
    }
    return out
  } catch (e) {
    console.warn('[eventsCsv] fetch failed:', e)
    return []
  }
}
