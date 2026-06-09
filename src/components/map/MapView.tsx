import { useEffect, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useVenueStore } from '../../store/venueStore'
import { useTripStore } from '../../store/tripStore'
import { addMapEventListener } from '../../lib/mapEvents'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import DateRangeBar from './DateRangeBar'
import MapContainer from './MapContainer'
import { useVenuePlayerMap } from './hooks/useVenuePlayerMap'
import { useDateFilteredVenues } from './hooks/useDateFilteredVenues'
import { useMapDateRange } from './hooks/useMapDateRange'
import { useTierMarkers } from './hooks/useTierMarkers'
import { useBestWindows } from './hooks/useBestWindows'
import type { WindowResult, BestWindowStrategy } from './hooks/useBestWindows'
import { formatDate } from '../../lib/formatters'
import MapFilters, { DEFAULT_MAP_FILTERS, applyMapFilters, type MapFilterState } from './MapFilters'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useMemo } from 'react'

const TIER_DOT_COLORS: Record<number, string> = { 1: 'bg-[#ef4444]', 2: 'bg-[#f97316]', 3: 'bg-gray-500' }

export default function MapView() {
  const [schedulePanelPlayer, setSchedulePanelPlayer] = useState<string | null>(null)

  const players = useRosterStore((s) => s.players)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const venues = useVenueStore((s) => s.venues)
  const loadNcaaVenues = useVenueStore((s) => s.loadNcaaVenues)
  const loadSpringTrainingVenues = useVenueStore((s) => s.loadSpringTrainingVenues)
  const addProVenue = useVenueStore((s) => s.addProVenue)
  const geocodeHsVenues = useVenueStore((s) => s.geocodeHsVenues)

  // Date range state
  const {
    filterStart,
    filterEnd,
    setFilterStart,
    setFilterEnd,
    setNext7Days,
    setNext30Days,
    syncFromTrip,
  } = useMapDateRange()

  // Data hooks
  const venuePlayerMap = useVenuePlayerMap()
  const dateFilteredVenues = useDateFilteredVenues(filterStart, filterEnd)
  const allTierMarkers = useTierMarkers(venuePlayerMap, dateFilteredVenues, filterStart, filterEnd)

  // Tier / level / search / overdue filter (Maptive Stage 1 polish)
  const [filterState, setFilterState] = useState<MapFilterState>(DEFAULT_MAP_FILTERS)
  const heartbeatPlayers = useHeartbeatStore((s) => s.players)
  const daysByPlayerKey = useMemo(() => {
    const m = new Map<string, number | null>()
    for (const p of heartbeatPlayers) {
      m.set(p.name.trim().toLowerCase(), p.daysSinceInPerson ?? null)
    }
    return m
  }, [heartbeatPlayers])
  const tierMarkers = applyMapFilters(allTierMarkers, filterState, daysByPlayerKey)

  // Best window recommender (uses filtered markers — Kent's filters should
  // drive the recommendations too)
  const homeBase = useTripStore((s) => s.homeBase)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const [windowDays, setWindowDays] = useState(3)
  const [bestWindowStrategy, setBestWindowStrategy] = useState<BestWindowStrategy>('impact')
  const bestWindows = useBestWindows(tierMarkers, homeBase, maxDriveMinutes, filterStart, filterEnd, windowDays, 5, bestWindowStrategy)

  // Are any schedules loaded?
  const hasSchedules = proGames.length > 0 || ncaaGames.length > 0 || hsGames.length > 0

  // Load venues once
  const venuesLoaded = useRef(false)
  useEffect(() => {
    if (venuesLoaded.current) return
    venuesLoaded.current = true
    loadNcaaVenues()
    loadSpringTrainingVenues()
  }, [loadNcaaVenues, loadSpringTrainingVenues])

  // Geocode HS venues once when players are available
  const hsGeocodeStarted = useRef(false)
  useEffect(() => {
    if (hsGeocodeStarted.current) return
    const hsPlayers = players.filter((p) => p.level === 'HS')
    if (hsPlayers.length === 0) return
    const hasHsVenues = Object.keys(venues).some((k) => k.startsWith('hs-'))
    if (hasHsVenues) { hsGeocodeStarted.current = true; return }
    hsGeocodeStarted.current = true
    const schools = hsPlayers.map((p) => ({
      schoolName: p.org,
      city: '',
      state: p.state,
    }))
    geocodeHsVenues(schools)
  }, [players, venues, geocodeHsVenues])

  // Add pro venues from schedule data
  const lastProGamesLen = useRef(0)
  useEffect(() => {
    if (proGames.length === lastProGamesLen.current) return
    lastProGamesLen.current = proGames.length
    for (const game of proGames) {
      const key = `pro-${game.venue.name.toLowerCase().replace(/\s+/g, '-')}`
      addProVenue(key, game.venue.name, game.venue.coords)
    }
  }, [proGames, addProVenue])

  // Listen for map:open-schedule events
  useEffect(() => {
    return addMapEventListener('map:open-schedule', (detail) => {
      if (detail.player) setSchedulePanelPlayer(detail.player)
    })
  }, [])

  // When a Trip Card sets selectedTripIndex (via the "Show on Map" button),
  // sync the map's visible date range to that trip's window so the trip's
  // venues actually fall inside the date filter and tier markers stay visible
  // around the highlighted polyline.
  const selectedTripIndex = useTripStore((s) => s.selectedTripIndex)
  const tripPlan = useTripStore((s) => s.tripPlan)
  useEffect(() => {
    if (selectedTripIndex == null || !tripPlan) return
    const trip = tripPlan.trips[selectedTripIndex]
    if (!trip || trip.suggestedDays.length === 0) return
    const days = [...trip.suggestedDays].sort()
    setFilterStart(days[0]!)
    setFilterEnd(days[days.length - 1]!)
  }, [selectedTripIndex, tripPlan, setFilterStart, setFilterEnd])

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      {/* Welcome explainer — dismissible */}
      <MapWelcome />

      {/* Schedule banner */}
      {!hasSchedules && (
        <div className="rounded-lg bg-surface border border-border px-4 py-3 text-sm text-text-dim">
          Load schedules from the <span className="font-medium text-text">Trip Planner</span> tab to see game venues on the map.
        </div>
      )}

      {/* Date range bar */}
      <DateRangeBar
        filterStart={filterStart}
        filterEnd={filterEnd}
        setFilterStart={setFilterStart}
        setFilterEnd={setFilterEnd}
        onNext7Days={setNext7Days}
        onNext30Days={setNext30Days}
        onUseTripDates={syncFromTrip}
        venueCount={tierMarkers.length}
      />

      {/* Filter strip — tier / level / search / overdue (acts as legend too) */}
      {hasSchedules && (
        <MapFilters
          state={filterState}
          setState={setFilterState}
          markerCount={tierMarkers.length}
          totalCount={allTierMarkers.length}
          daysByPlayerKey={daysByPlayerKey}
        />
      )}

      {/* Trip preview banner — shown when a Trip Card highlighted itself on the map */}
      {selectedTripIndex != null && tripPlan && tripPlan.trips[selectedTripIndex] && (
        <div className="flex items-center justify-between rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs">
          <span className="text-yellow-200">
            Previewing <strong>Trip #{selectedTripIndex + 1}</strong>
            {tripPlan.trips[selectedTripIndex]!.anchorGame.venue.name && (
              <span className="text-yellow-200/70"> · {tripPlan.trips[selectedTripIndex]!.anchorGame.venue.name}</span>
            )}
          </span>
          <button
            onClick={() => useTripStore.getState().setSelectedTripIndex(null)}
            className="text-yellow-200/80 hover:text-yellow-200 underline-offset-2 hover:underline"
          >
            clear preview
          </button>
        </div>
      )}

      {/* Best window recommender */}
      {hasSchedules && tierMarkers.length > 0 && (
        <BestWindowsPanel
          windows={bestWindows}
          windowDays={windowDays}
          setWindowDays={setWindowDays}
          strategy={bestWindowStrategy}
          setStrategy={setBestWindowStrategy}
          onApply={(w) => {
            setFilterStart(w.startDate)
            setFilterEnd(w.endDate)
          }}
        />
      )}

      {/* Tips */}
      <MapTip />

      {/* Map — when a specific player is selected, fitToMarkersKey changes,
          telling MapContainer to zoom to wherever that player's venues are.
          ("Find Jake Munroe for me.") */}
      <MapContainer
        tierMarkers={tierMarkers}
        colorBy={filterState.colorBy}
        fitToMarkersKey={filterState.selectedPlayer || undefined}
      />

      {/* Schedule panel (side drawer) */}
      {schedulePanelPlayer && (
        <PlayerSchedulePanel
          playerName={schedulePanelPlayer}
          onClose={() => setSchedulePanelPlayer(null)}
        />
      )}
    </div>
  )
}

