// Small CSV + date helpers shared by the health monitor's checks.

/** Tiny RFC-4180-ish CSV parser (same behaviour as api/slack-recap.ts's
 *  copy). Handles quoted fields with commas and doubled-quote escapes; skips
 *  empty rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else { cur += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else { cur += c }
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

/** Index of the first header (case-insensitive) that exists, or -1. */
export function headerIndex(header: string[], names: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase())
  for (const n of names) {
    const i = lower.indexOf(n.toLowerCase())
    if (i >= 0) return i
  }
  return -1
}

/** Accepts YYYY-MM-DD, M/D/YYYY, MM/DD/YYYY, M/D/YY → YYYY-MM-DD. The Client
 *  Game Schedule sheet writes two-digit years ("5/5/26"). Anything else is
 *  returned unchanged. */
export function normalizeIsoDate(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/)
  if (m) {
    const mm = m[1]!.padStart(2, '0')
    const dd = m[2]!.padStart(2, '0')
    const yyyy = m[3]!.length === 2 ? `20${m[3]}` : m[3]
    return `${yyyy}-${mm}-${dd}`
  }
  return s
}

/** Month-day as a sortable number (Sep 15 → 915), UTC. */
export function monthDay(d: Date): number {
  return (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
}

/** YYYY-MM-DD in UTC. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** "A", "A and B", "A, B and C"; long lists end "and N more". */
export function joinList(items: string[], max = 8): string {
  if (items.length === 0) return ''
  const shown = items.length > max ? items.slice(0, max) : items
  const rest = items.length - shown.length
  const parts = rest > 0 ? [...shown, `${rest} more`] : shown
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}
