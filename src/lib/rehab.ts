// Rehab assignment helpers. A "rehabbing" Pro player is an MLB-level (sportId 1)
// player currently appearing on a MiLB affiliate (sportId 11-14) roster. Their
// affiliate-team games are time-limited — per CBA, max 20 days for position
// players, max 30 days (or 30 IP) for pitchers.

export type PlayerRole = 'pitcher' | 'position'
export type RehabSource = 'transactions' | 'inferred-40man' | 'none'

export interface RehabWindow {
  /** Player name (case as in roster). */
  playerName: string
  /** Affiliate team the player is currently at (MiLB). */
  teamId: number
  sportId: number
  /** True if the player is on the parent org's 40-man roster — that means
   *  they're MLB-level and currently at MiLB on either a rehab assignment
   *  or an option. Without this signal we assume they're a genuine MiLB
   *  career player and apply no special treatment. */
  is40Man: boolean
  /** True if MLB Transactions API has an active "Rehab Assignment" record
   *  for this player. Only when this is true do we clip out-of-window MiLB
   *  games — option assignments can last months. */
  confirmedRehab: boolean
  /** Rehab assignment effective date — only set when confirmedRehab. */
  startDate: string | null
  /** Estimated last day at the MiLB affiliate — only set when
   *  confirmedRehab. CBA caps: 20 days for position players, 30 for pitchers. */
  estimatedEndDate: string | null
  source: RehabSource
  role: PlayerRole
  /** Free-form note from the transaction record. */
  description?: string
  /** When this window was fetched (epoch ms). Null = never. */
  fetchedAt: number | null
}

/** Soft check: Pro player currently at a MiLB sportId. Tells us whether to
 *  even ask "is this rehab or option?" — not whether the player IS rehabbing. */
export function isAtMilbAffiliate(
  playerLevel: string | null | undefined,
  affiliate: { sportId: number } | null | undefined,
): boolean {
  if (playerLevel !== 'Pro' || !affiliate) return false
  return affiliate.sportId >= 11 && affiliate.sportId <= 14
}

/** CBA-derived rehab cap. We project rehab end at start + max-allowed days
 *  for the role. Pitchers may rehab up to 30 days (or 30 IP); position
 *  players are capped at 20. The cap is a CEILING — players often come back
 *  sooner — but it's the right outer bound for trip planning. */
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
  if (w.confirmedRehab && w.estimatedEndDate) {
    const start = w.startDate ? ` ${formatShort(w.startDate)}` : ''
    return `Rehab assigned${start} · est. back by ~${formatShort(w.estimatedEndDate)} (CBA max)`
  }
  if (w.is40Man) {
    return 'On parent 40-man roster but currently at MiLB — could be rehab or option. No confirmation in last 35 days of MLB transactions.'
  }
  return 'Currently at MiLB affiliate.'
}

function formatShort(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
