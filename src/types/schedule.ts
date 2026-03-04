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
  }
  source: ScheduleSource
  playerNames: string[]
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
}

export interface PriorityResult {
  playerName: string
  status: 'included' | 'separate-trip' | 'fly-in-only' | 'unreachable'
  reason?: string
}

export interface FlyInVisit {
  playerNames: string[]
  venue: { name: string; coords: Coordinates }
  dates: string[]
  distanceKm: number
  estimatedTravelHours: number // flight + airport overhead
  visitValue: number // tier-weighted score (same as road trips)
  scoreBreakdown?: ScoreBreakdown
  source: ScheduleSource
  isHome: boolean
  sourceUrl?: string
  confidence?: VisitConfidence
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
}
