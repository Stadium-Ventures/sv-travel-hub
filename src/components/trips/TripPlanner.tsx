import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import TripCard, { generateItineraryText, buildVenueStops } from './TripCard'
import PlayerCoverageCard from './PlayerCoverageCard'
import { generateAllTripsIcs, downloadIcs } from '../../lib/icsExport'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'

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
  excludeNames,
  placeholder,
  onChange,
}: {
  value: string
  players: RosterPlayer[]
  excludeNames?: string[]
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
      .filter((p) => !excludeNames?.includes(p.playerName))
      .filter((p) => !q || p.playerName.toLowerCase().includes(q) || p.org.toLowerCase().includes(q))
      .sort((a, b) => {
        const levelDiff = (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9)
        if (levelDiff !== 0) return levelDiff
        return a.playerName.localeCompare(b.playerName)
      })
  }, [players, excludeNames, search])

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

// Progress bar helpers for trip generation
function getProgressPercent(step: string): string {
  if (step.includes('Auto-assigning')) return '10%'
  if (step.includes('Pro schedules')) return '25%'
  if (step.includes('College')) return '45%'
  if (step.includes('Mapping HS')) return '55%'
  if (step.includes('HS schedules')) return '65%'
  if (step.includes('Starting')) return '75%'
  if (step.includes('Analyzing') || step.includes('Scoring')) return '85%'
  if (step.includes('Optimizing') || step.includes('Selecting')) return '92%'
  return '50%'
}

function getProgressNote(step: string): string {
  if (step.includes('Auto-assigning')) return 'Checking MLB/MiLB rosters for player affiliates (~5s)'
  if (step.includes('Pro schedules')) return 'Fetching game schedules from MLB API (~15-30s)'
  if (step.includes('College')) return 'Scraping D1Baseball schedules (~30-60s)'
  if (step.includes('Mapping HS')) return 'Geocoding high school locations (~5s)'
  if (step.includes('HS schedules')) return 'Fetching MaxPreps schedules (~15-30s)'
  if (step.includes('Starting') || step.includes('Analyzing')) return 'Building trip candidates...'
  if (step.includes('Optimizing') || step.includes('Selecting')) return 'Almost done — selecting best trips...'
  return 'First run loads all schedule data. Subsequent runs are much faster.'
}