const MAP_TIPS = [
  'Red dots = must-see players (Tier 1). Orange = high priority. Gray = standard.',
  'Click any dot to see who plays there, when, and how recently each player was visited.',
  'The dashed circle shows your drive radius from your starting location.',
  'Switch "Color by" to Heartbeat to see which venues have overdue players (red = >90 days).',
  'Tap "Overdue only" in the filter strip to hide venues where everyone\'s been visited recently.',
  'Set "From" to a city you\'ll be in — Miami, Chicago — and the drive radius recenters there.',
  'Click "Plan trip with these N players" on any popup to jump straight into the Trip Planner.',
  'Generate trips in the Trip Planner tab, then click "Show on Map" to preview the route.',
]

function MapTip() {
  const [tipIndex, setTipIndex] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTipIndex((i) => (i + 1) % MAP_TIPS.length), 8000)
    return () => clearInterval(interval)
  }, [])
  return (
    <p className="text-[11px] text-accent-blue/70">
      <span className="font-medium text-accent-blue/90">TIP</span>{' '}
      {MAP_TIPS[tipIndex]}
    </p>
  )
}

const STRATEGY_OPTIONS: { value: BestWindowStrategy; label: string; hint: string }[] = [
  { value: 'impact',            label: 'Highest overall impact',     hint: 'Tier-weighted score — best mix of T1/T2 coverage' },
  { value: 't1-count',          label: 'Most T1 players in one trip', hint: 'Maximize Tier 1 player count in the window' },
  { value: 'overdue-priority',  label: 'Overdue high-priority players', hint: 'Catch T1/T2 players you haven\'t seen in 90+ days' },
  { value: 'player-count',      label: 'Most players (any tier)',     hint: 'Maximize total unique players regardless of tier' },
  { value: 'tuesday',           label: 'Includes a Tuesday',          hint: 'Best day for MiLB position-player visits' },
]

