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
import type { WindowResult } from './hooks/useBestWindows'
import { formatDate } from '../../lib/formatters'

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
  const tierMarkers = useTierMarkers(venuePlayerMap, dateFilteredVenues, filterStart, filterEnd)

  // Best window recommender
  const homeBase = useTripStore((s) => s.homeBase)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const [windowDays, setWindowDays] = useState(3)
  const bestWindows = useBestWindows(tierMarkers, homeBase, maxDriveMinutes, filterStart, filterEnd, windowDays)

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

      {/* Best window recommender */}
      {hasSchedules && tierMarkers.length > 0 && (
        <BestWindowsPanel
          windows={bestWindows}
          windowDays={windowDays}
          setWindowDays={setWindowDays}
          onApply={(w) => {
            setFilterStart(w.startDate)
            setFilterEnd(w.endDate)
          }}
        />
      )}

      {/* Tips */}
      <MapTip />

      {/* Map */}
      <MapContainer tierMarkers={tierMarkers} />

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
  'Click any dot to see who plays there and when. Click a name to view their full schedule.',
  'The dashed circle shows your drive radius from the Trip Planner starting location.',
  'Change the date range to see where your players have games in any window.',
  'Use "Next 30 days" to see the full upcoming month at a glance.',
  'The map shows where players will be playing — away games appear at the opponent\'s venue.',
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

function BestWindowsPanel({
  windows,
  windowDays,
  setWindowDays,
  onApply,
}: {
  windows: WindowResult[]
  windowDays: number
  setWindowDays: (n: number) => void
  onApply: (w: WindowResult) => void
}) {
  const [open, setOpen] = useState(false)
  const homeBaseName = useTripStore((s) => s.homeBaseName)

  return (
    <div className="rounded-lg bg-surface border border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-semibold text-text hover:text-accent-blue transition-colors"
        >
          <span className={`text-text-dim transition-transform text-xs ${open ? 'rotate-90' : ''}`}>&#9654;</span>
          Best Windows
          {windows.length > 0 && !open && (
            <span className="text-xs font-normal text-text-dim ml-1">
              — Top pick: {formatDate(windows[0]!.startDate)}–{formatDate(windows[0]!.endDate)}, {windows[0]!.uniquePlayerCount} players
            </span>
          )}
        </button>
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
  return (
    <div className="rounded-lg bg-surface border border-border px-5 py-4 relative">
      <button
        onClick={() => { setDismissed(true); try { localStorage.setItem('sv-map-welcome-dismissed', '1') } catch {} }}
        className="absolute top-3 right-4 text-xs text-text-dim hover:text-text"
      >
        Got it
      </button>
      <h3 className="text-sm font-semibold text-text mb-2">Player Map</h3>
      <p className="text-xs text-text-dim leading-relaxed">
        This map shows where your players have games in the selected date range.
        Each dot is a venue — <span className="text-[#ef4444] font-medium">red</span> for must-see players,{' '}
        <span className="text-[#f97316] font-medium">orange</span> for high priority,{' '}
        <span className="text-[#6b7280] font-medium">gray</span> for standard.
        The dashed circle shows what's drivable from your home base.
      </p>
      <p className="text-xs text-text-dim leading-relaxed mt-1.5">
        Click any dot to see who's playing there and when. Click a player's name to view their full schedule.
        Use the date range and home base controls above to explore different windows and locations.
      </p>
    </div>
  )
}
