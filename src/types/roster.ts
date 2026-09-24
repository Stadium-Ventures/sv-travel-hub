export interface Coordinates {
  lat: number
  lng: number
}

export type PlayerLevel = 'Pro' | 'NCAA' | 'HS'

export interface RosterPlayer {
  /** sv-registry slug: the stable join key. Always set on the registry
   *  source; set on the sheet source only if the CSV carries a `slug` column
   *  (the registry's sheet-shaped CSV does, the legacy sheet does not). */
  slug?: string
  /** Display name only. Do not join on it where a slug or MLBAM id exists. */
  playerName: string
  normalizedName: string
  org: string
  level: PlayerLevel
  /** True if the roster sheet listed this player as JUCO / Junior College.
   *  We collapse JUCO into NCAA at the level field (no JUCO-specific UI
   *  outside the badge), but preserve the original source so the UI can
   *  warn "no live schedule source for JUCO games." */
  isJuco: boolean
  mlbPlayerId: number | null // MLB player ID (Pro players only)
  /** Perfect Game integer profile ID — global, stable, links to perfectgame.org/Players/Playerprofile.aspx?ID=<n>. Optional column on the roster sheet (PG_ID / PG Player ID / Perfect Game ID). */
  pgPlayerId: number | null
  position: string
  state: string
  draftClass: string
  tier: number // 1-4
  leadAgent: string
  visitTarget2026: number
  visitsCompleted: number
  lastVisitDate: string | null
  visitsRemaining: number // derived
  status: string // e.g. 'Injured', 'Transferred', 'Drafted', or '' for active
  /** Contact card. NEVER populated by the roster load (sheet or registry) and
   *  never persisted: contact data is a separate grant from roster metadata
   *  (decision D4, pending). Reserved for a future gated contact door that is
   *  fetched on demand; the PlayerCard block that renders it is additionally
   *  behind VITE_CONTACT_CARD=1. */
  contact?: PlayerContact
}

export interface PlayerContact {
  phone?: string
  email?: string
  father?: string
  mother?: string
  dob?: string
}

/** Fields that must never be written to browser storage. Used by the
 *  sv-travel-roster persist migration to scrub snapshots written by builds
 *  that still parsed the sheet's contact columns. */
export const PII_PLAYER_KEYS = ['dob', 'age', 'phone', 'email', 'father', 'mother', 'contact'] as const

// Statuses that exclude a player from trip generation
export const INACTIVE_STATUSES = ['injured', 'transferred', 'drafted', 'out', 'inactive', 'released']
export function isPlayerInactive(status: string): boolean {
  return INACTIVE_STATUSES.includes(status.toLowerCase().trim())
}

export const TIER_VISIT_TARGETS: Record<number, number> = {
  1: 5,
  2: 3,
  3: 1,
  4: 0,
}