function BestWindowsPanel({
  windows,
  windowDays,
  setWindowDays,
  strategy,
  setStrategy,
  onApply,
}: {
  windows: WindowResult[]
  windowDays: number
  setWindowDays: (n: number) => void
  strategy: BestWindowStrategy
  setStrategy: (s: BestWindowStrategy) => void
  onApply: (w: WindowResult) => void
}) {
  // Default open so Kent always sees a recommendation without clicking. The
  // user's panel state is preserved within the session via this local state.
  const [open, setOpen] = useState(true)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const topPick = windows[0]
  const currentStrategy = STRATEGY_OPTIONS.find((o) => o.value === strategy) ?? STRATEGY_OPTIONS[0]!

  return (
    <div className="rounded-lg bg-surface border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-semibold text-text hover:text-accent-blue transition-colors"
        >
          <span className={`text-text-dim transition-transform text-xs ${open ? 'rotate-90' : ''}`}>&#9654;</span>
          Best Windows
          {topPick && (
            <span className="text-xs font-normal text-text-dim ml-1">
              — Top pick: {formatDate(topPick.startDate)}–{formatDate(topPick.endDate)}, {topPick.uniquePlayerCount} players
            </span>
          )}
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-dim/70">Prioritize by</span>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as BestWindowStrategy)}
              title={currentStrategy.hint}
              className="rounded border border-border bg-gray-950/50 px-2 py-1 text-xs text-text focus:border-accent-blue focus:outline-none"
            >
              {STRATEGY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-text-dim">Trip length:</span>
            {([1, 2, 3] as const).map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  windowDays === d ? 'bg-accent-blue/20 text-accent-blue' : 'bg-gray-800/50 text-text-dim hover:text-text'
                }`}
              >
                {d}-day
              </button>
            ))}
          </div>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {windows.length === 0 ? (
            <p className="text-xs text-text-dim">No games within drive radius for this date range.</p>
          ) : (
            windows.map((w, i) => (
              <div
                key={w.startDate}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 border transition-colors ${
                  i === 0 ? 'border-accent-blue/30 bg-accent-blue/5' : 'border-border/30 bg-gray-950/30'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {i === 0 && (
                      <span className="rounded-full bg-accent-blue/20 px-2 py-0.5 text-[10px] font-bold text-accent-blue">
                        BEST
                      </span>
                    )}
                    <span className="text-sm font-medium text-text">
                      {formatDate(w.startDate)} – {formatDate(w.endDate)}
                    </span>
                    {w.hasTuesday && (
                      <span className="text-[10px] text-accent-blue/70">Tue</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-text-dim">
                      {w.uniquePlayerCount} player{w.uniquePlayerCount !== 1 ? 's' : ''}
                    </span>
                    {w.t1Count > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[1]}`} />
                        {w.t1Count} T1
                      </span>
                    )}
                    {w.t2Count > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[2]}`} />
                        {w.t2Count} T2
                      </span>
                    )}
                    {w.t3Count > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[3]}`} />
                        {w.t3Count} T3
                      </span>
                    )}
                    {w.overdueCount > 0 && (
                      <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-red"
                        title={`${w.overdueCount} player(s) in this window are overdue (>90 days since visit) or never visited. Window score boosted.`}>
                        {w.overdueCount} overdue
                      </span>
                    )}
                    {w.timeConflictCount > 0 && (
                      <span className="rounded bg-accent-orange/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-orange"
                        title={`${w.timeConflictCount} game(s) overlap in start time across different venues — Kent can only attend one of each conflicting set. Window score discounted.`}>
                        ⚠ {w.timeConflictCount} conflict{w.timeConflictCount !== 1 ? 's' : ''}
                      </span>
                    )}
                    <span className="text-[10px] text-text-dim/40">
                      drivable from {homeBaseName}
                    </span>
                  </div>
                  {/* Player names */}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {w.players.slice(0, 8).map((p) => (
                      <span key={p.name} className="text-[10px] text-text-dim/70">
                        <span className={`inline-block h-1 w-1 rounded-full ${TIER_DOT_COLORS[p.tier] ?? 'bg-gray-600'} mr-0.5`} />
                        {p.name}
                      </span>
                    ))}
                    {w.players.length > 8 && (
                      <span className="text-[10px] text-text-dim/40">+{w.players.length - 8} more</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onApply(w)}
                  className="ml-3 shrink-0 rounded-lg bg-accent-blue/15 px-3 py-1.5 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
                >
                  Use dates
                </button>
              </div>
            ))
          )}
          {windows.length > 0 && (
            <p className="text-[10px] text-text-dim/40 mt-1">
              Ranked by tier-weighted player count within your {Math.floor(useTripStore.getState().maxDriveMinutes / 60)}h drive radius. Non-overlapping windows only.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function MapWelcome() {
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('sv-map-welcome-dismissed') === '1' } catch { return false }
  })
  if (dismissed) return null
  function dismiss() {
    setDismissed(true)
    try { localStorage.setItem('sv-map-welcome-dismissed', '1') } catch {}
  }
  return (
    <div className="rounded-lg bg-accent-blue/5 border border-accent-blue/30 px-5 py-4 relative">
      <button
        onClick={dismiss}
        className="absolute top-3 right-4 text-xs text-text-dim hover:text-text"
      >
        Got it
      </button>
      <h3 className="text-sm font-semibold text-text mb-2">Start here</h3>
      <ol className="text-xs text-text-dim leading-relaxed space-y-1 list-decimal list-inside">
        <li><strong className="text-text">Pick a date range</strong> in the bar below (or click <em>Next 7 days</em>).</li>
        <li><strong className="text-text">Pick where you'll be</strong> — choose from the <em>From</em> dropdown, or type any city in the <em>or type a city</em> box.</li>
        <li>Each dot on the map is a venue with at least one of your players' games in that window. Click a dot to see who, when, and how long since you've visited.</li>
        <li>Want suggestions? Open <em>Best Windows</em> below, or jump to the <em>Trip Planner</em> tab.</li>
      </ol>
      <p className="text-[11px] text-text-dim/60 mt-2">
        Tip: switch <strong className="text-text">Color by</strong> to <em>Heartbeat</em> to see overdue players in red — independent of tier.
      </p>
    </div>
  )
}
