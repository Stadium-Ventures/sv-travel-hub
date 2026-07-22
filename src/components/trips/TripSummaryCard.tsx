import { useMemo } from 'react'
import type { TripCandidate, FlyInVisit, GameEvent } from '../../types/schedule'
import type { RosterPlayer } from '../../types/roster'
import { formatDate, formatGameTime, TIER_DOT_COLORS } from '../../lib/formatters'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { dispatchMapEvent } from '../../lib/mapEvents'

// Compact opportunity card — the same visual language as the Double Up
// cards (Tom 2026-07-22: "you had a view earlier today that I liked so much
// better"). No day-by-day itinerary, no return-home assumptions, no score:
// just WHO you'd see and WHEN the games are in relation to each other.

interface GameLine {
  date: string
  time?: string
  venue: string
  coords: { lat: number; lng: number }
  players: string[]
  source: GameEvent['source']
}

function linesForRoadTrip(trip: TripCandidate): GameLine[] {
  const seen = new Set<string>()
  const lines: GameLine[] = []
  for (const g of [trip.anchorGame, ...trip.nearbyGames]) {
    const key = `${g.id}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({
      date: g.date,
      time: g.source === 'mlb-api' ? g.time : undefined,
      venue: g.venue.name,
      coords: g.venue.coords,
      players: g.playerNames,
      source: g.source,
    })
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}

function linesForFlyIn(visit: FlyInVisit): GameLine[] {
  if (visit.stops && visit.stops.length > 0) {
    return visit.stops.map((s) => ({
      date: s.date,
      time: s.gameTime,
      venue: s.venue.name,
      coords: s.venue.coords,
      players: s.playerNames,
      source: s.source,
    })).sort((a, b) => a.date.localeCompare(b.date))
  }
  return [...visit.dates].sort().map((d) => ({
    date: d,
    time: visit.gameTime,
    venue: visit.venue.name,
    coords: visit.venue.coords,
    players: visit.playerNames,
    source: visit.source,
  }))
}

export default function TripSummaryCard({
  item,
  tripIndex,
  playerMap,
  onPlayerClick,
}: {
  item: { type: 'road'; trip: TripCandidate } | { type: 'flyin'; visit: FlyInVisit }
  /** Index into tripPlan.trips for road trips — powers Show on Map. */
  tripIndex: number | null
  playerMap: Map<string, RosterPlayer>
  onPlayerClick?: (name: string) => void
}) {
  const starredTrips = useTripStore((s) => s.starredTrips)
  const toggleTripStar = useTripStore((s) => s.toggleTripStar)

  const lines = useMemo(
    () => (item.type === 'road' ? linesForRoadTrip(item.trip) : linesForFlyIn(item.visit)),
    [item],
  )
  const playerNames = useMemo(() => {
    const names: string[] = []
    for (const l of lines) for (const n of l.players) if (!names.includes(n)) names.push(n)
    return names.sort((a, b) => (playerMap.get(a)?.tier ?? 4) - (playerMap.get(b)?.tier ?? 4))
  }, [lines, playerMap])

  if (lines.length === 0) return null
  const first = lines[0]!.date
  const last = lines[lines.length - 1]!.date
  const dateLabel = first === last ? formatDate(first) : `${formatDate(first)} – ${formatDate(last)}`
  const venueCount = new Set(lines.map((l) => l.venue)).size
  const tripKey = item.type === 'road' ? getTripKey(item.trip) : null
  const starred = tripKey ? !!starredTrips[tripKey] : false

  function showOnMap() {
    if (item.type === 'road' && tripIndex != null) {
      useTripStore.getState().setSelectedTripIndex(tripIndex)
    } else {
      dispatchMapEvent('map:fit-points', { points: lines.map((l) => l.coords) })
    }
    dispatchMapEvent('app:switch-tab', { tab: 'map' })
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="rounded-xl bg-gray-900/40 px-4 py-3 transition-colors hover:bg-gray-900/60">
      {/* Title: the players */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-semibold text-text">
          {playerNames.map((name) => {
            const tier = playerMap.get(name)?.tier ?? 4
            return (
              <span
                key={name}
                className={`inline-flex items-center gap-1.5 ${onPlayerClick ? 'cursor-pointer hover:text-accent-blue' : ''}`}
                onClick={onPlayerClick ? () => onPlayerClick(name) : undefined}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${TIER_DOT_COLORS[tier] ?? 'bg-gray-500'}`} />
                {name}
              </span>
            )
          })}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={showOnMap}
            className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text hover:bg-gray-800/50 transition-colors"
            title="See this trip's venues on the map"
          >
            Show on map
          </button>
          {tripKey && (
            <button
              onClick={() => toggleTripStar(tripKey)}
              className={`text-base leading-none transition-colors ${starred ? 'text-yellow-400' : 'text-text-dim/50 hover:text-text-dim'}`}
              title={starred ? 'Unstar this trip' : 'Star this trip'}
            >
              {starred ? '★' : '☆'}
            </button>
          )}
        </span>
      </div>

      {/* Detail line */}
      <p className="mt-1 text-[11px] text-text-dim">
        <span className="font-medium">{dateLabel}</span>
        <span> · {lines.length} game{lines.length !== 1 ? 's' : ''}</span>
        <span> · {venueCount} venue{venueCount !== 1 ? 's' : ''}</span>
      </p>

      {/* Games in relation to each other — no itinerary assumptions */}
      <div className="mt-1 space-y-0.5">
        {lines.map((l, i) => (
          <p key={`${l.date}-${l.venue}-${i}`} className="truncate text-[11px] text-text-dim/70">
            <span className="inline-block w-24 font-medium text-text-dim">{formatDate(l.date)}</span>
            <span className="text-text-dim">{l.venue}</span>
            {l.time && <span className="text-text-dim/60"> {formatGameTime(l.time)}</span>}
            {l.players.length > 0 && <span> · {l.players.join(', ')}</span>}
          </p>
        ))}
      </div>
    </div>
  )
}
