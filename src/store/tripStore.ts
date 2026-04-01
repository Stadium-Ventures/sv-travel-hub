import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Coordinates } from '../types/roster'
import type { TripPlan } from '../types/schedule'
import { generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents, MAX_DRIVE_MINUTES, estimateDriveMinutes, DEFAULT_HOME_BASE } from '../lib/tripEngine'
import { findDoubleUps } from '../lib/doubleUps'
import type { UrgencyMap } from '../lib/tripEngine'
import type { WorkerParams, WorkerMessage } from '../lib/tripEngine.worker'
import { useRosterStore } from './rosterStore'
import { useScheduleStore } from './scheduleStore'
import { useVenueStore } from './venueStore'
import { useHeartbeatStore } from './heartbeatStore'

// Default: 3-day trip starting 1 week from now
function toISO(d: Date): string {
  return d.toISOString().split('T')[0]!
}
function defaultStart(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return toISO(d)
}
function defaultEnd(): string {
  const d = new Date()
  d.setDate(d.getDate() + 9) // +7 start + 2 more = 3 days
  return toISO(d)
}

export type TripStatus = 'planned' | 'completed'

// Stable trip key for status tracking across regeneration
export function getTripKey(trip: import('../types/schedule').TripCandidate): string {
  const anchorDate = trip.anchorGame.date
  const venueKey = `${trip.anchorGame.venue.coords.lat.toFixed(4)},${trip.anchorGame.venue.coords.lng.toFixed(4)}`
  return `trip-${anchorDate}-${venueKey}`
}

interface TripState {
  startDate: string
  endDate: string
  maxDriveMinutes: number
  maxFlightHours: number
  useHeartbeatBoost: boolean
  priorityPlayers: string[]
  familyTrip: boolean
  homeBase: Coordinates
  homeBaseName: string
  tripPlan: TripPlan | null
  computing: boolean
  progressStep: string
  progressDetail: string
  tripStatuses: Record<string, TripStatus>
  selectedTripIndex: number | null // For map preview highlighting

  setDateRange: (start: string, end: string) => void
  setMaxDriveMinutes: (minutes: number) => void
  setMaxFlightHours: (hours: number) => void
  setPriorityPlayers: (players: string[]) => void
  setHomeBase: (coords: Coordinates, name: string) => void
  setFamilyTrip: (v: boolean) => void
  generateTrips: () => Promise<void>
  clearTrips: () => void
  setTripStatus: (tripKey: string, status: TripStatus | null) => void
  setUseHeartbeatBoost: (v: boolean) => void
  setSelectedTripIndex: (index: number | null) => void
}

