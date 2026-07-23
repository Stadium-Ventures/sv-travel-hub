import { useEffect, useMemo, useRef, useState } from 'react'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { useSummerStore } from '../../store/summerStore'
import CompareStarredTrips from './CompareStarredTrips'
import TripSummaryCard from './TripSummaryCard'
import PlayerCoverageCard from './PlayerCoverageCard'
// ICS export removed from main UI — kept in individual trip cards
// import { generateAllTripsIcs, downloadIcs } from '../../lib/icsExport'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import { PairVerdictBanner, type PairVerdict } from './DoubleUpSection'
import { findDoubleUps, findClosestApproach } from '../../lib/doubleUps'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatDriveTime, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'
import { MAJOR_AIRPORTS } from '../../data/majorAirports'
import { groupAndNumberTrips, itemHasPriorityPlayer, type UnifiedTripItem } from './groupAndNumberTrips'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

// 5 priority slots per Kent's interview ("if I select five players...").
// Shared by the picker AND the Not Covered click-to-add flow so they agree.
const PRIORITY_SLOTS = 5


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
                  <span className="text-[10px] text-text-dim/50">{TIER_LABELS[p.tier] ?? ''}</span>
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

function addDaysISO(date: string, delta: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().split('T')[0]!
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
  if (step.includes('HS schedules')) return 'Loading HS games from the schedule sheet'
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
  const useHeartbeatBoost = useTripStore((s) => s.useHeartbeatBoost)
  const setUseHeartbeatBoost = useTripStore((s) => s.setUseHeartbeatBoost)
  const setPriorityPlayers = useTripStore((s) => s.setPriorityPlayers)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
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
  const [sortBy] = useState<'score' | 'date'>('score') // toolbar removed 2026-07-22 — best-first, always
  const [tripFilter] = useState<'all' | 'drive' | 'fly' | 'multi' | 'anchor' | 'starred'>('all') // filter chips removed 2026-07-22
  const [tripLengthFilter] = useState<'all' | '1' | '2' | '3'>('all') // length chips removed 2026-07-22 (simplify)
  const [showAllTrips, setShowAllTrips] = useState(false)
  // tierFilter removed — was adding clutter to the results toolbar
  const [anchorPlayerNames, setAnchorPlayerNames] = useState<string[]>([])
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null)
  // "Not Covered" explainer — lives in the Details section; also toggled by
  // clicking the Not Covered stat card, so the state lives up here.
  const [notCoveredOpen, setNotCoveredOpen] = useState(false)



  // Build player lookup
  const playerMap = useMemo(() => {
    const map = new Map<string, RosterPlayer>()
    for (const p of players) map.set(p.playerName, p)
    return map
  }, [players])

  // Double ups — computed live from loaded schedules, so Kent sees them
  // WITHOUT having to generate trips first. Real games only (no synthetic
  // events), which keeps this signal high-trust. Fixed 30-day lookahead,
  // independent of the trip date range — Kent wants these flagged well
  // ahead of when he's actually planning the trip (2026-07-21).
  const DOUBLE_UP_WINDOW_DAYS = 30
  const summerGames = useSummerStore((s) => s.summerGames)
  const upcomingDoubleUps = useMemo(() => {
    if (players.length === 0) return []
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    if (all.length === 0) return []
    const today = new Date().toISOString().split('T')[0]!
    // Horizon covers at least the planner's selected end date so in-window
    // verdicts don't miss double ups late in a long range.
    const horizon = addDaysISO(today, DOUBLE_UP_WINDOW_DAYS)
    return findDoubleUps(all, players, today, endDate > horizon ? endDate : horizon)
  }, [proGames, ncaaGames, hsGames, summerGames, players, DOUBLE_UP_WINDOW_DAYS, endDate])

  // "Does X double up with Y?" — Tom's 2026-07-21 read of the priority
  // pickers as a player-combo double-up filter. For each pair of selected
  // priority players, state the verdict explicitly: dates when they double
  // up, or how close their schedules come (silence read as noise before).
  const pairVerdicts = useMemo<PairVerdict[]>(() => {
    if (priorityPlayers.length < 2) return []
    const today = new Date().toISOString().split('T')[0]!
    const end = addDaysISO(today, DOUBLE_UP_WINDOW_DAYS)
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    const out: PairVerdict[] = []
    for (let i = 0; i < priorityPlayers.length; i++) {
      for (let j = i + 1; j < priorityPlayers.length; j++) {
        const a = priorityPlayers[i]!
        const b = priorityPlayers[j]!
        const dus = upcomingDoubleUps.filter((du) => du.playerNames.includes(a) && du.playerNames.includes(b))
        const allDates = [...new Set(dus.flatMap((d) => d.dates))].sort()
        // A verdict that says "in this window" must actually mean the
        // planner's selected dates — the fixed 30-day horizon claimed
        // "3 of 6 pairs double up" for an Aug 9–11 plan whose double ups
        // were on Aug 18 (Tom 2026-07-23).
        const inWindow = allDates.filter((d) => d >= startDate && d <= endDate)
        if (inWindow.length > 0) {
          out.push({ a, b, doubleUpDates: inWindow, closest: null })
        } else if (allDates.length > 0) {
          out.push({ a, b, doubleUpDates: null, outsideDates: allDates, closest: null })
        } else {
          out.push({ a, b, doubleUpDates: null, closest: findClosestApproach(all, a, b, today, end) })
        }
      }
    }
    return out
  }, [priorityPlayers, upcomingDoubleUps, proGames, ncaaGames, hsGames, summerGames, DOUBLE_UP_WINDOW_DAYS, startDate, endDate])


  // All players eligible for priority selection (don't filter by visits remaining)
  const eligibleForPriority = useMemo(
    () => players.sort((a, b) => a.playerName.localeCompare(b.playerName)),
    [players],
  )

  // Best week suggestions — computed on-demand only when user clicks "Suggest"
  // bestWeeks removed — trip planner generates for the dates selected

  const hasHsPlayers = players.some((p) => p.level === 'HS')


  const canGenerate = players.length > 0 && !computing


  function addPriorityPlayer(name: string) {
    if (!name) return
    setPriorityPlayers([...new Set([...priorityPlayers, name])].slice(0, PRIORITY_SLOTS))
  }
  function removePriorityPlayer(name: string) {
    setPriorityPlayers(priorityPlayers.filter((n) => n !== name))
  }

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

  // Shared trip grouping + numbering — one source of truth for "Trip #N"
  // across the Priority Player Results, status banner, and the card list.
  // See groupAndNumberTrips.ts for the history of why this must be shared.
  const tripGrouping = useMemo(
    () => tripPlan
      ? groupAndNumberTrips({ trips: tripPlan.trips, flyInVisits: displayedFlyIns, priorityPlayers, sortBy })
      : null,
    [tripPlan, displayedFlyIns, priorityPlayers, sortBy],
  )

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

  // NOTE: schedule auto-loading happens ONCE at the App level (AutoFetchData
  // in App.tsx) — it fires as soon as the roster loads, regardless of which
  // tab Kent lands on first. TripPlanner only reads the store; the manual
  // "Load Schedules" button below covers retry/refresh.

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
            {/* Ghost button — schedules auto-load at app start; this is a
                retry/refresh affordance, not the screen's primary action
                (that's Generate Trips). */}
            {!allSchedulesLoaded && !anyScheduleLoading && (
              <button
                onClick={handleLoadAllSchedules}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-dim hover:text-text hover:bg-gray-800 transition-colors"
              >
                Load schedules
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

        {/* Top row — dates + starting city + Generate, always visible.
            These are shared with the Map tab via the trip store. */}
        <div className="flex flex-wrap items-end gap-3">
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
                onChange={(e) => { if (e.target.value) setDateRange(startDate, e.target.value) }}
                className="rounded-lg border border-border bg-gray-950 px-3 py-1.5 text-sm text-text"
              />
              <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-text-dim">
                {getDayName(endDate)}
              </span>
            </div>
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

        {/* Quick date presets + shared-with-Map note */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
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
          <span className="text-[11px] text-text-dim/50" title="Dates and starting city are shared with the Map tab — change them here or there, both stay in sync.">
            Same dates as Map
          </span>
        </div>

        {/* Trip options — drive + length caps (drive-based app; flights
            are the user's own business). Tucked behind a
            disclosure so results stay close to the Generate button. */}
        <div className="mt-3">
          <button
            onClick={() => setSharedControlsOpen((v) => !v)}
            className="text-xs text-text-dim hover:text-text transition-colors"
          >
            {sharedControlsOpen ? '▾' : '▸'} Trip options
            <span className="text-text-dim/50">
              {' '}— drive up to {Math.floor(maxDriveMinutes / 60)}h · {maxNights} night{maxNights !== 1 ? 's' : ''} max
            </span>
          </button>
          {sharedControlsOpen && (
            <div className="mt-2 flex flex-wrap items-end gap-4 rounded-lg border border-border/50 bg-gray-950/50 p-3">
              <div>
                <label className="mb-1 block text-xs text-text-dim">
                  Max Drive: {Math.floor(maxDriveMinutes / 60)}h{maxDriveMinutes % 60 > 0 ? ` ${maxDriveMinutes % 60}m` : ''}
                </label>
                <input
                  type="range"
                  min={120}
                  max={480}
                  step={30}
                  value={maxDriveMinutes}
                  onChange={(e) => setMaxDriveMinutes(parseInt(e.target.value))}
                  className="h-1.5 w-32 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
                />
                <p className="mt-0.5 text-[11px] text-text-dim/50" title="Drive times are rough estimates — actual times depend on traffic and route">
                  How far you'll drive within the trip's area · estimates only
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs text-text-dim">
                  Max Trip: {maxNights} night{maxNights !== 1 ? 's' : ''}
                </label>
                <div className="flex gap-1">
                  {([1, 2, 3] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setMaxNights(n)}
                      title={n === 1 ? 'Day trips and overnights only — back home the next day.' : n === 2 ? 'Up to 2 nights away — covers most multi-stop trips.' : 'Up to 3 nights — the maximum trip length.'}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                        maxNights === n ? 'bg-accent-blue/20 text-accent-blue ring-1 ring-accent-blue/30' : 'bg-gray-950 border border-border text-text-dim hover:text-text'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="mt-0.5 text-[11px] text-text-dim/50">
                  {maxNights === 1 ? 'Quick trips — 1-2 days max' : maxNights === 2 ? 'Standard trips — up to 3 days' : 'Longest trips — 3-day rule'}
                </p>
              </div>
              {/* Heartbeat boost toggle */}
              <label className="flex w-full items-center gap-2 text-xs text-text-dim cursor-pointer">
                <input
                  type="checkbox"
                  checked={useHeartbeatBoost}
                  onChange={(e) => setUseHeartbeatBoost(e.target.checked)}
                  className="rounded border-border accent-accent-blue"
                />
                Prioritize overdue players
                <span className="text-text-dim/50">(boost players who haven't been visited recently according to the <a href="https://sv-heartbeat.vercel.app/" target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">Heartbeat app</a>)</span>
              </label>
            </div>
          )}
        </div>

        {/* Priority players — selected names as chips + ONE add picker
            (2026-07-21 apple-fy: five empty search boxes read as a form). */}
        <div className="mt-4 rounded-xl bg-gray-900/30 p-3">
          <label className="mb-2 block text-xs font-medium text-text-dim">
            Priority players <span className="text-text-dim/50">(optional — guaranteed to appear in your trip results)</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {priorityPlayers.map((name) => {
              const p = playerMap.get(name)
              return (
                <span key={name} className="flex items-center gap-1.5 rounded-lg bg-gray-800/60 px-2.5 py-1.5 text-sm text-text">
                  <span className={`h-2 w-2 rounded-full ${TIER_DOT_COLORS[p?.tier ?? 4] ?? 'bg-gray-500'}`} />
                  {name}
                  {p && <span className="text-[10px] text-text-dim">{p.level}</span>}
                  <button
                    onClick={() => removePriorityPlayer(name)}
                    className="ml-0.5 text-text-dim hover:text-text text-xs"
                    title={`Remove ${name}`}
                  >
                    ✕
                  </button>
                </span>
              )
            })}
            {priorityPlayers.length < PRIORITY_SLOTS && (
              <PlayerSearchPicker
                value=""
                players={eligibleForPriority}
                excludeNames={priorityPlayers}
                placeholder={priorityPlayers.length === 0 ? 'Add a priority player...' : '+ Add another...'}
                onChange={addPriorityPlayer}
              />
            )}
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
              
              <span className="text-sm font-semibold text-accent-red">{progressStep === 'Blocked' ? 'Trip Generation Blocked' : 'Trip Generation Failed'}</span>
            </div>
            {progressDetail && (
              <p className="mt-2 text-sm text-text-dim whitespace-pre-line">{progressDetail}</p>
            )}
            <p className="mt-3 text-xs text-text-dim">
              Trips need game schedules. Load them right here, or check the <strong>Schedule</strong> tab to see what's already loaded.
            </p>
            <button
              onClick={handleLoadAllSchedules}
              disabled={anyScheduleLoading}
              className="mt-2 rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-blue/80 disabled:opacity-50"
            >
              {anyScheduleLoading ? 'Loading schedules...' : 'Load Schedules'}
            </button>
          </div>
        )}
      </div>

      {/* Double ups are no longer a separate drawer — trips ARE the options,
          with double-up dates badged on each card (Tom 2026-07-22). Only the
          pair verdicts remain here: "do my priority players line up?" */}
      {!computing && pairVerdicts.length > 0 && (
        <PairVerdictBanner verdicts={pairVerdicts} />
      )}

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

          {/* Player Coverage + coverage stats moved into the collapsible
              "Details" section below the results — Kent asked for results
              first, diagnostics second. */}


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
                Try extending your end date, increasing the max drive, or checking that schedules are loaded for your players.
              </p>
            </div>
          )}

          {/* Unified trip list — road trips and fly-ins sorted together.
              Grouping/numbering comes from the SHARED tripGrouping memo so
              "Trip #N" here always matches the banners above. */}
          {tripGrouping && (tripPlan.trips.length > 0 || tripPlan.flyInVisits.length > 0) && (() => {
            const { unified, groups: numbered } = tripGrouping
            const prioritySet = new Set(priorityPlayers)

            // Filter helper — works on the primary item of each group
            function passesFilters(item: UnifiedTripItem): boolean {
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
              ? filtered.filter((g) => itemHasPriorityPlayer(g.primary, prioritySet))
              : filtered

            // Cap displayed trips (default 5) with a Show all expander —
            // fewer options surfaced by default. Kent's principle: quality
            // over quantity.
            const DEFAULT_TRIP_CAP = 5
            const capped = showAllTrips ? relevantToFilters : relevantToFilters.slice(0, DEFAULT_TRIP_CAP)
            const hasMore = relevantToFilters.length > capped.length

            return (
            <div id="section-road-trips">
              <div className="mb-3">
                {/* Honest count: say what's SHOWN, and why the rest isn't
                    (Tom 2026-07-22: "why does it say 7 trips and show 3?") */}
                <h3 className="text-sm font-semibold text-text">
                  Your Trips
                  <span className="ml-2 text-xs font-normal text-text-dim">
                    {relevantToFilters.length} option{relevantToFilters.length !== 1 ? 's' : ''}
                    {prioritySet.size > 0 && numbered.length > relevantToFilters.length &&
                      ` · ${numbered.length - relevantToFilters.length} without your priority players hidden`}
                  </span>
                </h3>
              </div>


              {/* Side-by-side comparison of starred favorites — renders only
                  when 2+ trips are starred. Lets Kent pick the best one
                  without scrolling back and forth between cards. */}
              <div className="mb-4">
                <CompareStarredTrips />
              </div>

              <div className="space-y-4">
                {capped.map((group) => {
                  const { primary } = group
                  const tripIndex = primary.type === 'road' && tripPlan
                    ? tripPlan.trips.indexOf(primary.trip)
                    : null
                  return (
                    <TripSummaryCard
                      key={`${primary.type}-${group.displayIndex}`}
                      item={primary}
                      tripIndex={tripIndex != null && tripIndex >= 0 ? tripIndex : null}
                      playerMap={playerMap}
                      onPlayerClick={setSelectedPlayer}
                    />
                  )
                })}
                {unified.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">No trips generated for the selected date range.</p>
                )}
                {unified.length > 0 && filtered.length === 0 && (
                  <p className="py-4 text-center text-sm text-text-dim">
                    No trips match these filters. Try switching Show back to "All" or Days to "Any".
                  </p>
                )}
                {prioritySet.size > 0 && filtered.length > 0 && relevantToFilters.length === 0 && (
                  <p className="py-4 text-center text-sm text-accent-orange">
                    None of the generated trips include your priority player{prioritySet.size !== 1 ? 's' : ''}.
                    {' '}Try widening the date range, raising the max drive, or removing a priority filter.
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
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(${TIER_LABELS[p.tier] ?? ''})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-text-dim">Shared</p>
                          {o.shared.length > 0 ? o.shared.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(${TIER_LABELS[p.tier] ?? ''})` : ''}</p>
                          }) : <p className="text-text-dim/50">None</p>}
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-accent-green">Only in #{o.idxB}</p>
                          {o.uniqueB.length > 0 ? o.uniqueB.map((n) => {
                            const p = playerMap.get(n)
                            return <p key={n} className="text-text-dim cursor-pointer hover:text-accent-blue transition-colors" onClick={() => setSelectedPlayer(n)}>{n} {p ? `(${TIER_LABELS[p.tier] ?? ''})` : ''}</p>
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
                      Too far from this trip's area ({beyondFlight.length})
                    </h3>
                    <p className="mb-3 text-xs text-text-dim">
                      These players have games, but nowhere near this trip's area. Plan a separate trip around them (set them as priority players and regenerate).
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
                            ({t1Count > 0 ? `${t1Count} must-see` : ''}{t1Count > 0 && t2Count > 0 ? ', ' : ''}{t2Count > 0 ? `${t2Count} high-priority` : ''} need attention)
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

        </>
      )}

      {/* Details — data freshness, quality, and coverage diagnostics.
          Collapsed by default so results stay front and center. */}
      <details className="rounded-xl border border-border/50 bg-surface">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-text-dim hover:text-text">
          Details
          <span className="ml-2 text-xs font-normal text-text-dim/50">data freshness, quality &amp; player coverage</span>
        </summary>
        <div className="border-t border-border/30 px-5 py-4 space-y-4">
          {/* Freshness pills — one per data layer */}
          {allSchedulesLoaded && !anyScheduleLoading ? (
            <div className="flex flex-wrap gap-1.5 text-[10px] text-text-dim">
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
          ) : (
            <p className="text-xs text-text-dim">{anyScheduleLoading ? 'Schedules are still loading...' : 'Schedules not loaded yet.'}</p>
          )}

          {/* Data quality — game-source confidence across the current results */}
          {tripPlan && tripGrouping && (() => {
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
            for (const item of tripGrouping.unified) {
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
            if (totalGames === 0) return null
            return (
              <p className="text-[11px] text-text-dim/70">
                Data quality: {' '}
                {confidenceCounts.mlb > 0 && <span className="text-accent-green">{confidenceCounts.mlb} confirmed <span className="text-text-dim/40">(MLB API)</span></span>}
                {confidenceCounts.mlb > 0 && (confidenceCounts.d1 + confidenceCounts.hsConfirmed + confidenceCounts.estimated > 0) && <span className="text-text-dim/30"> · </span>}
                {confidenceCounts.d1 > 0 && <span className="text-accent-blue/70">{confidenceCounts.d1} likely <span className="text-text-dim/40">(D1Baseball)</span></span>}
                {confidenceCounts.d1 > 0 && (confidenceCounts.hsConfirmed + confidenceCounts.estimated > 0) && <span className="text-text-dim/30"> · </span>}
                {confidenceCounts.hsConfirmed > 0 && <span className="text-accent-blue/70">{confidenceCounts.hsConfirmed} confirmed <span className="text-text-dim/40">(schedule sheet)</span></span>}
                {confidenceCounts.hsConfirmed > 0 && confidenceCounts.estimated > 0 && <span className="text-text-dim/30"> · </span>}
                {confidenceCounts.estimated > 0 && <span className="text-accent-orange">{confidenceCounts.estimated} estimated <span className="text-text-dim/40">(location approximate)</span></span>}
              </p>
            )
          })()}

          {/* Coverage stats — who made it into a trip and who didn't */}
          {tripPlan && (() => {
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="Total Trips" value={tripPlan.trips.length + displayedFlyIns.length} scrollTo="section-road-trips" hoverNames={allTripPlayerNames} />
              <div title={`${allTripPlayerNames.length} of your ${totalEligible} players appear in at least one trip option.`}>
                <StatCard label="Players in Trips" value={allTripPlayerNames.length} accent="blue" scrollTo="section-road-trips" hoverNames={allTripPlayerNames} />
              </div>
              <StatCard
                label="Not Covered"
                value={notCoveredCount}
                accent={notCoveredCount <= 2 ? 'green' : 'orange'}
                hoverNames={uncoveredPlayers.map((p) => p.playerName)}
                onClick={notCoveredCount > 0 ? () => setNotCoveredOpen((v) => !v) : undefined}
              />
            </div>

            {/* Not Covered explainer — expandable (also toggled by clicking
                the Not Covered card above) */}
            {notCoveredCount > 0 && (
              <NotCoveredExplainer
                expanded={notCoveredOpen}
                onToggle={() => setNotCoveredOpen((v) => !v)}
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

          {/* Player Coverage — answers "where is Player X?" */}
          {tripPlan && (
            <PlayerCoverageCard
              players={players}
              allGames={[...proGames, ...ncaaGames, ...hsGames]}
              onPlayerClick={setSelectedPlayer}
              onLoadAll={handleLoadAllSchedules}
              loadingAll={anyScheduleLoading}
            />
          )}
        </div>
      </details>

      {/* Did you know? — rotating app tips (below results per Kent's flow) */}
      <DidYouKnow />

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

function StatCard({ label, value, accent, scrollTo, hoverNames, onClick }: {
  label: string
  value: string | number
  accent?: string
  scrollTo?: string
  hoverNames?: string[]
  onClick?: () => void
}) {
  // Popover shows on hover (desktop) and PINS on click/tap (mobile-friendly —
  // hover-only meant iPad users could never see the player list).
  const [pinned, setPinned] = useState(false)
  const [hovering, setHovering] = useState(false)
  const hasNames = !!hoverNames && hoverNames.length > 0
  const showPopover = hasNames && (pinned || hovering)
  const accentColor =
    accent === 'green' ? 'text-accent-green' :
    accent === 'blue' ? 'text-accent-blue' :
    accent === 'orange' ? 'text-accent-orange' :
    accent === 'red' ? 'text-accent-red' :
    'text-text'

  // Click precedence: explicit onClick > toggle the popover > scroll target.
  function handleClick() {
    if (onClick) { onClick(); return }
    if (hasNames) { setPinned((v) => !v); return }
    if (scrollTo) document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const isClickable = !!onClick || hasNames || !!scrollTo
  return (
    <div
      className={`relative rounded-xl border border-border bg-surface p-4 ${isClickable ? 'cursor-pointer hover:border-border/80 hover:bg-surface/80 transition-colors' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      onMouseEnter={hasNames ? () => setHovering(true) : undefined}
      onMouseLeave={() => setHovering(false)}
    >
      <p className="text-xs font-medium text-text-dim">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accentColor}`}>{value}</p>
      {showPopover && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-border bg-gray-950 p-2 shadow-lg">
          <p className="mb-1 text-[10px] font-medium text-text-dim">{label} ({hoverNames!.length}){pinned ? ' — tap card to close' : ''}</p>
          <p className="text-[11px] text-text leading-relaxed">{hoverNames!.join(', ')}</p>
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
  const [anchorCoords, setAnchorCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [anchorLabel, setAnchorLabel] = useState('') // cleaned city name for the Build-trip CTA
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
      setAnchorLabel(airportMatch ? airportMatch.name : cleanCity)

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

  // Build a real trip anchored on this city: make it the trip origin (home
  // base), keep the current date window, and generate. Mirrors the pattern
  // DataTab's "Plan trip →" uses so the anchor flow ENDS in a trip, not
  // just a player list.
  function handleBuildTrip() {
    if (!anchorCoords || !anchorLabel) return
    const store = useTripStore.getState()
    store.setHomeBase(anchorCoords, anchorLabel)
    store.setDateRange(startDate, endDate) // seed the window explicitly
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // Brief delay so the origin/date state propagates before generateTrips reads it.
    setTimeout(() => {
      store.generateTrips().catch((e) => console.warn('[trip-anchor] auto-generate failed:', e))
    }, 100)
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
          <button onClick={() => { setResults([]); setAnchorCity(''); setAnchorCoords(null); setAnchorLabel(''); setExpanded(false); onPlayersFound?.([]) }} className="text-xs text-text-dim hover:text-text">Clear</button>
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
          {/* Primary action — turn this city into an actual trip */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-dim">
              <span className="font-medium text-purple-400">{playerEntries.length} players</span> within 3h drive of {anchorLabel || anchorCity}
            </p>
            <button
              onClick={handleBuildTrip}
              className="rounded-lg bg-accent-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-blue/80 transition-colors"
              title={`Set ${anchorLabel || anchorCity} as your starting point and generate trip options for these dates`}
            >
              Build trip from {anchorLabel || anchorCity} →
            </button>
          </div>
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
  expanded, onToggle,
  inactivePlayers, skippedMap,
  beyondFlight, noGamesInRange, noSchedule, otherUncovered, unvisitableMap, onPlayerClick,
  priorityPlayers, setPriorityPlayers,
}: {
  expanded: boolean
  onToggle: () => void
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
  const total = inactivePlayers.length + beyondFlight.length + noGamesInRange.length + noSchedule.length + otherUncovered.length
  if (total === 0) return null

  return (
    <div className="rounded-xl border border-accent-orange/20 bg-accent-orange/5">
      <button
        onClick={onToggle}
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
                      {p.playerName} <span className="rounded bg-accent-red/15 px-1 py-0.5 text-[10px] font-medium text-accent-red ml-0.5">{reason}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {beyondFlight.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-accent-orange mb-1">Too far to reach ({beyondFlight.length})</p>
              <p className="text-[10px] text-text-dim/60 mb-1.5">These players' games are nowhere near this trip's area — plan a separate trip around them.</p>
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

            const canAddPriority = priorityPlayers.length < PRIORITY_SLOTS
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
                            title={isClickableTier ? (alreadyPrio ? 'Already a Priority Player' : canAddPriority ? 'Click to add as Priority Player' : `Priority Player slots full (max ${PRIORITY_SLOTS})`) : undefined}
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
            <li>Pick your <span className="text-text">date range</span> and adjust the max drive if needed.</li>
            <li>Hit <span className="font-medium text-accent-blue">Generate Trips</span> to build trip options.</li>
            <li>Review your trips — expand any card for the full day-by-day itinerary.</li>
          </ol>
          <p className="mt-2 text-[10px] text-text-dim/50">Use Priority Players to build trips around specific guys first.</p>
        </div>
      )}
    </div>
  )
}
