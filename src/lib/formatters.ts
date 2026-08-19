export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

/** "Aug 23" — for tables that render their own (accented) weekday column,
 *  where formatDate's built-in weekday would double it ("Sun Sun Aug 23"). */
export function formatMonthDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

export function formatDriveTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

/** Game start time as Eastern, e.g. "6:40 PM ET". Empty string when the
 *  time isn't a real timestamp (synthetic noon placeholders return ''). */
export function formatGameTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET'
}

export type TimeDisplayMode = 'et' | 'local'

/** Coarse US timezone from longitude — the fallback when an event has no
 *  IANA zone (non-MLB sources, pre-2026-07-24 caches). Boundaries are
 *  approximate; fresh MLB fetches carry the exact venue zone. */
export function approxTzFromLng(lng: number): string {
  if (lng >= -85) return 'America/New_York'
  if (lng >= -97.5) return 'America/Chicago'
  if (lng >= -114) return 'America/Denver'
  return 'America/Los_Angeles'
}

/** Game time in the chosen display mode: ET (default) or venue-local with
 *  the zone abbreviation ("6:35 PM PDT"). ET default per Tom 2026-07-24,
 *  with a header toggle for local. */
export function formatGameTimeDisplay(
  iso: string | undefined,
  mode: TimeDisplayMode,
  venue?: { coords: { lat: number; lng: number }; tz?: string },
): string {
  if (mode === 'et' || !venue) return formatGameTime(iso)
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const tz = venue.tz ?? approxTzFromLng(venue.coords.lng)
  try {
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz, timeZoneName: 'short',
    })
  } catch {
    return formatGameTime(iso)
  }
}

export function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export const TIER_LABELS: Record<number, string> = {
  1: 'Must-see',
  2: 'High priority',
  3: 'Standard',
  4: 'No visits',
}

export const TIER_DOT_COLORS: Record<number, string> = {
  1: 'bg-accent-red',
  2: 'bg-accent-orange',
  3: 'bg-yellow-400',
  4: 'bg-gray-500',
}
