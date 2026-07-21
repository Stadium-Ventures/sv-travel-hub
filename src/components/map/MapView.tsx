import { useEffect, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useVenueStore } from '../../store/venueStore'
import { useTripStore } from '../../store/tripStore'
import { addMapEventListener, dispatchMapEvent } from '../../lib/mapEvents'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'
import DateRangeBar from './DateRangeBar'
import MapContainer from './MapContainer'
import { useVenuePlayerMap } from './hooks/useVenuePlayerMap'
import { useEventMarkers } from './hooks/useEventMarkers'
import { useDateFilteredVenues } from './hooks/useDateFilteredVenues'
import { useMapDateRange } from './hooks/useMapDateRange'
import { useTierMarkers } from './hooks/useTierMarkers'
import { useBestWindows } from './hooks/useBestWindows'
import type { BestWindowStrategy } from './hooks/useBestWindows'
import { useDestinationPicks } from './hooks/useDestinationPicks'
import SuggestionsPanel, { type SuggestTab } from './SuggestionsPanel'
import MapFilters, { DEFAULT_MAP_FILTERS, applyMapFilters, type MapFilterState } from './MapFilters'
import SummerCoverageNotice from './SummerCoverageNotice'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useSummerStore } from '../../store/summerStore'
import { findDoubleUps } from '../../lib/doubleUps'
import type { DoubleUp } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'
import { useMemo } from 'react'

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
  const eventMarkers = useEventMarkers(filterStart, filterEnd)
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
  const homeBaseForFilter = useTripStore((s) => s.homeBase)
  const maxDriveForFilter = useTripStore((s) => s.maxDriveMinutes)
  const tierMarkers = applyMapFilters(allTierMarkers, filterState, daysByPlayerKey, {
    homeBase: homeBaseForFilter,
    maxDriveMinutes: maxDriveForFilter,
  })

  // Best window recommender (uses filtered markers — Kent's filters should
  // drive the recommendations too)
  const homeBase = useTripStore((s) => s.homeBase)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const [windowDays, setWindowDays] = useState(3)
  const [bestWindowStrategy, setBestWindowStrategy] = useState<BestWindowStrategy>('impact')

  // Double ups for the map's date window — roster-wide (origin-agnostic).
  // Computed before Best Windows so the "Contains double ups" strategy and
  // per-window double-up chips can use them.
  const summerGames = useSummerStore((s) => s.summerGames)
  const doubleUps = useMemo(() => {
    if (players.length === 0) return []
    const all = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    if (all.length === 0) return []
    return findDoubleUps(all, players, filterStart, filterEnd)
  }, [proGames, ncaaGames, hsGames, summerGames, players, filterStart, filterEnd])

  const bestWindows = useBestWindows(tierMarkers, homeBase, maxDriveMinutes, filterStart, filterEnd, windowDays, 5, bestWindowStrategy, doubleUps)

  // Destination picks — scans ALL tier markers (not drive-filtered) because
  // the whole point of "Where to go?" is to look beyond the current radius.
  const destinationPicks = useDestinationPicks(allTierMarkers, homeBase, 180, 360, 5)
  const playerMap = useMemo(() => {
    const m = new Map<string, RosterPlayer>()
    for (const p of players) m.set(p.playerName, p)
    return m
  }, [players])
  const [suggestTab, setSuggestTab] = useState<SuggestTab>('when')
  const [selectedDoubleUp, setSelectedDoubleUp] = useState<number | null>(null)

  function handlePlanDoubleUp(du: DoubleUp) {
    useTripStore.getState().setPriorityPlayers(du.playerNames.slice(0, 5))
    const today = new Date().toISOString().split('T')[0]!
    const first = du.dates[0] ?? du.date
    const last = du.dates[du.dates.length - 1] ?? du.date
    const start = first > today ? first : today
    useTripStore.getState().setDateRange(start, last >= start ? last : start)
    dispatchMapEvent('app:switch-tab', { tab: 'trips' })
    setTimeout(() => {
      useTripStore.getState().generateTrips().catch((e) => console.warn('[map] auto-generate after double-up failed:', e))
    }, 100)
  }

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

  // Listen for global player search from the header. Filter to that player
  // (which will trigger the map zoom via fitToMarkersKey).
  useEffect(() => {
    return addMapEventListener('map:select-player', (detail) => {
      if (!detail.playerName) return
      setFilterState((s) => ({ ...s, selectedPlayer: detail.playerName }))
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
      {/* Help + the wide control strips stay full-width across the top so the
          date/origin/filter rows don't get cramped. Everything below splits
          into a two-pane layout: a scrolling recommendations rail on the left
          and a sticky, always-visible map on the right. The map used to live
          ~1,250px down the page (below both recommenders); pinning it keeps
          the namesake feature in view while Kent reads the picks. */}
      <MapHelp />

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

      {/* Two-pane: recommendations rail (left) · sticky map (right).
          On small screens the MAP renders first (order classes) — it's the
          tab's namesake and used to sit below the fold under both
          recommender panels. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* ── Left rail: recommendations (scrolls with the page) ── */}
        <div className="order-2 lg:order-none flex flex-col gap-3 lg:w-[460px] lg:shrink-0">
          {/* Summer coverage gap — only renders if any SV player is in a
              non-live summer league (e.g. PGCBL, NECBL, Northwoods). */}
          <SummerCoverageNotice />

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

          {/* Suggestions — one tabbed panel replacing the old stacked Best
              Windows + Where to go? pair (Tom 2026-07-21: consolidate). Tabs:
              When (dates from the star) · Where (cities, radius-agnostic) ·
              Double Ups (2+ clients, one outing — also draws map connectors). */}
          {hasSchedules && allTierMarkers.length > 0 && (
            <SuggestionsPanel
              windows={bestWindows}
              windowDays={windowDays}
              setWindowDays={setWindowDays}
              strategy={bestWindowStrategy}
              setStrategy={setBestWindowStrategy}
              onApplyWindow={(w) => {
                setFilterStart(w.startDate)
                setFilterEnd(w.endDate)
                // Jump to Trip Planner; the planner picks up the new dates from
                // the shared trip store and we kick off generation after a brief
                // delay so the date state propagates before generateTrips reads it.
                dispatchMapEvent('app:switch-tab', { tab: 'trips' })
                setTimeout(() => {
                  useTripStore.getState().generateTrips().catch((e) => console.warn('[map] auto-generate after Use Window failed:', e))
                }, 100)
              }}
              picks={destinationPicks}
              doubleUps={doubleUps}
              playerMap={playerMap}
              activeTab={suggestTab}
              setActiveTab={setSuggestTab}
              selectedDoubleUp={selectedDoubleUp}
              setSelectedDoubleUp={setSelectedDoubleUp}
              onPlanDoubleUp={handlePlanDoubleUp}
            />
          )}
        </div>

        {/* ── Right on desktop / FIRST on mobile: sticky map. Fills the
            viewport height and pins in place on desktop so it stays visible
            while the left rail scrolls. ── */}
        <div className="order-1 lg:order-none min-w-0 flex-1">
          <div className="h-[calc(100vh-180px)] min-h-[500px] lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]">
            {/* Map — when a specific player is selected, fitToMarkersKey changes,
                telling MapContainer to zoom to wherever that player's venues are.
                ("Find Jake Munroe for me.") */}
            <MapContainer
              tierMarkers={tierMarkers}
              colorBy={filterState.colorBy}
              eventMarkers={eventMarkers}
              fitToMarkersKey={filterState.selectedPlayer || undefined}
              doubleUps={suggestTab === 'doubleups' ? doubleUps.slice(0, 12) : []}
              selectedDoubleUp={selectedDoubleUp}
            />
          </div>
        </div>
      </div>

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

/** Collapsible help disclosure — replaces the old always-visible welcome
 *  banner + rotating tip line. Click to expand; remembers dismiss state in
 *  localStorage so repeat users don't see it every load. */
function MapHelp() {
  // Default collapsed — Kent uses this view weekly and doesn't need the
  // tutorial open on every load. Expanding is remembered so it can be pinned.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem('sv-map-help-open') === '1' } catch { return false }
  })
  function toggle() {
    const next = !open
    setOpen(next)
    try {
      if (next) localStorage.setItem('sv-map-help-open', '1')
      else localStorage.removeItem('sv-map-help-open')
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
          <span className="font-medium text-text">{open ? 'How to use this map' : 'How to use this map'}</span>
          {!open && <span className="text-text-dim/60 text-[11px]">— click for the quick guide</span>}
        </span>
        <span className={`text-text-dim text-xs transition-transform ${open ? 'rotate-90' : ''}`}>&#9654;</span>
      </button>
      {open && (
        <div className="border-t border-border/30 px-5 py-3 text-xs text-text-dim leading-relaxed">
          <ol className="space-y-1 list-decimal list-inside">
            <li><strong className="text-text">Pick a date range</strong> in the bar below (or click <em>Next 7 days</em>).</li>
            <li><strong className="text-text">Pick where you'll be</strong> via the <em>From</em> dropdown — preset cities or type any city.</li>
            <li>Each dot = a venue with at least one of your players. Click for who, when, and recency.</li>
            <li>For suggestions, open <em>Best Windows</em> below or jump to the <em>Trip Planner</em>.</li>
          </ol>
          <p className="mt-2 text-[11px] text-text-dim/60">
            Switch <strong className="text-text">Color by</strong> to <em>Heartbeat</em> to see overdue players (magenta) — uses a different palette than Tier so they don't conflict visually.
          </p>
        </div>
      )}
    </div>
  )
}
