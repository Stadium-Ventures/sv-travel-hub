import { useEffect, useMemo, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { isSpringTraining } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason, analyzeBestWeeks, generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents } from '../../lib/tripEngine'
import { resolveMaxPrepsSlug } from '../../lib/maxpreps'
import { resolveNcaaName } from '../../data/aliases'
import { useVenueStore } from '../../store/venueStore'
import type { Coordinates } from '../../types/roster'
import TripCard, { generateItineraryText, buildVenueStops } from './TripCard'
import { generateAllTripsIcs, downloadIcs } from '../../lib/icsExport'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import { getTripKey } from '../../store/tripStore'
import type { TripStatus } from '../../store/tripStore'
import type { RosterPlayer } from '../../types/roster'
import { formatDriveTime, formatTimeAgo, TIER_DOT_COLORS } from '../../lib/formatters'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const LEVEL_ORDER: Record<string, number> = { Pro: 0, NCAA: 1, HS: 2 }
const LEVEL_LABELS: Record<string, string> = { Pro: 'Pro', NCAA: 'College', HS: 'High School' }
const LEVEL_COLORS: Record<string, string> = {
  Pro: 'text-accent-blue',
  NCAA: 'text-accent-green',
  HS: 'text-accent-orange',
}

function PlayerSearchPicker({
  value,
  players,
  excludeName,
  placeholder,
  onChange,
}: {
  value: string
  players: RosterPlayer[]
  excludeName?: string
  placeholder: string
  onChange: (name: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return players
      .filter((p) => p.playerName !== excludeName)
      .filter((p) => !q || p.playerName.toLowerCase().includes(q) || p.org.toLowerCase().includes(q))
      .sort((a, b) => {
        const levelDiff = (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9)
        if (levelDiff !== 0) return levelDiff
        return a.playerName.localeCompare(b.playerName)
      })
  }, [players, excludeName, search])

  // Group by level
  const grouped = useMemo(() => {
    const groups: Array<{ level: string; players: RosterPlayer[] }> = []
    let currentLevel = ''
    for (const p of filtered) {
      if (p.level !== currentLevel) {
        currentLevel = p.level
        groups.push({ level: currentLevel, players: [] })
      }
      groups[groups.length - 1]!.players.push(p)
    }
    return groups
  }, [filtered])

  const selectedPlayer = players.find((p) => p.playerName === value)

  return (
    <div ref={containerRef} className="relative min-w-[220px]">
      {value && selectedPlayer ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5">
          <span className={`h-2 w-2 rounded-full ${TIER_DOT_COLORS[selectedPlayer.tier] ?? 'bg-gray-500'}`} />
          <span className="text-sm text-text">{selectedPlayer.playerName}</span>
          <span className={`text-[10px] ${LEVEL_COLORS[selectedPlayer.level] ?? 'text-text-dim'}`}>{selectedPlayer.level}</span>
          <button
            onClick={() => { onChange(''); setSearch('') }}
            className="ml-auto text-text-dim hover:text-text text-xs"
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-dim/50 focus:border-accent-blue focus:outline-none"
        />
      )}

      {open && !value && (
        <div className="absolute left-0 top-full z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
          {grouped.length === 0 && (
            <p className="px-3 py-2 text-xs text-text-dim">No players match "{search}"</p>
          )}
          {grouped.map((group) => (
            <div key={group.level}>
              <div className={`sticky top-0 bg-gray-950 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${LEVEL_COLORS[group.level] ?? 'text-text-dim'}`}>
                {LEVEL_LABELS[group.level] ?? group.level} ({group.players.length})
              </div>
              {group.players.map((p) => (
                <button
                  key={p.playerName}
                  onClick={() => { onChange(p.playerName); setSearch(''); setOpen(false) }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent-blue/10 transition-colors"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TIER_DOT_COLORS[p.tier] ?? 'bg-gray-500'}`} />
                  <span className="text-text">{p.playerName}</span>
                  <span className="text-[10px] text-text-dim/50">T{p.tier}</span>
                  <span className="ml-auto text-[10px] text-text-dim">{p.org}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function getDayName(dateStr: string): string {
  return DAY_NAMES[new Date(dateStr + 'T12:00:00Z').getUTCDay()]!
}

function getDaysInRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T12:00:00Z')
  const last = new Date(end + 'T12:00:00Z')
  while (cur <= last) {
    days.push(DAY_NAMES[cur.getUTCDay()]!)
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return days
}

const STEPS = [
  { label: 'Load Roster', desc: 'Import players from Google Sheet' },
  { label: 'Load Schedules', desc: 'Pull game schedules from all sources' },
  { label: 'Set Dates', desc: 'Choose your travel window' },
  { label: 'Generate Trips', desc: 'Build optimized trip plans' },
] as const

function WorkflowStepper({ currentStep, allComplete, onAction, step2Synthetic }: {
  currentStep: number
  allComplete: boolean
  onAction?: (step: number) => void
  step2Synthetic?: boolean
}) {
  if (allComplete) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-accent-green/10 px-3 py-2 text-sm text-accent-green">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-green text-[11px] font-bold text-white">&#10003;</span>
        4/4 steps complete — trip plan ready
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isCompleted = i < currentStep
          const isActive = i === currentStep
          const isSyntheticSkip = i === 1 && step2Synthetic && isCompleted
          return (
            <div key={i} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                  isSyntheticSkip
                    ? 'bg-accent-orange text-white'
                    : isCompleted
                      ? 'bg-accent-green text-white'
                      : isActive
                        ? 'bg-accent-blue text-white animate-pulse'
                        : 'bg-gray-800 text-text-dim/50'
                }`}>
                  {isSyntheticSkip ? '~' : isCompleted ? '\u2713' : i + 1}
                </div>
                <span className={`mt-1.5 text-center text-[11px] font-medium ${
                  isSyntheticSkip ? 'text-accent-orange' : isCompleted ? 'text-accent-green' : isActive ? 'text-accent-blue' : 'text-text-dim/50'
                }`}>
                  {step.label}
                </span>
                {isSyntheticSkip && (
                  <span className="mt-0.5 text-center text-[9px] text-accent-orange/70">
                    Using estimates
                  </span>
                )}
                {isActive && onAction && (
                  <button
                    onClick={() => onAction(i)}
                    className="mt-1 rounded-full bg-accent-blue/20 px-2.5 py-0.5 text-[10px] font-medium text-accent-blue hover:bg-accent-blue/30 transition-colors"
                  >
                    {i === 0 ? 'Load Now' : i === 1 ? 'Load Schedules' : i === 2 ? 'Set below ↓' : 'Generate ↓'}
                  </button>
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`mx-2 h-px flex-1 ${isCompleted ? 'bg-accent-green' : 'bg-gray-800'}`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function TripPlanner() {
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const priorityPlayers = useTripStore((s) => s.priorityPlayers)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const computing = useTripStore((s) => s.computing)
  const progressStep = useTripStore((s) => s.progressStep)
  const progressDetail = useTripStore((s) => s.progressDetail)
  const setDateRange = useTripStore((s) => s.setDateRange)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  const maxFlightHours = useTripStore((s) => s.maxFlightHours)
  const setMaxFlightHours = useTripStore((s) => s.setMaxFlightHours)
  const setPriorityPlayers = useTripStore((s) => s.setPriorityPlayers)
  const generateTrips = useTripStore((s) => s.generateTrips)
  const clearTrips = useTripStore((s) => s.clearTrips)
  const tripStatuses = useTripStore((s) => s.tripStatuses)
  const setTripStatus = useTripStore((s) => s.setTripStatus)
  const proGames = useScheduleStore((s) => s.proGames)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)
  const ncaaFetchedAt = useScheduleStore((s) => s.ncaaFetchedAt)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)
  const schedulesProgress = useScheduleStore((s) => s.schedulesProgress)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const ncaaProgress = useScheduleStore((s) => s.ncaaProgress)
  const hsLoading = useScheduleStore((s) => s.hsLoading)
  const hsProgress = useScheduleStore((s) => s.hsProgress)
  const hsFetchedAt = useScheduleStore((s) => s.hsFetchedAt)
  const fetchProSchedules = useScheduleStore((s) => s.fetchProSchedules)
  const fetchNcaaSchedules = useScheduleStore((s) => s.fetchNcaaSchedules)
  const fetchHsSchedules = useScheduleStore((s) => s.fetchHsSchedules)
  const autoAssignPlayers = useScheduleStore((s) => s.autoAssignPlayers)
  const autoAssignLoading = useScheduleStore((s) => s.autoAssignLoading)
  const playerTeamAssignments = useScheduleStore((s) => s.playerTeamAssignments)
  const players = useRosterStore((s) => s.players)
  const rosterLoading = useRosterStore((s) => s.loading)
  const rosterError = useRosterStore((s) => s.error)
  const rosterLastFetched = useRosterStore((s) => s.lastFetchedAt)
  const fetchRoster = useRosterStore((s) => s.fetchRoster)
  const heartbeatPriorities = useHeartbeatStore((s) => s.priorities)
  const heartbeatUrgencyActive = heartbeatPriorities.some((p) => p.visitUrgencyScore >= 25)

  // Auto-load roster if empty on mount (Trip Planner is the default tab)
  const rosterInitialized = useRef(false)
  useEffect(() => {
    if (rosterInitialized.current) return
    if (players.length === 0 && !rosterLoading) {
      rosterInitialized.current = true
      fetchRoster()
    }
  }, [players.length, rosterLoading, fetchRoster])

  const [copiedAll, setCopiedAll] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | TripStatus>('all')
  const [sortBy, setSortBy] = useState<'score' | 'players' | 'drive' | 'date'>('score')
  const [filterHasT1, setFilterHasT1] = useState(false)
  const [filterHasT2, setFilterHasT2] = useState(false)
  const [filterConfirmedOnly, setFilterConfirmedOnly] = useState(false)
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)

  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGamesReal = useScheduleStore((s) => s.hsGames)
  const customMlbAliases = useScheduleStore((s) => s.customMlbAliases)
  const customNcaaAliases = useScheduleStore((s) => s.customNcaaAliases)
  const venueState = useVenueStore((s) => s.venues)
  const geocodeHsVenues = useVenueStore((s) => s.geocodeHsVenues)
  const hsGeocodingProgress = useVenueStore((s) => s.hsGeocodingProgress)
  const hsGeocodingFailedSchools = useVenueStore((s) => s.hsGeocodingFailedSchools)

  // Build player lookup
  const playerMap = useMemo(() => {
    const map = new Map<string, RosterPlayer>()
    for (const p of players) map.set(p.playerName, p)
    return map
  }, [players])

  // Players eligible for priority selection (have visits remaining)
  const eligibleForPriority = useMemo(
    () => players.filter((p) => p.visitsRemaining > 0).sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [players],
  )

  // Best week suggestions — computed on-demand only when user clicks "Suggest"
  const [bestWeeks, setBestWeeks] = useState<ReturnType<typeof analyzeBestWeeks>>([])
  const [bestWeeksLoading, setBestWeeksLoading] = useState(false)
  function computeBestWeeks() {
    if (players.length === 0 || bestWeeksLoading) return
    setBestWeeksLoading(true)
    // Use full season range (Mar–Sep) so suggestions aren't limited to current date selection
    const y = new Date().getFullYear()
    const seasonStart = `${y}-03-01`
    const seasonEnd = `${y}-09-30`
    // Run in next tick to allow UI to show loading state
    setTimeout(() => {
      const stEvents = generateSpringTrainingEvents(players, seasonStart, seasonEnd, customMlbAliases)
      const ncaaPlayersWithReal = new Set(ncaaGames.flatMap((g: { playerNames: string[] }) => g.playerNames))
      const syntheticNcaa = generateNcaaEvents(
        players.filter((p) => p.level === 'NCAA' && !ncaaPlayersWithReal.has(p.playerName)),
        seasonStart, seasonEnd,
        customNcaaAliases,
      )
      const hsPlayersWithReal = new Set(hsGamesReal.flatMap((g: { playerNames: string[] }) => g.playerNames))
      const hsVenues = new Map<string, { name: string; coords: Coordinates }>()
      for (const [key, v] of Object.entries(venueState)) {
        if (v.source === 'hs-geocoded') hsVenues.set(key.replace(/^hs-/, ''), { name: v.name, coords: v.coords })
      }
      const syntheticHs = generateHsEvents(
        players.filter((p) => p.level === 'HS' && !hsPlayersWithReal.has(p.playerName)),
        seasonStart, seasonEnd, hsVenues,
      )
      const allGames = [...proGames, ...stEvents, ...ncaaGames, ...syntheticNcaa, ...hsGamesReal, ...syntheticHs]
      setBestWeeks(analyzeBestWeeks(allGames, players, seasonStart, seasonEnd, maxDriveMinutes))
      setBestWeeksLoading(false)
    }, 0)
  }

  const hasStDates = isSpringTraining(startDate) || isSpringTraining(endDate)
  const hasNcaaDates = isNcaaSeason(startDate) || isNcaaSeason(endDate)
  const hasHsDates = isHsSeason(startDate) || isHsSeason(endDate)
  const hasProPlayers = players.some((p) => p.level === 'Pro' && p.visitsRemaining > 0)
  const hasNcaaPlayers = players.some((p) => p.level === 'NCAA' && p.visitsRemaining > 0)
  const hasHsPlayers = players.some((p) => p.level === 'HS' && p.visitsRemaining > 0)

  // Check if HS players have geocoded venues
  const hsPlayersCount = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0).length
  const hsVenueCount = Object.values(venueState).filter((v) => v.source === 'hs-geocoded').length
  const hsVenueMissing = hasHsPlayers && hsVenueCount === 0

  const hasData = proGames.length > 0
    || (hasStDates && hasProPlayers)
    || (hasNcaaDates && hasNcaaPlayers)
    || (hasHsDates && hasHsPlayers)
  const canGenerate = hasData && players.length > 0 && !computing

  // Data freshness checks
  const proStale = proFetchedAt && (Date.now() - proFetchedAt > 24 * 60 * 60 * 1000)
  const ncaaStale = ncaaFetchedAt && (Date.now() - ncaaFetchedAt > 24 * 60 * 60 * 1000)
  const hsStale = hsFetchedAt && (Date.now() - hsFetchedAt > 24 * 60 * 60 * 1000)
  const showFreshnessWarning = (hasProPlayers && (proStale || !proFetchedAt)) || (hasNcaaPlayers && (ncaaStale || !ncaaFetchedAt)) || (hasHsPlayers && (hsStale || !hsFetchedAt))

  // Tier-based player orgs for loading buttons
  const customNcaaAliasesRef = useScheduleStore((s) => s.customNcaaAliases)
  const ncaaT1T2PlayerOrgs = useMemo(() =>
    players.filter((p) => p.level === 'NCAA' && p.visitsRemaining > 0 && p.tier <= 2)
      .map((p) => ({ playerName: p.playerName, org: p.org })),
    [players],
  )
  const ncaaAllPlayerOrgs = useMemo(() =>
    players.filter((p) => p.level === 'NCAA' && p.visitsRemaining > 0)
      .map((p) => ({ playerName: p.playerName, org: p.org })),
    [players],
  )
  const ncaaT1T2SchoolCount = useMemo(() => {
    const schools = new Set<string>()
    for (const { org } of ncaaT1T2PlayerOrgs) {
      const canonical = resolveNcaaName(org, customNcaaAliasesRef)
      if (canonical) schools.add(canonical)
    }
    return schools.size
  }, [ncaaT1T2PlayerOrgs, customNcaaAliasesRef])
  const ncaaAllSchoolCount = useMemo(() => {
    const schools = new Set<string>()
    for (const { org } of ncaaAllPlayerOrgs) {
      const canonical = resolveNcaaName(org, customNcaaAliasesRef)
      if (canonical) schools.add(canonical)
    }
    return schools.size
  }, [ncaaAllPlayerOrgs, customNcaaAliasesRef])

  const hsT1T2PlayerOrgs = useMemo(() =>
    players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0 && p.tier <= 2)
      .map((p) => ({ playerName: p.playerName, org: p.org, state: p.state })),
    [players],
  )
  const hsAllPlayerOrgs = useMemo(() =>
    players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
      .map((p) => ({ playerName: p.playerName, org: p.org, state: p.state })),
    [players],
  )
  const hsT1T2SchoolCount = useMemo(() => {
    const schools = new Set<string>()
    for (const { org, state } of hsT1T2PlayerOrgs) {
      if (resolveMaxPrepsSlug(org, state)) schools.add(`${org}|${state}`)
    }
    return schools.size
  }, [hsT1T2PlayerOrgs])
  const hsAllSchoolCount = useMemo(() => {
    const schools = new Set<string>()
    for (const { org, state } of hsAllPlayerOrgs) {
      if (resolveMaxPrepsSlug(org, state)) schools.add(`${org}|${state}`)
    }
    return schools.size
  }, [hsAllPlayerOrgs])

  // Workflow stepper — determine current step
  const schedulesActuallyLoaded = !!proFetchedAt || !!ncaaFetchedAt || !!hsFetchedAt
  const stepperStep = players.length === 0 ? 0
    : (!schedulesActuallyLoaded && proGames.length === 0 && !hasStDates && !hasNcaaDates && !hasHsDates) ? 1
    : !tripPlan ? 3
    : 4
  const stepperAllComplete = !!tripPlan
  // Track which steps used synthetic-only data (skipped real schedule loading)
  const step2Synthetic = !schedulesActuallyLoaded && (hasStDates || hasNcaaDates || hasHsDates)

  function handlePriorityChange(slot: 0 | 1, value: string) {
    const next = [...priorityPlayers]
    if (value === '') {
      next.splice(slot, 1)
    } else {
      next[slot] = value
    }
    // Remove duplicates and empty slots
    setPriorityPlayers([...new Set(next.filter(Boolean))])
  }

  const [copyAllError, setCopyAllError] = useState(false)
  const [calAllError, setCalAllError] = useState(false)

  async function handleCopyAllTrips() {
    if (!tripPlan) return
    try {
      const texts: string[] = []
      for (let i = 0; i < tripPlan.trips.length; i++) {
        const trip = tripPlan.trips[i]!
        const stops = buildVenueStops(trip, playerMap)
        texts.push(generateItineraryText(trip, i + 1, stops, playerMap))
      }
      await navigator.clipboard.writeText(texts.join('\n---\n\n'))
      setCopiedAll(true)
      setCopyAllError(false)
      setTimeout(() => setCopiedAll(false), 2000)
    } catch {
      setCopyAllError(true)
      setTimeout(() => setCopyAllError(false), 3000)
    }
  }

  return (
    <div className="space-y-6">
      {/* Workflow stepper */}
      <WorkflowStepper
        currentStep={stepperStep}
        allComplete={stepperAllComplete}
        step2Synthetic={step2Synthetic}
        onAction={(step) => {
          if (step === 0) fetchRoster()
          // Steps 1 and 2 can't be directly triggered from here — user needs to go to Data Setup / adjust dates
          if (step === 3 && canGenerate) generateTrips()
        }}
      />

      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Trip Planner</h2>
        <p className="mb-4 text-xs text-text-dim">
          Builds road trips from Orlando, grouping nearby players together. Trips are scored by how many high-priority players you'd visit. Tuesdays get a bonus because MiLB position players are most accessible. Starting pitchers get a boost when they're probable starters. Sundays are skipped since they're typically travel/rest days. Max 3-day trips.
        </p>

        {/* Data freshness indicators */}
        <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
          <span className={`rounded px-2 py-0.5 ${
            proFetchedAt
              ? proStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
              : 'bg-gray-800 text-text-dim/60'
          }`}>
            Pro games: {proFetchedAt ? `loaded ${formatTimeAgo(proFetchedAt)}` : 'not loaded yet'}
          </span>
          <span className={`rounded px-2 py-0.5 ${
            ncaaFetchedAt
              ? ncaaStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
              : 'bg-gray-800 text-text-dim/60'
          }`}>
            College games: {ncaaFetchedAt ? `loaded ${formatTimeAgo(ncaaFetchedAt)}` : 'not loaded yet'}
          </span>
          {hasHsPlayers && (
            <span className={`rounded px-2 py-0.5 ${
              hsFetchedAt
                ? hsStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
                : 'bg-gray-800 text-text-dim/60'
            }`}>
              HS games: {hsFetchedAt ? `loaded ${formatTimeAgo(hsFetchedAt)}` : 'not loaded yet'}
            </span>
          )}
        </div>

        {showFreshnessWarning && (
          <div className="mb-4 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
            <p className="text-[11px] text-accent-orange">
              {!proFetchedAt && hasProPlayers && 'Pro game schedules haven\'t been loaded yet. '}
              {proStale && 'Pro game data is more than 24 hours old. '}
              {!ncaaFetchedAt && hasNcaaPlayers && 'College game schedules haven\'t been loaded yet (using Tue/Fri/Sat estimates). '}
              {ncaaStale && 'College game data is more than 24 hours old. '}
              {!hsFetchedAt && hasHsPlayers && (hsVenueMissing
                ? 'HS schools need geocoding + schedule loading. '
                : 'HS schedules haven\'t been loaded yet (using Tue/Thu estimates). ')}
              {hsStale && 'HS game data is more than 24 hours old. '}
              Load schedules below to enable trip generation.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* Load All button — fires all pending schedule fetches + geocoding at once */}
              {(() => {
                const needsPro = hasProPlayers && (!proFetchedAt || proStale) && Object.keys(playerTeamAssignments).length > 0
                const needsNcaa = hasNcaaPlayers && (!ncaaFetchedAt || ncaaStale)
                const needsHs = hasHsPlayers && (!hsFetchedAt || hsStale)
                const sectionsNeeded = [needsPro, needsNcaa, needsHs].filter(Boolean).length
                if (sectionsNeeded < 2) return null
                const proTime = needsPro ? Object.keys(playerTeamAssignments).length * 2 : 0
                const ncaaTime = needsNcaa ? ncaaAllSchoolCount * 5 : 0
                const hsGeoTime = needsHs && hsVenueMissing ? hsPlayersCount * 2 : 0
                const hsSchedTime = needsHs ? hsAllSchoolCount * 5 : 0
                const totalTime = proTime + ncaaTime + hsGeoTime + hsSchedTime
                const anyLoading = schedulesLoading || ncaaLoading || hsLoading || !!hsGeocodingProgress
                return (
                  <button
                    onClick={() => {
                      const y = new Date().getFullYear()
                      if (needsPro) fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
                      if (needsNcaa) fetchNcaaSchedules(ncaaAllPlayerOrgs)
                      if (needsHs && hsVenueMissing) {
                        const hsPlayers = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
                        geocodeHsVenues(hsPlayers.map((p) => ({ schoolName: p.org, city: '', state: p.state })))
                      }
                      if (needsHs) fetchHsSchedules(hsAllPlayerOrgs)
                    }}
                    disabled={anyLoading}
                    className="rounded-lg bg-white px-3 py-1 text-[11px] font-medium text-gray-900 hover:bg-gray-200 disabled:opacity-50"
                  >
                    {anyLoading ? 'Loading...' : `Load All Schedules (~${totalTime}s)`}
                  </button>
                )
              })()}
              {hasProPlayers && (!proFetchedAt || proStale) && (
                <>
                  {Object.keys(playerTeamAssignments).length === 0 && (
                    <button
                      onClick={autoAssignPlayers}
                      disabled={autoAssignLoading}
                      className="rounded-lg bg-accent-green px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
                    >
                      {autoAssignLoading ? 'Scanning rosters...' : '1. Auto-Assign Players'}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      const y = new Date().getFullYear()
                      fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
                    }}
                    disabled={schedulesLoading || Object.keys(playerTeamAssignments).length === 0}
                    className="rounded-lg bg-accent-blue px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
                  >
                    {schedulesLoading ? 'Loading...' : Object.keys(playerTeamAssignments).length === 0 ? 'Assign players first' : `${!proFetchedAt ? '' : 'Re'}load Pro Schedules`}
                  </button>
                </>
              )}
              {hasNcaaPlayers && (!ncaaFetchedAt || ncaaStale) && (
                <>
                  {ncaaT1T2SchoolCount > 0 && ncaaT1T2SchoolCount < ncaaAllSchoolCount && (
                    <button
                      onClick={() => fetchNcaaSchedules(ncaaT1T2PlayerOrgs, { merge: true })}
                      disabled={ncaaLoading}
                      className="rounded-lg bg-accent-green px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
                    >
                      {ncaaLoading ? 'Loading...' : `Load College T1&T2 (~${ncaaT1T2SchoolCount * 5}s)`}
                    </button>
                  )}
                  <button
                    onClick={() => fetchNcaaSchedules(ncaaAllPlayerOrgs)}
                    disabled={ncaaLoading}
                    className="rounded-lg bg-accent-green px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-green/80 disabled:opacity-50"
                  >
                    {ncaaLoading ? 'Loading...' : `${!ncaaFetchedAt ? '' : 'Re'}load All College (~${ncaaAllSchoolCount * 5}s)`}
                  </button>
                </>
              )}
              {hasHsPlayers && (!hsFetchedAt || hsStale) && (
                <>
                  {hsVenueMissing && (
                    <button
                      onClick={() => {
                        const hsPlayers = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
                        const schools = hsPlayers.map((p) => ({ schoolName: p.org, city: '', state: p.state }))
                        geocodeHsVenues(schools)
                      }}
                      disabled={!!hsGeocodingProgress}
                      className="rounded-lg bg-accent-orange px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
                    >
                      {hsGeocodingProgress
                        ? `Geocoding... ${hsGeocodingProgress.completed}/${hsGeocodingProgress.total}`
                        : `1. Geocode ${hsPlayersCount} HS Schools (~${hsPlayersCount * 2}s)`}
                    </button>
                  )}
                  {hsT1T2SchoolCount > 0 && hsT1T2SchoolCount < hsAllSchoolCount && (
                    <button
                      onClick={() => fetchHsSchedules(hsT1T2PlayerOrgs, { merge: true })}
                      disabled={hsLoading}
                      className="rounded-lg bg-accent-orange px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
                    >
                      {hsLoading ? 'Loading...' : `${hsVenueMissing ? '2. ' : ''}Load HS T1&T2 (~${hsT1T2SchoolCount * 5}s)`}
                    </button>
                  )}
                  {hsAllSchoolCount > 0 && (
                    <button
                      onClick={() => fetchHsSchedules(hsAllPlayerOrgs)}
                      disabled={hsLoading}
                      className="rounded-lg bg-accent-orange px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
                    >
                      {hsLoading ? 'Loading...' : `${hsVenueMissing ? '2. ' : ''}${!hsFetchedAt ? '' : 'Re'}load All HS (~${hsAllSchoolCount * 5}s)`}
                    </button>
                  )}
                  {hsGeocodingFailedSchools.length > 0 && (
                    <span className="text-[10px] text-accent-red">
                      {hsGeocodingFailedSchools.length} geocode failed
                    </span>
                  )}
                </>
              )}
            </div>
            {/* Loading progress indicators */}
            {(schedulesProgress || ncaaProgress || hsProgress) && (
              <div className="mt-2 space-y-0.5">
                {schedulesProgress && (
                  <div className="text-[10px] text-text-dim">
                    Pro: {schedulesProgress.completed}/{schedulesProgress.total} teams (~{Math.max(0, (schedulesProgress.total - schedulesProgress.completed) * 2)}s remaining)
                  </div>
                )}
                {ncaaProgress && (
                  <div className="text-[10px] text-text-dim">
                    College: {ncaaProgress.completed}/{ncaaProgress.total} schools (~{Math.max(0, (ncaaProgress.total - ncaaProgress.completed) * 5)}s remaining)
                  </div>
                )}
                {hsProgress && (
                  <div className="text-[10px] text-text-dim">
                    HS: {hsProgress.completed}/{hsProgress.total} schools (~{Math.max(0, (hsProgress.total - hsProgress.completed) * 5)}s remaining)
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {hsVenueMissing && !showFreshnessWarning && (
          <div className="mb-4 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5">
            <p className="text-[11px] text-accent-orange">
              {hsPlayersCount} high school player{hsPlayersCount !== 1 ? 's' : ''} found but their school locations haven't been mapped yet.
              Without locations, HS players won't appear in trip results.
            </p>
            <div className="mt-1.5">
              <button
                onClick={() => {
                  const hsPlayers = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
                  const schools = hsPlayers.map((p) => ({ schoolName: p.org, city: '', state: p.state }))
                  geocodeHsVenues(schools)
                }}
                disabled={!!hsGeocodingProgress}
                className="rounded-lg bg-accent-orange px-3 py-1 text-[11px] font-medium text-white hover:bg-accent-orange/80 disabled:opacity-50"
              >
                {hsGeocodingProgress
                  ? `Geocoding... ${hsGeocodingProgress.completed}/${hsGeocodingProgress.total}`
                  : `Geocode ${hsPlayersCount} HS Schools (~${hsPlayersCount * 2}s)`}
              </button>
            </div>
          </div>
        )}

        {/* Roster staleness warning */}
        {rosterLastFetched && (Date.now() - new Date(rosterLastFetched).getTime() > 24 * 60 * 60 * 1000) && (
          <div className="mb-4 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5">
            <p className="text-[11px] text-accent-orange">
              Roster data is more than 24 hours old (loaded {new Date(rosterLastFetched).toLocaleDateString()}).
              <button onClick={fetchRoster} disabled={rosterLoading} className="ml-1 underline hover:no-underline">
                {rosterLoading ? 'Refreshing...' : 'Refresh now'}
              </button>
            </p>
          </div>
        )}

        {/* Roster load error in Trip Planner */}
        {rosterError && players.length === 0 && (
          <div className="mb-4 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2">
            <p className="text-sm text-accent-red">Failed to load roster: {rosterError}</p>
            <button
              onClick={fetchRoster}
              disabled={rosterLoading}
              className="mt-2 rounded-lg bg-accent-blue px-3 py-1 text-xs font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
            >
              {rosterLoading ? 'Retrying...' : 'Retry'}
            </button>
            <p className="mt-1 text-[10px] text-text-dim">Or go to the Roster tab for more details.</p>
          </div>
        )}

        {/* Best week suggestions */}
        {bestWeeks.length > 0 ? (
          <div className="mb-4 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-2">
            <span className="text-xs font-medium text-accent-blue" title="Ranked by how many Tier 1 and Tier 2 players have games that week (full season, all levels)">Best weeks: </span>
            {bestWeeks.map((w, i) => {
              const s = new Date(w.weekStart + 'T12:00:00Z')
              const e = new Date(w.weekEnd + 'T12:00:00Z')
              const label = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][s.getUTCMonth()]} ${s.getUTCDate()}–${e.getUTCDate()}`
              return (
                <span key={i}>
                  {i > 0 && <span className="text-text-dim/40 mx-1">·</span>}
                  <button
                    onClick={() => setDateRange(w.weekStart, w.weekEnd)}
                    className="text-xs text-accent-blue hover:underline"
                  >
                    {label} ({w.t1Count} T1, {w.t2Count} T2)
                  </button>
                </span>
              )
            })}
          </div>
        ) : players.length > 0 && (
          <div className="mb-4">
            <button
              onClick={computeBestWeeks}
              disabled={bestWeeksLoading}
              className="rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-3 py-1.5 text-xs font-medium text-accent-blue hover:bg-accent-blue/20 disabled:opacity-50"
            >
              {bestWeeksLoading ? 'Analyzing...' : 'Suggest Best Travel Weeks'}
            </button>
          </div>
        )}

        {/* Quick date presets */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-text-dim">Quick:</span>
          <button
            onClick={() => {
              const now = new Date()
              // Start of this week (Monday)
              const day = now.getDay()
              const diffToMon = day === 0 ? -6 : 1 - day
              const mon = new Date(now)
              mon.setDate(now.getDate() + diffToMon)
              const sat = new Date(mon)
              sat.setDate(mon.getDate() + 5)
              setDateRange(mon.toISOString().split('T')[0]!, sat.toISOString().split('T')[0]!)
            }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            This week
          </button>
          <button
            onClick={() => {
              const now = new Date()
              const day = now.getDay()
              const diffToNextMon = day === 0 ? 1 : 8 - day
              const mon = new Date(now)
              mon.setDate(now.getDate() + diffToNextMon)
              const sat = new Date(mon)
              sat.setDate(mon.getDate() + 5)
              setDateRange(mon.toISOString().split('T')[0]!, sat.toISOString().split('T')[0]!)
            }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            Next week
          </button>
          <button
            onClick={() => { const y = new Date().getFullYear(); setDateRange(`${y}-03-01`, `${y}-06-15`) }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            Spring (Mar–Jun)
          </button>
          <button
            onClick={() => { const y = new Date().getFullYear(); setDateRange(`${y}-03-01`, `${y}-09-30`) }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            Full Season
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-text-dim">Start Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(e) => setDateRange(e.target.value, endDate)}
                className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
              />
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                {getDayName(startDate)}
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">End Date</label>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setDateRange(startDate, e.target.value)}
                className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
              />
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                {getDayName(endDate)}
              </span>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">
              Max Drive: {Math.floor(maxDriveMinutes / 60)}h{maxDriveMinutes % 60 > 0 ? ` ${maxDriveMinutes % 60}m` : ''}
            </label>
            <input
              type="range"
              min={120}
              max={300}
              step={15}
              value={maxDriveMinutes}
              onChange={(e) => setMaxDriveMinutes(parseInt(e.target.value))}
              className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
            />
            <p className="mt-0.5 text-[9px] text-text-dim/50" title="Drive times are rough estimates based on straight-line distance with a 30% detour factor at ~55 mph average. Actual times vary with traffic and route.">
              {maxDriveMinutes <= 150 ? 'Covers central FL' : maxDriveMinutes <= 210 ? 'Reaches Tampa, Jacksonville, Port St. Lucie' : maxDriveMinutes <= 270 ? 'Reaches Tallahassee, South FL' : 'Reaches most of FL + southern GA'}
              {' · estimates only'}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">
              Max Flight: {maxFlightHours}h
            </label>
            <input
              type="range"
              min={3}
              max={12}
              step={0.5}
              value={maxFlightHours}
              onChange={(e) => setMaxFlightHours(parseFloat(e.target.value))}
              className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
            />
            <p className="mt-0.5 text-[9px] text-text-dim/50" title="Total travel time including airport overhead and flight. Filters fly-in visit options beyond this threshold.">
              {maxFlightHours <= 4 ? 'Southeast US only' : maxFlightHours <= 6 ? 'Reaches Midwest, Northeast' : maxFlightHours <= 8 ? 'Most domestic destinations' : maxFlightHours <= 10 ? 'Coast-to-coast + Hawaii' : 'All domestic + nearby international'}
            </p>
          </div>
          {startDate > endDate && (
            <p className="self-center text-xs text-accent-red">End date is before start date</p>
          )}
          <button
            onClick={generateTrips}
            disabled={!canGenerate || startDate > endDate}
            className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
          >
            {computing ? 'Computing...' : 'Generate Trips'}
          </button>
          {tripPlan && (
            <button
              onClick={clearTrips}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-dim hover:text-text hover:bg-gray-800 transition-colors"
            >
              Clear Results
            </button>
          )}
        </div>
        {heartbeatUrgencyActive && (
          <p className="text-[10px] text-accent-blue" title="Players with high visit urgency from SV Heartbeat get a scoring boost so they appear in higher-ranked trips.">
            Heartbeat urgency data active — overdue clients get boosted in trip scoring
          </p>
        )}

        {/* Day-of-week strip */}
        <DayStrip startDate={startDate} endDate={endDate} />

        {/* Priority players */}
        <div className="mt-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority Players <span className="text-text-dim/50">(optional — build first trip around these players)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <PlayerSearchPicker
              value={priorityPlayers[0] ?? ''}
              players={eligibleForPriority}
              excludeName={priorityPlayers[1]}
              placeholder="Type to search player 1..."
              onChange={(name) => handlePriorityChange(0, name)}
            />
            <PlayerSearchPicker
              value={priorityPlayers[1] ?? ''}
              players={eligibleForPriority}
              excludeName={priorityPlayers[0]}
              placeholder="Type to search player 2..."
              onChange={(name) => handlePriorityChange(1, name)}
            />
            {priorityPlayers.length > 0 && (
              <button
                onClick={() => setPriorityPlayers([])}
                className="rounded-lg px-2 py-1 text-xs text-text-dim hover:text-text"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {!canGenerate && !computing && (
          <p className="mt-3 text-xs text-accent-orange">
            {players.length === 0
              ? 'Load the roster first.'
              : 'No games found in the selected date range. Try adjusting dates to cover a season — Spring Training: Feb 15–Mar 28, College: Feb 14–Jun 15, High School: Feb 14–May 15. For Pro regular season games, load schedules on the Data Setup tab first.'}
          </p>
        )}

        {canGenerate && proGames.length === 0 && (
          <p className="mt-3 text-xs text-accent-green">
            {[
              hasStDates && hasProPlayers ? 'Spring training (Pro)' : '',
              hasNcaaDates && hasNcaaPlayers ? 'College season' : '',
              hasHsDates && hasHsPlayers ? 'High school season' : '',
            ].filter(Boolean).join(', ')} data available — trips can be generated now.
            {hasProPlayers && ' For exact Pro regular season schedules, load game data on the Data Setup tab.'}
          </p>
        )}

        {computing && (
          <div className="mt-4 rounded-lg border border-border/50 bg-gray-950 p-3">
            <div className="flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
              <span className="text-sm font-medium text-text">{progressStep}</span>
            </div>
            {progressDetail && <p className="mt-1 text-xs text-text-dim">{progressDetail}</p>}
          </div>
        )}
      </div>

      {/* Results */}
      {tripPlan && (
        <>
          {/* Priority player results */}
          {tripPlan.priorityResults && tripPlan.priorityResults.length > 0 && (
            <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4">
              <h3 className="mb-2 text-sm font-semibold text-accent-blue">Priority Player Results</h3>
              <div className="space-y-1.5">
                {tripPlan.priorityResults.map((r) => (
                  <div key={r.playerName} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 rounded-full ${
                      r.status === 'included' ? 'bg-accent-green' :
                      r.status === 'separate-trip' ? 'bg-accent-orange' :
                      r.status === 'fly-in-only' ? 'bg-accent-blue' :
                      'bg-accent-red'
                    }`} />
                    <span className="font-medium text-text">{r.playerName}</span>
                    <span className="text-xs text-text-dim">
                      {r.status === 'included' && 'Included in Trip #1'}
                      {r.status === 'separate-trip' && 'Separate trip created'}
                      {r.status === 'fly-in-only' && 'Fly-in only'}
                      {r.status === 'unreachable' && 'Could not be reached'}
                    </span>
                    {r.reason && (
                      <span className="text-[11px] text-accent-orange">— {r.reason}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coverage stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatCard label="Road Trips" value={tripPlan.trips.length} />
            <div title="Total player-visit appearances across all trips. T1 players can appear in up to 5 trips, T2 in 3, T3 in 2 — matching their visit targets.">
              <StatCard label="Visits Planned" value={tripPlan.totalVisitsPlanned ?? tripPlan.totalVisitsCovered} accent="blue" />
            </div>
            <StatCard label="Fly-in Visits" value={tripPlan.flyInVisits.length} />
            <div title={`Percentage of players with visits remaining (${players.filter((p) => p.visitsRemaining > 0).length} total) that appear in at least one generated trip. Does not count players with zero visits remaining.`}>
              <StatCard label="Players Reached" value={`${tripPlan.coveragePercent}%`} accent={tripPlan.coveragePercent >= 70 ? 'green' : 'orange'} />
            </div>
            {(() => {
              const beyondCount = tripPlan.unvisitablePlayers.filter((e) => e.reason.startsWith('Beyond max flight')).length
              const noGameCount = tripPlan.unvisitablePlayers.length - beyondCount
              return (
                <>
                  {beyondCount > 0 && (
                    <div title="Players with games beyond the max flight setting — increase the slider to include them.">
                      <StatCard label="Beyond Flight" value={beyondCount} accent="orange" />
                    </div>
                  )}
                  <div title="Players who need visits but have zero game events in the selected date range.">
                    <StatCard label="No Games Found" value={noGameCount} accent={noGameCount > 0 ? 'red' : 'green'} />
                  </div>
                </>
              )
            })()}
          </div>

          {/* Analysis summary */}
          <div className="rounded-lg bg-gray-950/40 px-3 py-2 text-[11px] text-text-dim">
            Analyzed {tripPlan.analyzedEventCount} game events for {players.filter((p) => p.visitsRemaining > 0).length} players in the selected date range.
            {tripPlan.skippedPlayers.length > 0 && (
              <span className="ml-1">
                {tripPlan.skippedPlayers.length} player{tripPlan.skippedPlayers.length !== 1 ? 's' : ''} skipped: {tripPlan.skippedPlayers.map((p) => `${p.name} (${p.reason})`).join(', ')}.
              </span>
            )}
          </div>

          {/* Zero road trips explanation */}
          {tripPlan.trips.length === 0 && tripPlan.flyInVisits.length > 0 && (
            <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-4 py-3">
              <p className="text-sm text-accent-orange">
                No road trips possible — all players with games are beyond the {Math.floor(maxDriveMinutes / 60)}h drive radius from Orlando.
                See fly-in options below, or increase the max drive time.
              </p>
            </div>
          )}

          {/* Road trip cards */}
          {tripPlan.trips.length > 0 && (() => {
            // Tag each trip with its original index before filtering/sorting
            let indexedTrips = tripPlan.trips.map((t, i) => ({ trip: t, originalIndex: i + 1 }))

            if (statusFilter !== 'all') {
              indexedTrips = indexedTrips.filter(({ trip: t }) => tripStatuses[getTripKey(t)] === statusFilter)
            }
            if (filterHasT1) {
              indexedTrips = indexedTrips.filter(({ trip: t }) => {
                const allNames = [
                  ...t.anchorGame.playerNames,
                  ...t.nearbyGames.flatMap((g) => g.playerNames),
                ]
                return allNames.some((n) => playerMap.get(n)?.tier === 1)
              })
            }
            if (filterHasT2) {
              indexedTrips = indexedTrips.filter(({ trip: t }) => {
                const allNames = [
                  ...t.anchorGame.playerNames,
                  ...t.nearbyGames.flatMap((g) => g.playerNames),
                ]
                return allNames.some((n) => playerMap.get(n)?.tier === 2)
              })
            }
            if (filterConfirmedOnly) {
              indexedTrips = indexedTrips.filter(({ trip: t }) => {
                return t.anchorGame.source === 'mlb-api' || (t.anchorGame.confidence === 'high')
              })
            }

            // Apply sort — use scoreBreakdown.finalScore (displayed value) for consistency
            indexedTrips.sort((a, b) => {
              if (sortBy === 'score') return (b.trip.scoreBreakdown?.finalScore ?? b.trip.visitValue) - (a.trip.scoreBreakdown?.finalScore ?? a.trip.visitValue)
              if (sortBy === 'players') return b.trip.totalPlayersVisited - a.trip.totalPlayersVisited
              if (sortBy === 'drive') return a.trip.totalDriveMinutes - b.trip.totalDriveMinutes
              if (sortBy === 'date') return a.trip.anchorGame.date.localeCompare(b.trip.anchorGame.date)
              return 0
            })

            const filteredTrips = indexedTrips.map(({ trip }) => trip)

            return (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text">
                    Road Trips
                    <span className="ml-2 text-xs font-normal text-text-dim">
                      Drivable from Orlando within {Math.floor(maxDriveMinutes / 60)}h{maxDriveMinutes % 60 > 0 ? ` ${maxDriveMinutes % 60}m` : ''} radius
                    </span>
                  </h3>
                  <p className="text-[10px] text-text-dim/60">
                    Score = T1 (5pts) + T2 (3pts) + T3 (1pt) per visit remaining · Thu anchor +20%
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyAllTrips}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors"
                  >
                    {copiedAll ? 'Copied!' : copyAllError ? 'Copy Failed' : 'Copy All Trips'}
                  </button>
                  <button
                    onClick={() => {
                      try {
                        const ics = generateAllTripsIcs(tripPlan.trips, playerMap)
                        downloadIcs(ics, 'sv-travel-trips.ics')
                        setCalAllError(false)
                      } catch {
                        setCalAllError(true)
                        setTimeout(() => setCalAllError(false), 3000)
                      }
                    }}
                    className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors"
                    title="Download all trips as a calendar file you can import into Google Calendar, Outlook, etc."
                  >
                    {calAllError ? 'Export Failed' : 'Export to Calendar'}
                  </button>
                </div>
              </div>

              {/* Sort & filter toolbar — sticky */}
              <div className="sticky top-0 z-10 -mx-5 mb-3 rounded-b-lg bg-surface px-5 pb-2 pt-2 border-b border-border/30">
              <div className="flex flex-wrap items-center gap-2">
                {/* Sort */}
                <span className="text-[11px] text-text-dim" title="Score = tier weight × visits remaining per player. T1=5pts, T2=3pts, T3=1pt. Tuesday anchor +20%. Pitcher match +50%.">Sort:</span>
                {([
                  { key: 'score', label: 'Score' },
                  { key: 'players', label: 'Players' },
                  { key: 'drive', label: 'Drive Time' },
                  { key: 'date', label: 'Date' },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      sortBy === key ? 'bg-accent-blue/20 text-accent-blue' : 'bg-gray-800/50 text-text-dim hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}

                <span className="mx-1 text-text-dim/30">|</span>

                {/* Filters */}
                <button
                  onClick={() => setFilterHasT1(!filterHasT1)}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    filterHasT1 ? 'bg-accent-red/20 text-accent-red' : 'bg-gray-800/50 text-text-dim hover:text-text'
                  }`}
                >
                  Has T1
                </button>
                <button
                  onClick={() => setFilterHasT2(!filterHasT2)}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    filterHasT2 ? 'bg-accent-orange/20 text-accent-orange' : 'bg-gray-800/50 text-text-dim hover:text-text'
                  }`}
                >
                  Has T2
                </button>
                <button
                  onClick={() => setFilterConfirmedOnly(!filterConfirmedOnly)}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    filterConfirmedOnly ? 'bg-accent-green/20 text-accent-green' : 'bg-gray-800/50 text-text-dim hover:text-text'
                  }`}
                  title="Only show trips where the main stop has a confirmed game from an official schedule"
                >
                  Confirmed Main Stop
                </button>
              </div>

              {/* Status filter pills */}
              <div className="mb-3 flex items-center gap-2">
                {(['all', 'planned', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      statusFilter === f
                        ? f === 'planned' ? 'bg-accent-blue/20 text-accent-blue' : f === 'completed' ? 'bg-accent-green/20 text-accent-green' : 'bg-gray-700 text-text'
                        : 'bg-gray-800/50 text-text-dim hover:text-text'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'planned' ? 'Planned' : 'Completed'}
                  </button>
                ))}
                <span className="text-[11px] text-text-dim">
                  Showing {filteredTrips.length} of {tripPlan.trips.length} trips
                </span>
              </div>
              </div>

              <div className="space-y-4">
                {indexedTrips.map(({ trip, originalIndex }, i) => (
                  <TripCard key={`trip-${originalIndex}`} trip={trip} index={originalIndex} playerMap={playerMap} defaultExpanded={i === 0 && statusFilter === 'all' && !filterHasT1 && !filterHasT2} onPlayerClick={setSelectedPlayer} />
                ))}
                {filteredTrips.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">No trips match the selected filters.</p>
                )}
              </div>
            </div>
            )
          })()}

          {/* Overlap warning with comparison */}
          {tripPlan.trips.length > 1 && (() => {
            const overlaps: Array<{ tripA: number; tripB: number; dates: string[]; uniqueA: string[]; uniqueB: string[]; shared: string[] }> = []
            for (let a = 0; a < tripPlan.trips.length; a++) {
              for (let b = a + 1; b < tripPlan.trips.length; b++) {
                const daysA = new Set(tripPlan.trips[a]!.suggestedDays)
                const sharedDates = tripPlan.trips[b]!.suggestedDays.filter((d) => daysA.has(d))
                if (sharedDates.length > 0) {
                  // Compare players between the two trips
                  const playersA = new Set([
                    ...tripPlan.trips[a]!.anchorGame.playerNames,
                    ...tripPlan.trips[a]!.nearbyGames.flatMap((g) => g.playerNames),
                  ])
                  const playersB = new Set([
                    ...tripPlan.trips[b]!.anchorGame.playerNames,
                    ...tripPlan.trips[b]!.nearbyGames.flatMap((g) => g.playerNames),
                  ])
                  const shared = [...playersA].filter((n) => playersB.has(n))
                  const uniqueA = [...playersA].filter((n) => !playersB.has(n))
                  const uniqueB = [...playersB].filter((n) => !playersA.has(n))
                  overlaps.push({ tripA: a + 1, tripB: b + 1, dates: sharedDates, uniqueA, uniqueB, shared })
                }
              }
            }
            if (overlaps.length === 0) return null
            return (
              <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-4">
                <h3 className="mb-1 text-sm font-semibold text-accent-orange">Trip Date Overlaps</h3>
                <p className="mb-3 text-[11px] text-text-dim">These trips share dates — you can only take one per time slot. Mark the one you want as "Planned" above.</p>
                <div className="space-y-4">
                  {overlaps.map((o, i) => {
                    const tripAKey = getTripKey(tripPlan.trips[o.tripA - 1]!)
                    const tripBKey = getTripKey(tripPlan.trips[o.tripB - 1]!)
                    const tripAStatus = tripStatuses[tripAKey]
                    const tripBStatus = tripStatuses[tripBKey]
                    return (
                    <div key={i} className="rounded-lg border border-border/30 bg-gray-950/30 p-3">
                      <p className="mb-2 text-xs text-text-dim">
                        <span className="font-medium text-accent-orange">Trips #{o.tripA} and #{o.tripB}</span> overlap on{' '}
                        {o.dates.map((d) => {
                          const dt = new Date(d + 'T12:00:00Z')
                          return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()]} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getUTCMonth()]} ${dt.getUTCDate()}`
                        }).join(', ')}
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="mb-1 font-medium text-accent-blue">Only in #{o.tripA}</p>
                          {o.uniqueA.length > 0 ? o.uniqueA.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(T${p.tier})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-text-dim">Shared</p>
                          {o.shared.length > 0 ? o.shared.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(T${p.tier})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-accent-green">Only in #{o.tripB}</p>
                          {o.uniqueB.length > 0 ? o.uniqueB.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(T${p.tier})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => { setTripStatus(tripAKey, 'planned'); setTripStatus(tripBKey, null) }}
                          className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                            tripAStatus === 'planned'
                              ? 'bg-accent-blue text-white'
                              : 'border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10'
                          }`}
                        >
                          {tripAStatus === 'planned' ? `✓ Trip #${o.tripA} chosen` : `Choose Trip #${o.tripA}`}
                        </button>
                        <button
                          onClick={() => { setTripStatus(tripBKey, 'planned'); setTripStatus(tripAKey, null) }}
                          className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                            tripBStatus === 'planned'
                              ? 'bg-accent-green text-white'
                              : 'border border-accent-green/30 text-accent-green hover:bg-accent-green/10'
                          }`}
                        >
                          {tripBStatus === 'planned' ? `✓ Trip #${o.tripB} chosen` : `Choose Trip #${o.tripB}`}
                        </button>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Near-misses */}
          {tripPlan.nearMisses && tripPlan.nearMisses.length > 0 && (
            <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-5">
              <h3 className="mb-2 text-sm font-semibold text-yellow-400">
                Near Misses
                <span className="ml-2 text-xs font-normal text-text-dim">
                  Extend drive to also reach these players
                </span>
              </h3>
              <div className="space-y-1.5">
                {tripPlan.nearMisses.map((nm, i) => {
                  const player = playerMap.get(nm.playerName)
                  const tier = player?.tier ?? 4
                  const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                  return (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                      <span className="font-medium text-text cursor-pointer hover:text-yellow-400 transition-colors" onClick={() => setSelectedPlayer(nm.playerName)}>{nm.playerName}</span>
                      <span className="text-xs text-text-dim">T{tier}</span>
                      <span className="text-xs text-text-dim">@ {nm.venue}</span>
                      <span className="ml-auto text-xs text-yellow-400">
                        +{nm.overBy}m over limit ({formatDriveTime(nm.driveMinutes)} drive)
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Fly-in visits */}
          {tripPlan.flyInVisits.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-purple-400">
                Fly-in Visits
                <span className="ml-2 text-xs font-normal text-text-dim">
                  Beyond driving range — requires flight
                </span>
              </h3>
              <p className="mb-3 text-xs text-text-dim">
                These players have games outside driving radius. Estimated travel includes flight + airport + rental car.
              </p>
              <div className="space-y-2">
                {tripPlan.flyInVisits.map((visit, i) => {
                  // Derive org label for fly-in
                  const firstPlayer = players.find((p) => visit.playerNames.includes(p.playerName))
                  let orgLabel = ''
                  if (visit.source === 'hs-lookup' && firstPlayer) {
                    orgLabel = `${firstPlayer.org}, ${firstPlayer.state}`
                  } else if (visit.source === 'ncaa-lookup' && firstPlayer) {
                    orgLabel = firstPlayer.org
                  } else if (visit.source === 'mlb-api' && firstPlayer) {
                    orgLabel = firstPlayer.org
                  }

                  return (
                    <div key={i} className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {orgLabel && orgLabel !== visit.venue.name ? (
                              <>
                                <span className="text-sm font-medium text-text">{orgLabel}</span>
                                <span className="text-xs text-text-dim">— {visit.venue.name}</span>
                              </>
                            ) : (
                              <span className="text-sm font-medium text-text">{visit.venue.name}</span>
                            )}
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              visit.source === 'mlb-api'
                                ? visit.isHome ? 'bg-accent-green/15 text-accent-green' : 'bg-purple-500/15 text-purple-400'
                                : (visit.source === 'hs-lookup' && visit.confidence === 'high')
                                  ? 'bg-accent-green/15 text-accent-green'
                                  : (visit.source === 'ncaa-lookup' && visit.confidence === 'high')
                                    ? 'bg-accent-green/15 text-accent-green'
                                    : 'bg-accent-orange/15 text-accent-orange'
                            }`}>
                              {visit.source === 'mlb-api'
                                ? (visit.isHome ? 'Home Game' : 'Away Game')
                                : visit.source === 'hs-lookup' && visit.confidence === 'high'
                                  ? 'Home Game (MaxPreps)'
                                  : visit.source === 'ncaa-lookup' && visit.confidence === 'high'
                                    ? 'School Visit (D1Baseball)'
                                    : 'School Visit (est.)'}
                            </span>
                            {visit.sourceUrl && (
                              <a
                                href={visit.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-dim hover:text-purple-400 transition-colors"
                                title="Verify this game on the source schedule"
                              >
                                {`Verify \u2197`}
                              </a>
                            )}
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {visit.playerNames.map((name) => {
                              const player = playerMap.get(name)
                              const tier = player?.tier ?? 4
                              const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                              return (
                                <span
                                  key={name}
                                  className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-text cursor-pointer hover:bg-accent-blue/10"
                                  onClick={() => setSelectedPlayer(name)}
                                >
                                  <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} title={`Tier ${tier}`} />
                                  {name}
                                  <span className="text-text-dim/60">T{tier}</span>
                                </span>
                              )
                            })}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {visit.visitValue > 0 && (
                            <>
                              <p className="text-lg font-bold text-purple-400">{visit.visitValue}</p>
                              {visit.scoreBreakdown && (
                                <p className="text-[10px] text-text-dim">
                                  {[
                                    visit.scoreBreakdown.tier1Count > 0 && `${visit.scoreBreakdown.tier1Count}×T1`,
                                    visit.scoreBreakdown.tier2Count > 0 && `${visit.scoreBreakdown.tier2Count}×T2`,
                                    visit.scoreBreakdown.tier3Count > 0 && `${visit.scoreBreakdown.tier3Count}×T3`,
                                  ].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </>
                          )}
                          <p className="text-sm font-medium text-purple-400">
                            ~{visit.estimatedTravelHours}h travel
                          </p>
                          <p className="text-[11px] text-text-dim">
                            {Math.round(visit.distanceKm * 0.621).toLocaleString()} mi
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Truly unreachable players (no games at all) — with reasons */}
          {(() => {
            const beyondFlight = tripPlan.unvisitablePlayers.filter((e) => e.reason.startsWith('Beyond max flight'))
            const noGames = tripPlan.unvisitablePlayers.filter((e) => !e.reason.startsWith('Beyond max flight'))
            return (
              <>
                {beyondFlight.length > 0 && (
                  <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-5">
                    <h3 className="mb-2 text-sm font-semibold text-accent-orange">
                      Beyond Max Flight ({beyondFlight.length})
                    </h3>
                    <p className="mb-3 text-xs text-text-dim">
                      These players have games but they're beyond the {maxFlightHours}h max flight setting. Increase the Max Flight slider to include them.
                    </p>
                    <div className="space-y-1.5">
                      {beyondFlight.map((entry) => {
                        const player = playerMap.get(entry.name)
                        const tier = player?.tier ?? 4
                        const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                        return (
                          <div key={entry.name} className="flex items-center gap-2 text-sm">
                            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                            <span className="font-medium text-accent-orange cursor-pointer hover:underline" onClick={() => setSelectedPlayer(entry.name)}>{entry.name}</span>
                            <span className="text-xs text-text-dim">T{tier}</span>
                            <span className="text-xs text-text-dim/70">— {entry.reason}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {noGames.length > 0 && (
                  <div className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-5">
                    <h3 className="mb-2 text-sm font-semibold text-accent-red">
                      No Games Found ({noGames.length})
                    </h3>
                    <p className="mb-3 text-xs text-text-dim">
                      No visit opportunities found for these players in the selected date range.
                    </p>
                    <div className="space-y-1.5">
                      {noGames.map((entry) => {
                        const player = playerMap.get(entry.name)
                        const tier = player?.tier ?? 4
                        const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                        return (
                          <div key={entry.name} className="flex items-center gap-2 text-sm">
                            <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                            <span className="font-medium text-accent-red cursor-pointer hover:underline" onClick={() => setSelectedPlayer(entry.name)}>{entry.name}</span>
                            <span className="text-xs text-text-dim">T{tier}</span>
                            <span className="text-xs text-text-dim/70">— {entry.reason}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )
          })()}

          {tripPlan.trips.length === 0 && tripPlan.flyInVisits.length === 0 && (
            <div className="rounded-xl border border-border bg-surface p-10 text-center">
              <p className="text-text-dim">No trips could be generated for the selected date range.</p>
              <p className="mt-1 text-xs text-text-dim/60">Try expanding the date range or assigning more players.</p>
            </div>
          )}
        </>
      )}

      {/* Player schedule drill-down panel */}
      {selectedPlayer && (
        <PlayerSchedulePanel
          playerName={selectedPlayer}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  const accentColor =
    accent === 'green' ? 'text-accent-green' :
    accent === 'blue' ? 'text-accent-blue' :
    accent === 'orange' ? 'text-accent-orange' :
    accent === 'red' ? 'text-accent-red' :
    'text-text'

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium text-text-dim">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentColor}`}>{value}</p>
    </div>
  )
}

function DayStrip({ startDate, endDate }: { startDate: string; endDate: string }) {
  const daysInRange = getDaysInRange(startDate, endDate)
  const dayCount = daysInRange.length

  if (dayCount < 1 || dayCount > 14) return null

  // Count occurrences of each day
  const dayCounts = new Map<string, number>()
  for (const d of daysInRange) {
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1)
  }

  const hasSunday = dayCounts.has('Sun')
  const hasTuesday = dayCounts.has('Tue')

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
      <div className="flex items-center gap-1">
        {DAY_NAMES.map((day) => {
          const inRange = dayCounts.has(day)
          const isSunday = day === 'Sun'
          const isTuesday = day === 'Tue'

          return (
            <span
              key={day}
              className={`flex h-7 w-8 items-center justify-center rounded text-[11px] font-medium ${
                !inRange
                  ? 'text-text-dim/20'
                  : isSunday
                    ? 'bg-accent-red/15 text-accent-red line-through'
                    : isTuesday
                      ? 'bg-accent-blue/15 text-accent-blue'
                      : 'bg-gray-800 text-text-dim'
              }`}
            >
              {day}
            </span>
          )
        })}
      </div>
      <span className="text-[11px] text-text-dim/60">
        {dayCount} day{dayCount !== 1 ? 's' : ''}
        {hasTuesday && ' · Tue preferred'}
        {hasSunday && ' · Sun blacked out'}
      </span>
    </div>
  )
}
