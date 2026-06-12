import { useEffect, useMemo, useRef, useState } from 'react'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { useSummerStore } from '../../store/summerStore'
import CityPicker from '../ui/CityPicker'
import TripCard from './TripCard'
import CompareStarredTrips from './CompareStarredTrips'
import PlayerCoverageCard from './PlayerCoverageCard'
// ICS export removed from main UI — kept in individual trip cards
// import { generateAllTripsIcs, downloadIcs } from '../../lib/icsExport'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'
import { MAJOR_AIRPORTS, findNearestAirport } from '../../data/majorAirports'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const STARTING_LOCATIONS = [
  { name: 'Orlando, FL', coords: { lat: 28.5383, lng: -81.3792 } },
  { name: 'Denver, CO', coords: { lat: 39.7392, lng: -104.9903 } },
  { name: 'Phoenix, AZ', coords: { lat: 33.4484, lng: -112.0740 } },
  { name: 'Dallas, TX', coords: { lat: 32.7767, lng: -96.7970 } },
  { name: 'Atlanta, GA', coords: { lat: 33.7490, lng: -84.3880 } },
  { name: 'Nashville, TN', coords: { lat: 36.1627, lng: -86.7816 } },
  { name: 'Charlotte, NC', coords: { lat: 35.2271, lng: -80.8431 } },
  { name: 'Miami, FL', coords: { lat: 25.7617, lng: -80.1918 } },
  { name: 'Los Angeles, CA', coords: { lat: 34.0522, lng: -118.2437 } },
  { name: 'Chicago, IL', coords: { lat: 41.8781, lng: -87.6298 } },
  { name: 'New York, NY', coords: { lat: 40.7128, lng: -74.0060 } },
  { name: 'Houston, TX', coords: { lat: 29.7604, lng: -95.3698 } },
] as const

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

  // Read ?priority=PlayerName from URL (cross-app link from Insight Engine)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const priority = params.get('priority')
    if (priority && !priorityPlayers.includes(priority)) {
      useTripStore.getState().setPriorityPlayers([priority])
      // Clean URL without reload
      window.history.replaceState({}, '', window.location.pathname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const tripPlan = useTripStore((s) => s.tripPlan)
  const computing = useTripStore((s) => s.computing)
  const progressStep = useTripStore((s) => s.progressStep)
  const progressDetail = useTripStore((s) => s.progressDetail)
  const setDateRange = useTripStore((s) => s.setDateRange)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  const maxFlightHours = useTripStore((s) => s.maxFlightHours)
  const setMaxFlightHours = useTripStore((s) => s.setMaxFlightHours)
  const useHeartbeatBoost = useTripStore((s) => s.useHeartbeatBoost)
  const setUseHeartbeatBoost = useTripStore((s) => s.setUseHeartbeatBoost)
  const setPriorityPlayers = useTripStore((s) => s.setPriorityPlayers)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)
  const maxNights = useTripStore((s) => s.maxNights)
  const setMaxNights = useTripStore((s) => s.setMaxNights)
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

  // "Refine" disclosure for the 4 controls that are shared with the Map tab
  // (date range, starting city, drive radius). Collapsed by default since
  // they're typically set on the Map and inherited here. Click summary to expand.
  const [sharedControlsOpen, setSharedControlsOpen] = useState(false)
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score')
  const [tripFilter, setTripFilter] = useState<'all' | 'drive' | 'fly' | 'multi' | 'anchor' | 'starred'>('all')
  const [tripLengthFilter, setTripLengthFilter] = useState<'all' | '1' | '2' | '3'>('all')
  const [showAllTrips, setShowAllTrips] = useState(false)
  // tierFilter removed — was adding clutter to the results toolbar
  const [anchorPlayerNames, setAnchorPlayerNames] = useState<string[]>([])
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


  function handlePriorityChange(slot: number, value: string) {
    const next = [...priorityPlayers]
    if (value === '') {
      next.splice(slot, 1)
    } else {
      next[slot] = value
    }
    // Remove duplicates and empty slots
    setPriorityPlayers([...new Set(next.filter(Boolean))])
  }

  // 5 priority slots per Kent's interview ("if I select five players...")
  const PRIORITY_SLOTS = 5

  const [copiedFlyIn, setCopiedFlyIn] = useState<string | null>(null)
  const flyInLimit = 5

  // Always include fly-ins with priority players, then fill remaining slots up to limit
  const displayedFlyIns = useMemo(() => {
    if (!tripPlan) return []
    const priorityFlyIns = tripPlan.flyInVisits.filter(v =>
      v.playerNames.some(n => priorityPlayers.includes(n))
    )
    const otherFlyIns = tripPlan.flyInVisits.filter(v =>
      !v.playerNames.some(n => priorityPlayers.includes(n))
    )
    const remaining = Math.max(0, flyInLimit - priorityFlyIns.length)
    return [...priorityFlyIns, ...otherFlyIns.slice(0, remaining)]
  }, [tripPlan, priorityPlayers, flyInLimit])
  const [showOverlaps, setShowOverlaps] = useState(false)
  const proFetchedAt = useScheduleStore((s) => s.proFetchedAt)
  const cachedProTeamIds = useScheduleStore((s) => s.cachedProTeamIds)

  // ----------------------------------------------------------------------
  // Shared trip-numbering helper. Used by Priority Player Results, status
  // banner, AND the rendered trip list — so the displayed "Trip #N" matches
  // everywhere. Previously each site re-derived the order on its own and they
  // diverged when same-player+same-venue trips got merged into alt-date cards.
  // (Bug reported 2026-06-08: "Cade Doughty → Trip #8" pointed at the wrong
  // card because numbering didn't account for the merge.)
  //
  // Also applies a priority-first sort: when priorityPlayers is non-empty,
  // trips containing any priority player get pushed to the top so Kent
  // doesn't have to scroll past 8 irrelevant trips to find his guys.
  // ----------------------------------------------------------------------
  const tripDisplayInfo = useMemo(() => {
    if (!tripPlan) return { findTripNum: (_n: string) => 0, findAllTripNums: (_n: string) => [] as number[], groupCount: 0 }
    type Item =
      | { type: 'road'; trip: import('../../types/schedule').TripCandidate; sortDate: string }
      | { type: 'flyin'; visit: import('../../types/schedule').FlyInVisit; sortDate: string }
    const items: Item[] = [
      ...tripPlan.trips.map((trip): Item => ({ type: 'road', trip, sortDate: trip.anchorGame.date })),
      ...displayedFlyIns.map((visit): Item => ({ type: 'flyin', visit, sortDate: visit.dates[0] ?? '' })),
    ]
    const prioSet = new Set(priorityPlayers)
    function hasPriority(item: Item): boolean {
      if (prioSet.size === 0) return false
      if (item.type === 'road') {
        if (item.trip.anchorGame.playerNames.some((n) => prioSet.has(n))) return true
        return item.trip.nearbyGames.some((g) => g.playerNames.some((n) => prioSet.has(n)))
      }
      return item.visit.playerNames.some((n) => prioSet.has(n))
    }
    // Sort: priority-bearing first (when priority set), then by score (or date)
    items.sort((a, b) => {
      if (prioSet.size > 0) {
        const ap = hasPriority(a) ? 0 : 1
        const bp = hasPriority(b) ? 0 : 1
        if (ap !== bp) return ap - bp
      }
      if (sortBy === 'date') return a.sortDate.localeCompare(b.sortDate)
      const scoreA = a.type === 'road' ? (a.trip.scoreBreakdown?.finalScore ?? a.trip.visitValue) : a.visit.visitValue
      const scoreB = b.type === 'road' ? (b.trip.scoreBreakdown?.finalScore ?? b.trip.visitValue) : b.visit.visitValue
      return scoreB - scoreA
    })
    // Group identical trips by player-set + venue coords (same key the
    // render path uses for alternative-dates collapsing).
    function getGroupKey(item: Item): string {
      if (item.type === 'road') {
        const players = new Set([...item.trip.anchorGame.playerNames, ...item.trip.nearbyGames.flatMap((g) => g.playerNames)])
        const venueKey = `${item.trip.anchorGame.venue.coords.lat.toFixed(3)},${item.trip.anchorGame.venue.coords.lng.toFixed(3)}`
        return `road|${[...players].sort().join(',')}|${venueKey}`
      }
      const venueKey = `${item.visit.venue.coords.lat.toFixed(3)},${item.visit.venue.coords.lng.toFixed(3)}`
      return `flyin|${[...item.visit.playerNames].sort().join(',')}|${venueKey}`
    }
    const playerToTripNum = new Map<string, number>()
    const playerToAllTripNums = new Map<string, number[]>()
    const seenGroups = new Set<string>()
    let displayIdx = 0
    for (const item of items) {
      const key = getGroupKey(item)
      if (seenGroups.has(key)) continue
      seenGroups.add(key)
      displayIdx++
      const playerNames = item.type === 'road'
        ? new Set([...item.trip.anchorGame.playerNames, ...item.trip.nearbyGames.flatMap((g) => g.playerNames)])
        : new Set(item.visit.playerNames)
      // Track first occurrence (for backwards compat) AND every trip this
      // player appears in (so the status banner can show "Trips #1, #2, #4"
      // when a priority player is in multiple matched trips — Kent's
      // 2026-06-09 catch: "Cebert is in all trips so why does it say Trip 1?").
      for (const name of playerNames) {
        if (!playerToTripNum.has(name)) playerToTripNum.set(name, displayIdx)
        const arr = playerToAllTripNums.get(name) ?? []
        arr.push(displayIdx)
        playerToAllTripNums.set(name, arr)
      }
    }
    return {
      findTripNum: (playerName: string) => playerToTripNum.get(playerName) ?? 0,
      findAllTripNums: (playerName: string) => playerToAllTripNums.get(playerName) ?? [],
      groupCount: displayIdx,
    }
  }, [tripPlan, displayedFlyIns, priorityPlayers, sortBy])

  const anyScheduleLoading = schedulesLoading || ncaaLoading || hsLoading
  const allSchedulesLoaded = proGames.length > 0 && ncaaGames.length > 0 && (!hasHsPlayers || hsGames.length > 0)

  // Compute staleness — only pro schedules can go stale (live-fetched from MLB API).
  // NCAA and HS schedules are bundled as static data and don't expire.
  const now = Date.now()
  const STALE_THRESHOLD = 24 * 60 * 60 * 1000 // 24 hours
  const proStale = proFetchedAt ? (now - proFetchedAt > STALE_THRESHOLD) : false
  const anyStale = proStale

  // Summer assignment + game counts for the freshness pill
  const summerAssignmentsCount = useSummerStore((s) => s.assignments.length)
  const summerActiveCount = useSummerStore((s) => s.assignments.filter((a) => a.active).length)
  const summerGamesCount = useSummerStore((s) => s.summerGames.length)
  const summerUnresolved = useSummerStore((s) => s.unresolvedPlayers.length)
  const summerFetchedAt = useSummerStore((s) => s.fetchedAt)
  const rosterMovesCount = useScheduleStore((s) => s.rosterMoves.length)
  const rosterMovesCheckedAt = useScheduleStore((s) => s.rosterMovesCheckedAt)

  // Freshness helper — formats a timestamp as "5h ago" / "2d ago"
  function relativeAge(iso: string | null | undefined): string {
    if (!iso) return 'never'
    const ageMs = Date.now() - new Date(iso).getTime()
    const h = ageMs / 3600000
    if (h < 1) return 'just now'
    if (h < 24) return `${Math.round(h)}h ago`
    return `${Math.round(h / 24)}d ago`
  }

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

    // 2. NCAA — bundled data loads instantly
    const ncaaAllOrgs = players
      .filter((p) => p.level === 'NCAA')
      .map((p) => ({ playerName: p.playerName, org: p.org }))
    if (ncaaAllOrgs.length > 0) {
      schedStore.fetchNcaaSchedules(ncaaAllOrgs)
    }

    // 3. HS — bundled data loads instantly (includes pre-geocoded venue coords)
    // NO geocoding needed — bundled homeVenue coords are used directly
    if (hasHsPlayers) {
      const hsOrgs = players
        .filter((p) => p.level === 'HS')
        .map((p) => ({ playerName: p.playerName, org: p.org, state: p.state }))
      if (hsOrgs.length > 0) {
        schedStore.fetchHsSchedules(hsOrgs)
      }
    }

    // 4. Summer — fetch live partner-league schedules (CCBL, MLBD)
    const summerStore = useSummerStore.getState()
    if (summerStore.assignments.length === 0) {
      await summerStore.loadAssignments()
    }
    if (useSummerStore.getState().assignments.length > 0) {
      const y = new Date().getFullYear()
      summerStore.loadSchedules(`${y}-05-20`, `${y}-08-31`)
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

          {/* Freshness row — small status pills for each data layer */}
          {allSchedulesLoaded && !anyScheduleLoading && (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-text-dim">
              <span className="rounded bg-gray-800/60 px-1.5 py-0.5" title={`Pro schedules last fetched ${relativeAge(proFetchedAt ? new Date(proFetchedAt).toISOString() : null)}. Live from MLB Stats API.`}>
                Pro · {proGames.length} games · {proStale ? <span className="text-accent-orange">stale</span> : relativeAge(proFetchedAt ? new Date(proFetchedAt).toISOString() : null)}
              </span>
              <span className="rounded bg-gray-800/60 px-1.5 py-0.5" title="NCAA schedules are bundled from D1Baseball generation. Static.">
                NCAA · {ncaaGames.length} games · bundled
              </span>
              {hasHsPlayers && (
                <span className="rounded bg-gray-800/60 px-1.5 py-0.5" title="HS schedules are bundled from a generated CSV. Static.">
                  HS · {hsGames.length} games · bundled
                </span>
              )}
              {summerAssignmentsCount > 0 && (
                <span className="rounded bg-gray-800/60 px-1.5 py-0.5"
                  title={`${summerActiveCount} active summer assignment(s); ${summerGamesCount} games loaded${summerUnresolved > 0 ? `; ${summerUnresolved} player(s) without fetchable schedule (PGCBL/NECBL/FCBL pending)` : ''}.`}>
                  Summer · {summerGamesCount} games · {relativeAge(summerFetchedAt)}
                  {summerUnresolved > 0 && <span className="ml-1 text-accent-orange">({summerUnresolved} pending)</span>}
                </span>
              )}
              {rosterMovesCheckedAt && (
                <span className="rounded bg-gray-800/60 px-1.5 py-0.5"
                  title={`MLB transactions checked ${relativeAge(rosterMovesCheckedAt)}. ${rosterMovesCount} player movement(s) detected.`}>
                  Roster moves · {rosterMovesCount === 0 ? 'none' : `${rosterMovesCount} detected`} · {relativeAge(rosterMovesCheckedAt)}
                </span>
              )}
            </div>
          )}

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
                  label={`HS Schedules${hsGames.length > 0 ? ` (${hsGames.length} games, ${new Set(hsGames.flatMap(g => g.playerNames)).size} players)` : ''}`}
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

        {/* Refine bar — the date range, starting city, and drive radius are
            all shared with the Map tab via the trip store. Most users set
            them on the Map and arrive here ready to generate. We surface a
            one-line summary by default and offer "Edit" to expand. */}
        <div className="mb-3 rounded-lg border border-border bg-gray-950/30 px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-text-dim/60 uppercase tracking-wide text-[10px]">Synced w/ Map:</span>
            <span className="text-text">
              <span className="text-text-dim/60">Dates</span> {formatDate(startDate)}–{formatDate(endDate)}
            </span>
            <span className="text-text-dim/30">·</span>
            <span className="text-text">
              <span className="text-text-dim/60">From</span> {homeBaseName}
            </span>
            <span className="text-text-dim/30">·</span>
            <span className="text-text">
              <span className="text-text-dim/60">Drive</span> {Math.floor(maxDriveMinutes / 60)}h
            </span>
            <button
              onClick={() => setSharedControlsOpen((v) => !v)}
              className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] text-text-dim hover:text-text hover:border-accent-blue/50"
              title="Show the shared filter controls in this tab"
            >
              {sharedControlsOpen ? 'Hide' : 'Edit'}
            </button>
          </div>
        </div>

        {/* Quick date presets — always available as a one-click shortcut. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([
            { label: 'Next 30 days', days: 30 },
            { label: 'Next 3 months', days: 90 },
            { label: 'Full season', days: 0 },
          ]).map(({ label, days }) => (
            <button
              key={label}
              onClick={() => {
                const today = new Date().toISOString().split('T')[0]!
                if (days === 0) {
                  const y = new Date().getFullYear()
                  setDateRange(today, `${y}-09-30`)
                } else {
                  const end = new Date()
                  end.setDate(end.getDate() + days)
                  setDateRange(today, end.toISOString().split('T')[0]!)
                }
              }}
              className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Shared-with-Map controls — hidden by default behind the "Edit"
              toggle in the Synced banner above. Keeps the planner focused on
              trip-specific knobs (flight cap, trip length) which can't be
              set elsewhere. */}
          {sharedControlsOpen && (
            <>
              <div>
                <label className="mb-1 block text-xs text-text-dim">Start Date</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      const val = e.target.value
                      if (!val) return
                      if (val > endDate) {
                        const end = new Date(val + 'T12:00:00')
                        end.setDate(end.getDate() + 7)
                        setDateRange(val, end.toISOString().split('T')[0]!)
                      } else {
                        setDateRange(val, endDate)
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
                    onChange={(e) => setDateRange(startDate, e.target.value)}
                    className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
                  />
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                    {getDayName(endDate)}
                  </span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">Starting From</label>
                <CityPicker
                  value={homeBaseName}
                  onChange={(coords, name) => setHomeBase(coords, name)}
                  presets={STARTING_LOCATIONS.map((l) => ({ name: l.name, coords: { lat: l.coords.lat, lng: l.coords.lng } }))}
                  buttonClass="min-w-[160px] py-1.5 text-sm"
                  title="Where you'll be traveling from. Type any city or pick from common ones."
                />
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
                  {homeBaseName === 'Orlando, FL'
                    ? (maxDriveMinutes <= 150 ? 'Covers central FL' : maxDriveMinutes <= 210 ? 'Reaches Tampa, Jacksonville, Port St. Lucie' : maxDriveMinutes <= 270 ? 'Reaches Tallahassee, South FL' : 'Reaches most of FL + southern GA')
                    : `~${Math.round(maxDriveMinutes / 60)}h radius from ${homeBaseName}`}
                  {' · estimates only'}
                </p>
              </div>
            </>
          )}
          <div>
            <label className="mb-1 block text-xs text-text-dim">
              Max Flight: {maxFlightHours}h
            </label>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={maxFlightHours}
              onChange={(e) => setMaxFlightHours(parseFloat(e.target.value))}
              className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
            />
            <p className="mt-0.5 text-[9px] text-text-dim/50" title="Pure flight (air) time only — does not include airport / rental car overhead. Add ~3h for door-to-door.">
              {maxFlightHours <= 1.5 ? 'Short hops only (NY→BOS, ATL→CLT)' : maxFlightHours <= 2.5 ? 'Reaches NE corridor / Midwest' : maxFlightHours <= 4 ? 'Most domestic (coast-to-coast tight)' : maxFlightHours <= 5.5 ? 'Coast-to-coast comfortable' : 'All domestic + Hawaii'}
              {' · pure flight, not door-to-door'}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-dim">
              Max Trip: {maxNights} night{maxNights !== 1 ? 's' : ''}
            </label>
            <div className="flex gap-1">
              {([1, 2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setMaxNights(n)}
                  title={n === 1 ? 'Day trips and overnights only — back home the next day.' : n === 2 ? 'Up to 2 nights away — covers most multi-stop trips.' : n === 3 ? 'Up to 3 nights — good when family is coming along.' : 'Extended trips up to 4 nights away.'}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    maxNights === n ? 'bg-accent-blue/20 text-accent-blue ring-1 ring-accent-blue/30' : 'bg-gray-950 border border-border text-text-dim hover:text-text'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-0.5 text-[9px] text-text-dim/50">
              {maxNights === 1 ? 'Quick trips — 1-2 days max' : maxNights === 2 ? 'Standard trips — up to 3 days' : maxNights === 3 ? 'Extended trips — up to 4 days' : 'Long trips — up to 5 days'}
            </p>
          </div>
          {/* Starting From was previously rendered here on the right; moved
              up to sit next to End Date. */}
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

        {/* Heartbeat boost toggle */}
        <label className="mt-3 flex items-center gap-2 text-xs text-text-dim cursor-pointer">
          <input
            type="checkbox"
            checked={useHeartbeatBoost}
            onChange={(e) => setUseHeartbeatBoost(e.target.checked)}
            className="rounded border-border accent-accent-blue"
          />
          Prioritize overdue players
          <span className="text-text-dim/50">(boost players who haven't been visited recently according to the <a href="https://sv-heartbeat.vercel.app/" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">Heartbeat app</a>)</span>
        </label>

        {/* Priority players */}
        <div className="mt-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority Players <span className="text-text-dim/50">(optional — guarantees these players appear in your trip results, even if they require a flight)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            {Array.from({ length: PRIORITY_SLOTS }, (_, i) => (
              <PlayerSearchPicker
                key={i}
                value={priorityPlayers[i] ?? ''}
                players={eligibleForPriority}
                excludeNames={priorityPlayers.filter((_, j) => j !== i)}
                placeholder={`Type to search player ${i + 1}...`}
                onChange={(name) => handlePriorityChange(i, name)}
              />
            ))}
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

      {/* Did you know? — rotating app tips */}
      <DidYouKnow />

      {/* First-time welcome — dismissible */}
      {!tripPlan && !computing && <WelcomeHint />}

      {/* Empty state coaching — when no trips generated yet */}
      {!tripPlan && !computing && allSchedulesLoaded && (
        <div className="rounded-xl border border-border/50 bg-surface/50 px-5 py-6 text-center">
          <p className="text-sm text-text-dim">Set your date range above and hit <span className="font-medium text-accent-blue">Generate Trips</span> to see trip options.</p>
        </div>
      )}

      {/* Results */}
      {tripPlan && (
        <>
          {/* Priority player results — compact rows + split-region banner.
              Kent's 2026-06-08 question: when 2 priority players are in
              different regions (e.g. Tampa drive vs Phoenix flight), don't
              force-combine into one impractical 4-day trip — show them
              separately AND name the situation up-front. */}
          {tripPlan.priorityResults && tripPlan.priorityResults.length > 0 && (() => {
            const findUnifiedTripNum = tripDisplayInfo.findTripNum
            const assignments = useScheduleStore.getState().playerTeamAssignments

            // Build per-player display rows with transport mode + city
            type PrRow = {
              name: string
              teamName: string
              city: string
              tripNum: number
              mode: 'drive' | 'flight' | 'none'
              note?: string
            }
            const rows: PrRow[] = tripPlan.priorityResults.map((r) => {
              const player = playerMap.get(r.playerName)
              const assignment = assignments[r.playerName]
              const teamName = assignment?.teamName ?? player?.org ?? ''
              const tripNum = findUnifiedTripNum(r.playerName)
              // Derive city from the matched trip when possible
              let city = ''
              if (tripNum > 0) {
                const t = tripPlan.trips.find((trip) =>
                  trip.anchorGame.playerNames.includes(r.playerName) ||
                  trip.nearbyGames.some((g) => g.playerNames.includes(r.playerName)))
                if (t) {
                  // Pull the venue name + extract city-ish suffix if no separate field
                  city = t.anchorGame.venue.name
                } else {
                  const fv = tripPlan.flyInVisits.find((v) => v.playerNames.includes(r.playerName))
                  if (fv) city = fv.venue.name
                }
              }
              const mode: 'drive' | 'flight' | 'none' =
                (r.status === 'included' || r.status === 'separate-trip') ? 'drive'
                : r.status === 'fly-in-only' ? 'flight'
                : 'none'
              let note: string | undefined
              if (mode === 'none') {
                note = r.status === 'unreachable'
                  ? `No games in date range${r.reason ? ` — ${r.reason}` : ''}`
                  : 'Has games but not yet matched to a trip'
              } else if (tripNum === 0) {
                note = 'Trip generated but not displayed — widen filters or date range'
              }
              return { name: r.playerName, teamName, city, tripNum, mode, note }
            })

            const driveCount = rows.filter((r) => r.mode === 'drive').length
            const flightCount = rows.filter((r) => r.mode === 'flight').length
            // Unique flight destinations (rough: split by city — different
            // venue names imply different geographies)
            const flightCities = new Set(rows.filter((r) => r.mode === 'flight').map((r) => r.city.toLowerCase()))
            const splitRegions = (driveCount > 0 && flightCount > 0) || flightCities.size > 1

            return (
            <div className="rounded-xl border border-accent-blue/30 bg-accent-blue/5 p-4">
              <h3 className="mb-2 text-sm font-semibold text-accent-blue">Priority Player Results</h3>

              {splitRegions && (
                <div className="mb-3 rounded-md border border-accent-blue/30 bg-accent-blue/10 px-3 py-2 text-xs text-accent-blue/90 leading-relaxed">
                  <strong>Your priority players are in different regions.</strong>{' '}
                  Visiting them all in one trip would require multiple flights and 4+ days.
                  The trips below show each one planned <em>separately</em> — pick the dates that work for each.
                </div>
              )}

              <div className="space-y-1.5">
                {rows.map((r) => {
                  const modeBadge = r.mode === 'drive'
                    ? { icon: '🚗', label: 'Drive', color: 'bg-accent-green/15 text-accent-green' }
                    : r.mode === 'flight'
                    ? { icon: '✈', label: 'Flight', color: 'bg-accent-blue/15 text-accent-blue' }
                    : { icon: '—', label: 'No trip', color: 'bg-gray-700/40 text-text-dim' }
                  return (
                    <div key={r.name} className="flex flex-wrap items-center gap-2 rounded-md bg-surface/50 px-3 py-1.5 text-sm">
                      <span className="font-medium text-text">{r.name}</span>
                      {r.teamName && <span className="text-xs text-text-dim">· {r.teamName}</span>}
                      <span className="ml-auto flex items-center gap-2">
                        {r.tripNum > 0 ? (
                          <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${modeBadge.color}`}>
                            <span>{modeBadge.icon}</span>
                            <span>{modeBadge.label} · Trip #{r.tripNum}</span>
                          </span>
                        ) : (
                          <span className={`flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${r.mode === 'none' ? 'bg-accent-red/15 text-accent-red' : 'bg-accent-orange/15 text-accent-orange'}`}>
                            {r.note ?? 'Not matched'}
                          </span>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>

              {splitRegions && (
                <p className="mt-2 text-[11px] text-text-dim/60">
                  Want to bundle them anyway? Plan the closer one first, then book a one-way flight after.
                  A true multi-modal "drive + fly" itinerary builder is on the roadmap.
                </p>
              )}
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

            const notCoveredCount = Math.max(0, totalEligible - allTripPlayerNames.length)

            // Build detailed breakdown of why players aren't covered
            const coveredSet = new Set(allTripPlayerNames)
            const uncoveredPlayers = players.filter((p) => !coveredSet.has(p.playerName))
            const unvisitableMap = new Map(tripPlan.unvisitablePlayers.map((u) => [u.name, u.reason]))

            // Group by reason — inactive players (from skippedPlayers) first
            const skippedMap = new Map(tripPlan.skippedPlayers.map((s) => [s.name, s.reason]))
            const inactivePlayers = uncoveredPlayers.filter((p) => {
              const reason = skippedMap.get(p.playerName)
              return reason && reason !== 'Tier 4 — no visits required'
            })
            const inactiveSet = new Set(inactivePlayers.map(p => p.playerName))
            const remainingUncovered = uncoveredPlayers.filter(p => !inactiveSet.has(p.playerName))

            const beyondFlight = remainingUncovered.filter((p) => unvisitableMap.get(p.playerName)?.startsWith('Beyond max flight'))
            const noGamesInRange = remainingUncovered.filter((p) => {
              const r = unvisitableMap.get(p.playerName)
              return r && !r.includes('not selected') && (r.includes('No games in date range') || r.includes('season may be over'))
            })
            const noSchedule = remainingUncovered.filter((p) => {
              const r = unvisitableMap.get(p.playerName)
              return r && (r.includes('No schedule') || r.includes('No venue') || r.includes('geocoding'))
            })
            const otherUncovered = remainingUncovered.filter((p) =>
              !beyondFlight.includes(p) && !noGamesInRange.includes(p) && !noSchedule.includes(p)
            )

            return (
            <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total Trips" value={tripPlan.trips.length + displayedFlyIns.length} scrollTo="section-road-trips" hoverNames={allTripPlayerNames} />
              <div title={`${allTripPlayerNames.length} of your ${totalEligible} players appear in at least one trip option.`}>
                <StatCard label="Players in Trips" value={allTripPlayerNames.length} accent="blue" scrollTo="section-road-trips" hoverNames={allTripPlayerNames} />
              </div>
              <StatCard
                label="Not Covered"
                value={notCoveredCount}
                accent={notCoveredCount <= 2 ? 'green' : 'orange'}
                hoverNames={uncoveredPlayers.map((p) => p.playerName)}
              />
            </div>

            {/* Not Covered explainer — expandable */}
            {notCoveredCount > 0 && (
              <NotCoveredExplainer
                inactivePlayers={inactivePlayers}
                skippedMap={skippedMap}
                beyondFlight={beyondFlight}
                noGamesInRange={noGamesInRange}
                noSchedule={noSchedule}
                otherUncovered={otherUncovered}
                unvisitableMap={unvisitableMap}
                onPlayerClick={setSelectedPlayer}
                priorityPlayers={priorityPlayers}
                setPriorityPlayers={setPriorityPlayers}
              />
            )}
            </>
            )
          })()}

          {/* Priority player status — the most important thing */}
          {priorityPlayers.length > 0 && (() => {
            // Use shared tripDisplayInfo for matching trip numbers.
            const findAllTripNums = tripDisplayInfo.findAllTripNums
            const prioInTrip = priorityPlayers.filter((n) => findAllTripNums(n).length > 0)
            const prioMissing = priorityPlayers.filter((n) => findAllTripNums(n).length === 0)
            function formatTrips(name: string): string {
              const nums = findAllTripNums(name)
              if (nums.length === 1) return `${name} → Trip #${nums[0]}`
              if (nums.length <= 3) return `${name} → Trips #${nums.join(', #')}`
              return `${name} → Trips #${nums.slice(0, 3).join(', #')} (+${nums.length - 3} more)`
            }
            return (
              <div className={`rounded-lg px-3 py-2 ${prioMissing.length > 0 ? 'bg-accent-orange/10 border border-accent-orange/30' : 'bg-accent-green/10 border border-accent-green/30'}`}>
                <p className="text-sm font-medium">
                  {prioInTrip.length > 0 && (
                    <span className="text-accent-green">
                      {prioInTrip.map(formatTrips).join(' · ')}
                    </span>
                  )}
                  {prioInTrip.length > 0 && prioMissing.length > 0 && (
                    <span className="text-text-dim/30 mx-2">|</span>
                  )}
                  {prioMissing.length > 0 && (
                    <span className="text-accent-red">{prioMissing.join(', ')} not found in any trip option</span>
                  )}
                </p>
              </div>
            )
          })()}

          {/* Zero road trips explanation */}
          {tripPlan.trips.length === 0 && tripPlan.flyInVisits.length > 0 && (
            <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-4 py-3">
              <p className="text-sm text-accent-orange">
                No road trips possible — all players with games are beyond the {Math.floor(maxDriveMinutes / 60)}h drive radius from {homeBaseName}.
                See fly-in options below, or increase the max drive time.
              </p>
            </div>
          )}

          {/* Zero everything — no results at all */}
          {tripPlan.trips.length === 0 && tripPlan.flyInVisits.length === 0 && (
            <div className="rounded-xl border border-border/50 bg-surface/50 px-5 py-6 text-center space-y-2">
              <p className="text-sm font-medium text-text">No trip options found for this date range.</p>
              <p className="text-xs text-text-dim">
                Try extending your end date, increasing the drive or flight time sliders, or checking that schedules are loaded for your players.
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
              ...displayedFlyIns.map((visit) => ({
                type: 'flyin' as const,
                visit,
                sortDate: visit.dates[0] ?? '',
              })),
            ]

            // Sort: when priority players are set, trips containing them
            // rank FIRST (Kent 2026-06-08: "frustrating to get trips that do
            // not include those players"). Within each group, by score desc.
            const prioritySet = new Set(priorityPlayers)
            function itemHasPriorityPlayer(item: UnifiedItem): boolean {
              if (prioritySet.size === 0) return false
              if (item.type === 'road') {
                if (item.trip.anchorGame.playerNames.some((n) => prioritySet.has(n))) return true
                return item.trip.nearbyGames.some((g) => g.playerNames.some((n) => prioritySet.has(n)))
              }
              return item.visit.playerNames.some((n) => prioritySet.has(n))
            }
            unified.sort((a, b) => {
              if (prioritySet.size > 0) {
                const ap = itemHasPriorityPlayer(a) ? 0 : 1
                const bp = itemHasPriorityPlayer(b) ? 0 : 1
                if (ap !== bp) return ap - bp
              }
              const scoreA = a.type === 'road' ? (a.trip.scoreBreakdown?.finalScore ?? a.trip.visitValue) : (a.visit.visitValue)
              const scoreB = b.type === 'road' ? (b.trip.scoreBreakdown?.finalScore ?? b.trip.visitValue) : (b.visit.visitValue)
              return scoreB - scoreA
            })

            // --- Alternative Dates Grouping ---
            // Group trips with the same players + destination into one card with date alternatives.
            // Signature: type + sorted player names + venue coords (3 decimal places)
            function getGroupKey(item: UnifiedItem): string {
              if (item.type === 'road') {
                const players = new Set([...item.trip.anchorGame.playerNames, ...item.trip.nearbyGames.flatMap(g => g.playerNames)])
                const venueKey = `${item.trip.anchorGame.venue.coords.lat.toFixed(3)},${item.trip.anchorGame.venue.coords.lng.toFixed(3)}`
                return `road|${[...players].sort().join(',')}|${venueKey}`
              } else {
                const venueKey = `${item.visit.venue.coords.lat.toFixed(3)},${item.visit.venue.coords.lng.toFixed(3)}`
                return `flyin|${[...item.visit.playerNames].sort().join(',')}|${venueKey}`
              }
            }

            type GroupedItem = {
              primary: UnifiedItem
              alternatives: UnifiedItem[] // other date options (sorted by score, best first)
            }

            const groupMap = new Map<string, GroupedItem>()
            const groupOrder: string[] = [] // preserve insertion order (= score order)
            for (const item of unified) {
              const key = getGroupKey(item)
              const existing = groupMap.get(key)
              if (existing) {
                existing.alternatives.push(item)
              } else {
                groupMap.set(key, { primary: item, alternatives: [] })
                groupOrder.push(key)
              }
            }
            const grouped: GroupedItem[] = groupOrder.map(k => groupMap.get(k)!)

            // Apply final sort to grouped list
            if (sortBy === 'date') {
              grouped.sort((a, b) => a.primary.sortDate.localeCompare(b.primary.sortDate))
            }
            // (score sort is already applied — primary is the best-scored variant)

            // Number trips sequentially — one counter across groups
            const numbered = grouped.map((group, i) => ({
              ...group,
              displayIndex: i + 1,
            }))

            // Filter helper — works on the primary item of each group
            function passesFilters(item: UnifiedItem): boolean {
              // Transport type filter
              if (tripFilter === 'drive' && item.type !== 'road') return false
              if (tripFilter === 'fly' && item.type !== 'flyin') return false
              if (tripFilter === 'multi') {
                if (item.type === 'road') {
                  const playerSet = new Set([...item.trip.anchorGame.playerNames, ...item.trip.nearbyGames.flatMap(g => g.playerNames)])
                  if (playerSet.size < 2) return false
                } else {
                  if (item.visit.playerNames.length < 2) return false
                }
              }
              if (tripFilter === 'anchor' && anchorPlayerNames.length > 0) {
                if (item.type === 'road') {
                  const tripPlayers = [...item.trip.anchorGame.playerNames, ...item.trip.nearbyGames.flatMap(g => g.playerNames)]
                  if (!tripPlayers.some(n => anchorPlayerNames.includes(n))) return false
                } else {
                  if (!item.visit.playerNames.some(n => anchorPlayerNames.includes(n))) return false
                }
              }
              // Starred filter — only show Kent's favorites (road trips only;
              // fly-ins don't have stable keys today).
              if (tripFilter === 'starred') {
                if (item.type !== 'road') return false
                const key = getTripKey(item.trip)
                if (!useTripStore.getState().starredTrips[key]) return false
              }

              // Trip length filter (fly-ins add +1 for return travel day, matching the card display)
              if (tripLengthFilter !== 'all') {
                const targetDays = Number(tripLengthFilter)
                const actualDays = item.type === 'road'
                  ? item.trip.suggestedDays.length
                  : item.visit.dates.length + 1
                if (actualDays !== targetDays) return false
              }

              return true
            }

            const filtered = numbered.filter((group) => passesFilters(group.primary))

            // When priority players are set, also hide trips that don't
            // include any of them. Kent's principle 2026-06-08: "fewer
            // options and just make sure the ones we suggest are good and
            // relevant to the filters."
            const relevantToFilters = prioritySet.size > 0
              ? filtered.filter((g) => itemHasPriorityPlayer(g.primary))
              : filtered

            // Cap displayed trips (default 5) with a Show all expander —
            // fewer options surfaced by default. Kent's principle: quality
            // over quantity.
            const DEFAULT_TRIP_CAP = 5
            const capped = showAllTrips ? relevantToFilters : relevantToFilters.slice(0, DEFAULT_TRIP_CAP)
            const hasMore = relevantToFilters.length > capped.length

            const totalCollapsed = unified.length - grouped.length // how many trips were collapsed

            // Confidence summary: count games by source across all trips
            const confidenceCounts = { mlb: 0, d1: 0, hsConfirmed: 0, estimated: 0 }
            const countedGameIds = new Set<string>()
            function countGame(g: { id: string; source: import('../../types/schedule').ScheduleSource; confidence?: import('../../types/schedule').VisitConfidence }) {
              if (countedGameIds.has(g.id)) return
              countedGameIds.add(g.id)
              if (g.source === 'mlb-api') confidenceCounts.mlb++
              else if (g.source === 'ncaa-lookup' && g.confidence === 'high') confidenceCounts.d1++
              else if (g.source === 'hs-lookup' && g.confidence === 'high') confidenceCounts.hsConfirmed++
              else confidenceCounts.estimated++
            }
            for (const item of unified) {
              if (item.type === 'road') {
                countGame(item.trip.anchorGame)
                for (const g of item.trip.nearbyGames) countGame(g)
              } else if (item.visit.isCombo && item.visit.stops) {
                for (const s of item.visit.stops) countGame({ id: `${s.venue.name}-${s.date}`, source: s.source, confidence: s.confidence })
              } else {
                countGame({ id: `${item.visit.venue.name}-${item.visit.dates[0]}`, source: item.visit.source, confidence: item.visit.confidence })
              }
            }
            const totalGames = confidenceCounts.mlb + confidenceCounts.d1 + confidenceCounts.hsConfirmed + confidenceCounts.estimated

            return (
            <div id="section-road-trips">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-text">
                  Your Trips
                  <span className="ml-2 text-xs font-normal text-text-dim">
                    {filtered.length === grouped.length
                      ? `${grouped.length} trip options`
                      : `${filtered.length} of ${grouped.length} trips`}
                    {totalCollapsed > 0 && ` (${totalCollapsed} alt dates merged)`}
                  </span>
                </h3>
                {totalGames > 0 && (
                  <p className="mt-1 text-[11px] text-text-dim/70">
                    Data quality: {' '}
                    {confidenceCounts.mlb > 0 && <span className="text-accent-green">{confidenceCounts.mlb} confirmed <span className="text-text-dim/40">(MLB API)</span></span>}
                    {confidenceCounts.mlb > 0 && (confidenceCounts.d1 + confidenceCounts.hsConfirmed + confidenceCounts.estimated > 0) && <span className="text-text-dim/30"> · </span>}
                    {confidenceCounts.d1 > 0 && <span className="text-accent-blue/70">{confidenceCounts.d1} likely <span className="text-text-dim/40">(D1Baseball)</span></span>}
                    {confidenceCounts.d1 > 0 && (confidenceCounts.hsConfirmed + confidenceCounts.estimated > 0) && <span className="text-text-dim/30"> · </span>}
                    {confidenceCounts.hsConfirmed > 0 && <span className="text-accent-blue/70">{confidenceCounts.hsConfirmed} confirmed <span className="text-text-dim/40">(MaxPreps)</span></span>}
                    {confidenceCounts.hsConfirmed > 0 && confidenceCounts.estimated > 0 && <span className="text-text-dim/30"> · </span>}
                    {confidenceCounts.estimated > 0 && <span className="text-accent-orange">{confidenceCounts.estimated} estimated <span className="text-text-dim/40">(location approximate)</span></span>}
                  </p>
                )}
              </div>

              {/* Compact toolbar */}
              <div className="sticky top-0 z-10 -mx-5 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-b-lg bg-surface px-5 pb-2 pt-2 border-b border-border/30">
                <span className="text-[11px] text-text-dim">Sort:</span>
                {([
                  { key: 'score', label: 'Best', tip: 'Sort by our recommendation — factors in player tier, travel efficiency, and how many players you can see per trip.' },
                  { key: 'date', label: 'Date', tip: 'Sort chronologically — earliest trips first, so you can plan week by week.' },
                ] as const).map(({ key, label, tip }) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    title={tip}
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
                  { key: 'all', label: 'All', tip: 'Show all trip options — drives and flights.' },
                  { key: 'drive', label: '🚗 Drives', tip: `Only show trips you can drive to from ${homeBaseName}.` },
                  { key: 'fly', label: '✈️ Flights', tip: 'Only show trips that require a flight.' },
                  { key: 'multi', label: '👥 2+ Players', tip: 'Only show trips where you can see 2 or more players.' },
                  ...(anchorPlayerNames.length > 0 ? [{ key: 'anchor' as const, label: '📍 Near destination', tip: 'Only show trips near your selected destination.' }] : []),
                  { key: 'starred', label: '★ Starred', tip: 'Show only trips you\'ve saved as favorites.' },
                ] as Array<{ key: typeof tripFilter; label: string; tip: string }>).map(({ key, label, tip }) => (
                  <button
                    key={key}
                    onClick={() => setTripFilter(key)}
                    title={tip}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      tripFilter === key ? 'bg-accent-blue/20 text-accent-blue' : 'bg-gray-800/50 text-text-dim hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="mx-1 text-text-dim/20">|</span>
                <span className="text-[11px] text-text-dim">Days:</span>
                {([
                  { key: 'all', label: 'Any', tip: 'Show trips of any length.' },
                  { key: '1', label: '1-day', tip: 'Only show day trips — no overnight stay needed.' },
                  { key: '2', label: '2-day', tip: 'Only show 2-day trips — one overnight stay.' },
                  { key: '3', label: '3-day', tip: 'Only show 3-day trips — the maximum trip length.' },
                ] as const).map(({ key, label, tip }) => (
                  <button
                    key={key}
                    onClick={() => setTripLengthFilter(key)}
                    title={tip}
                    className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      tripLengthFilter === key ? 'bg-accent-blue/20 text-accent-blue' : 'bg-gray-800/50 text-text-dim hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Heading copy reflects "fewer + relevant" — when priority
                  players are set, surface that the list is filtered to them. */}
              {prioritySet.size > 0 && relevantToFilters.length !== filtered.length && (
                <p className="mb-3 text-[11px] text-accent-blue">
                  Showing {relevantToFilters.length} trip{relevantToFilters.length !== 1 ? 's' : ''} that include your priority player{prioritySet.size !== 1 ? 's' : ''}
                  <span className="text-text-dim/50"> · {filtered.length - relevantToFilters.length} other trip{filtered.length - relevantToFilters.length !== 1 ? 's' : ''} hidden</span>
                </p>
              )}

              {/* Side-by-side comparison of starred favorites — renders only
                  when 2+ trips are starred. Lets Kent pick the best one
                  without scrolling back and forth between cards. */}
              <div className="mb-4">
                <CompareStarredTrips />
              </div>

              <div className="space-y-4">
                {capped.map((group, i) => {
                  const { primary, alternatives } = group
                  if (primary.type === 'road') {
                    const altTrips = alternatives
                      .filter((a): a is typeof a & { type: 'road' } => a.type === 'road')
                      .map(a => a.trip)
                    return (
                      <TripCard
                        key={`road-${group.displayIndex}`}
                        trip={primary.trip}
                        index={group.displayIndex}
                        playerMap={playerMap}
                        defaultExpanded={i === 0}
                        onPlayerClick={setSelectedPlayer}
                        alternativeTrips={altTrips.length > 0 ? altTrips : undefined}
                      />
                    )
                  } else {
                    const altVisits = alternatives
                      .filter((a): a is typeof a & { type: 'flyin' } => a.type === 'flyin')
                      .map(a => a.visit)
                    return (
                      <FlyInCard
                        key={`flyin-${group.displayIndex}`}
                        visit={primary.visit}
                        index={group.displayIndex}
                        players={players}
                        playerMap={playerMap}
                        priorityPlayers={priorityPlayers}
                        copiedFlyIn={copiedFlyIn}
                        setCopiedFlyIn={setCopiedFlyIn}
                        onPlayerClick={setSelectedPlayer}
                        defaultExpanded={i === 0 && tripPlan.trips.length === 0}
                        alternativeVisits={altVisits.length > 0 ? altVisits : undefined}
                      />
                    )
                  }
                })}
                {unified.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">No trips generated for the selected date range.</p>
                )}
                {unified.length > 0 && filtered.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">
                    No trips match these filters. Try loosening the Days or Tier filter.
                  </p>
                )}
                {prioritySet.size > 0 && filtered.length > 0 && relevantToFilters.length === 0 && (
                  <p className="py-4 text-center text-sm text-accent-orange">
                    None of the generated trips include your priority player{prioritySet.size !== 1 ? 's' : ''}.
                    {' '}Try widening the date range, raising the drive/flight caps, or removing a priority filter.
                  </p>
                )}
                {hasMore && (
                  <button
                    onClick={() => setShowAllTrips(true)}
                    className="w-full rounded-lg border border-border bg-surface/40 px-4 py-2 text-xs text-text-dim hover:text-text hover:border-accent-blue/40 transition-colors"
                  >
                    Show all {relevantToFilters.length} trips
                    <span className="text-text-dim/40"> · {relevantToFilters.length - capped.length} more</span>
                  </button>
                )}
                {showAllTrips && relevantToFilters.length > DEFAULT_TRIP_CAP && (
                  <button
                    onClick={() => setShowAllTrips(false)}
                    className="w-full rounded-lg border border-border/30 bg-transparent px-4 py-1.5 text-[11px] text-text-dim/60 hover:text-text-dim transition-colors"
                  >
                    Collapse to top {DEFAULT_TRIP_CAP}
                  </button>
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
        onPlayersFound={(names) => setAnchorPlayerNames(names)}
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
  onPlayersFound,
}: {
  allGames: import('../../types/schedule').GameEvent[]
  playerMap: Map<string, RosterPlayer>
  startDate: string
  endDate: string
  onPlayersFound?: (names: string[]) => void
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
      const uniqueNames = [...new Set(nearby.map(r => r.playerName))]
      onPlayersFound?.(uniqueNames)
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
          <button onClick={() => { setResults([]); setAnchorCity(''); setExpanded(false); onPlayersFound?.([]) }} className="text-xs text-text-dim hover:text-text">Clear</button>
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
  alternativeVisits,
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
  alternativeVisits?: import('../../types/schedule').FlyInVisit[]
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const [selectedAltIndex, setSelectedAltIndex] = useState(-1) // -1 = primary visit
  const allVariants = useMemo(() => [visit, ...(alternativeVisits ?? [])], [visit, alternativeVisits])
  const activeVisit = selectedAltIndex === -1 ? visit : (allVariants[selectedAltIndex + 1] ?? visit)
  const flyInHomeBaseName = useTripStore((s) => s.homeBaseName)

  // Derive org label — prefer teamLabel from trip engine (accurate per-team grouping)
  const firstPlayer = players.find((p) => activeVisit.playerNames.includes(p.playerName))
  let orgLabel = activeVisit.teamLabel ?? ''
  if (!orgLabel) {
    if (activeVisit.source === 'hs-lookup' && firstPlayer) orgLabel = `${firstPlayer.org}, ${firstPlayer.state}`
    else if (activeVisit.source === 'ncaa-lookup' && firstPlayer) orgLabel = firstPlayer.org
    else if (activeVisit.source === 'mlb-api' && firstPlayer) orgLabel = firstPlayer.org
  }

  const milesDisplay = Math.round(activeVisit.distanceKm * 0.621).toLocaleString()

  // Date formatting
  const firstDate = activeVisit.dates[0]
  const lastDate = activeVisit.dates[activeVisit.dates.length - 1]
  const dateLabel = firstDate && lastDate && firstDate !== lastDate
    ? `${formatDate(firstDate)} – ${formatDate(lastDate)}`
    : firstDate ? formatDate(firstDate) : ''

  // Natural language summary
  const t1Names = activeVisit.playerNames.filter((n) => playerMap.get(n)?.tier === 1)
  const t2Names = activeVisit.playerNames.filter((n) => playerMap.get(n)?.tier === 2)
  const isPriority = activeVisit.playerNames.some((n) => priorityPlayers.includes(n))
  let summary = `Fly to ${activeVisit.venue.name} to see ${activeVisit.playerNames.length} player${activeVisit.playerNames.length !== 1 ? 's' : ''}`
  summary += ` — ${activeVisit.isHome ? `${orgLabel || 'team'} home game` : `${orgLabel || 'team'} away series`}.`
  summary += ` ~${activeVisit.estimatedTravelHours}h travel (${milesDisplay} mi). Rental car likely needed.`
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
  } else if (activeVisit.playerNames.length >= 3) {
    flyInWhy = `Worth the flight — sees ${activeVisit.playerNames.length} players at one venue.`
  }


  // Check if the last game is early enough to fly home same day (before 3 PM ET)
  const isEarlyGame = (gameTimeStr?: string): boolean => {
    if (!gameTimeStr) return false
    const d = new Date(gameTimeStr)
    if (isNaN(d.getTime())) return false
    // Convert to ET hours (America/New_York)
    const etTime = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    return etTime.getHours() < 15 // before 3 PM
  }

  // For single-venue: check activeVisit.gameTime; for combo: check last stop's gameTime
  const lastGameTime = activeVisit.isCombo && activeVisit.stops && activeVisit.stops.length > 1
    ? activeVisit.stops[activeVisit.stops.length - 1]!.gameTime
    : activeVisit.gameTime
  const couldFlyHomeSameDay = isEarlyGame(lastGameTime)
  const totalDaysShown = activeVisit.isCombo && activeVisit.stops ? activeVisit.stops.length + 1 : activeVisit.dates.length + 1

  // Source badge
  const sourceBadge = activeVisit.source === 'mlb-api'
    ? { label: activeVisit.isHome ? 'Home Game' : 'Away Game', color: activeVisit.isHome ? 'bg-accent-green/15 text-accent-green' : 'bg-purple-500/15 text-purple-400', tip: activeVisit.isHome ? 'Confirmed home game from the MLB/MiLB schedule.' : 'Away game — location is based on the opposing team\'s home venue.' }
    : (activeVisit.source === 'hs-lookup' && activeVisit.confidence === 'high')
      ? { label: 'Home Game (MaxPreps)', color: 'bg-accent-green/15 text-accent-green', tip: 'Confirmed home game from MaxPreps schedule.' }
      : (activeVisit.source === 'ncaa-lookup' && activeVisit.confidence === 'high')
        ? { label: activeVisit.isHome ? 'School Visit (D1Baseball)' : 'Away Game (D1Baseball)', color: activeVisit.isHome ? 'bg-accent-green/15 text-accent-green' : 'bg-purple-500/15 text-purple-400', tip: activeVisit.isHome ? 'Confirmed home game from D1Baseball schedule.' : 'Away game — location is based on the opposing team\'s home venue.' }
        : { label: activeVisit.isHome ? 'School Visit (est.)' : 'Away Game (est.)', color: 'bg-accent-orange/15 text-accent-orange', tip: 'Location is estimated — we know the game exists but aren\'t sure of the exact venue. Click "Verify" to confirm.' }

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
                Fly to {findNearestAirport(activeVisit.venue.coords).name}
              </span>
            </h3>
          </div>
          <p className="mt-0.5 text-sm text-text-dim">
            {dateLabel} · {activeVisit.playerNames.join(', ')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-text-dim/60">
          <span>{activeVisit.dates.length + 1} days</span>
          <span className="text-text-dim/20">·</span>
          <span>~{Math.round(activeVisit.estimatedTravelHours - 3)}h flight</span>
          {allVariants.length > 1 && (
            <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-bold text-purple-400">
              {allVariants.length} dates
            </span>
          )}
        </div>
      </div>

      {/* Alternative date selector — shown when multiple date options exist */}
      {allVariants.length > 1 && expanded && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-text-dim mr-1">Dates:</span>
          {allVariants.map((variant, vi) => {
            const vDates = variant.dates
            const vStart = formatDate(vDates[0]!)
            const vEnd = vDates.length > 1 ? formatDate(vDates[vDates.length - 1]!) : null
            const label = vEnd ? `${vStart} – ${vEnd}` : vStart
            const isActive = vi === 0 ? selectedAltIndex === -1 : selectedAltIndex === vi - 1
            const isTue = vDates.some(d => new Date(d + 'T12:00:00Z').getUTCDay() === 2)
            return (
              <button
                key={vi}
                onClick={(e) => { e.stopPropagation(); setSelectedAltIndex(vi === 0 ? -1 : vi - 1) }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30'
                    : 'bg-gray-800/50 text-text-dim hover:text-text hover:bg-gray-700/50'
                }`}
              >
                {label}
                {isTue && <span className="ml-1 text-[9px] opacity-70">Tue</span>}
                {vi === 0 && <span className="ml-1 text-[9px] opacity-50">best</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Expanded content — day-by-day itinerary */}
      {expanded && (() => {
        const bestDay = activeVisit.dates.find(d => new Date(d + 'T12:00:00Z').getUTCDay() === 2) ?? activeVisit.dates[0]!
        const isTue = new Date(bestDay + 'T12:00:00Z').getUTCDay() === 2
        const hasMultipleDays = activeVisit.dates.length > 1

        // Combo trip: multi-stop fly-in with driving between venues
        if (activeVisit.isCombo && activeVisit.stops && activeVisit.stops.length > 1) {
          // Sort combo stops by date, then by game time within the same day
          const comboStops = [...activeVisit.stops].sort((a, b) => {
            const dateCmp = a.date.localeCompare(b.date)
            if (dateCmp !== 0) return dateCmp
            const aTime = a.gameTime ? new Date(a.gameTime).getTime() : Infinity
            const bTime = b.gameTime ? new Date(b.gameTime).getTime() : Infinity
            if (isNaN(aTime) && isNaN(bTime)) return 0
            if (isNaN(aTime)) return 1
            if (isNaN(bTime)) return -1
            return aTime - bTime
          })
          const nearestApt = findNearestAirport(comboStops[0]!.venue.coords)
          return (
          <div className="mt-4 space-y-3">
            {/* Natural language summary */}
            <p className="text-sm text-text-dim leading-relaxed bg-gray-950/40 rounded-lg px-4 py-2.5">
              {formatDate(comboStops[0]!.date)} – {formatDate(comboStops[comboStops.length - 1]!.date)}: Fly to {nearestApt.name} ({nearestApt.code}) (~{Math.round(activeVisit.estimatedTravelHours - 3)}h flight).
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
                  {i === 0 && <span className="text-[10px] text-text-dim">Fly from {flyInHomeBaseName} · ~{Math.round(activeVisit.estimatedTravelHours - 3)}h flight</span>}
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
                      <a href={stop.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-dim/50 hover:text-purple-400" title="Open the source schedule to confirm this game's date, time, and location">Verify ↗</a>
                    )}
                  </div>
                  {stop.source === 'hs-lookup' && !stop.isHome && (
                    <p className="text-[10px] text-accent-orange/60 mt-0.5">
                      📍 Location approximate — away game venue estimated from home field area.{' '}
                      <a href={`https://www.google.com/maps/search/${encodeURIComponent(`${stop.teamLabel || stop.venue.name} high school baseball field`)}`} target="_blank" rel="noopener noreferrer" className="text-accent-blue/70 hover:text-accent-blue underline">Confirm on Google Maps ↗</a>
                    </p>
                  )}
                  {isTueDay && <p className="mt-0.5 text-xs text-accent-blue font-medium">Tuesday — ideal for position players</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
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
                    {stop.playerNames.length >= 2 && (
                      <span className="text-[10px] text-accent-green/70 ml-1" title={`${stop.playerNames.length} SV players in the same game — efficient visit`}>
                        {stop.playerNames.length} players, 1 game
                      </span>
                    )}
                  </div>
                </div>
              </div>
              )
            })}

            {/* Return day */}
            {(() => {
              const lastComboStop = comboStops[comboStops.length - 1]!
              const returnAirport = findNearestAirport(lastComboStop.venue.coords)
              const arrivalCode = activeVisit.hubAirport || nearestApt.code
              const showReturnAirport = returnAirport.code !== arrivalCode
              return (
              <div className="rounded-lg border border-border/30 bg-surface/50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-text-dim">Day {comboStops.length + 1}</span>
                  <span className="text-xs text-text-dim/50">Fly home</span>
                </div>
                {showReturnAirport && (
                  <p className="mt-1 text-[11px] text-text-dim/50">Fly home from {returnAirport.code} ({returnAirport.name}) — closest to last stop</p>
                )}
                {couldFlyHomeSameDay && (
                  <p className="mt-1 text-[11px] text-text-dim/50 italic">Early game — could fly home same day instead of Day {totalDaysShown}</p>
                )}
              </div>
              )
            })()}

            {flyInWhy && <p className="text-xs italic text-text-dim/60">{flyInWhy}</p>}
            <FlyInScoreExplainer breakdown={activeVisit.scoreBreakdown} />
          </div>
          )
        }

        // Single-venue fly-in (existing behavior)
        return (
        <div className="mt-4 space-y-3">
          {/* Natural language summary */}
          <p className="text-sm text-text-dim leading-relaxed bg-gray-950/40 rounded-lg px-4 py-2.5">
            {(() => {
              const apt = findNearestAirport(activeVisit.venue.coords)
              return `${formatDate(bestDay)}${hasMultipleDays ? ` – ${formatDate(activeVisit.dates[activeVisit.dates.length - 1]!)}` : ''}: Fly to ${apt.name} (${apt.code}) (~${Math.round(activeVisit.estimatedTravelHours - 3)}h flight).`
            })()}
            {' '}See {activeVisit.playerNames.map((n) => {
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
              <span className="text-[10px] text-text-dim">Fly from {flyInHomeBaseName} · ~{Math.round(activeVisit.estimatedTravelHours - 3)}h flight</span>
            </div>

            <div className="ml-4 space-y-2">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-text">
                    {orgLabel || activeVisit.venue.name}
                  </span>
                  {orgLabel && orgLabel !== activeVisit.venue.name && (
                    <span className="text-[11px] text-text-dim/60">{activeVisit.venue.name}</span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium cursor-help ${sourceBadge.color}`} title={sourceBadge.tip}>
                    {sourceBadge.label}
                  </span>
                  {activeVisit.sourceUrl && (
                    <a href={activeVisit.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-dim/50 hover:text-purple-400" title="Open the source schedule to confirm this game's date, time, and location">Verify ↗</a>
                  )}
                </div>
                {activeVisit.source === 'hs-lookup' && !activeVisit.isHome && (
                  <p className="text-[10px] text-accent-orange/60 mt-0.5">
                    📍 Location approximate — away game venue estimated from home field area.{' '}
                    <a href={`https://www.google.com/maps/search/${encodeURIComponent(`${activeVisit.teamLabel || activeVisit.venue.name} high school baseball field`)}`} target="_blank" rel="noopener noreferrer" className="text-accent-blue/70 hover:text-accent-blue underline">Confirm on Google Maps ↗</a>
                  </p>
                )}
                {isTue && (
                  <p className="mt-1 text-xs text-accent-blue font-medium">Tuesday — ideal for position players</p>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {activeVisit.playerNames.map((name) => {
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
                  {activeVisit.playerNames.length >= 2 && (
                    <span className="text-[10px] text-accent-green/70 ml-1" title={`${activeVisit.playerNames.length} SV players in the same game — efficient visit`}>
                      {activeVisit.playerNames.length} players, 1 game
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Day 2+ if multi-day */}
          {hasMultipleDays && activeVisit.dates.filter(d => d !== bestDay).map((d, i) => (
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
                <span className="text-xs font-bold text-text-dim">Day {activeVisit.dates.length + 1}</span>
                <span className="text-xs text-text-dim/50">Fly home</span>
              </div>
            </div>
            {couldFlyHomeSameDay && (
              <p className="mt-1 text-[11px] text-text-dim/50 italic">Early game — could fly home same day instead of Day {totalDaysShown}</p>
            )}
          </div>

          {flyInWhy && (
            <p className="text-xs italic text-text-dim/60">{flyInWhy}</p>
          )}
          <FlyInScoreExplainer breakdown={activeVisit.scoreBreakdown} />

        </div>
        )
      })()}
    </div>
  )
}

/* ── Score explainer for fly-in cards ── */
function FlyInScoreExplainer({ breakdown }: { breakdown?: import('../../types/schedule').ScoreBreakdown }) {
  const [open, setOpen] = useState(false)
  if (!breakdown) return null
  const parts: string[] = []
  if (breakdown.tier1Count > 0) parts.push(`${breakdown.tier1Count} must-see (${breakdown.tier1Points}pts)`)
  if (breakdown.tier2Count > 0) parts.push(`${breakdown.tier2Count} high-priority (${breakdown.tier2Points}pts)`)
  if (breakdown.tier3Count > 0) parts.push(`${breakdown.tier3Count} standard (${breakdown.tier3Points}pts)`)
  if (breakdown.tuesdayBonus) parts.push('Tuesday bonus (+20%)')
  if (breakdown.pitcherMatchBonus > 0) parts.push(`Pitcher match (+${Math.round(breakdown.pitcherMatchBonus * 100)}%)`)
  return (
    <div className="text-[11px]">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="text-text-dim/50 hover:text-text-dim transition-colors"
      >
        {open ? '▾' : '▸'} Why this ranking? <span className="text-text-dim/30">Score: {Math.round(breakdown.finalScore)}</span>
      </button>
      {open && (
        <div className="mt-1 ml-3 text-text-dim/60 space-y-0.5">
          {parts.map((p, i) => <div key={i}>· {p}</div>)}
          <div className="text-text-dim/30 mt-1">Raw: {Math.round(breakdown.rawScore)} → Final: {Math.round(breakdown.finalScore)}</div>
        </div>
      )}
    </div>
  )
}

/* ── Did You Know? ── rotating app tips ── */
const APP_TIPS = [
  'Click any player name to see their full schedule and upcoming games.',
  'Use Priority Players to build trips around specific guys first.',
  'Hover over yellow badges for details on what\'s estimated or unconfirmed.',
  '"Not Covered" means no trip exists yet — try widening your date range or increasing the drive slider.',
  'Combo fly-ins cluster nearby players so you can see more per trip.',
  'The drive time slider controls which trips appear — slide right to see more options.',
  'Sort trips by "Best" for our recommendation, or "Date" to plan chronologically.',
  'Hover over the stat cards (Total Trips, Players in Trips) to see which players are included.',
  '"Verify" links open the source schedule so you can double-check game details.',
  'Estimated pro assignments auto-correct once official rosters are published — just hit Check Assignments again.',
  'The "Prioritize overdue players" checkbox boosts players who haven\'t been visited recently.',
  'Filter trips by Drives or Flights to focus on one travel type at a time.',
  'Click the "Not Covered" section to see exactly which players are missing and why.',
]

/* ── Not Covered Explainer ── shows who isn't in any trip and why ── */
function NotCoveredExplainer({
  inactivePlayers, skippedMap,
  beyondFlight, noGamesInRange, noSchedule, otherUncovered, unvisitableMap, onPlayerClick,
  priorityPlayers, setPriorityPlayers,
}: {
  inactivePlayers: RosterPlayer[]
  skippedMap: Map<string, string>
  beyondFlight: RosterPlayer[]
  noGamesInRange: RosterPlayer[]
  noSchedule: RosterPlayer[]
  otherUncovered: RosterPlayer[]
  unvisitableMap: Map<string, string>
  onPlayerClick: (name: string) => void
  priorityPlayers: string[]
  setPriorityPlayers: (players: string[]) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const total = inactivePlayers.length + beyondFlight.length + noGamesInRange.length + noSchedule.length + otherUncovered.length
  if (total === 0) return null

  return (
    <div className="rounded-xl border border-accent-orange/20 bg-accent-orange/5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-xs font-medium text-accent-orange">
          {expanded ? '▾' : '▸'} {total} player{total !== 1 ? 's' : ''} not in any trip — why?
        </span>
        <span className="text-[10px] text-accent-orange/50">{expanded ? 'hide' : 'show'}</span>
      </button>
      {expanded && (
        <div className="border-t border-accent-orange/10 px-4 py-3 space-y-3">
          {inactivePlayers.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-accent-red mb-1">Inactive ({inactivePlayers.length})</p>
              <p className="text-[10px] text-text-dim/60 mb-1.5">These players are marked as unavailable in the roster and excluded from trip planning.</p>
              <div className="flex flex-wrap gap-1">
                {inactivePlayers.map((p) => {
                  const reason = skippedMap.get(p.playerName) ?? p.status
                  return (
                    <span key={p.playerName} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-text cursor-pointer hover:bg-accent-blue/10" onClick={() => onPlayerClick(p.playerName)}>
                      {p.playerName} <span className="rounded bg-accent-red/15 px-1 py-0.5 text-[9px] font-medium text-accent-red ml-0.5">{reason}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {beyondFlight.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-accent-orange mb-1">Too far to reach ({beyondFlight.length})</p>
              <p className="text-[10px] text-text-dim/60 mb-1.5">These players are beyond your max flight time setting. Increase the flight slider to include them.</p>
              <div className="flex flex-wrap gap-1">
                {beyondFlight.map((p) => (
                  <span key={p.playerName} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-text cursor-pointer hover:bg-accent-blue/10" onClick={() => onPlayerClick(p.playerName)}>
                    {p.playerName} <span className="text-text-dim/40">({p.org})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {noGamesInRange.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-accent-orange mb-1">No games in your date range ({noGamesInRange.length})</p>
              <p className="text-[10px] text-text-dim/60 mb-1.5">These players have schedules, but no games fall within your selected dates. Try extending your end date.</p>
              <div className="flex flex-wrap gap-1">
                {noGamesInRange.map((p) => {
                  const reason = unvisitableMap.get(p.playerName)
                  return (
                    <span key={p.playerName} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-text cursor-pointer hover:bg-accent-blue/10" onClick={() => onPlayerClick(p.playerName)}>
                      {p.playerName} <span className="text-text-dim/40">({reason?.includes('season may be over') ? 'season may be over' : p.org})</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {noSchedule.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-accent-orange mb-1">No schedule data ({noSchedule.length})</p>
              <p className="text-[10px] text-text-dim/60 mb-1.5">We couldn't find or load a schedule for these players. Their team may not be recognized, or data hasn't been published yet.</p>
              <div className="flex flex-wrap gap-1">
                {noSchedule.map((p) => (
                  <span key={p.playerName} className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-text cursor-pointer hover:bg-accent-blue/10" onClick={() => onPlayerClick(p.playerName)}>
                    {p.playerName} <span className="text-text-dim/40">({p.org})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {otherUncovered.length > 0 && (() => {
            const TIER_EXPLAIN: Record<number, string> = {
              1: 'Must-see',
              2: 'High priority',
              3: 'Standard',
              4: 'Development',
            }
            const TIER_COLOR: Record<number, string> = {
              1: 'text-accent-red',
              2: 'text-accent-orange',
              3: 'text-yellow-400',
              4: 'text-text-dim',
            }
            // Group by tier
            const byTier = new Map<number, typeof otherUncovered>()
            for (const p of otherUncovered) {
              const tier = p.tier ?? 4
              const arr = byTier.get(tier) ?? []
              arr.push(p)
              byTier.set(tier, arr)
            }
            const sortedTiers = [...byTier.entries()].sort((a, b) => a[0] - b[0])
            const highTierCount = (byTier.get(1)?.length ?? 0) + (byTier.get(2)?.length ?? 0)

            const canAddPriority = priorityPlayers.length < 3
            const isAlreadyPriority = (name: string) => priorityPlayers.includes(name)
            const addAsPriority = (name: string) => {
              if (!canAddPriority || isAlreadyPriority(name)) return
              setPriorityPlayers([...priorityPlayers, name])
            }

            return (
            <div>
              <p className="text-[11px] font-medium text-text-dim mb-1">Have games but not in a trip ({otherUncovered.length})</p>
              <p className="text-[10px] text-text-dim/60 mb-1.5">
                {highTierCount > 0
                  ? `${highTierCount} high-priority player${highTierCount !== 1 ? 's' : ''} missed — try adding them as Priority Players. Lower-tier players are included when they're near higher-priority stops.`
                  : 'These are mostly lower-tier players. The engine prioritizes trips with must-see and high-priority players first. Add any of these as a Priority Player to force the engine to build a trip around them.'}
              </p>
              {highTierCount > 0 && (
                <p className="text-[10px] text-accent-blue/70 mb-2 italic">
                  Click any must-see or high-priority player below to add them as a Priority Player — the engine will build trips around them.
                </p>
              )}
              <div className="space-y-2">
                {sortedTiers.map(([tier, players]) => {
                  const isClickableTier = tier <= 2
                  return (
                  <div key={tier}>
                    <p className={`text-[10px] font-medium mb-1 ${TIER_COLOR[tier] ?? 'text-text-dim'}`}>
                      Tier {tier} — {TIER_EXPLAIN[tier] ?? 'Other'} ({players.length})
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {players.map((p) => {
                        const r = unvisitableMap.get(p.playerName)
                        const gameCount = r?.match(/Has (\d+) game/)?.[1]
                        const alreadyPrio = isAlreadyPriority(p.playerName)
                        const clickable = isClickableTier && canAddPriority && !alreadyPrio
                        return (
                          <span
                            key={p.playerName}
                            className={`rounded-full bg-surface px-2 py-0.5 text-[11px] text-text cursor-pointer hover:bg-accent-blue/10 ${clickable ? 'ring-1 ring-accent-blue/30 hover:ring-accent-blue/60' : ''} ${alreadyPrio ? 'opacity-50' : ''}`}
                            title={isClickableTier ? (alreadyPrio ? 'Already a Priority Player' : canAddPriority ? 'Click to add as Priority Player' : 'Priority Player slots full (max 3)') : undefined}
                            onClick={() => {
                              if (clickable) {
                                addAsPriority(p.playerName)
                              } else {
                                onPlayerClick(p.playerName)
                              }
                            }}
                          >
                            {p.playerName} <span className="text-text-dim/40">({p.org}{gameCount ? ` · ${gameCount} games` : ''})</span>
                            {isClickableTier && canAddPriority && !alreadyPrio && <span className="text-accent-blue/60 ml-0.5">+</span>}
                            {alreadyPrio && <span className="text-accent-green/60 ml-0.5">✓</span>}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

function DidYouKnow() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * APP_TIPS.length))
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % APP_TIPS.length), 20_000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2 rounded-lg bg-gray-950/40 px-4 py-2">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-accent-blue/60">Tip</span>
      <p className="text-[11px] text-text-dim/70">{APP_TIPS[index]}</p>
    </div>
  )
}

/* ── Welcome Hint ── collapsible "?" disclosure, mirrors Map's MapHelp ── */
function WelcomeHint() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('sv-trip-welcome-dismissed') !== '1' } catch { return true }
  })
  function toggle() {
    const next = !open
    setOpen(next)
    try {
      if (!next) localStorage.setItem('sv-trip-welcome-dismissed', '1')
      else localStorage.removeItem('sv-trip-welcome-dismissed')
    } catch {}
  }
  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-900/30 transition-colors"
      >
        <span className="flex items-center gap-2 text-xs text-text-dim">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-bold text-accent-blue">?</span>
          <span className="font-medium text-text">How to use the Trip Planner</span>
          {!open && <span className="text-text-dim/60 text-[11px]">— click for the quick guide</span>}
        </span>
        <span className={`text-text-dim text-xs transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
      </button>
      {open && (
        <div className="border-t border-border/30 px-5 py-3 text-xs text-text-dim leading-relaxed">
          <ol className="space-y-1 list-decimal list-inside">
            <li>Pick your <span className="text-text">date range</span> and adjust drive/flight sliders if needed.</li>
            <li>Hit <span className="font-medium text-accent-blue">Generate Trips</span> to build trip options.</li>
            <li>Review your trips — expand any card for the full day-by-day itinerary.</li>
          </ol>
          <p className="mt-2 text-[10px] text-text-dim/50">Use Priority Players to build trips around specific guys first.</p>
        </div>
      )}
    </div>
  )
}
