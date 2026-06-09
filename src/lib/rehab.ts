// Rehab assignment helpers. A "rehabbing" Pro player is an MLB-level (sportId 1)
// player currently appearing on a MiLB affiliate (sportId 11-14) roster. Their
// affiliate-team games are time-limited — per CBA, max 20 days for position
// players, max 30 days (or 30 IP) for pitchers.

export type PlayerRole = 'pitcher' | 'position'
export type RehabSource = 'estimated' | 'transactions'

export interface RehabWindow {
  /** Player name (case as in roster). */
  playerName: string
  /** Affiliate team the player is rehabbing with (MiLB). */
  teamId: number
  sportId: number
  /** Date the rehab assignment started, ISO YYYY-MM-DD. Null = unknown. */
  startDate: string | null
  /** Estimated last day the player is likely still with this affiliate. */
  estimatedEndDate: string
  /** Where the data came from — drives UI confidence label. */
  source: RehabSource
  role: PlayerRole
  /** Free-form note ("Started 2026-05-28 — sent on rehab to Worcester"). */
  description?: string
  /** When this window was fetched (epoch ms). Null = never. */
  fetchedAt: number | null
}

/** Is this player likely rehabbing right now? MLB org player on MiLB affiliate. */
export function isLikelyRehab(
  playerLevel: string | null | undefined,
  affiliate: { sportId: number } | null | undefined,
): boolean {
  if (playerLevel !== 'Pro' || !affiliate) return false
  return affiliate.sportId >= 11 && affiliate.sportId <= 14
}

/** Default rehab end if we have no transaction data — conservative cap from today. */
export function estimateEndFromToday(today: string, role: PlayerRole): string {
  // Conservative: assume the player is partway into their rehab already.
  // Pitchers heal/rehab faster than position players come back.
  const days = role === 'pitcher' ? 10 : 14
  return addDaysISO(today, days)
}

/** Max-window end if we know the rehab start date. Aligns with CBA caps. */
export function endFromStart(startDate: string, role: PlayerRole): string {
  const days = role === 'pitcher' ? 30 : 20
  return addDaysISO(startDate, days)
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Human-friendly summary for tooltips and chips. */
export function describeRehabWindow(w: RehabWindow): string {
  const verb = w.source === 'transactions' ? 'Rehab assigned' : 'On MiLB roster (rehab?)'
  const start = w.startDate ? ` ${formatShort(w.startDate)}` : ''
  return `${verb}${start} · est. back by ~${formatShort(w.estimatedEndDate)}`
}

function formatShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
