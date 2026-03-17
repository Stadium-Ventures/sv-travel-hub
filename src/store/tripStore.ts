import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Coordinates } from '../types/roster'
import type { TripPlan } from '../types/schedule'
import { generateTrips, generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents, MAX_DRIVE_MINUTES } from '../lib/tripEngine'
import { findDoubleUps } from '../lib/doubleUps'
import type { UrgencyMap } from '../lib/tripEngine'
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
  priorityPlayers: string[]
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
  generateTrips: () => Promise<void>
  clearTrips: () => void
  setTripStatus: (tripKey: string, status: TripStatus | null) => void
  setSelectedTripIndex: (index: number | null) => void
}

export const useTripStore = create<TripState>()(
  persist(
    (set, get) => ({
  startDate: defaultStart(),
  endDate: defaultEnd(),
  maxDriveMinutes: MAX_DRIVE_MINUTES,
  maxFlightHours: 4,
  priorityPlayers: [],
  tripPlan: null,
  computing: false,
  progressStep: '',
  progressDetail: '',
  tripStatuses: {},
  selectedTripIndex: null,

  setDateRange: (startDate, endDate) => set({ startDate, endDate }),
  setMaxDriveMinutes: (maxDriveMinutes) => set({ maxDriveMinutes }),
  setMaxFlightHours: (maxFlightHours) => set({ maxFlightHours }),
  setPriorityPlayers: (priorityPlayers) => set({ priorityPlayers }),
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
    const { startDate, endDate, maxDriveMinutes, maxFlightHours, priorityPlayers } = get()
    const players = useRosterStore.getState().players
    let scheduleState = useScheduleStore.getState()

    // Auto-fetch pro schedules if any Pro players exist but pro games haven't been loaded
    const hasProPlayers = players.some((p) => p.level === 'Pro' && p.visitsRemaining > 0)
    if (hasProPlayers && scheduleState.proGames.length === 0 && !scheduleState.schedulesLoading) {
      try {
        // Auto-assign first if no assignments exist
        if (Object.keys(scheduleState.playerTeamAssignments).length === 0) {
          set({ computing: true, tripPlan: null, progressStep: 'Auto-assigning players to teams...', progressDetail: '' })
          await useScheduleStore.getState().autoAssignPlayers()
          scheduleState = useScheduleStore.getState()
        }
        // Fetch pro schedules if assignments now exist
        if (Object.keys(scheduleState.playerTeamAssignments).length > 0) {
          set({ computing: true, tripPlan: null, progressStep: 'Loading Pro schedules...', progressDetail: '' })
          const y = new Date().getFullYear()
          await useScheduleStore.getState().fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
          scheduleState = useScheduleStore.getState()
        }
      } catch (e) {
        console.warn('Pro schedule loading failed, continuing with available data:', e)
      }
    }

    // Auto-fetch NCAA schedules — T1/T2 + priority players only (faster first load)
    const hasNcaaPlayers = players.some((p) => p.level === 'NCAA' && p.visitsRemaining > 0)
    if (hasNcaaPlayers && scheduleState.ncaaGames.length === 0 && !scheduleState.ncaaLoading) {
      try {
        const prioritySet2 = new Set(priorityPlayers)
        const ncaaPlayerOrgs = players
          .filter((p) => p.level === 'NCAA' && p.visitsRemaining > 0 && (p.tier <= 2 || prioritySet2.has(p.playerName)))
          .map((p) => ({ playerName: p.playerName, org: p.org }))
        if (ncaaPlayerOrgs.length > 0) {
          set({ computing: true, tripPlan: null, progressStep: 'Loading College schedules...', progressDetail: `${ncaaPlayerOrgs.length} schools (T1 & T2)` })
          await useScheduleStore.getState().fetchNcaaSchedules(ncaaPlayerOrgs, { merge: true })
          scheduleState = useScheduleStore.getState()
        }
      } catch (e) {
        console.warn('NCAA schedule loading failed, continuing with available data:', e)
      }
    }

    // Auto-geocode HS venues and fetch HS schedules — T1/T2 + priority players only
    const hasHsPlayers = players.some((p) => p.level === 'HS' && p.visitsRemaining > 0)
    if (hasHsPlayers) {
      const prioritySet = new Set(priorityPlayers)
      const venueState = useVenueStore.getState()
      const hsVenueCount = Object.values(venueState.venues).filter((v: any) => v.source === 'hs-geocoded').length
      const hsPlayerList = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0 && (p.tier <= 2 || prioritySet.has(p.playerName)))
      try {
        if (hsVenueCount === 0 && hsPlayerList.length > 0) {
          set({ computing: true, tripPlan: null, progressStep: 'Mapping HS school locations...', progressDetail: `${hsPlayerList.length} schools (T1 & T2)` })
          await useVenueStore.getState().geocodeHsVenues(
            hsPlayerList.map((p) => ({ schoolName: p.org, city: '', state: p.state }))
          )
        }
        if (scheduleState.hsGames.length === 0 && !scheduleState.hsLoading && hsPlayerList.length > 0) {
          set({ computing: true, tripPlan: null, progressStep: 'Loading HS schedules...', progressDetail: `${hsPlayerList.length} schools (T1 & T2)` })
          const hsPlayerOrgs = hsPlayerList.map((p) => ({ playerName: p.playerName, org: p.org, state: p.state }))
          await useScheduleStore.getState().fetchHsSchedules(hsPlayerOrgs, { merge: true })
          scheduleState = useScheduleStore.getState()
        }
      } catch (e) {
        console.warn('HS schedule loading failed, continuing without HS data:', e)
        // Don't block trip generation — HS players will use estimated schedules
      }
    }

    // BLOCK: Refuse to generate if priority player schedule data is missing
    if (priorityPlayers.length > 0) {
      const missingSchedule: string[] = []
      for (const pName of priorityPlayers) {
        const player = players.find((p) => p.playerName === pName)
        if (!player) continue
        if (player.level === 'Pro' && scheduleState.proGames.length === 0) {
          missingSchedule.push(`${pName} (Pro) — schedule data failed to load automatically.`)
        }
        if (player.level === 'NCAA' && scheduleState.ncaaGames.length === 0) {
          missingSchedule.push(`${pName} (NCAA) — college schedule data failed to load automatically.`)
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

    const scheduledGames = scheduleState.proGames
    const realNcaaGames = scheduleState.ncaaGames

    // Read custom aliases from schedule store
    const customMlbAliases = scheduleState.customMlbAliases
    const customNcaaAliases = scheduleState.customNcaaAliases

    // Merge scheduled games with spring training + NCAA + HS visit opportunities
    const stEvents = generateSpringTrainingEvents(players, startDate, endDate, customMlbAliases)

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

    // Build urgency map from heartbeat data
    const urgencyMap: UrgencyMap = new Map()
    const heartbeatState = useHeartbeatStore.getState()
    for (const p of players) {
      const urgency = heartbeatState.getPlayerUrgency(p.playerName)
      if (urgency && urgency.visitUrgencyScore > 0) {
        // Scale: urgencyScore of 50+ gets 1.5x boost, 25-49 gets 1.25x, below 25 gets 1.0x
        const boost = urgency.visitUrgencyScore >= 50 ? 1.5
          : urgency.visitUrgencyScore >= 25 ? 1.25
          : 1.0
        if (boost > 1.0) urgencyMap.set(p.playerName, boost)
      }
    }

    set({ computing: true, tripPlan: null, progressStep: 'Starting...', progressDetail: '' })

    try {
      const plan = await generateTrips(
        allGames,
        players,
        startDate,
        endDate,
        (step, detail) => set({ progressStep: step, progressDetail: detail ?? '' }),
        maxDriveMinutes,
        priorityPlayers,
        urgencyMap.size > 0 ? urgencyMap : undefined,
        maxFlightHours,
        scheduleState.playerTeamAssignments,
      )
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
    } catch (e) {
      set({
        computing: false,
        progressStep: 'Error',
        progressDetail: e instanceof Error ? e.message : 'Trip generation failed',
      })
    }
  },
}),
    {
      name: 'sv-travel-trips',
      version: 4,
      migrate: (persisted: any) => ({
        // Keep settings, drop computed trip data
        startDate: persisted?.startDate ?? defaultStart(),
        endDate: persisted?.endDate ?? defaultEnd(),
        maxDriveMinutes: persisted?.maxDriveMinutes ?? MAX_DRIVE_MINUTES,
        maxFlightHours: persisted?.maxFlightHours ?? 4,
        priorityPlayers: persisted?.priorityPlayers ?? [],
        tripStatuses: persisted?.tripStatuses ?? {},
      }),
      partialize: (state) => ({
        // tripPlan is NOT persisted — it's computed data that should be
        // regenerated each session to avoid stale results and schema mismatches
        startDate: state.startDate,
        endDate: state.endDate,
        maxDriveMinutes: state.maxDriveMinutes,
        maxFlightHours: state.maxFlightHours,
        priorityPlayers: state.priorityPlayers,
        tripStatuses: state.tripStatuses,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        return {
          ...current,
          ...(p ?? {}),
          maxFlightHours: p?.maxFlightHours ?? 8,
          priorityPlayers: p?.priorityPlayers ?? [],
          tripStatuses: p?.tripStatuses ?? {},
          tripPlan: null, // Always start fresh
        }
      },
    },
  ),
)
