import type { Coordinates } from './roster'

export type ScheduleSource = 'mlb-api' | 'ncaa-lookup' | 'hs-lookup'

// Confidence that the player will actually be at this venue on this date
export type VisitConfidence = 'high' | 'medium' | 'low'

export interface GameEvent {
  id: string
  date: string // ISO date
  dayOfWeek: number // 0=Sun, 1=Mon, ..., 6=Sat
  time: string
  homeTeam: string
  awayTeam: string
  isHome: boolean
  venue: {
    name: string
    coords: Coordinates
    /** IANA zone (e.g. "America/Los_Angeles") from the MLB API — used for
     *  the venue-local time display. Absent on non-MLB sources and on
     *  events cached before 2026-07-24; display falls back to a
     *  longitude-based approximation. */
    tz?: string
  }
  source: ScheduleSource
  playerNames: string[]
  /** Which side of THIS game each tracked player is on. Present on Pro games
   *  (from team assignments) so a game where two SV clients face each other
   *  keeps both — NCAA/HS events are single-school, where isHome already
   *  determines every listed player's side. */
  playerSides?: Record<string, 'home' | 'away'>
  sportId?: number
  confidence?: VisitConfidence
  confidenceNote?: string // e.g. "Typical home game day" or "May be traveling for away series"
  sourceUrl?: string // Link to verify this game (MLB Gameday, D1Baseball schedule, etc.)
  gameStatus?: string // e.g. "Final", "Postponed", "Cancelled" from MLB API status.detailedState
  probablePitcherNames?: string[] // fullNames from MLB API probablePitcher hydration
}

export interface ScoreBreakdown {
  tier1Count: number; tier1Points: number
  tier2Count: number; tier2Points: number
  tier3Count: number; tier3Points: number
  tuesdayBonus: boolean
  pitcherMatchBonus: number
  rawScore: number
  finalScore: number
}

export interface TripCandidate {
  anchorGame: GameEvent
  nearbyGames: Array<GameEvent & { driveMinutes: number }>
  suggestedDays: string[] // ISO dates
  totalPlayersVisited: number
  visitValue: number // tier-weighted score
  driveFromHomeMinutes: number // Orlando → anchor drive time
  totalDriveMinutes: number // estimated total driving (round trip)
  venueCount: number // number of distinct venues visited
  scoreBreakdown?: ScoreBreakdown
  /** Other anchor dates at the same venue with the same players — a series
   *  where several dates work equally well (e.g. a week-long head-to-head).
   *  Display-only; computed after trip selection. */
  altDates?: string[]
  /** Built from the exact convergence route the user clicked "Plan" on.
   *  Banner routes may have legs over the Drive cap (flagged, not dropped),
   *  so the engine can't be trusted to rediscover the clicked itinerary —
   *  this card IS that itinerary, and it pins to the top of the results. */
  plannedFromSwing?: boolean
}

export interface PriorityResult {
  playerName: string
  status: 'included' | 'separate-trip' | 'fly-in-only' | 'unreachable'
  reason?: string
}

export interface FlyInStop {
  venue: { name: string; coords: Coordinates }
  playerNames: string[]
  date: string
  driveMinutesFromPrev: number
  source: ScheduleSource
  isHome: boolean
  sourceUrl?: string
  confidence?: VisitConfidence
  teamLabel?: string
  gameTime?: string
}

export interface FlyInVisit {
  playerNames: string[]
  venue: { name: string; coords: Coordinates } // primary venue (or hub center for combos)
  dates: string[]
  distanceKm: number
  estimatedTravelHours: number // flight + airport overhead
  visitValue: number // tier-weighted score (same as road trips)
  scoreBreakdown?: ScoreBreakdown
  source: ScheduleSource
  isHome: boolean
  sourceUrl?: string
  confidence?: VisitConfidence
  teamLabel?: string // the team whose schedule these games belong to
  gameTime?: string // game time for single-venue fly-ins (ISO string)
  // Combo trip fields (fly-in + drive to nearby venues)
  isCombo?: boolean
  stops?: FlyInStop[]
  hubAirport?: string // e.g. "ATL"
  totalDriveMinutes?: number // inter-venue driving within the combo
}

export interface NearMiss {
  playerName: string
  venue: string
  driveMinutes: number
  overBy: number // minutes over the limit
}

export interface UnvisitablePlayer {
  name: string
  reason: string
}

export type DoubleUpType = 'nearby-venues' | 'same-venue-matchup' | 'tournament-cluster' | 'stay-over' | 'triple-up'

export interface DoubleUp {
  date: string
  /** All dates when this same double-up repeats back-to-back (a series).
   *  Length 1 for one-off opportunities; date === dates[0]. */
  dates: string[]
  /** Per-date detail for the expandable "Dates & times" view — each date in
   *  the series with THAT date's games (start times differ night to night)
   *  and its own feasibility verdict. */
  occurrences?: Array<{ date: string; games: GameEvent[]; timeFeasible: boolean | null }>
  games: GameEvent[]
  type: DoubleUpType
  driveMinutesBetween: number  // 0 for same-venue
  timeFeasible: boolean | null // null = times unknown
  combinedValue: number        // tier-weighted score
  playerNames: string[]
}

export interface TripPlan {
  trips: TripCandidate[]
  flyInVisits: FlyInVisit[]
  unvisitablePlayers: UnvisitablePlayer[]
  skippedPlayers: Array<{ name: string; reason: string }> // T4 / no visits needed
  analyzedEventCount: number // how many game events were analyzed
  totalPlayersWithVisits: number
  totalVisitsCovered: number
  totalVisitsPlanned: number // total player-trip appearances (T1 player in 3 trips = 3)
  coveragePercent: number
  priorityResults?: PriorityResult[]
  nearMisses?: NearMiss[]
  doubleUps?: DoubleUp[]
  flyInDiagnostic?: Record<string, string> // priority player name → diagnostic trace
}
