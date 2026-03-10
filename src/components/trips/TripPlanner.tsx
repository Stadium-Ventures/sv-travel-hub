import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { isSpringTraining } from '../../data/springTraining'
import { isNcaaSeason, isHsSeason } from '../../lib/tripEngine'
import { resolveMaxPrepsSlug } from '../../lib/maxpreps'
import { resolveNcaaName } from '../../data/aliases'
import { useVenueStore } from '../../store/venueStore'
import TripCard, { generateItineraryText, buildVenueStops, MarkVisitedChip } from './TripCard'
import { clearScheduleCaches } from '../../lib/cacheUtils'
import { generateAllTripsIcs, downloadIcs } from '../../lib/icsExport'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import { getTripKey } from '../../store/tripStore'
import type { TripStatus } from '../../store/tripStore'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, formatTimeAgo, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'

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
  const autoAssignResult = useScheduleStore((s) => s.autoAssignResult)
  const assignmentLog = useScheduleStore((s) => s.assignmentLog) ?? []
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
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score')
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)

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
  // bestWeeks removed — trip planner generates for the dates selected

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
  const [copiedFlyIn, setCopiedFlyIn] = useState<string | null>(null)
  const flyInLimit = 10 // Hard cap on fly-in results
  const [showOverlaps, setShowOverlaps] = useState(false)

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

  // Compute whether priority player is fly-in only — controls section ordering
  const priorityIsFlyIn = tripPlan?.priorityResults?.some((r) => r.status === 'fly-in-only') ?? false

  // Pre-compute fly-in section so it can be rendered in reordered position
  const flyInSection = tripPlan && tripPlan.flyInVisits.length > 0 ? (() => {
    const sortedVisits = [...tripPlan.flyInVisits].sort((a, b) => {
      const aHasPriority = a.playerNames.some((n) => priorityPlayers.includes(n)) ? 1 : 0
      const bHasPriority = b.playerNames.some((n) => priorityPlayers.includes(n)) ? 1 : 0
      if (aHasPriority !== bHasPriority) return bHasPriority - aHasPriority
      return b.visitValue - a.visitValue
    })
    const visibleVisits = sortedVisits.slice(0, flyInLimit)
    const totalCount = sortedVisits.length

    return (
      <div id="section-fly-in">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-purple-400">
              Fly-in Visits
              <span className="ml-2 text-xs font-normal text-text-dim">
                Beyond driving range — requires flight
              </span>
            </h3>
            <p className="text-[10px] text-text-dim/60">
              Estimated travel = flight + 1h airport + ground transport
            </p>
          </div>
          {totalCount > flyInLimit && (
            <span className="text-[11px] text-text-dim">
              Top {flyInLimit} of {totalCount}
            </span>
          )}
        </div>
        <div className="space-y-4">
          {visibleVisits.map((visit, i) => (
            <FlyInCard
              key={i}
              visit={visit}
              index={i + 1}
              players={players}
              playerMap={playerMap}
              priorityPlayers={priorityPlayers}
              tripStatuses={tripStatuses}
              setTripStatus={setTripStatus}
              copiedFlyIn={copiedFlyIn}
              setCopiedFlyIn={setCopiedFlyIn}
              onPlayerClick={setSelectedPlayer}
              defaultExpanded={i === 0}
            />
          ))}
        </div>
      </div>
    )
  })() : null

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
        <p className="mb-2 text-xs text-text-dim">
          Builds road trips from Orlando, grouping nearby players together. Trips are ranked by how many high-priority players you'd visit.
        </p>
        <details className="mb-4">
          <summary className="cursor-pointer text-[11px] text-text-dim/60 hover:text-text-dim">How scoring works</summary>
          <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-[11px] text-text-dim">
            <li><strong>Must-see (Tier 1)</strong> = 5 pts per visit remaining</li>
            <li><strong>High priority (Tier 2)</strong> = 3 pts per visit remaining</li>
            <li><strong>Standard (Tier 3)</strong> = 1 pt per visit remaining</li>
            <li><strong>Tuesday bonus</strong> — +20% because MiLB position players are most accessible on Tuesdays</li>
            <li><strong>Pitcher start bonus</strong> — extra points when a starting pitcher you follow is scheduled to pitch</li>
            <li><strong>Sundays skipped</strong> — typically travel/rest days</li>
            <li><strong>Max 3-day trips</strong></li>
          </ul>
        </details>

        {/* Data freshness indicators */}
        <div className="mb-4 flex flex-wrap gap-2 text-[11px]">
          <span className={`rounded px-2 py-0.5 ${
            proFetchedAt
              ? proStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
              : 'bg-gray-800 text-text-dim/60'
          }`}>
            Pro games: {proFetchedAt ? `loaded ${formatTimeAgo(proFetchedAt)}${proStale ? ' — may be outdated' : ''}` : 'not loaded yet'}
          </span>
          <span className={`rounded px-2 py-0.5 ${
            ncaaFetchedAt
              ? ncaaStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
              : 'bg-gray-800 text-text-dim/60'
          }`}>
            College games: {ncaaFetchedAt ? `loaded ${formatTimeAgo(ncaaFetchedAt)}${ncaaStale ? ' — may be outdated' : ''}` : 'not loaded yet'}
          </span>
          {hasHsPlayers && (
            <span className={`rounded px-2 py-0.5 ${
              hsFetchedAt
                ? hsStale ? 'bg-accent-orange/10 text-accent-orange' : 'bg-accent-green/10 text-accent-green'
                : 'bg-gray-800 text-text-dim/60'
            }`}>
              HS games: {hsFetchedAt ? `loaded ${formatTimeAgo(hsFetchedAt)}${hsStale ? ' — may be outdated' : ''}` : 'not loaded yet'}
            </span>
          )}
        </div>

        {showFreshnessWarning && (
          <div className="mb-4 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
            <p className="text-[11px] text-accent-orange">
              {!proFetchedAt && hasProPlayers && 'Pro game schedules haven\'t been loaded yet. '}
              {proStale && 'Pro game data is more than 24 hours old. '}
              {!ncaaFetchedAt && hasNcaaPlayers && 'College game schedules haven\'t been loaded yet (using estimated game days until real schedules are loaded). '}
              {ncaaStale && 'College game data is more than 24 hours old. '}
              {!hsFetchedAt && hasHsPlayers && (hsVenueMissing
                ? 'HS school locations haven\'t been mapped yet. '
                : 'HS schedules haven\'t been loaded yet (using estimated game days until real schedules are loaded). ')}
              {hsStale && 'HS game data is more than 24 hours old. '}
              Load schedules below to enable trip generation.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {/* Load All button — fires all pending schedule fetches + geocoding at once */}
              {(() => {
                const needsPro = hasProPlayers && (!proFetchedAt || proStale)
                const needsNcaa = hasNcaaPlayers && (!ncaaFetchedAt || ncaaStale)
                const needsHs = hasHsPlayers && (!hsFetchedAt || hsStale)
                const sectionsNeeded = [needsPro, needsNcaa, needsHs].filter(Boolean).length
                if (sectionsNeeded === 0) return null
                const proTime = needsPro ? Math.max(Object.keys(playerTeamAssignments).length, players.filter(p => p.level === 'Pro').length) * 2 : 0
                const ncaaTime = needsNcaa ? ncaaAllSchoolCount * 5 : 0
                const hsGeoTime = needsHs && hsVenueMissing ? hsPlayersCount * 2 : 0
                const hsSchedTime = needsHs ? hsAllSchoolCount * 5 : 0
                const totalTime = proTime + ncaaTime + hsGeoTime + hsSchedTime
                const anyLoading = schedulesLoading || ncaaLoading || hsLoading || !!hsGeocodingProgress || autoAssignLoading
                return (
                  <button
                    onClick={async () => {
                      const y = new Date().getFullYear()
                      if (needsPro) {
                        // Auto-assign players to teams first if needed
                        if (Object.keys(useScheduleStore.getState().playerTeamAssignments).length === 0) {
                          await autoAssignPlayers()
                        }
                        // Now fetch pro schedules (assignments should exist)
                        if (Object.keys(useScheduleStore.getState().playerTeamAssignments).length > 0) {
                          fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
                        }
                      }
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
                      {autoAssignLoading ? 'Scanning rosters...' : '1. Match Players to Teams'}
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
                    {schedulesLoading ? 'Loading...' : Object.keys(playerTeamAssignments).length === 0 ? 'Match players to teams first' : `${!proFetchedAt ? '' : 'Re'}load Pro Schedules`}
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
                        ? `Mapping... ${hsGeocodingProgress.completed}/${hsGeocodingProgress.total}`
                        : `1. Map ${hsPlayersCount} HS School Locations (~${hsPlayersCount * 2}s)`}
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
                      {hsGeocodingFailedSchools.length} school location(s) not found
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
                  ? `Mapping... ${hsGeocodingProgress.completed}/${hsGeocodingProgress.total}`
                  : `Map ${hsPlayersCount} HS School Locations (~${hsPlayersCount * 2}s)`}
              </button>
            </div>
          </div>
        )}

        {/* Roster & assignment status */}
        {rosterLastFetched && (
          <div className={`mb-4 rounded-lg border px-3 py-1.5 ${
            Date.now() - new Date(rosterLastFetched).getTime() > 24 * 60 * 60 * 1000
              ? 'border-accent-orange/20 bg-accent-orange/5'
              : 'border-border/30 bg-surface'
          }`}>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-text-dim">
                <span className="font-medium text-text">Roster:</span>{' '}
                {formatTimeAgo(new Date(rosterLastFetched).getTime())}
                {Date.now() - new Date(rosterLastFetched).getTime() > 24 * 60 * 60 * 1000 && (
                  <span className="ml-1 text-accent-orange">(stale)</span>
                )}
                {autoAssignResult && autoAssignResult.assigned > 0 && (
                  <span className="ml-2 text-accent-green">· {autoAssignResult.assigned} players auto-assigned</span>
                )}
                {autoAssignResult && autoAssignResult.notFound.length > 0 && (
                  <span className="ml-2 text-accent-orange">· {autoAssignResult.notFound.length} not found on MLB rosters</span>
                )}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchRoster}
                  disabled={rosterLoading}
                  className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-text-dim hover:text-text hover:bg-gray-700 disabled:opacity-50"
                >
                  {rosterLoading ? 'Refreshing...' : 'Refresh Roster'}
                </button>
                <button
                  onClick={autoAssignPlayers}
                  disabled={autoAssignLoading || players.length === 0}
                  className="rounded bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-text-dim hover:text-text hover:bg-gray-700 disabled:opacity-50"
                  title="Re-check MLB rosters for player assignments (trades, promotions, demotions)"
                >
                  {autoAssignLoading ? 'Checking...' : 'Check Roster Moves'}
                </button>
                <button
                  onClick={() => { clearScheduleCaches(); window.location.reload() }}
                  className="rounded bg-accent-orange/20 px-2 py-0.5 text-[10px] font-medium text-accent-orange hover:bg-accent-orange/30 transition-colors"
                  title="Clears cached schedule data (D1Baseball, MaxPreps, geocoding) and reloads the page. Use this if trip results look stale or wrong."
                >
                  Clear Cache &amp; Reload
                </button>
              </div>
            </div>
            <p className="mt-0.5 text-[9px] text-text-dim/50">
              Refresh Roster pulls the Google Sheet. Check Roster Moves re-queries MLB rosters. Clear Cache forces fresh schedule data.
            </p>
            {/* Show recent assignment changes */}
            {assignmentLog.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] text-text-dim hover:text-text">
                  {assignmentLog.length} recent assignment change{assignmentLog.length !== 1 ? 's' : ''}
                </summary>
                <div className="mt-1 max-h-24 overflow-y-auto text-[10px]">
                  {assignmentLog.slice(-10).reverse().map((entry, i) => (
                    <p key={i} className={`leading-snug ${
                      entry.action === 'reassigned' ? 'text-accent-blue' :
                      entry.action === 'not-found' ? 'text-accent-orange' :
                      'text-text-dim'
                    }`}>
                      {entry.action === 'assigned' && `✓ ${entry.playerName} → ${entry.to}`}
                      {entry.action === 'reassigned' && `↻ ${entry.playerName}: ${entry.from} → ${entry.to}`}
                      {entry.action === 'not-found' && `? ${entry.playerName}: not found on any roster`}
                      {entry.action === 'name-matched' && `≈ ${entry.playerName} → ${entry.to} (name match)`}
                      {entry.action === 'fallback' && `↓ ${entry.playerName} → ${entry.to} (org fallback)`}
                    </p>
                  ))}
                </div>
              </details>
            )}
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
            <p className="mt-0.5 text-[9px] text-text-dim/50" title="Drive times are rough estimates — actual times depend on traffic and route">
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
            <p className="mt-0.5 text-[9px] text-text-dim/50" title="Total travel time including airport time and flight. Options beyond this limit won't be shown.">
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
          <p className="text-[10px] text-accent-blue" title="Players overdue for visits (from Heartbeat data) get ranked higher in trip results">
            Heartbeat urgency data active — overdue clients get boosted in trip scoring
          </p>
        )}

        {/* DayStrip removed — days are shown in trip cards */}

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

        {/* Warning: priority player's schedule data not loaded */}
        {priorityPlayers.length > 0 && (() => {
          const missingData: string[] = []
          for (const name of priorityPlayers) {
            const player = players.find((p) => p.playerName === name)
            if (!player) continue
            if (player.level === 'Pro' && proGames.length === 0) {
              missingData.push(`${name} is a Pro player but Pro schedules aren't loaded yet`)
            }
          }
          if (missingData.length === 0) return null
          return (
            <div className="mt-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2">
              <p className="text-xs font-medium text-accent-red">Missing data for your priority player:</p>
              {missingData.map((msg, i) => (
                <p key={i} className="text-xs text-accent-red/80 mt-0.5">{msg}</p>
              ))}
              <p className="text-[10px] text-text-dim mt-1">
                Click "Generate Trips" anyway — it will auto-load Pro schedules first. Or use the Load buttons above.
              </p>
            </div>
          )
        })()}
        {canGenerate && proGames.length === 0 && priorityPlayers.every(n => {
          const p = players.find(pl => pl.playerName === n)
          return !p || p.level !== 'Pro'
        }) && (
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

        {/* Blocked / Error state — shown when generation was refused or failed */}
        {!computing && !tripPlan && (progressStep === 'Blocked' || progressStep === 'Error') && (
          <div className="mt-4 rounded-lg border border-accent-red/50 bg-accent-red/10 p-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">⛔</span>
              <span className="text-sm font-semibold text-accent-red">{progressStep === 'Blocked' ? 'Trip Generation Blocked' : 'Trip Generation Failed'}</span>
            </div>
            {progressDetail && (
              <p className="mt-2 text-sm text-text-dim whitespace-pre-line">{progressDetail}</p>
            )}
            <p className="mt-3 text-xs text-text-dim">
              Make sure all schedule data is loaded before generating trips. Go to the <strong>Player Setup</strong> tab to load schedules.
            </p>
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
              <div className="space-y-3">
                {tripPlan.priorityResults.map((r) => {
                  // Find best fly-in visit for fly-in-only priority players
                  const bestFlyIn = r.status === 'fly-in-only'
                    ? tripPlan.flyInVisits.find((v) => v.playerNames.includes(r.playerName))
                    : null
                  return (
                    <div key={r.playerName}>
                      <div className="flex items-center gap-2 text-sm">
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
                          {r.status === 'fly-in-only' && 'Fly-in required'}
                          {r.status === 'unreachable' && 'Could not be reached'}
                        </span>
                        {r.status === 'unreachable' && r.reason && (
                          <span className="text-[11px] text-accent-orange">— {r.reason}</span>
                        )}
                      </div>
                      {bestFlyIn && (
                        <div className="ml-4 mt-1.5 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-medium text-accent-blue">Best fly-in:</span>
                            <span className="text-text">{bestFlyIn.venue.name}</span>
                            <span className="text-text-dim">~{bestFlyIn.estimatedTravelHours}h travel</span>
                            <span className="text-text-dim">{bestFlyIn.distanceKm} mi</span>
                          </div>
                          <div className="mt-1 text-[11px] text-text-dim">
                            {bestFlyIn.dates.slice(0, 5).map((d) => {
                              const dt = new Date(d + 'T12:00:00Z')
                              return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()]} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getUTCMonth()]} ${dt.getUTCDate()}`
                            }).join(', ')}
                            {bestFlyIn.dates.length > 5 && ` +${bestFlyIn.dates.length - 5} more`}
                          </div>
                          {bestFlyIn.sourceUrl && (
                            <a href={bestFlyIn.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[11px] text-accent-blue hover:underline">
                              Verify schedule ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Coverage stats */}
          {(() => {
            const beyondPlayers = tripPlan.unvisitablePlayers.filter((e) => e.reason.startsWith('Beyond max flight'))
            // Collect all player names that appear in road trips
            const roadTripPlayerNames = [...new Set(tripPlan.trips.flatMap((t) => [
              ...t.anchorGame.playerNames,
              ...t.nearbyGames.flatMap((g) => g.playerNames),
            ]))]
            // Collect fly-in player names
            const flyInPlayerNames = [...new Set(tripPlan.flyInVisits.flatMap((v) => v.playerNames))]
            // Unique players across ALL trip types
            const allTripPlayerNames = [...new Set([...roadTripPlayerNames, ...flyInPlayerNames])]
            const totalEligible = players.filter((p) => p.visitsRemaining > 0).length

            return (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard label="Road Trips" value={tripPlan.trips.length} scrollTo="section-road-trips" hoverNames={roadTripPlayerNames} />
              <div title={`${allTripPlayerNames.length} of your ${totalEligible} players appear in at least one trip option.`}>
                <StatCard label="Players in Trips" value={allTripPlayerNames.length} accent="blue" scrollTo="section-road-trips" hoverNames={allTripPlayerNames} />
              </div>
              <StatCard label="Fly-in Visits" value={tripPlan.flyInVisits.length} scrollTo="section-fly-in" hoverNames={flyInPlayerNames} />
              <div title={`What percentage of players who still need visits appear in at least one trip`}>
                <StatCard label="Players Reached" value={`${tripPlan.coveragePercent}%`} accent={tripPlan.coveragePercent >= 70 ? 'green' : 'orange'} />
              </div>
              {beyondPlayers.length > 0 && (
                <StatCard label="Beyond Flight" value={beyondPlayers.length} accent="orange" scrollTo="section-beyond-flight" hoverNames={beyondPlayers.map((e) => e.name)} />
              )}
            </div>
            )
          })()}

          {/* Priority player status — the most important thing */}
          {priorityPlayers.length > 0 && (() => {
            // Sort trips same way as card list so trip numbers match
            const sorted = [...tripPlan.trips].sort((a, b) => {
              if (sortBy === 'score') return (b.scoreBreakdown?.finalScore ?? b.visitValue) - (a.scoreBreakdown?.finalScore ?? a.visitValue)
              if (sortBy === 'date') return a.anchorGame.date.localeCompare(b.anchorGame.date)
              return 0
            })
            const prioInRoad = priorityPlayers.filter((n) =>
              sorted.some((t) => t.anchorGame.playerNames.includes(n) || t.nearbyGames.some((g) => g.playerNames.includes(n)))
            )
            const prioInFlyIn = priorityPlayers.filter((n) =>
              !prioInRoad.includes(n) && tripPlan.flyInVisits.some((v) => v.playerNames.includes(n))
            )
            const prioMissing = priorityPlayers.filter((n) => !prioInRoad.includes(n) && !prioInFlyIn.includes(n))
            return (
              <div className={`rounded-lg px-3 py-2 ${prioMissing.length > 0 ? 'bg-accent-red/10 border border-accent-red/30' : 'bg-accent-green/10 border border-accent-green/30'}`}>
                <p className="text-sm font-medium">
                  {prioMissing.length > 0
                    ? <span className="text-accent-red">Priority player {prioMissing.join(', ')} not found in any trip option</span>
                    : <span className="text-accent-green">
                        {prioInRoad.map((n) => {
                          const idx = sorted.findIndex((t) => t.anchorGame.playerNames.includes(n) || t.nearbyGames.some((g) => g.playerNames.includes(n)))
                          return `${n} → Trip #${idx + 1}`
                        }).join(' · ')}
                        {prioInFlyIn.length > 0 && ` · ${prioInFlyIn.join(', ')} → Fly-in`}
                      </span>
                  }
                </p>
              </div>
            )
          })()}

          {/* Priority player's BEST fly-in — shown before road trips when priority is fly-in-only */}
          {priorityIsFlyIn && tripPlan.flyInVisits.length > 0 && (() => {
            // Show only the priority player's best fly-in option here
            const priorityFlyIn = tripPlan.flyInVisits.find((v) =>
              v.playerNames.some((n) => priorityPlayers.includes(n))
            )
            if (!priorityFlyIn) return null
            return (
              <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
                <h3 className="mb-2 text-sm font-semibold text-purple-400">
                  Best Fly-in for Priority Player
                </h3>
                <FlyInCard
                  visit={priorityFlyIn}
                  index={1}
                  players={players}
                  playerMap={playerMap}
                  priorityPlayers={priorityPlayers}
                  tripStatuses={tripStatuses}
                  setTripStatus={setTripStatus}
                  copiedFlyIn={copiedFlyIn}
                  setCopiedFlyIn={setCopiedFlyIn}
                  onPlayerClick={setSelectedPlayer}
                  defaultExpanded
                />
              </div>
            )
          })()}

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
            let trips = [...tripPlan.trips]

            if (statusFilter !== 'all') {
              trips = trips.filter((t) => tripStatuses[getTripKey(t)] === statusFilter)
            }

            trips.sort((a, b) => {
              if (sortBy === 'score') return (b.scoreBreakdown?.finalScore ?? b.visitValue) - (a.scoreBreakdown?.finalScore ?? a.visitValue)
              if (sortBy === 'date') return a.anchorGame.date.localeCompare(b.anchorGame.date)
              return 0
            })

            // Number trips sequentially after sorting — #1 is always the best
            const indexedTrips = trips.map((trip, i) => ({ trip, displayIndex: i + 1 }))

            return (
            <div id="section-road-trips">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text">
                    Road Trips
                    <span className="ml-2 text-xs font-normal text-text-dim">
                      within {Math.floor(maxDriveMinutes / 60)}h drive of Orlando
                    </span>
                  </h3>
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

              {/* Compact toolbar */}
              <div className="sticky top-0 z-10 -mx-5 mb-3 flex items-center gap-3 rounded-b-lg bg-surface px-5 pb-2 pt-2 border-b border-border/30">
                <span className="text-[11px] text-text-dim">Sort:</span>
                {([
                  { key: 'score', label: 'Best' },
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
                {(['all', 'planned', 'completed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      statusFilter === f
                        ? f === 'planned' ? 'bg-accent-blue/20 text-accent-blue' : f === 'completed' ? 'bg-accent-green/20 text-accent-green' : 'bg-gray-700 text-text'
                        : 'bg-gray-800/50 text-text-dim hover:text-text'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'planned' ? 'Planned' : 'Completed'}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                {indexedTrips.map(({ trip, displayIndex }, i) => (
                  <TripCard key={`trip-${getTripKey(trip)}`} trip={trip} index={displayIndex} playerMap={playerMap} defaultExpanded={i === 0 && statusFilter === 'all'} onPlayerClick={setSelectedPlayer} />
                ))}
                {trips.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">No trips match the selected filters.</p>
                )}
              </div>
            </div>
            )
          })()}

          {/* Overlap warning — uses sorted trip order so numbers match cards above */}
          {tripPlan.trips.length > 1 && (() => {
            // Sort trips the same way as the card list so numbers are consistent
            const sorted = [...tripPlan.trips].sort((a, b) => {
              if (sortBy === 'score') return (b.scoreBreakdown?.finalScore ?? b.visitValue) - (a.scoreBreakdown?.finalScore ?? a.visitValue)
              if (sortBy === 'date') return a.anchorGame.date.localeCompare(b.anchorGame.date)
              return 0
            })
            const overlaps: Array<{ idxA: number; idxB: number; tripA: typeof sorted[0]; tripB: typeof sorted[0]; dates: string[]; uniqueA: string[]; uniqueB: string[]; shared: string[] }> = []
            for (let a = 0; a < sorted.length; a++) {
              for (let b = a + 1; b < sorted.length; b++) {
                const daysA = new Set(sorted[a]!.suggestedDays)
                const sharedDates = sorted[b]!.suggestedDays.filter((d) => daysA.has(d))
                if (sharedDates.length > 0) {
                  const playersA = new Set([...sorted[a]!.anchorGame.playerNames, ...sorted[a]!.nearbyGames.flatMap((g) => g.playerNames)])
                  const playersB = new Set([...sorted[b]!.anchorGame.playerNames, ...sorted[b]!.nearbyGames.flatMap((g) => g.playerNames)])
                  overlaps.push({
                    idxA: a + 1, idxB: b + 1,
                    tripA: sorted[a]!, tripB: sorted[b]!,
                    dates: sharedDates,
                    uniqueA: [...playersA].filter((n) => !playersB.has(n)),
                    uniqueB: [...playersB].filter((n) => !playersA.has(n)),
                    shared: [...playersA].filter((n) => playersB.has(n)),
                  })
                }
              }
            }
            if (overlaps.length === 0) return null
            return (
              <div className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-4">
                <div className="flex cursor-pointer items-center justify-between" onClick={() => setShowOverlaps(!showOverlaps)}>
                  <h3 className="text-sm font-semibold text-accent-orange">
                    <span className={`mr-1.5 inline-block text-text-dim transition-transform ${showOverlaps ? 'rotate-90' : ''}`}>&#9654;</span>
                    {overlaps.length} date overlap{overlaps.length !== 1 ? 's' : ''} between trips
                  </h3>
                </div>
                {showOverlaps && (
                <>
                <p className="mt-2 mb-3 text-[11px] text-text-dim">These trips share dates — you can only take one per time slot.</p>
                <div className="space-y-4">
                  {overlaps.map((o, i) => {
                    const tripAKey = getTripKey(o.tripA)
                    const tripBKey = getTripKey(o.tripB)
                    const tripAStatus = tripStatuses[tripAKey]
                    const tripBStatus = tripStatuses[tripBKey]
                    return (
                    <div key={i} className="rounded-lg border border-border/30 bg-gray-950/30 p-3">
                      <p className="mb-2 text-xs text-text-dim">
                        <span className="font-medium text-accent-orange">Trips #{o.idxA} and #{o.idxB}</span> overlap on{' '}
                        {o.dates.map((d) => {
                          const dt = new Date(d + 'T12:00:00Z')
                          return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()]} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getUTCMonth()]} ${dt.getUTCDate()}`
                        }).join(', ')}
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="mb-1 font-medium text-accent-blue">Only in #{o.idxA}</p>
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
                          <p className="mb-1 font-medium text-accent-green">Only in #{o.idxB}</p>
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
                            tripAStatus === 'planned' ? 'bg-accent-blue text-white' : 'border border-accent-blue/30 text-accent-blue hover:bg-accent-blue/10'
                          }`}
                        >
                          {tripAStatus === 'planned' ? `Trip #${o.idxA} chosen` : `Choose Trip #${o.idxA}`}
                        </button>
                        <button
                          onClick={() => { setTripStatus(tripBKey, 'planned'); setTripStatus(tripAKey, null) }}
                          className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-colors ${
                            tripBStatus === 'planned' ? 'bg-accent-green text-white' : 'border border-accent-green/30 text-accent-green hover:bg-accent-green/10'
                          }`}
                        >
                          {tripBStatus === 'planned' ? `Trip #${o.idxB} chosen` : `Choose Trip #${o.idxB}`}
                        </button>
                      </div>
                    </div>
                    )
                  })}
                </div>
                </>
                )}
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

          {/* Fly-in visits — all options */}
          {flyInSection}

          {/* Truly unreachable players (no games at all) — with reasons */}
          {(() => {
            const beyondFlight = tripPlan.unvisitablePlayers.filter((e) => e.reason.startsWith('Beyond max flight'))
            const noGames = tripPlan.unvisitablePlayers.filter((e) => !e.reason.startsWith('Beyond max flight'))
            return (
              <>
                {beyondFlight.length > 0 && (
                  <div id="section-beyond-flight" className="rounded-xl border border-accent-orange/30 bg-accent-orange/5 p-5">
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
                  <div id="section-no-games" className="rounded-xl border border-accent-red/30 bg-accent-red/5 p-5">
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

function StatCard({ label, value, accent, scrollTo, hoverNames }: {
  label: string
  value: string | number
  accent?: string
  scrollTo?: string
  hoverNames?: string[]
}) {
  const [showHover, setShowHover] = useState(false)
  const accentColor =
    accent === 'green' ? 'text-accent-green' :
    accent === 'blue' ? 'text-accent-blue' :
    accent === 'orange' ? 'text-accent-orange' :
    accent === 'red' ? 'text-accent-red' :
    'text-text'

  const isClickable = !!scrollTo
  return (
    <div
      className={`relative rounded-xl border border-border bg-surface p-4 ${isClickable ? 'cursor-pointer hover:border-border/80 hover:bg-surface/80 transition-colors' : ''}`}
      onClick={scrollTo ? () => document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined}
      onMouseEnter={hoverNames && hoverNames.length > 0 ? () => setShowHover(true) : undefined}
      onMouseLeave={() => setShowHover(false)}
    >
      <p className="text-xs font-medium text-text-dim">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentColor}`}>{value}</p>
      {showHover && hoverNames && hoverNames.length > 0 && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-border bg-gray-950 p-2 shadow-lg">
          <p className="mb-1 text-[10px] font-medium text-text-dim">{label} ({hoverNames.length})</p>
          <p className="text-[11px] text-text leading-relaxed">{hoverNames.join(', ')}</p>
        </div>
      )}
    </div>
  )
}

function FlyInCard({
  visit, index, players, playerMap, priorityPlayers, tripStatuses, setTripStatus,
  copiedFlyIn, setCopiedFlyIn, onPlayerClick, defaultExpanded,
}: {
  visit: import('../../types/schedule').FlyInVisit
  index: number
  players: RosterPlayer[]
  playerMap: Map<string, RosterPlayer>
  priorityPlayers: string[]
  tripStatuses: Record<string, TripStatus>
  setTripStatus: (key: string, status: TripStatus | null) => void
  copiedFlyIn: string | null
  setCopiedFlyIn: (key: string | null) => void
  onPlayerClick: (name: string) => void
  defaultExpanded?: boolean
}) {
  const setVisitOverride = useRosterStore((s) => s.setVisitOverride)
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const [markedPlayers, setMarkedPlayers] = useState<Set<string>>(new Set())

  // Derive org label — prefer teamLabel from trip engine (accurate per-team grouping)
  const firstPlayer = players.find((p) => visit.playerNames.includes(p.playerName))
  let orgLabel = visit.teamLabel ?? ''
  if (!orgLabel) {
    if (visit.source === 'hs-lookup' && firstPlayer) orgLabel = `${firstPlayer.org}, ${firstPlayer.state}`
    else if (visit.source === 'ncaa-lookup' && firstPlayer) orgLabel = firstPlayer.org
    else if (visit.source === 'mlb-api' && firstPlayer) orgLabel = firstPlayer.org
  }

  const coordKey = `${visit.venue.coords.lat.toFixed(4)},${visit.venue.coords.lng.toFixed(4)}`
  const teamSlug = (visit.teamLabel ?? '').toLowerCase().replace(/\s+/g, '-')
  const dateSlug = visit.dates[0] ?? ''
  const flyInKey = `flyin-${coordKey}${teamSlug ? `-${teamSlug}` : ''}-${dateSlug}`
  const currentStatus = tripStatuses[flyInKey] as TripStatus | undefined

  function cycleStatus(e: React.MouseEvent) {
    e.stopPropagation()
    if (!currentStatus) setTripStatus(flyInKey, 'planned')
    else if (currentStatus === 'planned') setTripStatus(flyInKey, 'completed')
    else setTripStatus(flyInKey, null)
  }

  const milesDisplay = Math.round(visit.distanceKm * 0.621).toLocaleString()

  // Tier counts
  const tierCounts = { t1: 0, t2: 0, t3: 0 }
  for (const name of visit.playerNames) {
    const tier = playerMap.get(name)?.tier
    if (tier === 1) tierCounts.t1++
    else if (tier === 2) tierCounts.t2++
    else if (tier === 3) tierCounts.t3++
  }

  // Date formatting
  const firstDate = visit.dates[0]
  const lastDate = visit.dates[visit.dates.length - 1]
  const dateLabel = firstDate && lastDate && firstDate !== lastDate
    ? `${formatDate(firstDate)} – ${formatDate(lastDate)}`
    : firstDate ? formatDate(firstDate) : ''
  const dayCount = visit.dates.length

  // Natural language summary
  const t1Names = visit.playerNames.filter((n) => playerMap.get(n)?.tier === 1)
  const t2Names = visit.playerNames.filter((n) => playerMap.get(n)?.tier === 2)
  const isPriority = visit.playerNames.some((n) => priorityPlayers.includes(n))
  let summary = `Fly to ${visit.venue.name} to see ${visit.playerNames.length} player${visit.playerNames.length !== 1 ? 's' : ''}`
  summary += ` — ${visit.isHome ? `${orgLabel || 'team'} home game` : `${orgLabel || 'team'} away series`}.`
  summary += ` ~${visit.estimatedTravelHours}h travel (${milesDisplay} mi). Rental car likely needed.`
  if (t1Names.length > 0) summary += ` Top priority: ${t1Names.join(', ')}.`
  if (t2Names.length > 0) summary += ` Also seeing: ${t2Names.join(', ')}.`

  // Build "why this trip" explanation
  let flyInWhy = ''
  if (t1Names.length > 1) {
    flyInWhy = `Worth the flight — sees ${t1Names.length} must-see players at one venue.`
  } else if (t1Names.length === 1 && isPriority) {
    flyInWhy = `Only way to reach ${t1Names[0]} this window.`
  } else if (t1Names.length === 1) {
    flyInWhy = `Worth the flight — sees ${t1Names[0]} (must-see).`
  } else if (visit.playerNames.length >= 3) {
    flyInWhy = `Worth the flight — sees ${visit.playerNames.length} players at one venue.`
  }

  const breakdown = visit.scoreBreakdown

  // Copy handler
  async function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const playerDescs = visit.playerNames.map((name) => {
      const p = playerMap.get(name)
      return p ? `${name} (T${p.tier})` : name
    })
    let text = `Fly-in #${index} — ${orgLabel || visit.venue.name}\n`
    text += `Venue: ${visit.venue.name}\n`
    text += `Players: ${playerDescs.join(', ')}\n`
    text += `Travel: ~${visit.estimatedTravelHours}h (${milesDisplay} mi)\n`
    text += `Available dates: ${visit.dates.map(formatDate).join(', ')}\n`
    if (breakdown) {
      const parts: string[] = []
      if (breakdown.tier1Count > 0) parts.push(`${breakdown.tier1Count}x T1`)
      if (breakdown.tier2Count > 0) parts.push(`${breakdown.tier2Count}x T2`)
      if (breakdown.tier3Count > 0) parts.push(`${breakdown.tier3Count}x T3`)
      text += `Score: ${breakdown.finalScore} pts (${parts.join(' + ')})\n`
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedFlyIn(flyInKey)
      setTimeout(() => setCopiedFlyIn(null), 2000)
    } catch { /* ignore */ }
  }

  // Source badge
  const sourceBadge = visit.source === 'mlb-api'
    ? { label: visit.isHome ? 'Home Game' : 'Away Game', color: visit.isHome ? 'bg-accent-green/15 text-accent-green' : 'bg-purple-500/15 text-purple-400' }
    : (visit.source === 'hs-lookup' && visit.confidence === 'high')
      ? { label: 'Home Game (MaxPreps)', color: 'bg-accent-green/15 text-accent-green' }
      : (visit.source === 'ncaa-lookup' && visit.confidence === 'high')
        ? { label: 'School Visit (D1Baseball)', color: 'bg-accent-green/15 text-accent-green' }
        : { label: 'School Visit (est.)', color: 'bg-accent-orange/15 text-accent-orange' }

  return (
    <div className={`rounded-xl border bg-surface p-5 ${isPriority ? 'border-purple-500/40' : 'border-border'}`}>
      {/* Header — clickable to expand/collapse */}
      <div
        className="flex cursor-pointer items-start justify-between gap-4"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded) } }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-text-dim transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
            <h3 className="text-base font-semibold text-text">
              Fly-in #{index}
            </h3>
            {breakdown && (
              <span
                className="rounded-lg bg-purple-500/10 px-2 py-0.5 text-xs font-bold text-purple-400"
                title="Single-venue score — fly-ins cover 1 venue vs road trips which chain multiple"
              >
                {breakdown.finalScore} pts
              </span>
            )}
            <button
              onClick={cycleStatus}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                currentStatus === 'planned'
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
                  : currentStatus === 'completed'
                    ? 'bg-accent-green/15 text-accent-green border border-accent-green/30'
                    : 'bg-gray-800 text-text-dim/50 border border-border/30 hover:text-text-dim'
              }`}
            >
              {currentStatus === 'planned' ? 'Planned' : currentStatus === 'completed' ? 'Completed' : 'Mark Status'}
            </button>
          </div>
          <p className="mt-0.5 text-sm text-text-dim">
            {dateLabel}
            <span className="ml-2 text-xs text-text-dim/60">
              {dayCount}-day trip
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            onClick={handleCopy}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors hidden sm:block"
          >
            {copiedFlyIn === flyInKey ? 'Copied!' : 'Copy'}
          </button>
          <div className="rounded-lg bg-purple-500/10 px-2.5 py-1">
            <span className="text-sm font-bold text-purple-400">{visit.playerNames.length}</span>
            <span className="ml-1 text-[11px] text-purple-400/70">
              player{visit.playerNames.length !== 1 ? 's' : ''}
            </span>
          </div>
          {(tierCounts.t1 > 0 || tierCounts.t2 > 0 || tierCounts.t3 > 0) && (
            <div className="flex items-center gap-1 rounded-lg bg-gray-950/60 px-2 py-1 text-[11px] font-medium">
              {tierCounts.t1 > 0 && <span className="text-accent-red">{tierCounts.t1}× {TIER_LABELS[1]}</span>}
              {tierCounts.t1 > 0 && (tierCounts.t2 > 0 || tierCounts.t3 > 0) && <span className="text-text-dim/30">·</span>}
              {tierCounts.t2 > 0 && <span className="text-accent-orange">{tierCounts.t2}× {TIER_LABELS[2]}</span>}
              {tierCounts.t2 > 0 && tierCounts.t3 > 0 && <span className="text-text-dim/30">·</span>}
              {tierCounts.t3 > 0 && <span className="text-yellow-400">{tierCounts.t3}× {TIER_LABELS[3]}</span>}
            </div>
          )}
          <div className="rounded-lg bg-gray-950/60 px-2.5 py-1">
            <span className="text-[11px] text-text-dim">~{visit.estimatedTravelHours}h</span>
          </div>
          <div className="hidden rounded-lg bg-gray-950/60 px-2.5 py-1 sm:block">
            <span className="text-[11px] text-text-dim">{milesDisplay} mi</span>
          </div>
        </div>
      </div>

      {/* Expanded content — simplified: one plan, not repeated per day */}
      {expanded && (
        <div className="mt-4 space-y-3">
          {/* Recommendation */}
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {orgLabel && orgLabel !== visit.venue.name ? (
                <>
                  <span className="text-sm font-semibold text-text">{orgLabel}</span>
                  <span className="text-xs text-text-dim">{visit.venue.name}</span>
                </>
              ) : (
                <span className="text-sm font-semibold text-text">{visit.venue.name}</span>
              )}
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceBadge.color}`}>
                {sourceBadge.label}
              </span>
              {visit.confidence && visit.confidence !== 'high' && (
                <span className="rounded bg-accent-orange/10 px-1.5 py-0.5 text-[10px] text-accent-orange">
                  Estimated — verify before booking
                </span>
              )}
              {visit.sourceUrl && (
                <a href={visit.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-dim/50 hover:text-purple-400">Verify ↗</a>
              )}
            </div>

            {/* Travel info inline */}
            <p className="text-xs text-text-dim mb-2">
              ~{visit.estimatedTravelHours}h travel from Orlando ({milesDisplay} mi) · flight + rental car
            </p>

            {/* Best date recommendation */}
            {(() => {
              const bestDay = visit.dates.find(d => new Date(d + 'T12:00:00Z').getUTCDay() === 2) ?? visit.dates[0]
              if (!bestDay) return null
              const bestDate = new Date(bestDay + 'T12:00:00Z')
              const bestDayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][bestDate.getUTCDay()]
              const isTue = bestDate.getUTCDay() === 2
              return (
                <p className="text-sm text-text">
                  <span className={`font-medium ${isTue ? 'text-accent-blue' : ''}`}>
                    Best day: {bestDayName} {formatDate(bestDay)}
                    {isTue ? ' (Tuesday — ideal for position players)' : ''}
                  </span>
                  {visit.dates.length > 1 && (
                    <span className="text-text-dim text-xs ml-2">
                      ({visit.dates.length} days available: {visit.dates.map(d => {
                        const dt = new Date(d + 'T12:00:00Z')
                        return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getUTCDay()]
                      }).join(', ')})
                    </span>
                  )}
                </p>
              )
            })()}

            {/* Players */}
            <div className="mt-2 flex flex-wrap gap-1">
              {visit.playerNames.map((name) => {
                const player = playerMap.get(name)
                const tier = player?.tier ?? 4
                const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                return (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text cursor-pointer hover:bg-accent-blue/10"
                    onClick={(e) => { e.stopPropagation(); onPlayerClick(name) }}
                  >
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
                    {name}
                    <span className="text-text-dim/50">T{tier}</span>
                  </span>
                )
              })}
            </div>

            {flyInWhy && (
              <p className="mt-2 text-xs italic text-text-dim/60">{flyInWhy}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleCopy}
              className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors"
            >
              {copiedFlyIn === flyInKey ? 'Copied!' : 'Copy Itinerary'}
            </button>
          </div>

          {/* Mark Visited */}
          <div className="border-t border-border/30 pt-3">
            <p className="mb-1.5 text-[11px] font-medium text-text-dim">Mark Visited</p>
            <div className="flex flex-wrap gap-1.5">
              {visit.playerNames.map((name) => {
                const player = playerMap.get(name)
                if (!player) return null
                const tier = player.tier
                const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                return (
                  <MarkVisitedChip
                    key={name}
                    name={name}
                    tier={tier}
                    dotColor={dotColor}
                    marked={markedPlayers.has(name)}
                    onMark={() => {
                      const today = new Date().toISOString().split('T')[0]!
                      setVisitOverride(name, player.visitsCompleted + 1, today)
                      setMarkedPlayers((prev) => new Set(prev).add(name))
                    }}
                  />
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
