export interface Coordinates {
  lat: number
  lng: number
}

export type PlayerLevel = 'Pro' | 'NCAA' | 'HS'

export interface RosterPlayer {
  playerName: string
  normalizedName: string
  org: string
  level: PlayerLevel
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
  dob: string
  age: number | null
  phone: string
  email: string
  father: string
  mother: string
  status: string // e.g. 'Injured', 'Transferred', 'Drafted', or '' for active
}

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
