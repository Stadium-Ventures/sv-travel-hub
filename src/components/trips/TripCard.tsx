import { useMemo, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useTripStore, getTripKey } from '../../store/tripStore'
import type { TripCandidate, VisitConfidence, ScheduleSource } from '../../types/schedule'
import { generateTripIcs, downloadIcs } from '../../lib/icsExport'
import { haversineKm, HOME_BASE } from '../../lib/tripEngine'
import { formatDate, formatDriveTime, TIER_DOT_COLORS } from '../../lib/formatters'
import type { TripStatus } from '../../store/tripStore'
import type { RosterPlayer } from '../../types/roster'

interface Props {
  trip: TripCandidate
  index: number
  playerMap: Map<string, RosterPlayer>
  defaultExpanded?: boolean
  onPlayerClick?: (playerName: string) => void
}

function formatGameTime(timeStr?: string, source?: ScheduleSource): string {
  if (!timeStr) return ''
  // Synthetic events (ST/NCAA/HS) have generic times — show TBD
  if (source && source !== 'mlb-api') return 'TBD'
  const d = new Date(timeStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET'
}

// Derive a human-readable reason the player should be at this venue
function getVisitContext(source: ScheduleSource, isHome: boolean, awayTeam: string): {
  label: string
  color: string
} {
  if (awayTeam === 'Spring Training') {
    return { label: 'Spring Training', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  if (source === 'mlb-api') {
    return isHome
      ? { label: 'Home Game', color: 'bg-accent-green/15 text-accent-green' }
      : { label: 'Away Game', color: 'bg-purple-500/15 text-purple-400' }
  }
  if (source === 'ncaa-lookup') {
    return { label: 'School Visit (estimated)', color: 'bg-accent-green/15 text-accent-green' }
  }
  // hs-lookup
  return { label: 'School Visit (estimated)', color: 'bg-accent-orange/15 text-accent-orange' }
}

// Get data source badge for real vs estimated
function getSourceBadge(source: ScheduleSource, confidence: VisitConfidence | undefined, awayTeam: string): {
  label: string
  color: string
} | null {
  if (awayTeam === 'Spring Training') {
    return { label: 'ST Schedule', color: 'bg-pink-500/15 text-pink-400' }
  }
  if (source === 'mlb-api') {
    return { label: 'Confirmed', color: 'bg-accent-green/15 text-accent-green' }
  }
  if (source === 'ncaa-lookup') {
    if (confidence === 'high') {
      return { label: 'D1Baseball', color: 'bg-accent-green/15 text-accent-green' }
    }
    return { label: 'Estimated', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  if (source === 'hs-lookup') {
    return { label: 'Estimated', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  return null
}

// Derive org label for a venue stop
function getOrgLabel(
  source: ScheduleSource,
  homeTeam: string,
  awayTeam: string,
  playerNames: string[],
  playerMap: Map<string, RosterPlayer>,
): string {
  if (awayTeam === 'Spring Training') {
    for (const name of playerNames) {
      const player = playerMap.get(name)
      if (player) return player.org
    }
    return ''
  }
  if (source === 'mlb-api') {
    return homeTeam
  }
  if (source === 'ncaa-lookup') {
    return homeTeam
  }
  if (source === 'hs-lookup') {
    for (const name of playerNames) {
      const player = playerMap.get(name)
      if (player) return `${player.org}, ${player.state}`
    }
    return homeTeam
  }
  return homeTeam
}

// Deduplicate venues: merge nearby games at the same coords into one stop
interface VenueStop {
  venueName: string
  venueKey: string
  players: string[]
  driveFromAnchor: number
  driveFromPrev: number // sequential drive from previous stop
  isAnchor: boolean
  dates: string[]
  confidence?: VisitConfidence
  confidenceNote?: string
  source: ScheduleSource
  isHome: boolean
  homeTeam: string
  awayTeam: string
  sourceUrl?: string
  orgLabel: string
  gameTime?: string
  gameStatus?: string
}

export function buildVenueStops(trip: TripCandidate, playerMap: Map<string, RosterPlayer>): VenueStop[] {
  const venueMap = new Map<string, VenueStop>()

  // Add anchor venue
  const anchorKey = `${trip.anchorGame.venue.coords.lat.toFixed(4)},${trip.anchorGame.venue.coords.lng.toFixed(4)}`
  const anchorOrg = getOrgLabel(
    trip.anchorGame.source, trip.anchorGame.homeTeam, trip.anchorGame.awayTeam,
    trip.anchorGame.playerNames, playerMap,
  )
  venueMap.set(anchorKey, {
    venueName: trip.anchorGame.venue.name,
    venueKey: anchorKey,
    players: [...trip.anchorGame.playerNames],
    driveFromAnchor: 0,
    driveFromPrev: 0,
    isAnchor: true,
    dates: [trip.anchorGame.date],
    confidence: trip.anchorGame.confidence,
    confidenceNote: trip.anchorGame.confidenceNote,
    source: trip.anchorGame.source,
    isHome: trip.anchorGame.isHome,
    homeTeam: trip.anchorGame.homeTeam,
    awayTeam: trip.anchorGame.awayTeam,
    sourceUrl: trip.anchorGame.sourceUrl,
    orgLabel: anchorOrg,
    gameTime: trip.anchorGame.time,
    gameStatus: trip.anchorGame.gameStatus,
  })

  // Merge nearby games by venue
  for (const game of trip.nearbyGames) {
    const key = `${game.venue.coords.lat.toFixed(4)},${game.venue.coords.lng.toFixed(4)}`
    const existing = venueMap.get(key)
    if (existing) {
      for (const name of game.playerNames) {
        if (!existing.players.includes(name)) existing.players.push(name)
      }
      if (!existing.dates.includes(game.date)) existing.dates.push(game.date)
    } else {
      const org = getOrgLabel(game.source, game.homeTeam, game.awayTeam, game.playerNames, playerMap)
      venueMap.set(key, {
        venueName: game.venue.name,
        venueKey: key,
        players: [...game.playerNames],
        driveFromAnchor: game.driveMinutes,
        driveFromPrev: 0, // computed after sorting
        isAnchor: false,
        dates: [game.date],
        confidence: game.confidence,
        confidenceNote: game.confidenceNote,
        source: game.source,
        isHome: game.isHome,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        sourceUrl: game.sourceUrl,
        orgLabel: org,
        gameTime: game.time,
        gameStatus: game.gameStatus,
      })
    }
  }

  const sorted = [...venueMap.values()].sort((a, b) => {
    if (a.isAnchor) return -1
    if (b.isAnchor) return 1
    return a.driveFromAnchor - b.driveFromAnchor
  })

  // Compute sequential drive times between stops using Haversine
  for (let i = 1; i < sorted.length; i++) {
    const prevCoords = parseVenueKey(sorted[i - 1]!.venueKey)
    const currCoords = parseVenueKey(sorted[i]!.venueKey)
    const km = haversineKm(prevCoords, currCoords)
    sorted[i]!.driveFromPrev = Math.round((km * 1.3 / 90) * 60)
  }

  return sorted
}

// Parse "lat,lng" venue key back to coordinates
function parseVenueKey(key: string): { lat: number; lng: number } {
  const [lat, lng] = key.split(',').map(Number)
  return { lat: lat!, lng: lng! }
}

// Generate plain-text itinerary for a trip
export function generateItineraryText(trip: TripCandidate, index: number, stops: VenueStop[], playerMap: Map<string, RosterPlayer>): string {
  const startDate = formatDate(trip.suggestedDays[0]!)
  const endDate = formatDate(trip.suggestedDays[trip.suggestedDays.length - 1]!)
  const dayCount = trip.suggestedDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`

  let text = `Trip #${index} — ${dateLabel} (${dayCount} day${dayCount !== 1 ? 's' : ''})\n`
  text += `Drive from Orlando: ~${formatDriveTime(trip.driveFromHomeMinutes)}\n`

  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i]!
    const label = stop.orgLabel && stop.orgLabel !== stop.venueName
      ? `${stop.orgLabel} — ${stop.venueName}`
      : stop.venueName
    const ctx = getVisitContext(stop.source, stop.isHome, stop.awayTeam)
    const driveNote = i > 0 && stop.driveFromPrev > 0 ? ` (${formatDriveTime(stop.driveFromPrev)} from Stop ${i})` : ''
    text += `\nStop ${i + 1}: ${label} (${ctx.label})${driveNote}\n`
    const playerDescs = stop.players.map((name) => {
      const p = playerMap.get(name)
      return p ? `${name} (T${p.tier})` : name
    })
    text += `  Players: ${playerDescs.join(', ')}\n`
  }

  if (trip.scoreBreakdown) {
    const b = trip.scoreBreakdown
    const parts: string[] = []
    if (b.tier1Count > 0) parts.push(`${b.tier1Count}x T1`)
    if (b.tier2Count > 0) parts.push(`${b.tier2Count}x T2`)
    if (b.tier3Count > 0) parts.push(`${b.tier3Count}x T3`)
    if (b.thursdayBonus) parts.push('Thu bonus')
    text += `\nScore: ${b.finalScore} pts (${parts.join(' + ')})\n`
  }

  // Compute sequential total drive
  const interDrive = stops.reduce((sum, s) => sum + s.driveFromPrev, 0)
  const lastStop = stops[stops.length - 1]
  let returnMin = 0
  if (lastStop) {
    const lastCoords = parseVenueKey(lastStop.venueKey)
    returnMin = Math.round((haversineKm(lastCoords, HOME_BASE) * 1.3 / 90) * 60)
  }
  const totalDriveText = trip.driveFromHomeMinutes + interDrive + returnMin
  text += `Total drive: ~${formatDriveTime(totalDriveText)}\n`

  return text
}

export default function TripCard({ trip, index, playerMap, defaultExpanded = false, onPlayerClick }: Props) {
  const setVisitOverride = useRosterStore((s) => s.setVisitOverride)

  const stops = useMemo(() => buildVenueStops(trip, playerMap), [trip, playerMap])
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [showScoreDetail, setShowScoreDetail] = useState(false)
  const [copied, setCopied] = useState(false)

  const tripKey = getTripKey(trip)
  const tripStatuses = useTripStore((s) => s.tripStatuses)
  const setTripStatus = useTripStore((s) => s.setTripStatus)
  const setSelectedTripIndex = useTripStore((s) => s.setSelectedTripIndex)
  const currentStatus = tripStatuses[tripKey] as TripStatus | undefined

  function cycleStatus(e: React.MouseEvent) {
    e.stopPropagation()
    if (!currentStatus) setTripStatus(tripKey, 'planned')
    else if (currentStatus === 'planned') setTripStatus(tripKey, 'completed')
    else setTripStatus(tripKey, null)
  }

  const allPlayers = new Set<string>()
  for (const stop of stops) {
    for (const name of stop.players) allPlayers.add(name)
  }

  // Compute tier counts for collapsed header
  const tierCounts = { t1: 0, t2: 0, t3: 0 }
  for (const name of allPlayers) {
    const tier = playerMap.get(name)?.tier
    if (tier === 1) tierCounts.t1++
    else if (tier === 2) tierCounts.t2++
    else if (tier === 3) tierCounts.t3++
  }

  const hasUncertainEvents =
    stops.some((s) => s.confidence && s.confidence !== 'high')

  const startDate = formatDate(trip.suggestedDays[0]!)
  const endDate = formatDate(trip.suggestedDays[trip.suggestedDays.length - 1]!)
  const dayCount = trip.suggestedDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`

  const breakdown = trip.scoreBreakdown

  // Compute route distance breakdown using sequential drives
  const routeSegments: Array<{ from: string; to: string; minutes: number }> = []
  routeSegments.push({ from: 'Orlando', to: stops[0]?.orgLabel || stops[0]?.venueName || 'Stop 1', minutes: trip.driveFromHomeMinutes })
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1]!
    const curr = stops[i]!
    if (curr.driveFromPrev > 0) {
      routeSegments.push({
        from: prev.orgLabel || prev.venueName,
        to: curr.orgLabel || curr.venueName,
        minutes: curr.driveFromPrev,
      })
    }
  }
  // Return home from last stop
  const lastStop = stops[stops.length - 1]
  if (lastStop) {
    const lastCoords = parseVenueKey(lastStop.venueKey)
    const returnKm = haversineKm(lastCoords, HOME_BASE)
    const returnMinutes = Math.round((returnKm * 1.3 / 90) * 60)
    if (returnMinutes > 0) {
      routeSegments.push({ from: lastStop.orgLabel || lastStop.venueName, to: 'Orlando', minutes: returnMinutes })
    }
  }
  // Compute actual total drive from sequential segments
  const computedTotalDrive = routeSegments.reduce((sum, s) => sum + s.minutes, 0)

  // Build natural language summary
  const uniquePlayerNames = [...allPlayers]
  const t1Names = uniquePlayerNames.filter((n) => playerMap.get(n)?.tier === 1)
  const t2Names = uniquePlayerNames.filter((n) => playerMap.get(n)?.tier === 2)
  const stopCities = stops.map((s) => s.orgLabel || s.venueName)
  let summary = `${dayCount}-day trip visiting ${uniquePlayerNames.length} player${uniquePlayerNames.length !== 1 ? 's' : ''} across ${stops.length} stop${stops.length !== 1 ? 's' : ''}`
  if (stopCities.length <= 4) {
    summary += ` (${stopCities.join(' → ')})`
  }
  summary += `. ~${formatDriveTime(computedTotalDrive)} total driving.`
  if (t1Names.length > 0) {
    summary += ` Top priority: ${t1Names.join(', ')}.`
  }
  if (t2Names.length > 0) {
    summary += ` Also seeing: ${t2Names.join(', ')}.`
  }

  // Track which players have been marked as visited (persists across collapse/expand)
  const [markedPlayers, setMarkedPlayers] = useState<Set<string>>(new Set())

  const [copyError, setCopyError] = useState(false)
  const [calError, setCalError] = useState(false)

  async function handleCopyItinerary() {
    try {
      const text = generateItineraryText(trip, index, stops, playerMap)
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setCopyError(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyError(true)
      setTimeout(() => setCopyError(false), 3000)
    }
  }

  function handleExportCalendar(e: React.MouseEvent) {
    e.stopPropagation()
    try {
      const ics = generateTripIcs(trip, index, playerMap)
      downloadIcs(ics, `sv-trip-${index}.ics`)
      setCalError(false)
    } catch {
      setCalError(true)
      setTimeout(() => setCalError(false), 3000)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      {/* Header — always visible, clickable to expand/collapse */}
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
              Trip #{index}
            </h3>
            {breakdown && (
              <span
                className="rounded-lg bg-accent-blue/10 px-2 py-0.5 text-xs font-bold text-accent-blue"
                title="Trip value score = tier weight × visits remaining per player. T1=5pts/visit, T2=3pts/visit, T3=1pt/visit, T4=0. Thursday anchor gets +20% bonus."
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
              title={currentStatus ? `Click to change status: ${currentStatus === 'planned' ? 'Planned → Completed' : 'Completed → Clear'}` : 'Click to mark this trip as Planned'}
            >
              {currentStatus === 'planned' ? 'Planned' : currentStatus === 'completed' ? 'Completed' : 'Mark Status'}
            </button>
          </div>
          <p className="mt-0.5 text-sm text-text-dim">
            {dateLabel}
            <span className="ml-2 text-xs text-text-dim/60">
              {dayCount} day{dayCount !== 1 ? 's' : ''}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); handleCopyItinerary() }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors hidden sm:block"
            title="Copy trip itinerary to clipboard"
          >
            {copied ? 'Copied!' : copyError ? 'Failed' : 'Copy'}
          </button>
          <button
            onClick={handleExportCalendar}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors hidden sm:block"
            title="Download .ics calendar file"
          >
            {calError ? 'Failed' : 'Calendar'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setSelectedTripIndex(index - 1) }}
            className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text hover:bg-gray-700 transition-colors hidden sm:block"
            title="Highlight this trip on the Map tab"
          >
            Map
          </button>
          <div className="rounded-lg bg-accent-blue/10 px-2.5 py-1">
            <span className="text-sm font-bold text-accent-blue">{allPlayers.size}</span>
            <span className="ml-1 text-[11px] text-accent-blue/70">
              player{allPlayers.size !== 1 ? 's' : ''}
            </span>
          </div>
          {(tierCounts.t1 > 0 || tierCounts.t2 > 0 || tierCounts.t3 > 0) && (
            <div className="flex items-center gap-1 rounded-lg bg-gray-950/60 px-2 py-1 text-[11px] font-medium">
              {tierCounts.t1 > 0 && <span className="text-accent-red">{tierCounts.t1}×T1</span>}
              {tierCounts.t1 > 0 && (tierCounts.t2 > 0 || tierCounts.t3 > 0) && <span className="text-text-dim/30">·</span>}
              {tierCounts.t2 > 0 && <span className="text-accent-orange">{tierCounts.t2}×T2</span>}
              {tierCounts.t2 > 0 && tierCounts.t3 > 0 && <span className="text-text-dim/30">·</span>}
              {tierCounts.t3 > 0 && <span className="text-yellow-400">{tierCounts.t3}×T3</span>}
            </div>
          )}
          <div className="hidden rounded-lg bg-gray-950/60 px-2.5 py-1 sm:block">
            <span className="text-sm font-bold text-text">{stops.length}</span>
            <span className="ml-1 text-[11px] text-text-dim">
              venue{stops.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="rounded-lg bg-gray-950/60 px-2.5 py-1">
            <span className="text-[11px] text-text-dim">~{formatDriveTime(computedTotalDrive)}</span>
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (<div className="mt-4">

      {/* Natural language summary */}
      <p className="mb-3 text-sm text-text-dim">{summary}</p>

      {/* Score breakdown toggle */}
      {breakdown && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowScoreDetail(!showScoreDetail) }}
          className="mb-2 rounded-lg bg-accent-blue/10 px-2 py-0.5 text-xs font-bold text-accent-blue hover:bg-accent-blue/20 transition-colors"
        >
          {showScoreDetail ? 'Hide Score Detail' : 'Show Score Detail'}
        </button>
      )}

      {/* Score breakdown (expandable) */}
      {showScoreDetail && breakdown && (
        <div className="mb-4 rounded-lg border border-accent-blue/20 bg-accent-blue/5 px-3 py-2 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {breakdown.tier1Count > 0 && (
              <span className="text-text">{breakdown.tier1Count}x Tier 1 <span className="text-text-dim">({breakdown.tier1Points}pts)</span></span>
            )}
            {breakdown.tier2Count > 0 && (
              <span className="text-text">{breakdown.tier2Count}x Tier 2 <span className="text-text-dim">({breakdown.tier2Points}pts)</span></span>
            )}
            {breakdown.tier3Count > 0 && (
              <span className="text-text">{breakdown.tier3Count}x Tier 3 <span className="text-text-dim">({breakdown.tier3Points}pts)</span></span>
            )}
            {breakdown.thursdayBonus && (
              <span className="text-accent-blue">Thu bonus +20%</span>
            )}
          </div>
          <p className="mt-1 text-text-dim">
            Total: {breakdown.finalScore} pts — higher score = more high-priority players on this trip
          </p>
        </div>
      )}

      {/* Route distance breakdown */}
      <div className="mb-4 rounded-lg bg-gray-950/40 px-3 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-1">
          {routeSegments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i === 0 && <span className="inline-block h-2 w-2 rounded-full bg-accent-blue" />}
              {i > 0 && <span className="text-text-dim/40">&rarr;</span>}
              <span className="text-text-dim">{seg.to}</span>
              <span className="text-text-dim/60">({formatDriveTime(seg.minutes)})</span>
            </span>
          ))}
        </div>
        <p className="mt-1 text-text-dim/60" title="Estimates use straight-line distance with a 30% detour factor at ~55 mph average. Actual times will vary with traffic and route.">
          Total drive: ~{formatDriveTime(computedTotalDrive)} <span className="text-text-dim/40">(estimates only)</span>
        </p>
      </div>

      {/* Venue stops */}
      <div className="space-y-2">
        {stops.map((stop, i) => {
          const ctx = getVisitContext(stop.source, stop.isHome, stop.awayTeam)
          const srcBadge = getSourceBadge(stop.source, stop.confidence, stop.awayTeam)

          return (
            <div key={stop.venueKey}>
              {/* Drive connector between stops */}
              {i > 0 && stop.driveFromPrev > 0 && (
                <div className="my-1 flex items-center gap-2 pl-6">
                  <div className="h-px flex-1 border-t border-dashed border-border/40" />
                  <span className="text-[10px] text-text-dim/60">
                    ~{formatDriveTime(stop.driveFromPrev)} from stop {i}
                  </span>
                  <div className="h-px flex-1 border-t border-dashed border-border/40" />
                </div>
              )}

              <div className={`flex items-start gap-3 rounded-lg px-3 py-2.5 ${
                stop.isAnchor
                  ? 'border border-accent-blue/20 bg-accent-blue/5'
                  : 'border border-border/30 bg-gray-950/30'
              }`}>
                {/* Stop number */}
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                  stop.isAnchor
                    ? 'bg-accent-blue text-white'
                    : 'bg-surface text-text-dim'
                }`}>
                  {i + 1}
                </div>

                <div className="min-w-0 flex-1">
                  {/* Org label + venue name + context badges */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stop.orgLabel && stop.orgLabel !== stop.venueName ? (
                      <>
                        <span className="text-sm font-medium text-text">{stop.orgLabel}</span>
                        <span className="text-xs text-text-dim">— {stop.venueName}</span>
                      </>
                    ) : (
                      <span className="text-sm font-medium text-text">{stop.venueName}</span>
                    )}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ctx.color}`}>
                      {ctx.label}
                    </span>
                    {srcBadge && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${srcBadge.color}`}>
                        {srcBadge.label}
                      </span>
                    )}
                    {stop.gameStatus && (stop.gameStatus === 'Postponed' || stop.gameStatus === 'Suspended') && (
                      <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-red">
                        {stop.gameStatus}
                      </span>
                    )}
                    {stop.gameStatus && (stop.gameStatus === 'Cancelled' || stop.gameStatus === 'Canceled') && (
                      <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-red line-through">
                        Canceled
                      </span>
                    )}
                    {stop.isAnchor && (
                      <span className="rounded bg-accent-blue/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-blue" title="The main stop this trip is built around">
                        Main Stop
                      </span>
                    )}
                    {stop.sourceUrl && (
                      <a
                        href={stop.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-dim hover:text-accent-blue transition-colors"
                        title="Verify this game on the source schedule"
                      >
                        {`Verify \u2197`}
                      </a>
                    )}
                  </div>

                  {/* Game time */}
                  {formatGameTime(stop.gameTime, stop.source) && (
                    <p className="mt-0.5 text-[11px] text-text-dim/70">
                      {formatGameTime(stop.gameTime, stop.source)}
                    </p>
                  )}

                  {/* Confidence badge */}
                  {stop.confidence && stop.confidence !== 'high' && (
                    <ConfidenceBadge confidence={stop.confidence} note={stop.confidenceNote} />
                  )}

                  {/* Players with tier badges */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {stop.players.map((name) => {
                      const player = playerMap.get(name)
                      const tier = player?.tier ?? 4
                      const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                      return (
                        <span
                          key={name}
                          className={`inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-medium text-text ${onPlayerClick ? 'cursor-pointer hover:bg-accent-blue/10' : ''}`}
                          onClick={onPlayerClick ? (e) => { e.stopPropagation(); onPlayerClick(name) } : undefined}
                        >
                          <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} title={`Tier ${tier}`} />
                          {name}
                          <span className="text-text-dim/60">T{tier}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Mobile action buttons (hidden on desktop where they appear in header) */}
      <div className="mt-3 flex gap-2 sm:hidden">
        <button
          onClick={(e) => { e.stopPropagation(); handleCopyItinerary() }}
          className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text"
        >
          {copied ? 'Copied!' : copyError ? 'Failed' : 'Copy'}
        </button>
        <button
          onClick={handleExportCalendar}
          className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text"
        >
          {calError ? 'Failed' : 'Calendar'}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setSelectedTripIndex(index - 1) }}
          className="rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-text-dim hover:text-text"
        >
          Map
        </button>
      </div>

      {/* Mark Visited — quick-log visits from the trip card */}
      <div className="mt-4 border-t border-border/30 pt-3">
        <p className="mb-2 text-[11px] font-medium text-text-dim">Mark Visited</p>
        <div className="flex flex-wrap gap-1.5">
          {[...allPlayers].map((name) => {
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

      {/* Player list */}
      <div className="mt-3 border-t border-border/30 pt-3">
        <p className="text-xs text-text-dim">
          <span className="font-medium text-text">{allPlayers.size} players:</span>{' '}
          {[...allPlayers].map((name) => {
            const p = playerMap.get(name)
            return p ? `${name} (T${p.tier})` : name
          }).join(', ')}
        </p>
      </div>

      {/* Confidence warning */}
      {hasUncertainEvents && (
        <div className="mt-2 rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-1.5">
          <p className="text-[11px] text-accent-orange">
            Some stops on this trip are based on estimated schedules (college or high school). Double-check that the player will actually be at the venue before making the drive.
          </p>
        </div>
      )}
      </div>)}
    </div>
  )
}

function MarkVisitedChip({ name, tier, dotColor, marked, onMark }: {
  name: string
  tier: number
  dotColor: string
  marked: boolean
  onMark: () => void
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        if (marked) return
        onMark()
      }}
      disabled={marked}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
        marked
          ? 'bg-accent-green/15 text-accent-green'
          : 'bg-surface text-text hover:bg-accent-green/10'
      }`}
      title={marked ? `Logged visit for ${name}` : `Log an in-person visit for ${name} today`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${marked ? 'bg-accent-green' : dotColor}`} />
      {name}
      <span className="text-text-dim/60">T{tier}</span>
      {marked ? (
        <span className="ml-0.5 text-accent-green">&#10003;</span>
      ) : (
        <span className="ml-0.5 text-text-dim/40">+1</span>
      )}
    </button>
  )
}

function ConfidenceBadge({ confidence, note }: { confidence: VisitConfidence; note?: string }) {
  const colors = confidence === 'medium'
    ? 'bg-accent-orange/10 text-accent-orange'
    : 'bg-accent-red/10 text-accent-red'
  const label = confidence === 'medium' ? 'Likely there' : 'Not confirmed'

  return (
    <span className={`mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${colors}`} title={note || (confidence === 'medium' ? 'Player is likely at this location based on schedule patterns, but not 100% confirmed' : 'This is an estimated schedule — confirm the player will be there before traveling')}>
      {label}
      {note && <span className="opacity-70">— {note}</span>}
    </span>
  )
}
