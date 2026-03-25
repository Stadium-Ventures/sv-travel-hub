import { useEffect, useMemo, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import TripCard from './TripCard'
import PlayerCoverageCard from './PlayerCoverageCard'
// ICS export removed from main UI — kept in individual trip cards
// import { generateAllTripsIcs, downloadIcs } from '../../lib/icsExport'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'
import { MAJOR_AIRPORTS, findNearestAirport } from '../../data/majorAirports'

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

  // Auto-clear stale selection (player no longer eligible)
  useEffect(() => {
    if (value && !selectedPlayer) {
      onChange('')
    }
  }, [value, selectedPlayer, onChange])

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

      {open && !selectedPlayer && (
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
  const allFetched = progress != null && progress.completed >= progress.total
  // Done = games loaded into store, OR all items fetched (store still post-processing)
  const effectivelyDone = done || allFetched

  return (
    <div className="flex items-center gap-3">
      {/* Status icon */}
      <div className="w-3 shrink-0">
        {effectivelyDone ? (
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
          <span className={`text-[11px] font-medium ${effectivelyDone ? 'text-accent-green' : loading ? 'text-text' : 'text-text-dim'}`}>
            {label}
          </span>
          <span className="text-[10px] text-text-dim/60">
            {effectivelyDone
              ? 'Done'
              : loading && progress
              ? `${progress.completed}/${progress.total}`
              : loading
              ? (detail ?? 'Starting...')
              : 'Pending'}
          </span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          {effectivelyDone ? (
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

  const [sortBy, setSortBy] = useState<'score' | 'date'>('score')
  const [tripFilter, setTripFilter] = useState<'all' | 'drive' | 'fly'>('all')
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)



  // Build player lookup
  const playerMap = useMemo(() => {
    const map = new Map<string, RosterPlayer>()
    for (const p of players) map.set(p.playerName, p)
    return map
  }, [players])

  // All players eligible for priority selection (don't filter by visits remaining)
  const eligibleForPriority = useMemo(
    () => players.sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [players],
  )

  // Best week suggestions — computed on-demand only when user clicks "Suggest"
  // bestWeeks removed — trip planner generates for the dates selected

  const hasHsPlayers = players.some((p) => p.level === 'HS')


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

  const [copiedFlyIn, setCopiedFlyIn] = useState<string | null>(null)
  const flyInLimit = 5 // Hard cap on fly-in results
  const [showOverlaps, setShowOverlaps] = useState(false)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)
  const cachedProTeamIds = useScheduleStore((s) => s.cachedProTeamIds)

  const anyScheduleLoading = schedulesLoading || ncaaLoading || hsLoading || autoAssignLoading
  const allSchedulesLoaded = proGames.length > 0 && ncaaGames.length > 0 && (!hasHsPlayers || hsGames.length > 0)

  // Compute staleness — only pro schedules can go stale (live-fetched from MLB API).
  // NCAA and HS schedules are bundled as static data and don't expire.
  const now = Date.now()
  const STALE_THRESHOLD = 24 * 60 * 60 * 1000 // 24 hours
  const proStale = proFetchedAt ? (now - proFetchedAt > STALE_THRESHOLD) : false
  const anyStale = proStale

  // (formatAge removed — schedule badges simplified)

  // Auto-load on mount: use cached data if fresh, otherwise fetch
  // Also detect new teams/schools not in cache (roster changes)
  const schedulesInitialized = useRef(false)
  useEffect(() => {
    if (schedulesInitialized.current) return
    if (players.length === 0) return // wait for roster
    if (anyScheduleLoading) return // already in progress

    // If we have cached data, check for gaps (new players/teams not in cache)
    if (allSchedulesLoaded) {
      schedulesInitialized.current = true
      // Check for new teams not in cached Pro data
      const assignments = useScheduleStore.getState().playerTeamAssignments
      const assignedTeamIds = new Set(Object.values(assignments).map((a) => a.teamId))
      const cachedSet = new Set(cachedProTeamIds)
      const missingProTeams = [...assignedTeamIds].filter((id) => !cachedSet.has(id))

      // Always re-run HS + NCAA schedule conversion on startup — bundled data is
      // instant and ensures venue coords from the latest generation are used.
      const hsOrgs = players
        .filter((p) => p.level === 'HS' && p.state)
        .map((p) => ({ playerName: p.playerName, org: p.org, state: p.state! }))
      if (hsOrgs.length > 0) {
        useScheduleStore.getState().fetchHsSchedules(hsOrgs)
      }
      const ncaaAllOrgs = players
        .filter((p) => p.level === 'NCAA' && true)
        .map((p) => ({ playerName: p.playerName, org: p.org }))
      if (ncaaAllOrgs.length > 0) {
        useScheduleStore.getState().fetchNcaaSchedules(ncaaAllOrgs)
      }

      if (missingProTeams.length > 0) {
        handleIncrementalLoad(missingProTeams, [])
      }
      return
    }

    // No cached data — full load
    schedulesInitialized.current = true
    handleLoadAllSchedules()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length, allSchedulesLoaded, anyScheduleLoading])

  async function handleIncrementalLoad(missingProTeamIds: number[], missingNcaaOrgs: string[]) {
    const schedStore = useScheduleStore.getState()
    // For Pro: re-fetch will include new teams automatically since it reads current assignments
    if (missingProTeamIds.length > 0) {
      const y = new Date().getFullYear()
      schedStore.fetchProSchedules(`${y}-03-01`, `${y}-09-30`)
    }
    // For NCAA: fetch only the missing schools
    if (missingNcaaOrgs.length > 0) {
      const ncaaOrgs = players
        .filter((p) => p.level === 'NCAA' && missingNcaaOrgs.includes(p.org) && true)
        .map((p) => ({ playerName: p.playerName, org: p.org }))
      if (ncaaOrgs.length > 0) {
        schedStore.fetchNcaaSchedules(ncaaOrgs, { merge: true })
      }
    }
  }

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
      .filter((p) => p.level === 'NCAA' && true)
      .map((p) => ({ playerName: p.playerName, org: p.org }))
    if (ncaaAllOrgs.length > 0) {
      schedStore.fetchNcaaSchedules(ncaaAllOrgs, { merge: true })
    }

    // 3. HS (with geocoding)
    if (hasHsPlayers) {
      const hsPlayers = players.filter((p) => p.level === 'HS' && true)
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


  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // Fly-in section removed — fly-ins are now in the unified "Your Trips" list

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Trip Planner</h2>

        {/* Schedule status — minimal */}
        <div className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            {!allSchedulesLoaded && !anyScheduleLoading && (
              <button
                onClick={handleLoadAllSchedules}
                className="rounded-lg bg-accent-blue px-4 py-2 text-sm font-medium text-white hover:bg-accent-blue/80"
              >
                Load Schedules
              </button>
            )}
            {anyScheduleLoading && !allSchedulesLoaded && (
              <span className="flex items-center gap-2 text-xs text-text-dim">
                <span className="h-3 w-3 animate-spin rounded-full border border-accent-blue border-t-transparent" />
                Loading game data...
              </span>
            )}
            {allSchedulesLoaded && !anyScheduleLoading && (
              <span className="text-[10px] text-accent-green/60">
                Game data loaded
                {anyStale && <button onClick={handleLoadAllSchedules} className="ml-2 text-accent-orange hover:underline">refresh</button>}
              </span>
            )}
          </div>

          {/* Per-source progress bars — only during active network fetches, not cached restores */}
          {anyScheduleLoading && !allSchedulesLoaded && (
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

        {/* DayStrip removed — days are shown in trip cards */}

        {/* Priority players */}
        <div className="mt-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority Players <span className="text-text-dim/50">(optional — engine will build trips around these players first)</span>
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

        {/* Trip Anchor moved below results */}

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
          {tripPlan.priorityResults && tripPlan.priorityResults.length > 0 && (() => {
            // Sort trips same way as card list so trip numbers match
            const prSorted = [...tripPlan.trips].sort((a, b) => {
              if (sortBy === 'score') return (b.scoreBreakdown?.finalScore ?? b.visitValue) - (a.scoreBreakdown?.finalScore ?? a.visitValue)
              if (sortBy === 'date') return a.anchorGame.date.localeCompare(b.anchorGame.date)
              return 0
            })
            function findTripNum(playerName: string): number {
              const idx = prSorted.findIndex((t) =>
                t.anchorGame.playerNames.includes(playerName) ||
                t.nearbyGames.some((g) => g.playerNames.includes(playerName))
              )
              return idx + 1
            }
            return (
            <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4">
              <h3 className="mb-2 text-sm font-semibold text-accent-blue">Priority Player Results</h3>
              <div className="space-y-3">
                {tripPlan.priorityResults.map((r) => {
                  const player = playerMap.get(r.playerName)
                  const assignments = useScheduleStore.getState().playerTeamAssignments
                  const assignment = assignments[r.playerName]
                  const teamName = assignment?.teamName ?? player?.org ?? ''
                  const tripNum = (r.status === 'included' || r.status === 'separate-trip') ? findTripNum(r.playerName) : 0

                  // Find which unified trip # this player appears in (for fly-in results)
                  const flyInTripIdx = r.status === 'fly-in-only'
                    ? tripPlan.flyInVisits.findIndex((v) => v.playerNames.includes(r.playerName))
                    : -1
                  // Unified index: road trips come first in the "best" sort, so fly-in index starts after them
                  const unifiedFlyInNum = flyInTripIdx >= 0 ? tripPlan.trips.length + flyInTripIdx + 1 : 0

                  return (
                    <div key={r.playerName} className="rounded-lg bg-surface/50 px-3 py-2">
                      <p className="text-sm text-text">
                        <span className="font-medium">{r.playerName}</span>
                        {teamName && <span className="text-text-dim"> ({teamName})</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-text-dim">
                        {r.status === 'included' && (
                          <>Within driving range. <span className="text-accent-green font-medium">See him on Trip #{tripNum}.</span></>
                        )}
                        {r.status === 'separate-trip' && (
                          <>Within driving range. <span className="text-accent-green font-medium">See him on Trip #{tripNum}.</span></>
                        )}
                        {r.status === 'fly-in-only' && (
                          <>Too far to drive from Orlando — requires a flight. {unifiedFlyInNum > 0 && <span className="text-accent-blue font-medium">See Trip #{unifiedFlyInNum}.</span>}</>
                        )}
                        {r.status === 'unreachable' && (
                          <span className="text-accent-red">No games found in the date range{r.reason ? ` — ${r.reason}` : ''}.</span>
                        )}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
            )})()}

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
            const totalEligible = players.length

            return (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatCard label="Total Trips" value={tripPlan.trips.length + Math.min(tripPlan.flyInVisits.length, flyInLimit)} scrollTo="section-road-trips" hoverNames={allTripPlayerNames} />
              <div title={`${allTripPlayerNames.length} of your ${totalEligible} players appear in at least one trip option.`}>
                <StatCard label="Players in Trips" value={allTripPlayerNames.length} accent="blue" scrollTo="section-road-trips" hoverNames={allTripPlayerNames} />
              </div>
              <div title={`${totalEligible - allTripPlayerNames.length} players still need trip options`}>
                <StatCard
                  label="Not Covered"
                  value={Math.max(0, totalEligible - allTripPlayerNames.length)}
                  accent={totalEligible - allTripPlayerNames.length <= 2 ? 'green' : 'orange'}
                />
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
                        {prioInFlyIn.length > 0 && prioInFlyIn.map((n) => {
                          const bestVisit = tripPlan.flyInVisits.find((v) => v.playerNames.includes(n))
                          const bestDate = bestVisit?.dates[0]
                          return ` · ${n} → Fly-in${bestDate ? ` (${formatDate(bestDate)})` : ''}`
                        }).join('')}
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

          {/* Unified trip list — road trips and fly-ins sorted together */}
          {(tripPlan.trips.length > 0 || tripPlan.flyInVisits.length > 0) && (() => {
            // Build unified list: each item has a type, sort date, and the original data
            type UnifiedItem =
              | { type: 'road'; trip: typeof tripPlan.trips[0]; sortDate: string }
              | { type: 'flyin'; visit: typeof tripPlan.flyInVisits[0]; sortDate: string }

            const unified: UnifiedItem[] = [
              ...tripPlan.trips.map((trip) => ({
                type: 'road' as const,
                trip,
                sortDate: trip.anchorGame.date,
              })),
              ...tripPlan.flyInVisits.slice(0, flyInLimit).map((visit) => ({
                type: 'flyin' as const,
                visit,
                sortDate: visit.dates[0] ?? '',
              })),
            ]

            // Sort by date (chronological), or by score (road trips first by value, then fly-ins)
            if (sortBy === 'date') {
              unified.sort((a, b) => a.sortDate.localeCompare(b.sortDate))
            } else {
              unified.sort((a, b) => {
                const scoreA = a.type === 'road' ? (a.trip.scoreBreakdown?.finalScore ?? a.trip.visitValue) : (a.visit.visitValue)
                const scoreB = b.type === 'road' ? (b.trip.scoreBreakdown?.finalScore ?? b.trip.visitValue) : (b.visit.visitValue)
                return scoreB - scoreA
              })
            }

            // Number trips sequentially — one counter across both types
            const numbered = unified.map((item, i) => ({
              ...item,
              displayIndex: i + 1,
            }))

            return (
            <div id="section-road-trips">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-text">
                  Your Trips
                  <span className="ml-2 text-xs font-normal text-text-dim">
                    {unified.length} trip options
                  </span>
                </h3>
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
                <span className="mx-1 text-text-dim/20">|</span>
                <span className="text-[11px] text-text-dim">Show:</span>
                {([
                  { key: 'all', label: 'All' },
                  { key: 'drive', label: '🚗 Drives' },
                  { key: 'fly', label: '✈️ Flights' },
                ] as const).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setTripFilter(key)}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      tripFilter === key ? 'bg-accent-blue/20 text-accent-blue' : 'bg-gray-800/50 text-text-dim hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="space-y-4">
                {numbered.filter((item) => {
                  if (tripFilter === 'drive') return item.type === 'road'
                  if (tripFilter === 'fly') return item.type === 'flyin'
                  return true
                }).map((item, i) => {
                  if (item.type === 'road') {
                    return (
                      <TripCard
                        key={`road-${item.displayIndex}`}
                        trip={item.trip}
                        index={item.displayIndex}
                        playerMap={playerMap}
                        defaultExpanded={i === 0}
                        onPlayerClick={setSelectedPlayer}
                      />
                    )
                  } else {
                    return (
                      <FlyInCard
                        key={`flyin-${item.displayIndex}`}
                        visit={item.visit}
                        index={item.displayIndex}
                        players={players}
                        playerMap={playerMap}
                        priorityPlayers={priorityPlayers}
                        copiedFlyIn={copiedFlyIn}
                        setCopiedFlyIn={setCopiedFlyIn}
                        onPlayerClick={setSelectedPlayer}
                        defaultExpanded={i === 0 && tripPlan.trips.length === 0}
                      />
                    )
                  }
                })}
                {unified.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">No trips generated for the selected date range.</p>
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
                      <span className="text-xs text-text-dim">{TIER_LABELS[tier] ?? ''}</span>
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
          {/* Fly-ins are now merged into the unified trip list above */}

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
                            <span className="text-xs text-text-dim">{TIER_LABELS[tier] ?? ''}</span>
                            <span className="text-xs text-text-dim/70">— {entry.reason}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {noGames.length > 0 && (() => {
                  // Split into expected (season over) vs actionable (missing data)
                  const seasonOver = noGames.filter((e) => e.reason.includes('season may be over'))
                  const missingData = noGames.filter((e) => !e.reason.includes('season may be over'))
                  const t1Count = missingData.filter((e) => (playerMap.get(e.name)?.tier ?? 4) === 1).length
                  const t2Count = missingData.filter((e) => (playerMap.get(e.name)?.tier ?? 4) === 2).length

                  return (
                    <details id="section-no-games" className="rounded-xl border border-border/50 bg-surface">
                      <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-text-dim">
                        {noGames.length} player{noGames.length !== 1 ? 's' : ''} with no games in date range
                        {(t1Count > 0 || t2Count > 0) && (
                          <span className="ml-2 text-xs font-normal text-accent-orange">
                            ({t1Count > 0 ? `${t1Count} T1` : ''}{t1Count > 0 && t2Count > 0 ? ', ' : ''}{t2Count > 0 ? `${t2Count} T2` : ''} need attention)
                          </span>
                        )}
                      </summary>
                      <div className="border-t border-border/30 px-5 py-3 space-y-3">
                        {/* Actionable: missing data */}
                        {missingData.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-orange">Missing schedule data</p>
                            {missingData.map((entry) => {
                              const player = playerMap.get(entry.name)
                              const tier = player?.tier ?? 4
                              const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                              return (
                                <div key={entry.name} className="flex items-center gap-2 text-sm">
                                  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                                  <span className="font-medium text-accent-orange cursor-pointer hover:underline" onClick={() => setSelectedPlayer(entry.name)}>{entry.name}</span>
                                  <span className="text-xs text-text-dim">{TIER_LABELS[tier] ?? ''}</span>
                                  <span className="text-xs text-text-dim/70">— {entry.reason}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                        {/* Expected: season over */}
                        {seasonOver.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-dim/50">Season over for date range</p>
                            {seasonOver.map((entry) => {
                              const player = playerMap.get(entry.name)
                              const tier = player?.tier ?? 4
                              return (
                                <div key={entry.name} className="flex items-center gap-2 text-sm text-text-dim/60">
                                  <span className="h-2 w-2 rounded-full bg-gray-600" />
                                  <span className="cursor-pointer hover:underline" onClick={() => setSelectedPlayer(entry.name)}>{entry.name}</span>
                                  <span className="text-xs">{TIER_LABELS[tier] ?? ''}</span>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </details>
                  )
                })()}
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

      {/* Trip Anchor — "Already have a trip planned?" */}
      <TripAnchor
        allGames={[...proGames, ...ncaaGames, ...hsGames]}
        playerMap={playerMap}
        startDate={startDate}
        endDate={endDate}
      />

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

// --- Trip Anchor: "I'll be in [city], who can I see nearby?" ---
function TripAnchor({
  allGames,
  playerMap,
  startDate,
  endDate,
}: {
  allGames: import('../../types/schedule').GameEvent[]
  playerMap: Map<string, RosterPlayer>
  startDate: string
  endDate: string
}) {
  const [anchorCity, setAnchorCity] = useState('')
  const [, setAnchorCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<Array<{ playerName: string; venue: string; date: string; driveMin: number; org: string; tier: number }>>([])
  const [expanded, setExpanded] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const MAX_ANCHOR_DRIVE = 180 // 3h drive from anchor point

  async function handleSearch() {
    if (!anchorCity.trim()) return
    setSearching(true)
    setResults([])
    try {
      // Strip common prefixes like "I'll be in", "going to", etc.
      const cleanCity = anchorCity
        .replace(/^(i'll be in|i will be in|i'm going to|going to|visiting|traveling to|in)\s+/i, '')
        .trim()
      if (!cleanCity) { setSearching(false); return }

      // First check the bundled airports for quick match
      const { MAJOR_AIRPORTS } = await import('../../data/majorAirports')
      const cityLower = cleanCity.toLowerCase().trim()
      const airportMatch = MAJOR_AIRPORTS.find((a) =>
        a.name.toLowerCase().includes(cityLower) || a.code.toLowerCase() === cityLower
      )

      let coords: { lat: number; lng: number }
      if (airportMatch) {
        coords = airportMatch.coords
      } else {
        // Geocode via Nominatim
        const params = new URLSearchParams({ q: `${cleanCity}, USA`, format: 'json', limit: '1' })
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          headers: { 'User-Agent': 'SVTravelHub/1.0' },
        })
        const data = await res.json()
        if (!data.length) { setSearching(false); return }
        coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) }
      }

      setAnchorCoords(coords)

      // Find all games within driving range of this anchor during the date range
      const { estimateDriveMinutes } = await import('../../lib/tripEngine')
      const nearby: typeof results = []
      const seen = new Set<string>() // dedupe by player+date

      for (const game of allGames) {
        if (game.date < startDate || game.date > endDate) continue
        if (game.venue.coords.lat === 0) continue

        const driveMin = estimateDriveMinutes(coords, game.venue.coords)
        if (driveMin > MAX_ANCHOR_DRIVE) continue

        for (const name of game.playerNames) {
          const key = `${name}|${game.date}`
          if (seen.has(key)) continue
          seen.add(key)

          const player = playerMap.get(name)
          if (!player) continue

          nearby.push({
            playerName: name,
            venue: game.venue.name,
            date: game.date,
            driveMin: Math.round(driveMin),
            org: player.org,
            tier: player.tier,
          })
        }
      }

      // Sort by date, then tier
      nearby.sort((a, b) => a.date.localeCompare(b.date) || a.tier - b.tier)
      setResults(nearby)
      setExpanded(true)
    } catch (err) {
      console.warn('Anchor search failed:', err)
    }
    setSearching(false)
  }

  return (
    <div className="mt-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
      <label className="mb-2 block text-xs font-medium text-text-dim">
        Already have a trip planned? <span className="text-text-dim/50">(find players near your destination)</span>
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={anchorCity}
            onChange={(e) => { setAnchorCity(e.target.value); setShowSuggestions(true) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setShowSuggestions(false); handleSearch() } }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Type a city (e.g., Boston, Atlanta)"
            className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-dim/50 focus:border-accent-blue focus:outline-none"
          />
          {showSuggestions && anchorCity.length >= 2 && (() => {
            const q = anchorCity.toLowerCase()
            const matches = MAJOR_AIRPORTS.filter(a =>
              a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q)
            ).slice(0, 6)
            if (matches.length === 0) return null
            return (
              <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg overflow-hidden">
                {matches.map((a) => (
                  <button
                    key={a.code}
                    onClick={() => { setAnchorCity(a.name); setShowSuggestions(false); }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-sm text-left hover:bg-accent-blue/10 transition-colors"
                  >
                    <span className="text-text">{a.name}</span>
                    <span className="text-[10px] text-text-dim">{a.code}</span>
                  </button>
                ))}
              </div>
            )
          })()}
        </div>
        <button
          onClick={handleSearch}
          disabled={searching || !anchorCity.trim()}
          className="rounded-lg bg-purple-500/20 px-3 py-1.5 text-sm font-medium text-purple-400 hover:bg-purple-500/30 disabled:opacity-50"
        >
          {searching ? 'Searching...' : 'Find Players'}
        </button>
        {results.length > 0 && (
          <button onClick={() => { setResults([]); setAnchorCity(''); setExpanded(false) }} className="text-xs text-text-dim hover:text-text">Clear</button>
        )}
      </div>

      {expanded && results.length > 0 && (() => {
        // Group by player — show each player once with their game count and next dates
        const byPlayer = new Map<string, { dates: string[]; org: string; tier: number; driveMin: number; venue: string }>()
        for (const r of results) {
          const existing = byPlayer.get(r.playerName)
          if (existing) {
            if (!existing.dates.includes(r.date)) existing.dates.push(r.date)
          } else {
            byPlayer.set(r.playerName, { dates: [r.date], org: r.org, tier: r.tier, driveMin: r.driveMin, venue: r.venue })
          }
        }
        // Sort by tier, then by number of games
        const playerEntries = [...byPlayer.entries()].sort(([, a], [, b]) => a.tier - b.tier || b.dates.length - a.dates.length)

        return (
        <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
          <p className="mb-3 text-xs text-text-dim">
            <span className="font-medium text-purple-400">{playerEntries.length} players</span> within 3h drive of {anchorCity}
          </p>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {playerEntries.map(([name, info]) => {
              const sortedDates = info.dates.sort()
              const nextDates = sortedDates.slice(0, 4).map(d => formatDate(d))
              return (
                <div key={name} className="flex items-start gap-2 text-[11px]">
                  <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${TIER_DOT_COLORS[info.tier] ?? 'bg-gray-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text">{name}</span>
                      <span className="text-text-dim/60">{info.org}</span>
                      <span className="ml-auto text-text-dim/50">~{formatDriveTime(info.driveMin)} drive</span>
                    </div>
                    <p className="text-[10px] text-text-dim/60">
                      {info.dates.length} game{info.dates.length !== 1 ? 's' : ''} nearby: {nextDates.join(', ')}
                      {info.dates.length > 4 && ` +${info.dates.length - 4} more`}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Trip suggestion from anchor — one line per UNIQUE player */}
          {playerEntries.length > 0 && (
            <div className="mt-3 rounded-lg border border-accent-blue/30 bg-accent-blue/5 px-4 py-3">
              <p className="text-xs font-medium text-accent-blue mb-2">
                While you're near {anchorCity}:
              </p>
              <div className="space-y-1.5">
                {playerEntries.map(([name, info]) => {
                  const sortedDates = info.dates.sort()
                  const dateList = sortedDates.slice(0, 3).map(d => formatDate(d))
                  return (
                    <div key={name} className="text-[11px]">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1 ${TIER_DOT_COLORS[info.tier] ?? 'bg-gray-500'}`} />
                      <span className="font-medium text-text">{name}</span>
                      <span className="text-text-dim"> ({info.org})</span>
                      <span className="text-text-dim"> · ~{formatDriveTime(info.driveMin)} drive</span>
                      <span className="text-text-dim/60"> · {dateList.join(', ')}{sortedDates.length > 3 ? ` +${sortedDates.length - 3} more` : ''}</span>
                    </div>
                  )
                })}
              </div>
              {playerEntries.length > 1 && (
                <p className="mt-2 text-[10px] text-text-dim/60">
                  Best day to see multiple players: {(() => {
                    // Find dates where most players overlap
                    const dateCounts = new Map<string, number>()
                    for (const [, info] of playerEntries) {
                      for (const d of info.dates) dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1)
                    }
                    const best = [...dateCounts.entries()].sort((a, b) => b[1] - a[1])[0]
                    return best ? `${formatDate(best[0])} (${best[1]} players)` : 'varies'
                  })()}
                </p>
              )}
            </div>
          )}
        </div>
        )
      })()}

      {expanded && results.length === 0 && !searching && anchorCity && (
        <p className="mt-2 text-xs text-text-dim">No players found within 3h drive of {anchorCity} during this date range.</p>
      )}
    </div>
  )
}

function FlyInCard({
  visit, index, players, playerMap, priorityPlayers,
  dateConflicts: _dateConflicts, copiedFlyIn: _copiedFlyIn, setCopiedFlyIn: _setCopiedFlyIn, onPlayerClick, defaultExpanded,
}: {
  visit: import('../../types/schedule').FlyInVisit
  index: number
  players: RosterPlayer[]
  playerMap: Map<string, RosterPlayer>
  priorityPlayers: string[]
  dateConflicts?: number[]
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


  // Copy handler

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
              Trip #{index} <span className="text-sm">✈️</span>
              <span className="ml-1.5 text-sm font-medium text-purple-400">
                Fly to {findNearestAirport(visit.venue.coords).name}
              </span>
            </h3>
          </div>
          <p className="mt-0.5 text-sm text-text-dim">
            {dateLabel} · {visit.isCombo && visit.stops ? visit.stops.map(s => s.teamLabel || s.venue.name).join(' → ') : (orgLabel || visit.venue.name)} · {visit.playerNames.length} player{visit.playerNames.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
          {tierCounts.t1 > 0 && <span className="text-[11px] font-medium text-accent-red">{tierCounts.t1}× Must-see</span>}
          {tierCounts.t2 > 0 && <span className="text-[11px] font-medium text-accent-orange">{tierCounts.t2}× High priority</span>}
        </div>
      </div>

      {/* Expanded content — day-by-day itinerary */}
      {expanded && (() => {
        const bestDay = visit.dates.find(d => new Date(d + 'T12:00:00Z').getUTCDay() === 2) ?? visit.dates[0]!
        const isTue = new Date(bestDay + 'T12:00:00Z').getUTCDay() === 2
        const hasMultipleDays = visit.dates.length > 1

        // Combo trip: multi-stop fly-in with driving between venues
        if (visit.isCombo && visit.stops && visit.stops.length > 1) {
          const comboStops = visit.stops
          const nearestApt = findNearestAirport(comboStops[0]!.venue.coords)
          return (
          <div className="mt-4 space-y-3">
            {/* Natural language summary */}
            <p className="text-sm text-text-dim leading-relaxed bg-gray-950/40 rounded-lg px-4 py-2.5">
              {formatDate(comboStops[0]!.date)} – {formatDate(comboStops[comboStops.length - 1]!.date)}: Fly to {nearestApt.name} ({nearestApt.code}) (~{Math.round(visit.estimatedTravelHours - 3)}h flight).
              {comboStops.map((s, i) => {
                const names = s.playerNames.map((n) => {
                  const p = playerMap.get(n)
                  return p ? `${n} (${p.org})` : n
                }).join(', ')
                const drive = i > 0 && s.driveMinutesFromPrev > 0
                  ? ` Drive ${formatDriveTime(s.driveMinutesFromPrev)},`
                  : ''
                return ` Day ${i + 1}:${drive} see ${names} at ${s.teamLabel || s.venue.name}.`
              }).join('')}
              {' '}Fly home after.
            </p>

            {/* Day-by-day stops */}
            {comboStops.map((stop, i) => {
              const dayDate = new Date(stop.date + 'T12:00:00Z')
              const isTueDay = dayDate.getUTCDay() === 2
              return (
              <div key={i} className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-purple-400">Day {i + 1}</span>
                    <span className="text-xs text-text-dim">{formatDate(stop.date)}{isTueDay ? ' (best day)' : ''}</span>
                    {i > 0 && stop.driveMinutesFromPrev > 0 && (
                      <span className="text-[11px] text-accent-blue font-medium">
                        {formatDriveTime(stop.driveMinutesFromPrev)} drive from previous stop
                      </span>
                    )}
                  </div>
                  {i === 0 && <span className="text-[10px] text-text-dim">Fly from Orlando · ~{Math.round(visit.estimatedTravelHours - 3)}h flight</span>}
                </div>
                <div className="ml-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-text">{stop.teamLabel || stop.venue.name}</span>
                    {stop.teamLabel && stop.teamLabel !== stop.venue.name && (
                      <span className="text-[11px] text-text-dim/60">{stop.venue.name}</span>
                    )}
                    {stop.gameTime && (() => {
                      const d = new Date(stop.gameTime)
                      return !isNaN(d.getTime()) ? (
                        <span className="text-[11px] text-text-dim/60">
                          {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })} ET
                        </span>
                      ) : null
                    })()}
                    {stop.sourceUrl && (
                      <a href={stop.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-dim/50 hover:text-purple-400">Verify ↗</a>
                    )}
                  </div>
                  {isTueDay && <p className="mt-0.5 text-xs text-accent-blue font-medium">Tuesday — ideal for position players</p>}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {stop.playerNames.map((name) => {
                      const player = playerMap.get(name)
                      const tier = player?.tier ?? 4
                      const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                      return (
                        <span key={name} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text cursor-pointer hover:bg-accent-blue/10"
                          onClick={(e) => { e.stopPropagation(); onPlayerClick(name) }}>
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
                          {name} <span className="text-text-dim/50">{TIER_LABELS[tier] ?? ''}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
              )
            })}

            {/* Return day */}
            <div className="rounded-lg border border-border/30 bg-surface/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-text-dim">Day {comboStops.length + 1}</span>
                <span className="text-xs text-text-dim/50">Fly home</span>
              </div>
            </div>

            {flyInWhy && <p className="text-xs italic text-text-dim/60">{flyInWhy}</p>}
          </div>
          )
        }

        // Single-venue fly-in (existing behavior)
        return (
        <div className="mt-4 space-y-3">
          {/* Natural language summary */}
          <p className="text-sm text-text-dim leading-relaxed bg-gray-950/40 rounded-lg px-4 py-2.5">
            {(() => {
              const apt = findNearestAirport(visit.venue.coords)
              return `${formatDate(bestDay)}${hasMultipleDays ? ` – ${formatDate(visit.dates[visit.dates.length - 1]!)}` : ''}: Fly to ${apt.name} (${apt.code}) (~${Math.round(visit.estimatedTravelHours - 3)}h flight).`
            })()}
            {' '}See {visit.playerNames.map((n) => {
              const p = playerMap.get(n)
              return p ? `${n} (${p.org})` : n
            }).join(' and ')}{isTue ? ' (Tuesday — best day for position players)' : ''}.
            {' '}Fly home after.
          </p>

          {/* Day 1: Travel + Game */}
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-purple-400">Day 1</span>
                <span className="text-xs text-text-dim">{formatDate(bestDay)}{isTue ? ' (best day)' : ''}</span>
              </div>
              <span className="text-[10px] text-text-dim">Fly from Orlando · ~{Math.round(visit.estimatedTravelHours - 3)}h flight</span>
            </div>

            <div className="ml-4 space-y-2">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-text">
                    {orgLabel || visit.venue.name}
                  </span>
                  {orgLabel && orgLabel !== visit.venue.name && (
                    <span className="text-[11px] text-text-dim/60">{visit.venue.name}</span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${sourceBadge.color}`}>
                    {sourceBadge.label}
                  </span>
                  {visit.sourceUrl && (
                    <a href={visit.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-dim/50 hover:text-purple-400">Verify ↗</a>
                  )}
                </div>
                {isTue && (
                  <p className="mt-1 text-xs text-accent-blue font-medium">Tuesday — ideal for position players</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {visit.playerNames.map((name) => {
                    const player = playerMap.get(name)
                    const tier = player?.tier ?? 4
                    const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                    return (
                      <span key={name} className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text cursor-pointer hover:bg-accent-blue/10"
                        onClick={(e) => { e.stopPropagation(); onPlayerClick(name) }}>
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
                        {name} <span className="text-text-dim/50">{TIER_LABELS[tier] ?? ''}</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Day 2+ if multi-day */}
          {hasMultipleDays && visit.dates.filter(d => d !== bestDay).map((d, i) => (
            <div key={d} className="rounded-lg border border-border/30 bg-surface/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-text-dim">Day {i + 2}</span>
                <span className="text-xs text-text-dim">{formatDate(d)}</span>
                <span className="text-[10px] text-text-dim/50">Also available for games</span>
              </div>
            </div>
          ))}

          {/* Return day */}
          <div className="rounded-lg border border-border/30 bg-surface/50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-text-dim">Day {visit.dates.length + 1}</span>
                <span className="text-xs text-text-dim/50">Fly home</span>
              </div>
            </div>
          </div>

          {flyInWhy && (
            <p className="text-xs italic text-text-dim/60">{flyInWhy}</p>
          )}

        </div>
        )
      })()}
    </div>
  )
}