// Track active worker for cancel support
let activeWorker: Worker | null = null

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
  startDate: defaultStart(),
  endDate: defaultEnd(),
  maxDriveMinutes: MAX_DRIVE_MINUTES,
  maxFlightHours: 4,
  useHeartbeatBoost: false, // default OFF — Heartbeat data is a snapshot of now, not the future
  priorityPlayers: [],
  familyTrip: false,
  homeBase: DEFAULT_HOME_BASE,
  homeBaseName: 'Orlando, FL',
  tripPlan: null,
  computing: false,
  progressStep: '',
  progressDetail: '',
  tripStatuses: {},
  selectedTripIndex: null,

  setDateRange: (startDate, endDate) => set({ startDate, endDate }),
  setMaxDriveMinutes: (maxDriveMinutes) => set({ maxDriveMinutes }),
  setMaxFlightHours: (maxFlightHours) => set({ maxFlightHours }),
  setUseHeartbeatBoost: (useHeartbeatBoost: boolean) => set({ useHeartbeatBoost }),
  setPriorityPlayers: (priorityPlayers) => set({ priorityPlayers }),
  setHomeBase: (homeBase, homeBaseName) => set({ homeBase, homeBaseName }),
  setFamilyTrip: (familyTrip: boolean) => set({ familyTrip }),
  clearTrips: () => set({ tripPlan: null, selectedTripIndex: null }),
  setSelectedTripIndex: (selectedTripIndex) => set({ selectedTripIndex }),
  setTripStatus: (tripKey, status) => set((state) => {
    const next = { ...state.tripStatuses }
    if (status === null) {
      delete next[tripKey]
    } else {
      next[tripKey] = status
    }
    return { tripStatuses: next }
  }),

  generateTrips: async () => {
    if (get().computing) return
    const { startDate, endDate, maxDriveMinutes, maxFlightHours, priorityPlayers, useHeartbeatBoost, homeBase, homeBaseName, familyTrip } = get()
    const players = useRosterStore.getState().players
    let scheduleState = useScheduleStore.getState()

    set({ computing: true, tripPlan: null, progressStep: 'Preparing...', progressDetail: '' })

    // BLOCK: Refuse to generate if priority player schedule data is missing
    if (priorityPlayers.length > 0) {
      const missingSchedule: string[] = []
      for (const pName of priorityPlayers) {
        const player = players.find((p) => p.playerName === pName)
        if (!player) continue
        if (player.level === 'Pro' && scheduleState.proGames.length === 0) {
          missingSchedule.push(`${pName} (Pro) — click "Load Pro Schedules" first`)
        }
        if (player.level === 'NCAA' && scheduleState.ncaaGames.length === 0) {
          missingSchedule.push(`${pName} (NCAA) — click "Load College Schedules" first`)
        }
      }
      if (missingSchedule.length > 0) {
        set({
          computing: false,
          tripPlan: null,
          progressStep: 'Blocked',
          progressDetail: `Cannot generate trips — missing schedule data for priority player(s):\n${missingSchedule.join('\n')}`,
        })
        return
      }
    }

    // Pre-flight check: warn immediately if priority players have no drivable games
    if (priorityPlayers.length > 0) {
      const allAvailableGames = [...scheduleState.proGames, ...scheduleState.ncaaGames, ...scheduleState.hsGames]
      for (const pName of priorityPlayers) {
        const playerGames = allAvailableGames.filter((g) => g.playerNames.includes(pName))
        if (playerGames.length === 0) continue // missing schedule already handled above
        const hasDrivable = playerGames.some((g) => {
          if (g.venue.coords.lat === 0 && g.venue.coords.lng === 0) return false
          return estimateDriveMinutes(homeBase, g.venue.coords) <= maxDriveMinutes
        })
        if (!hasDrivable) {
          const driveHours = Math.round(maxDriveMinutes / 60)
          set({ progressDetail: `Heads up: ${pName} has no games within ${driveHours}h drive of ${homeBaseName} — will check fly-in options...` })
          // Brief pause so user sees the warning before heavy computation
          await new Promise((r) => setTimeout(r, 1200))
        }
      }
    }

    const scheduledGames = scheduleState.proGames
    const realNcaaGames = scheduleState.ncaaGames

    // Read custom aliases from schedule store
    const customMlbAliases = scheduleState.customMlbAliases
    const customNcaaAliases = scheduleState.customNcaaAliases

    // Merge scheduled games with spring training + NCAA + HS visit opportunities
    // Only generate ST events for Pro players who don't have real API games yet
    const proPlayersWithRealGames = new Set(
      scheduledGames.flatMap((g) => g.playerNames),
    )
    const stEvents = generateSpringTrainingEvents(
      players.filter((p) => !proPlayersWithRealGames.has(p.playerName)),
      startDate, endDate, customMlbAliases,
    )

    // Use real D1Baseball NCAA schedules if available, otherwise fall back to synthetic
    const ncaaPlayersWithRealSchedules = new Set(
      realNcaaGames.flatMap((g) => g.playerNames),
    )
    const ncaaSyntheticEvents = generateNcaaEvents(
      // Only generate synthetic events for NCAA players WITHOUT real schedules
      players.filter((p) => p.level === 'NCAA' && !ncaaPlayersWithRealSchedules.has(p.playerName)),
      startDate,
      endDate,
      customNcaaAliases,
    )

    // Use real MaxPreps HS schedules if available, otherwise fall back to synthetic
    const realHsGames = scheduleState.hsGames
    const hsPlayersWithRealSchedules = new Set(
      realHsGames.flatMap((g) => g.playerNames),
    )

    // Build HS venue lookup from venue store
    const venueState = useVenueStore.getState().venues
    const hsVenues = new Map<string, { name: string; coords: Coordinates }>()
    for (const [key, v] of Object.entries(venueState)) {
      if (v.source === 'hs-geocoded') {
        const venueKey = key.replace(/^hs-/, '')
        hsVenues.set(venueKey, { name: v.name, coords: v.coords })
      }
    }
    // Only generate synthetic events for HS players WITHOUT real schedules
    const hsSyntheticEvents = generateHsEvents(
      players.filter((p) => p.level === 'HS' && !hsPlayersWithRealSchedules.has(p.playerName)),
      startDate, endDate, hsVenues,
    )

    // Merge all game sources and deduplicate by venue+date+playerSet
    // This prevents synthetic events from duplicating real schedule data
    const rawGames = [...scheduledGames, ...stEvents, ...realNcaaGames, ...ncaaSyntheticEvents, ...realHsGames, ...hsSyntheticEvents]
    const gameMap = new Map<string, typeof rawGames[0]>()
    for (const game of rawGames) {
      // Prefer real (high confidence) games over synthetic ones at same venue+date
      const dedupeKey = `${game.venue.coords.lat.toFixed(4)},${game.venue.coords.lng.toFixed(4)}|${game.date}|${game.playerNames.sort().join(',')}`
      const existing = gameMap.get(dedupeKey)
      if (!existing || (game.confidence === 'high' && existing.confidence !== 'high')) {
        gameMap.set(dedupeKey, game)
      }
    }
    const allGames = [...gameMap.values()]

    // Diagnostic: log HS game counts per player so we can debug "no games in range" issues
    const hsPlayers = players.filter((p) => p.level === 'HS')
    if (hsPlayers.length > 0) {
      const hsInAll = allGames.filter((g) => g.source === 'hs-lookup')
      console.log(`[HS-DEBUG] HS games in allGames: ${hsInAll.length}, realHsGames: ${realHsGames.length}, hsSynthetic: ${hsSyntheticEvents.length}`)
      for (const p of hsPlayers) {
        const playerGames = allGames.filter((g) => g.playerNames.includes(p.playerName))
        const inRange = playerGames.filter((g) => g.date >= startDate && g.date <= endDate)
        if (playerGames.length > 0 || inRange.length === 0) {
          console.log(`[HS-DEBUG] ${p.playerName}: ${playerGames.length} total games, ${inRange.length} in range (${startDate} to ${endDate})${playerGames.length > 0 ? `, dates: ${playerGames[0]!.date} to ${playerGames[playerGames.length - 1]!.date}` : ''}`)
        }
      }
    }

    // Build urgency map from heartbeat data (only when toggle is ON)
    const urgencyMap: UrgencyMap = new Map()
    if (useHeartbeatBoost) {
      const heartbeatState = useHeartbeatStore.getState()
      for (const p of players) {
        const urgency = heartbeatState.getPlayerUrgency(p.playerName)
        if (urgency && urgency.visitUrgencyScore > 0) {
          // Scale: urgencyScore of 50+ gets 2.0x, 25-49 gets 1.5x, below 25 gets 1.25x
          const boost = urgency.visitUrgencyScore >= 50 ? 2.0
            : urgency.visitUrgencyScore >= 25 ? 1.5
            : 1.25
          urgencyMap.set(p.playerName, boost)
        }
      }
    }

    set({ computing: true, tripPlan: null, progressStep: 'Analyzing games...', progressDetail: `${allGames.length} games in date range` })

    // Cancel any in-flight worker
    if (activeWorker) {
      activeWorker.terminate()
      activeWorker = null
    }

    // Convert urgencyMap (Map) to plain Record for worker serialization
    const urgencyRecord: Record<string, number> = {}
    for (const [k, v] of urgencyMap) urgencyRecord[k] = v

    const workerParams: WorkerParams = {
      games: allGames,
      players,
      startDate,
      endDate,
      maxDriveMinutes,
      priorityPlayers,
      urgencyRecord: Object.keys(urgencyRecord).length > 0 ? urgencyRecord : undefined,
      maxFlightHours,
      playerTeamAssignments: scheduleState.playerTeamAssignments,
      homeBase,
      maxTripDays: familyTrip ? 3 : 2,
    }

    const worker = new Worker(
      new URL('../lib/tripEngine.worker.ts', import.meta.url),
      { type: 'module' },
    )
    activeWorker = worker

    worker.postMessage(workerParams)

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        set({ progressStep: msg.step, progressDetail: msg.detail ?? '' })
      } else if (msg.type === 'result') {
        const plan = msg.plan
        // Detect double-up opportunities across all games
        plan.doubleUps = findDoubleUps(allGames, players, startDate, endDate)

        // Prune stale tripStatuses — only keep keys that match current trips
        const currentKeys = new Set(plan.trips.map(getTripKey))
        const oldStatuses = get().tripStatuses
        const prunedStatuses: Record<string, TripStatus> = {}
        for (const [key, status] of Object.entries(oldStatuses)) {
          if (currentKeys.has(key)) prunedStatuses[key] = status
        }

        set({ tripPlan: plan, computing: false, progressStep: '', progressDetail: '', tripStatuses: prunedStatuses })
        worker.terminate()
        activeWorker = null
      } else if (msg.type === 'error') {
        set({
          computing: false,
          progressStep: 'Error',
          progressDetail: msg.message,
        })
        worker.terminate()
        activeWorker = null
      }
    }

    worker.onerror = (e) => {
      set({
        computing: false,
        progressStep: 'Error',
        progressDetail: e.message || 'Worker failed unexpectedly',
      })
      worker.terminate()
      activeWorker = null
    }
  },
}),
    {
      name: 'sv-travel-trips',
      version: 6,
      migrate: (persisted: any) => ({
        // Keep settings, drop computed trip data
        startDate: persisted?.startDate ?? defaultStart(),
        endDate: persisted?.endDate ?? defaultEnd(),
        // v5: bump default drive time from 180 (3h) → 240 (4h).
        // Migrate users who had the old default; keep custom values.
        maxDriveMinutes: persisted?.maxDriveMinutes === 180 ? MAX_DRIVE_MINUTES : (persisted?.maxDriveMinutes ?? MAX_DRIVE_MINUTES),
        maxFlightHours: persisted?.maxFlightHours ?? 4,
        useHeartbeatBoost: persisted?.useHeartbeatBoost ?? false,
        priorityPlayers: persisted?.priorityPlayers ?? [],
        tripStatuses: persisted?.tripStatuses ?? {},
        familyTrip: persisted?.familyTrip ?? false,
        homeBase: persisted?.homeBase ?? DEFAULT_HOME_BASE,
        homeBaseName: persisted?.homeBaseName ?? 'Orlando, FL',
      }),
      partialize: (state) => ({
        // tripPlan is NOT persisted — it's computed data that should be
        // regenerated each session to avoid stale results and schema mismatches
        startDate: state.startDate,
        endDate: state.endDate,
        maxDriveMinutes: state.maxDriveMinutes,
        maxFlightHours: state.maxFlightHours,
        useHeartbeatBoost: state.useHeartbeatBoost,
        familyTrip: state.familyTrip,
        priorityPlayers: state.priorityPlayers,
        tripStatuses: state.tripStatuses,
        homeBase: state.homeBase,
        homeBaseName: state.homeBaseName,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          maxFlightHours: p?.maxFlightHours ?? 8,
          priorityPlayers: p?.priorityPlayers ?? [],
          tripStatuses: p?.tripStatuses ?? {},
          familyTrip: p?.familyTrip ?? false,
          homeBase: p?.homeBase ?? DEFAULT_HOME_BASE,
          homeBaseName: p?.homeBaseName ?? 'Orlando, FL',
          tripPlan: null, // Always start fresh
        }
      },
    },
  ),
)
