import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Coordinates } from '../types/roster'
import type { TripPlan } from '../types/schedule'
import { generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents, MAX_DRIVE_MINUTES, estimateDriveMinutes, DEFAULT_HOME_BASE } from '../lib/tripEngine'
import { findDoubleUps } from '../lib/doubleUps'
import { debugLog } from '../lib/debugLog'
import type { UrgencyMap } from '../lib/tripEngine'
import type { WorkerParams, WorkerMessage } from '../lib/tripEngine.worker'
import { useRosterStore } from './rosterStore'
import { useScheduleStore } from './scheduleStore'
import { useVenueStore } from './venueStore'
import { useHeartbeatStore } from './heartbeatStore'
import { useSummerStore } from './summerStore'
import { isInSummerWindow } from '../data/summerLeagues'

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
  maxNights: number
  homeBase: Coordinates
  homeBaseName: string
  tripPlan: TripPlan | null
  computing: boolean
  progressStep: string
  progressDetail: string
  tripStatuses: Record<string, TripStatus>
  /** Kent-favorited trips, keyed by getTripKey(trip). Persisted so
   *  starring survives regenerations and sessions. */
  starredTrips: Record<string, boolean>
  selectedTripIndex: number | null // For map preview highlighting

  setDateRange: (start: string, end: string) => void
  setMaxDriveMinutes: (minutes: number) => void
  setMaxFlightHours: (hours: number) => void
  setPriorityPlayers: (players: string[]) => void
  setHomeBase: (coords: Coordinates, name: string) => void
  setMaxNights: (n: number) => void
  generateTrips: () => Promise<void>
  clearTrips: () => void
  setTripStatus: (tripKey: string, status: TripStatus | null) => void
  toggleTripStar: (tripKey: string) => void
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
  maxNights: 2,
  homeBase: DEFAULT_HOME_BASE,
  homeBaseName: 'Orlando, FL',
  tripPlan: null,
  computing: false,
  progressStep: '',
  progressDetail: '',
  tripStatuses: {},
  starredTrips: {},
  selectedTripIndex: null,

  setDateRange: (startDate, endDate) => set({ startDate, endDate }),
  setMaxDriveMinutes: (maxDriveMinutes) => set({ maxDriveMinutes }),
  setMaxFlightHours: (maxFlightHours) => set({ maxFlightHours }),
  setUseHeartbeatBoost: (useHeartbeatBoost: boolean) => set({ useHeartbeatBoost }),
  setPriorityPlayers: (priorityPlayers) => set({ priorityPlayers }),
  setHomeBase: (homeBase, homeBaseName) => set({ homeBase, homeBaseName }),
  setMaxNights: (maxNights: number) => set({ maxNights }),
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
  toggleTripStar: (tripKey) => set((state) => {
    const next = { ...state.starredTrips }
    if (next[tripKey]) delete next[tripKey]
    else next[tripKey] = true
    return { starredTrips: next }
  }),

  generateTrips: async () => {
    if (get().computing) return
    const { startDate, endDate, maxDriveMinutes, maxFlightHours, priorityPlayers, useHeartbeatBoost, homeBase, homeBaseName, maxNights } = get()
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

    // Pull in summer-league games if the date window overlaps summer. Most
    // SV-relevant summer schedules (CCBL, MLB Draft League) come straight from
    // the MLB Stats API; PrestoSports leagues will join later.
    const summerStore = useSummerStore.getState()
    const summerInRange = (() => {
      try {
        return isInSummerWindow(new Date(startDate)) || isInSummerWindow(new Date(endDate))
      } catch { return false }
    })()
    if (summerInRange && summerStore.assignments.length > 0 && summerStore.summerGames.length === 0) {
      // Don't await — let the trip computation kick off; summer games will
      // appear on the next Generate Trips press. We only block on the first
      // load when there are zero summer games but assignments exist.
      await summerStore.loadSchedules(startDate, endDate)
    }
    const summerGames = useSummerStore.getState().summerGames

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

    // During summer, an NCAA player's summer-team games should replace their
    // (essentially absent) college games. Filter out synthetic NCAA events for
    // any player who has an active summer assignment.
    const summerByPlayer = useSummerStore.getState().byPlayer
    const ncaaSyntheticFiltered = ncaaSyntheticEvents
      .map((g) => {
        const kept = g.playerNames.filter((n) => !summerByPlayer[n]?.active)
        if (kept.length === 0) return null
        if (kept.length === g.playerNames.length) return g
        return { ...g, playerNames: kept }
      })
      .filter((g): g is typeof ncaaSyntheticEvents[number] => g !== null)

    // Merge all game sources and deduplicate by venue+date+playerSet
    // This prevents synthetic events from duplicating real schedule data
    const rawGames = [...scheduledGames, ...stEvents, ...realNcaaGames, ...ncaaSyntheticFiltered, ...realHsGames, ...hsSyntheticEvents, ...summerGames]
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
      debugLog(`[HS-DEBUG] HS games in allGames: ${hsInAll.length}, realHsGames: ${realHsGames.length}, hsSynthetic: ${hsSyntheticEvents.length}`)
      for (const p of hsPlayers) {
        const playerGames = allGames.filter((g) => g.playerNames.includes(p.playerName))
        const inRange = playerGames.filter((g) => g.date >= startDate && g.date <= endDate)
        if (playerGames.length > 0 || inRange.length === 0) {
          debugLog(`[HS-DEBUG] ${p.playerName}: ${playerGames.length} total games, ${inRange.length} in range (${startDate} to ${endDate})${playerGames.length > 0 ? `, dates: ${playerGames[0]!.date} to ${playerGames[playerGames.length - 1]!.date}` : ''}`)
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

    // Cross-agent visit coverage — if another SV agent already has a planned
    // visit to a player within the trip window, down-weight that player so
    // the engine doesn't recommend Tom double up. Always applied (not gated
    // on useHeartbeatBoost) because Kent specifically asked for this.
    {
      const heartbeatState = useHeartbeatStore.getState()
      for (const p of players) {
        const vc = heartbeatState.getVisitCount(p.playerName)
        const planned = vc?.nextPlannedDate
        if (!planned) continue
        // Only count if the planned visit falls inside (or within 14d of) the trip window
        const plannedISO = planned.length > 10 ? planned.slice(0, 10) : planned
        if (plannedISO < startDate) continue
        // Noon-UTC parse + UTC date math — new Date('YYYY-MM-DD') parses as
        // UTC midnight, so local setDate/toISOString shifted a day in some TZs
        const windowEnd = new Date(endDate + 'T12:00:00Z')
        windowEnd.setUTCDate(windowEnd.getUTCDate() + 14)
        const windowEndISO = windowEnd.toISOString().split('T')[0]!
        if (plannedISO > windowEndISO) continue
        // Multiply existing urgency by 0.4 (or set to 0.4 if no entry yet).
        // 0.4 = noticeable de-prioritization without zeroing out — if Mike
        // cancels his visit, this player still shows up in trip generation.
        const existing = urgencyMap.get(p.playerName) ?? 1.0
        urgencyMap.set(p.playerName, existing * 0.4)
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
      maxTripDays: maxNights + 1,
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
      // v7: reset every user's home base back to Orlando, FL — Kent (primary
      // user) lives there, so it's the right default. Previously each user's
      // session held their last picked city forever via localStorage, which
      // meant Kent's session was stuck on whatever I last tested with.
      version: 7,
      migrate: (persisted: any) => ({
        startDate: persisted?.startDate ?? defaultStart(),
        endDate: persisted?.endDate ?? defaultEnd(),
        maxDriveMinutes: persisted?.maxDriveMinutes === 180 ? MAX_DRIVE_MINUTES : (persisted?.maxDriveMinutes ?? MAX_DRIVE_MINUTES),
        maxFlightHours: persisted?.maxFlightHours ?? 4,
        useHeartbeatBoost: persisted?.useHeartbeatBoost ?? false,
        priorityPlayers: persisted?.priorityPlayers ?? [],
        tripStatuses: persisted?.tripStatuses ?? {},
        starredTrips: persisted?.starredTrips ?? {},
        maxNights: persisted?.maxNights ?? 2,
        // v7 reset: force-overwrite home base to the Orlando default. Keeps
        // the user free to pick a different city per session, but stops the
        // old stuck value from re-loading on every visit.
        homeBase: DEFAULT_HOME_BASE,
        homeBaseName: 'Orlando, FL',
      }),
      partialize: (state) => ({
        // tripPlan is NOT persisted — it's computed data that should be
        // regenerated each session to avoid stale results and schema mismatches
        startDate: state.startDate,
        endDate: state.endDate,
        maxDriveMinutes: state.maxDriveMinutes,
        maxFlightHours: state.maxFlightHours,
        useHeartbeatBoost: state.useHeartbeatBoost,
        maxNights: state.maxNights,
        priorityPlayers: state.priorityPlayers,
        tripStatuses: state.tripStatuses,
        starredTrips: state.starredTrips,
        homeBase: state.homeBase,
        homeBaseName: state.homeBaseName,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          maxFlightHours: p?.maxFlightHours ?? 4, // match initial state + migrate default
          priorityPlayers: p?.priorityPlayers ?? [],
          tripStatuses: p?.tripStatuses ?? {},
          starredTrips: p?.starredTrips ?? {},
          maxNights: p?.maxNights ?? 2,
          homeBase: p?.homeBase ?? DEFAULT_HOME_BASE,
          homeBaseName: p?.homeBaseName ?? 'Orlando, FL',
          tripPlan: null, // Always start fresh
        }
      },
    },
  ),
)