function ScheduleProgressRow({ label, loading, done, progress, detail, color }: {
  label: string
  loading: boolean
  done: boolean
  progress?: { completed: number; total: number } | null
  detail?: string
  color: string
}) {
  const pct = progress ? Math.round((progress.completed / progress.total) * 100) : 0
  const timeRemaining = progress ? Math.max(0, (progress.total - progress.completed) * 3) : 0

  return (
    <div className="flex items-center gap-3">
      {/* Status icon */}
      <div className="w-3 shrink-0">
        {done && !loading ? (
          <svg className="h-3 w-3 text-accent-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : loading ? (
          <span className="block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent text-text-dim" />
        ) : (
          <span className="block h-2 w-2 rounded-full bg-gray-600 ml-0.5" />
        )}
      </div>
      {/* Label + bar */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className={`text-[11px] font-medium ${done && !loading ? 'text-accent-green' : loading ? 'text-text' : 'text-text-dim'}`}>
            {label}
          </span>
          <span className="text-[10px] text-text-dim/60">
            {done && !loading
              ? 'Done'
              : loading && progress
              ? `${progress.completed}/${progress.total}${timeRemaining > 0 ? ` — ~${timeRemaining}s` : ''}`
              : loading
              ? (detail ?? 'Starting...')
              : 'Pending'}
          </span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          {done && !loading ? (
            <div className={`h-full rounded-full ${color} w-full`} />
          ) : loading && progress ? (
            <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
          ) : loading ? (
            <div className={`h-full rounded-full ${color} animate-pulse w-1/3`} />
          ) : (
            <div className="h-full rounded-full bg-gray-700 w-0" />
          )}
        </div>
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
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const schedulesLoading = useScheduleStore((s) => s.schedulesLoading)
  const schedulesProgress = useScheduleStore((s) => s.schedulesProgress)
  const ncaaLoading = useScheduleStore((s) => s.ncaaLoading)
  const ncaaProgress = useScheduleStore((s) => s.ncaaProgress)
  const hsLoading = useScheduleStore((s) => s.hsLoading)
  const hsProgress = useScheduleStore((s) => s.hsProgress)
  const autoAssignLoading = useScheduleStore((s) => s.autoAssignLoading)
  const players = useRosterStore((s) => s.players)
  const rosterLoading = useRosterStore((s) => s.loading)
  const rosterError = useRosterStore((s) => s.error)
  const fetchRoster = useRosterStore((s) => s.fetchRoster)

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
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score')
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)



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

  const hasHsPlayers = players.some((p) => p.level === 'HS' && p.visitsRemaining > 0)


  const canGenerate = players.length > 0 && !computing


  function handlePriorityChange(slot: 0 | 1 | 2, value: string) {
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
  const flyInLimit = 5 // Hard cap on fly-in results
  const [showOverlaps, setShowOverlaps] = useState(false)
  const anyScheduleLoading = schedulesLoading || ncaaLoading || hsLoading || autoAssignLoading
  const allSchedulesLoaded = proGames.length > 0 && ncaaGames.length > 0 && (!hasHsPlayers || hsGames.length > 0)

  // Auto-load schedules on mount if not already loaded
  const schedulesInitialized = useRef(false)
  useEffect(() => {
    if (schedulesInitialized.current) return
    if (players.length === 0) return // wait for roster
    if (allSchedulesLoaded) return // already have data
    if (anyScheduleLoading) return // already in progress
    schedulesInitialized.current = true
    handleLoadAllSchedules()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length, allSchedulesLoaded, anyScheduleLoading])

  async function handleLoadAllSchedules() {
    if (anyScheduleLoading) return
    const schedStore = useScheduleStore.getState()

    // 1. Pro: auto-assign then fetch
    if (Object.keys(schedStore.playerTeamAssignments).length === 0) {
      await schedStore.autoAssignPlayers()
    }
    if (Object.keys(useScheduleStore.getState().playerTeamAssignments).length > 0) {
      const y = new Date().getFullYear()
      schedStore.fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
    }

    // 2. NCAA
    const ncaaAllOrgs = players
      .filter((p) => p.level === 'NCAA' && p.visitsRemaining > 0)
      .map((p) => ({ playerName: p.playerName, org: p.org }))
    if (ncaaAllOrgs.length > 0) {
      schedStore.fetchNcaaSchedules(ncaaAllOrgs, { merge: true })
    }

    // 3. HS (with geocoding)
    if (hasHsPlayers) {
      const hsPlayers = players.filter((p) => p.level === 'HS' && p.visitsRemaining > 0)
      const { useVenueStore } = await import('../../store/venueStore')
      const venueCount = Object.values(useVenueStore.getState().venues).filter((v: any) => v.source === 'hs-geocoded').length
      if (venueCount === 0) {
        await useVenueStore.getState().geocodeHsVenues(
          hsPlayers.map((p) => ({ schoolName: p.org, city: '', state: p.state }))
        )
      }
      const hsOrgs = hsPlayers.map((p) => ({ playerName: p.playerName, org: p.org, state: p.state }))
      if (hsOrgs.length > 0) {
        schedStore.fetchHsSchedules(hsOrgs, { merge: true })
      }
    }
  }

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

    // Priority players whose games are all within driving range (no fly-in needed)
    const drivablePriorityNames = priorityPlayers.filter((n) => {
      const result = tripPlan.priorityResults?.find((r) => r.playerName === n)
      return result && (result.status === 'included' || result.status === 'separate-trip')
    })

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
        {drivablePriorityNames.length > 0 && (
          <p className="mb-3 text-xs text-text-dim">
            {drivablePriorityNames.join(', ')} {drivablePriorityNames.length === 1 ? 'has' : 'have'} all games within driving range — no fly-in needed. Fly-in options below are for other players on the roster.
          </p>
        )}
        <div className="space-y-4">
          {visibleVisits.map((visit, i) => (
            <FlyInCard
              key={i}
              visit={visit}
              index={i + 1}
              players={players}
              playerMap={playerMap}
              priorityPlayers={priorityPlayers}

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
      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Trip Planner</h2>
        <p className="mb-2 text-xs text-text-dim">
          Load schedules below, then hit Generate to build optimized road trips from Orlando.
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

        {/* Schedule status + load button */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleLoadAllSchedules}
              disabled={anyScheduleLoading}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                allSchedulesLoaded
                  ? 'bg-accent-green/15 text-accent-green border border-accent-green/30 hover:bg-accent-green/25'
                  : 'bg-accent-blue text-white hover:bg-accent-blue/80'
              } disabled:opacity-50`}
            >
              {anyScheduleLoading
                ? 'Loading Schedules...'
                : allSchedulesLoaded ? 'Reload Schedules' : 'Load All Schedules'}
            </button>
            {/* Inline schedule status chips (when not loading) */}
            {!anyScheduleLoading && (proGames.length > 0 || ncaaGames.length > 0 || hsGames.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                {proGames.length > 0 && (
                  <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-accent-green">
                    Pro: {proGames.length} games
                  </span>
                )}
                {ncaaGames.length > 0 && (
                  <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-accent-green">
                    College: {ncaaGames.length} games
                  </span>
                )}
                {hsGames.length > 0 && (
                  <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-accent-green">
                    HS: {hsGames.length} games
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Per-source progress bars during loading */}
          {anyScheduleLoading && (
            <div className="mt-3 space-y-2">
              <ScheduleProgressRow
                label="Pro Schedules"
                loading={schedulesLoading || autoAssignLoading}
                done={proGames.length > 0}
                progress={schedulesProgress}
                detail={autoAssignLoading ? 'Verifying team assignments...' : undefined}
                color="bg-accent-blue"
              />
              <ScheduleProgressRow
                label="College Schedules"
                loading={ncaaLoading}
                done={ncaaGames.length > 0}
                progress={ncaaProgress}
                color="bg-accent-green"
              />
              {hasHsPlayers && (
                <ScheduleProgressRow
                  label="HS Schedules"
                  loading={hsLoading}
                  done={hsGames.length > 0}
                  progress={hsProgress}
                  color="bg-accent-orange"
                />
              )}
            </div>
          )}
        </div>

        {/* Roster load error */}
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
            onClick={() => {
              const now = new Date()
              const day = now.getDay()
              const diffToNextMon = day === 0 ? 1 : 8 - day
              const start = new Date(now)
              start.setDate(now.getDate() + diffToNextMon)
              const end = new Date(start)
              end.setDate(start.getDate() + 13) // 2 weeks
              setDateRange(start.toISOString().split('T')[0]!, end.toISOString().split('T')[0]!)
            }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            Next 2 weeks
          </button>
          <button
            onClick={() => {
              const now = new Date()
              const end = new Date(now)
              end.setDate(now.getDate() + 30)
              setDateRange(now.toISOString().split('T')[0]!, end.toISOString().split('T')[0]!)
            }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            Next 30 days
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
                onChange={(e) => {
                  const newStart = e.target.value
                  // Cap at 30 days
                  const startMs = new Date(newStart).getTime()
                  const endMs = new Date(endDate).getTime()
                  if (endMs - startMs > 30 * 86400000) {
                    const capped = new Date(startMs + 30 * 86400000).toISOString().split('T')[0]!
                    setDateRange(newStart, capped)
                  } else {
                    setDateRange(newStart, endDate)
                  }
                }}
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
                onChange={(e) => {
                  const newEnd = e.target.value
                  // Cap at 30 days
                  const startMs = new Date(startDate).getTime()
                  const endMs = new Date(newEnd).getTime()
                  if (endMs - startMs > 30 * 86400000) {
                    const capped = new Date(endMs - 30 * 86400000).toISOString().split('T')[0]!
                    setDateRange(capped, newEnd)
                  } else {
                    setDateRange(startDate, newEnd)
                  }
                }}
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

        {/* DayStrip removed — days are shown in trip cards */}

        {/* Priority players */}
        <div className="mt-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority Players <span className="text-text-dim/50">(optional — every trip must include ALL selected players)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <PlayerSearchPicker
              value={priorityPlayers[0] ?? ''}
              players={eligibleForPriority}
              excludeNames={priorityPlayers.filter((_, i) => i !== 0)}
              placeholder="Type to search player 1..."
              onChange={(name) => handlePriorityChange(0, name)}
            />
            <PlayerSearchPicker
              value={priorityPlayers[1] ?? ''}
              players={eligibleForPriority}
              excludeNames={priorityPlayers.filter((_, i) => i !== 1)}
              placeholder="Type to search player 2..."
              onChange={(name) => handlePriorityChange(1, name)}
            />
            <PlayerSearchPicker
              value={priorityPlayers[2] ?? ''}
              players={eligibleForPriority}
              excludeNames={priorityPlayers.filter((_, i) => i !== 2)}
              placeholder="Type to search player 3..."
              onChange={(name) => handlePriorityChange(2, name)}
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

        {!canGenerate && !computing && players.length === 0 && (
          <p className="mt-3 text-xs text-accent-orange">Loading roster...</p>
        )}

        {computing && (
          <div className="mt-4 rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4">
            <div className="flex items-center gap-3 mb-2">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
              <span className="text-sm font-semibold text-text">{progressStep || 'Working...'}</span>
            </div>
            {progressDetail && <p className="text-xs text-text-dim mb-2">{progressDetail}</p>}
            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div className="h-full rounded-full bg-accent-blue animate-pulse" style={{ width: getProgressPercent(progressStep) }} />
            </div>
            <p className="mt-1.5 text-[10px] text-text-dim/60">
              {getProgressNote(progressStep)}
            </p>
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
                            {bestFlyIn.dates.slice(0, 5).map((d) => formatDate(d)).join(', ')}
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

          {/* Player Coverage — answers "where is Player X?" */}
          <PlayerCoverageCard
            players={players}
            allGames={[...proGames, ...ncaaGames, ...hsGames]}
            onPlayerClick={setSelectedPlayer}
            onLoadAll={handleLoadAllSchedules}
            loadingAll={anyScheduleLoading}
          />

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
            // Tag each trip with its original index before sorting
            let trips = [...tripPlan.trips]

            trips.sort((a, b) => {
              if (sortBy === 'score') return (b.scoreBreakdown?.finalScore ?? b.visitValue) - (a.scoreBreakdown?.finalScore ?? a.visitValue)
              if (sortBy === 'date') return a.anchorGame.date.localeCompare(b.anchorGame.date)
              return 0
            })

            // Number trips sequentially after sorting — #1 is always the best
            const indexedTrips = trips.map((trip, i) => ({ trip, displayIndex: i + 1 }))

            // Build overlap map: for each trip index, which other trip indices overlap?
            const overlapMap = new Map<number, number[]>()
            for (let a = 0; a < trips.length; a++) {
              for (let b = a + 1; b < trips.length; b++) {
                const daysA = new Set(trips[a]!.suggestedDays)
                const hasOverlap = trips[b]!.suggestedDays.some((d) => daysA.has(d))
                if (hasOverlap) {
                  const idxA = a + 1
                  const idxB = b + 1
                  overlapMap.set(idxA, [...(overlapMap.get(idxA) ?? []), idxB])
                  overlapMap.set(idxB, [...(overlapMap.get(idxB) ?? []), idxA])
                }
              }
            }

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
              </div>

              <div className="space-y-4">
                {indexedTrips.map(({ trip, displayIndex }, i) => (
                  <TripCard key={`trip-${displayIndex}`} trip={trip} index={displayIndex} playerMap={playerMap} defaultExpanded={i === 0} onPlayerClick={setSelectedPlayer} overlappingTrips={overlapMap.get(displayIndex)} />
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
                  {overlaps.map((o, i) => (
                    <div key={i} className="rounded-lg border border-border/30 bg-gray-950/30 p-3">
                      <p className="mb-2 text-xs text-text-dim">
                        <span className="font-medium text-accent-orange">Trips #{o.idxA} and #{o.idxB}</span> overlap on{' '}
                        {o.dates.map((d) => {
                          return formatDate(d)
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
                    </div>
                  ))}
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
                  <details id="section-no-games" className="rounded-xl border border-accent-red/30 bg-accent-red/5">
                    <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-accent-red">
                      {noGames.length} player{noGames.length !== 1 ? 's' : ''} with no games in date range
                      {(() => {
                        const t1Count = noGames.filter((e) => (playerMap.get(e.name)?.tier ?? 4) === 1).length
                        const t2Count = noGames.filter((e) => (playerMap.get(e.name)?.tier ?? 4) === 2).length
                        if (t1Count === 0 && t2Count === 0) return null
                        return (
                          <span className="ml-2 text-xs font-normal text-accent-red/70">
                            ({t1Count > 0 ? `${t1Count} T1` : ''}{t1Count > 0 && t2Count > 0 ? ', ' : ''}{t2Count > 0 ? `${t2Count} T2` : ''})
                          </span>
                        )
                      })()}
                    </summary>
                    <div className="border-t border-accent-red/20 px-5 py-3 space-y-1.5">
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
                  </details>
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
  visit, index, players, playerMap, priorityPlayers,
  copiedFlyIn, setCopiedFlyIn, onPlayerClick, defaultExpanded,
}: {
  visit: import('../../types/schedule').FlyInVisit
  index: number
  players: RosterPlayer[]
  playerMap: Map<string, RosterPlayer>
  priorityPlayers: string[]
  copiedFlyIn: string | null
  setCopiedFlyIn: (key: string | null) => void
  onPlayerClick: (name: string) => void
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)

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
              const isTue = bestDate.getUTCDay() === 2
              return (
                <p className="text-sm text-text">
                  <span className={`font-medium ${isTue ? 'text-accent-blue' : ''}`}>
                    Best day: {formatDate(bestDay)}
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

        </div>
      )}
    </div>
  )
}
