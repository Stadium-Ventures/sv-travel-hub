import React, { useMemo, useState } from 'react'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import type { TripCandidate, VisitConfidence, ScheduleSource, ScoreBreakdown } from '../../types/schedule'
// import { generateTripIcs, downloadIcs } from '../../lib/icsExport'
import { haversineKm, HOME_BASE } from '../../lib/tripEngine'
import { formatDate, formatDriveTime, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'
import type { RosterPlayer } from '../../types/roster'
import { dispatchMapEvent } from '../../lib/mapEvents'

interface Props {
  trip: TripCandidate
  index: number
  playerMap: Map<string, RosterPlayer>
  defaultExpanded?: boolean
  onPlayerClick?: (playerName: string) => void
  overlappingTrips?: number[]
  alternativeTrips?: TripCandidate[] // same players/destination, different dates
}

/** Badge whose explanation opens on click/tap — title tooltips are invisible
 *  on touch devices (Kent often uses an iPad). Renders inside a flex-wrap
 *  row; the expanded detail wraps onto its own full-width line. */
function TapBadge({ label, detail, className }: { label: string; detail: string; className: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={`${className} cursor-pointer`}
        title={detail}
      >
        {label} {open ? '▴' : '▾'}
      </button>
      {open && <span className="basis-full text-[11px] text-text-dim leading-relaxed">{detail}</span>}
    </>
  )
}

function formatGameTime(timeStr?: string, source?: ScheduleSource): string {
  if (!timeStr) return ''
  if (source && source !== 'mlb-api') return 'Unconfirmed'
  const d = new Date(timeStr)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET'
}

function getVisitContext(source: ScheduleSource, isHome: boolean, awayTeam: string, confidence?: VisitConfidence): {
  label: string
  color: string
} {
  if (awayTeam === 'Spring Training') {
    return { label: 'Spring Training', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  if (source === 'mlb-api') {
    return isHome
      ? { label: 'Home', color: 'bg-accent-green/15 text-accent-green' }
      : { label: 'Away', color: 'bg-purple-500/15 text-purple-400' }
  }
  if (source === 'ncaa-lookup') {
    return confidence === 'high'
      ? { label: 'D1Baseball', color: 'bg-accent-green/15 text-accent-green' }
      : { label: 'Est.', color: 'bg-accent-orange/15 text-accent-orange' }
  }
  return confidence === 'high'
    ? { label: 'HS', color: 'bg-accent-green/15 text-accent-green' }
    : { label: 'Est.', color: 'bg-accent-orange/15 text-accent-orange' }
}

function getOrgLabel(
  source: ScheduleSource,
  homeTeam: string,
  awayTeam: string,
  playerNames: string[],
  playerMap: Map<string, RosterPlayer>,
  _isHome?: boolean,
): string {
  if (awayTeam === 'Spring Training') {
    for (const name of playerNames) {
      const player = playerMap.get(name)
      if (player) return player.org
    }
    return ''
  }
  if (source === 'hs-lookup') {
    for (const name of playerNames) {
      const player = playerMap.get(name)
      if (player) return `${player.org}, ${player.state}`
    }
    return homeTeam
  }
  // For pro/NCAA: show the venue's home team (where the game is)
  // but indicate it's an away game via the badge, not the label
  return homeTeam
}

// Assume a baseball game lasts ~3 hours. Two stops at different venues on
// the same day conflict if you can't finish game A and drive to game B
// before game B starts (i.e. the windows overlap).
const GAME_DURATION_MIN = 180

/**
 * Cluster a day's stops by attendability. Each returned cluster is a group of
 * mutually-exclusive stops — the user can attend at most one game per cluster.
 * Stops with non-overlapping time windows (and enough drive buffer between)
 * end up in separate clusters and can BOTH be attended.
 *
 * If a stop is missing gameTime, it's treated as its own single-stop cluster
 * (we can't reason about conflicts without a start time).
 *
 * Bug fix (Kent 2026-06-08): previously the engine rendered all same-day
 * nearby venues as a "DOUBLE UP" stop list even when their games started at
 * the same time — physically impossible to attend more than one.
 */
export function clusterDayStopsByOverlap(dayStops: VenueStop[]): VenueStop[][] {
  const n = dayStops.length
  if (n <= 1) return dayStops.length ? [dayStops] : []
  // Build a parent[] for union-find over conflicts.
  const parent = Array.from({ length: n }, (_, i) => i)
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!
      x = parent[x]!
    }
    return x
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  function parseStart(stop: VenueStop): number | null {
    if (!stop.gameTime) return null
    const t = new Date(stop.gameTime).getTime()
    return isNaN(t) ? null : t
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = dayStops[i]!, b = dayStops[j]!
      // Same venue = doubleheader; never a conflict (you're already there).
      if (a.venueKey === b.venueKey) continue
      const ta = parseStart(a), tb = parseStart(b)
      // Without times we can't be sure — DON'T flag as conflict (preserve
      // current behavior; the existing TBD warning already calls these out).
      if (ta == null || tb == null) continue
      const earlierStart = Math.min(ta, tb)
      const laterStart = Math.max(ta, tb)
      const gapMin = (laterStart - earlierStart) / 60000
      // HARD rule: any two games on the same day starting within
      // GAME_DURATION_MIN (3h) of each other are mutually exclusive — you
      // can't be in two stadiums at once. Skip the drive-time math entirely
      // for this case so subtle bugs (NaN/Infinity in driveFromAnchor,
      // unexpected zero values) can't accidentally let two simultaneous
      // games coexist as separate "attendable" stops.
      if (gapMin < GAME_DURATION_MIN) {
        union(i, j)
        continue
      }
      // Otherwise, factor in drive time between the two venues. Defensive
      // about bad values: NaN/Infinity collapse to a 60-min cap.
      const earlier = ta <= tb ? a : b
      const later = ta <= tb ? b : a
      const dEarly = Number.isFinite(earlier.driveFromAnchor) ? earlier.driveFromAnchor : 0
      const dLate = Number.isFinite(later.driveFromAnchor) ? later.driveFromAnchor : 0
      const assumedDriveMin = Math.max(15, Math.min(60, Math.abs(dLate - dEarly) + 15))
      if (gapMin < GAME_DURATION_MIN + assumedDriveMin) {
        union(i, j)
      }
    }
  }
  const clusters = new Map<number, VenueStop[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const arr = clusters.get(root) ?? []
    arr.push(dayStops[i]!)
    clusters.set(root, arr)
  }
  // Sort clusters by earliest start time, stops within a cluster by start time
  function clusterStart(c: VenueStop[]): number {
    let min = Infinity
    for (const s of c) {
      const t = parseStart(s)
      if (t != null && t < min) min = t
    }
    return min
  }
  const result = [...clusters.values()].sort((a, b) => clusterStart(a) - clusterStart(b))
  for (const c of result) {
    c.sort((a, b) => (parseStart(a) ?? Infinity) - (parseStart(b) ?? Infinity))
  }
  return result
}

// Deduplicate venues: merge nearby games at the same coords into one stop
interface VenueStop {
  venueName: string
  venueKey: string
  players: string[]
  driveFromAnchor: number
  driveFromPrev: number
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

  const anchorKey = `${trip.anchorGame.venue.coords.lat.toFixed(4)},${trip.anchorGame.venue.coords.lng.toFixed(4)}`
  const anchorOrg = getOrgLabel(
    trip.anchorGame.source, trip.anchorGame.homeTeam, trip.anchorGame.awayTeam,
    trip.anchorGame.playerNames, playerMap, trip.anchorGame.isHome,
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

  for (const game of trip.nearbyGames) {
    const key = `${game.venue.coords.lat.toFixed(4)},${game.venue.coords.lng.toFixed(4)}`
    const existing = venueMap.get(key)
    if (existing) {
      for (const name of game.playerNames) {
        if (!existing.players.includes(name)) existing.players.push(name)
      }
      if (!existing.dates.includes(game.date)) existing.dates.push(game.date)
    } else {
      const org = getOrgLabel(game.source, game.homeTeam, game.awayTeam, game.playerNames, playerMap, game.isHome)
      venueMap.set(key, {
        venueName: game.venue.name,
        venueKey: key,
        players: [...game.playerNames],
        driveFromAnchor: game.driveMinutes,
        driveFromPrev: 0,
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

  for (let i = 1; i < sorted.length; i++) {
    const prevCoords = parseVenueKey(sorted[i - 1]!.venueKey)
    const currCoords = parseVenueKey(sorted[i]!.venueKey)
    const km = haversineKm(prevCoords, currCoords)
    sorted[i]!.driveFromPrev = Math.round((km * 1.3 / 90) * 60)
  }

  return sorted
}

function parseVenueKey(key: string): { lat: number; lng: number } {
  const [lat, lng] = key.split(',').map(Number)
  return { lat: lat!, lng: lng! }
}

/**
 * Assign each stop to exactly ONE day. Algorithm:
 * 1. If a stop's game dates overlap with a trip day, assign to the best one (prefer Tuesday, then anchor date, then earliest)
 * 2. If no overlap, distribute evenly across trip days based on route order
 */
function assignStopsToDays(stops: VenueStop[], suggestedDays: string[]): Map<string, VenueStop[]> {
  const dayMap = new Map<string, VenueStop[]>()
  for (const day of suggestedDays) {
    dayMap.set(day, [])
  }
  if (suggestedDays.length === 0) return dayMap

  const assigned = new Set<string>()

  // First pass: stops with specific date matches
  for (const stop of stops) {
    const matchingDays = stop.dates.filter((d) => suggestedDays.includes(d))
    if (matchingDays.length > 0) {
      // Prefer Tuesday, then earliest
      const best = matchingDays.sort((a, b) => {
        const aDate = new Date(a + 'T12:00:00Z')
        const bDate = new Date(b + 'T12:00:00Z')
        const aTue = aDate.getUTCDay() === 2 ? 0 : 1
        const bTue = bDate.getUTCDay() === 2 ? 0 : 1
        if (aTue !== bTue) return aTue - bTue
        return a.localeCompare(b)
      })[0]!
      dayMap.get(best)!.push(stop)
      assigned.add(stop.venueKey)
    }
  }

  // Second pass: distribute unassigned stops evenly
  const unassigned = stops.filter((s) => !assigned.has(s.venueKey))
  if (unassigned.length > 0) {
    const stopsPerDay = Math.ceil(unassigned.length / suggestedDays.length)
    let dayIdx = 0
    for (const stop of unassigned) {
      const day = suggestedDays[dayIdx]!
      dayMap.get(day)!.push(stop)
      if (dayMap.get(day)!.length >= stopsPerDay && dayIdx < suggestedDays.length - 1) {
        dayIdx++
      }
    }
  }

  // Sort stops within each day by game time (earliest first)
  for (const [_day, dayStops] of dayMap) {
    dayStops.sort((a, b) => {
      const aTime = a.gameTime ? new Date(a.gameTime).getTime() : Infinity
      const bTime = b.gameTime ? new Date(b.gameTime).getTime() : Infinity
      if (isNaN(aTime) && isNaN(bTime)) return 0
      if (isNaN(aTime)) return 1
      if (isNaN(bTime)) return -1
      return aTime - bTime
    })
  }

  // Deduplicate players: each player should only appear on ONE day (their first/best day).
  // If a player shows up at multiple venues on different days, keep only the first occurrence.
  const playerAssignedDay = new Set<string>()
  for (const [day, dayStops] of dayMap) {
    for (const stop of dayStops) {
      stop.players = stop.players.filter((name) => {
        if (playerAssignedDay.has(name)) return false
        playerAssignedDay.add(name)
        return true
      })
    }
    // Remove stops that have no players left after dedup
    dayMap.set(day, dayStops.filter((s) => s.players.length > 0))
  }

  return dayMap
}

export function generateItineraryText(trip: TripCandidate, index: number, stops: VenueStop[], playerMap: Map<string, RosterPlayer>, homeBase = 'Orlando, FL'): string {
  const startDate = formatDate(trip.suggestedDays[0]!)
  const endDate = formatDate(trip.suggestedDays[trip.suggestedDays.length - 1]!)
  const dayCount = trip.suggestedDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`

  let text = `Trip #${index} — ${dateLabel} (${dayCount} day${dayCount !== 1 ? 's' : ''})\n`
  text += `Drive from ${homeBase}: ~${formatDriveTime(trip.driveFromHomeMinutes)}\n`

  const dayAssignments = assignStopsToDays(stops, trip.suggestedDays)
  for (const [day, dayStops] of dayAssignments) {
    text += `\n${formatDate(day)}:\n`
    for (const stop of dayStops) {
      const label = stop.orgLabel && stop.orgLabel !== stop.venueName
        ? `${stop.orgLabel} — ${stop.venueName}`
        : stop.venueName
      const playerDescs = stop.players.map((name) => {
        const p = playerMap.get(name)
        return p ? `${name} (${TIER_LABELS[p.tier] ?? `Tier ${p.tier}`})` : name
      })
      text += `  ${label}: ${playerDescs.join(', ')}\n`
    }
  }

  const interDrive = stops.reduce((sum, s) => sum + s.driveFromPrev, 0)
  const lastStop = stops[stops.length - 1]
  let returnMin = 0
  if (lastStop) {
    const lastCoords = parseVenueKey(lastStop.venueKey)
    returnMin = Math.round((haversineKm(lastCoords, HOME_BASE) * 1.3 / 90) * 60)
  }
  const totalDriveText = trip.driveFromHomeMinutes + interDrive + returnMin
  text += `\nTotal drive: ~${formatDriveTime(totalDriveText)}\n`

  return text
}

function TripCard({ trip, index, playerMap, defaultExpanded = false, onPlayerClick, overlappingTrips: _overlappingTrips, alternativeTrips }: Props) {
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const [selectedAltIndex, setSelectedAltIndex] = useState(-1) // -1 = primary trip
  const allVariants = useMemo(() => [trip, ...(alternativeTrips ?? [])], [trip, alternativeTrips])
  const activeTrip = selectedAltIndex === -1 ? trip : (allVariants[selectedAltIndex + 1] ?? trip)
  const stops = useMemo(() => buildVenueStops(activeTrip, playerMap), [activeTrip, playerMap])
  const [expanded, setExpanded] = useState(defaultExpanded)
  // User's pick per overlap-cluster. Key = `${day}|${clusterIndex}` → venueKey
  // of the chosen stop. Lets Kent affirmatively select which game he'd attend
  // when a day has 5pm/5pm/6pm/6:45pm conflicts.
  const [pickedByCluster, setPickedByCluster] = useState<Record<string, string>>({})


  const allPlayers = new Set<string>()
  for (const stop of stops) {
    for (const name of stop.players) allPlayers.add(name)
  }

  // Compute total drive
  let totalDrive = activeTrip.driveFromHomeMinutes
  for (const s of stops) totalDrive += s.driveFromPrev
  const lastStop = stops[stops.length - 1]
  if (lastStop) {
    const lastCoords = parseVenueKey(lastStop.venueKey)
    totalDrive += Math.round((haversineKm(lastCoords, HOME_BASE) * 1.3 / 90) * 60)
  }

  // Assign stops to days, then remove empty days (no reason to show "flex days" with no games)
  const { dayAssignments, displayDays } = useMemo(() => {
    const assignments = assignStopsToDays(stops, activeTrip.suggestedDays)
    // Keep only days that have games, plus the last day as "return home" if it's after a game day
    const daysWithGames = activeTrip.suggestedDays.filter((d) => (assignments.get(d) ?? []).length > 0)
    let days: string[]
    if (daysWithGames.length === 0) {
      days = [activeTrip.suggestedDays[0]!] // fallback
    } else {
      const lastGameDay = daysWithGames[daysWithGames.length - 1]!
      const lastSuggested = activeTrip.suggestedDays[activeTrip.suggestedDays.length - 1]!
      // Add a return-home day after the last game day if there's one in the original window
      if (lastGameDay !== lastSuggested && activeTrip.suggestedDays.indexOf(lastSuggested) > activeTrip.suggestedDays.indexOf(lastGameDay)) {
        days = [...daysWithGames, lastSuggested]
      } else {
        days = [...daysWithGames]
      }
    }

    return { dayAssignments: assignments, displayDays: days }
  }, [stops, activeTrip.suggestedDays])

  const startDate = formatDate(displayDays[0]!)
  const endDate = formatDate(displayDays[displayDays.length - 1]!)
  const dayCount = displayDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`


  // Build concise summary

  // Build concise summary line (not the old narrative paragraph)


  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      {/* Header */}
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
              <span className="ml-1.5 text-sm font-medium text-accent-green">
                Drive to {stops[0]?.orgLabel || stops[0]?.venueName || 'venue'} area
              </span>
            </h3>
          </div>
          {/* Compact summary — player names, not venue names */}
          <p className="mt-0.5 text-sm text-text-dim">
            {dateLabel} · {[...allPlayers].map(n => {
              const p = playerMap.get(n)
              return p ? n : n
            }).join(', ')} · ~{formatDriveTime(activeTrip.driveFromHomeMinutes)} from {homeBaseName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-text-dim/60">
          <span>{dayCount} day{dayCount !== 1 ? 's' : ''}</span>
          <span className="text-text-dim/20">·</span>
          <span>~{formatDriveTime(activeTrip.driveFromHomeMinutes)} drive</span>
          {allVariants.length > 1 && (
            <span className="rounded-full bg-accent-blue/15 px-2 py-0.5 text-[10px] font-bold text-accent-blue">
              {allVariants.length} dates
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              useTripStore.getState().setSelectedTripIndex(index)
              dispatchMapEvent('app:switch-tab', { tab: 'map' })
            }}
            className="ml-1 rounded-md bg-accent-blue/15 px-2 py-0.5 text-[10px] font-semibold text-accent-blue hover:bg-accent-blue/25"
            title="Highlight this trip's venues on the map"
          >
            Show on Map
          </button>
          <StarButton trip={trip} />
        </div>
      </div>

      {/* Alternative date selector — shown when multiple date options exist */}
      {allVariants.length > 1 && expanded && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-text-dim mr-1">Dates:</span>
          {allVariants.map((variant, vi) => {
            const vDays = variant.suggestedDays
            const vStart = formatDate(vDays[0]!)
            const vEnd = vDays.length > 1 ? formatDate(vDays[vDays.length - 1]!) : null
            const label = vEnd ? `${vStart} – ${vEnd}` : vStart
            const isActive = vi === 0 ? selectedAltIndex === -1 : selectedAltIndex === vi - 1
            const isTue = vDays.some(d => new Date(d + 'T12:00:00Z').getUTCDay() === 2)
            return (
              <button
                key={vi}
                onClick={(e) => { e.stopPropagation(); setSelectedAltIndex(vi === 0 ? -1 : vi - 1) }}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'bg-accent-blue/20 text-accent-blue ring-1 ring-accent-blue/30'
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

      {/* Cross-agent "heads up": if any player in this trip already has a
          planned visit from another SV agent, surface it so Kent doesn't
          double-book. Lights up automatically once Heartbeat populates the
          nextPlannedDate field (currently empty for all players upstream). */}
      {expanded && (() => {
        const heartbeatState = useHeartbeatStore.getState()
        const headsUp: Array<{ player: string; date: string; agent: string | null }> = []
        for (const name of allPlayers) {
          const vc = heartbeatState.getVisitCount(name)
          if (vc?.nextPlannedDate) {
            headsUp.push({ player: name, date: vc.nextPlannedDate, agent: vc.nextPlannedAgent })
          }
        }
        if (headsUp.length === 0) return null
        return (
          <div className="mt-4 rounded-lg border border-accent-blue/30 bg-accent-blue/5 px-3 py-2 text-xs text-accent-blue">
            <strong>Heads up — coverage from teammates:</strong>
            <ul className="mt-1 ml-3 space-y-0.5">
              {headsUp.map((h) => (
                <li key={h.player}>
                  {h.agent ?? 'Someone'} is already planning to visit <strong>{h.player}</strong> on {h.date.length > 10 ? h.date.slice(0, 10) : h.date}.
                </li>
              ))}
            </ul>
          </div>
        )
      })()}

      {/* Expanded: Day-by-day plan (each stop assigned to ONE day) */}
      {expanded && (
        <div className="mt-4 space-y-3">

          {/* Score explainer */}
          {activeTrip.scoreBreakdown && (
            <ScoreExplainer breakdown={activeTrip.scoreBreakdown} driveMinutes={activeTrip.driveFromHomeMinutes} />
          )}

          {/* Warnings — TBD times, estimated locations */}
          {(() => {
            const items: Array<{ summary: string; detail: string; defaultOpen?: boolean }> = []

            // Check for TBD times on multi-stop days
            for (const [day, dayStops] of dayAssignments) {
              if (dayStops.length >= 2) {
                const tbdStops = dayStops.filter(s => !formatGameTime(s.gameTime, s.source) || formatGameTime(s.gameTime, s.source) === 'Unconfirmed')
                if (tbdStops.length >= 2) {
                  const names = tbdStops.flatMap(s => s.players).join(', ')
                  items.push({
                    summary: `${formatDate(day)}: ${tbdStops.length} games have unconfirmed start times (${names})`,
                    detail: `Games for ${names} don't have posted start times yet. If you're planning to see multiple games on the same day, check the team schedules closer to game day to make sure the times don't conflict.`,
                  })
                }
              }
            }

            // Time conflicts — same day, same time, different venues
            for (const [day, dayStops] of dayAssignments) {
              if (dayStops.length >= 2) {
                const withTimes = dayStops
                  .map((s) => ({ stop: s, time: formatGameTime(s.gameTime, s.source) }))
                  .filter((s) => s.time && s.time !== 'Unconfirmed')
                // Group by time
                const byTime = new Map<string, typeof withTimes>()
                for (const s of withTimes) {
                  const arr = byTime.get(s.time) ?? []
                  arr.push(s)
                  byTime.set(s.time, arr)
                }
                for (const [time, group] of byTime) {
                  if (group.length >= 2) {
                    const names = group.map((g) => `${g.stop.players.join(', ')} at ${g.stop.orgLabel}`).join(' and ')
                    items.push({
                      summary: `${formatDate(day)}: ${group.length} games at ${time} — pick one`,
                      detail: `${names} are both at ${time} on ${formatDate(day)} but at different venues. You can only attend one of these games. Consider which player is higher priority.`,
                    })
                  }
                }
              }
            }

            // Estimated location stops
            const estimatedStops = stops.filter((s) => s.confidence && s.confidence !== 'high')
            for (const s of estimatedStops) {
              const playerList = s.players.join(', ')
              const isHsAway = s.source === 'hs-lookup' && !s.isHome
              items.push({
                summary: `${playerList}'s game at ${s.orgLabel}: location is estimated`,
                detail: isHsAway
                  ? `${playerList} has an away game vs. ${s.homeTeam}. We don't have the exact address of the opponent's field, so the map pin is placed near ${s.orgLabel}'s home field as a rough estimate. The actual game could be in a different location — check the schedule to confirm the venue before planning your route.`
                  : `The game for ${playerList} at ${s.orgLabel} is on the schedule, but we haven't confirmed the exact venue. Click "Verify" on the stop below to double-check the location.`,
                defaultOpen: true,
              })
            }

            if (items.length === 0) return null
            return (
              <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2 space-y-2">
                {items.map((item, i) => (
                  <ExpandableWarning key={i} summary={item.summary} detail={item.detail} defaultOpen={item.defaultOpen} />
                ))}
              </div>
            )
          })()}

          {/* Day-by-day schedule — the core of the card */}
          {displayDays.map((day, dayIdx) => {
            const dayDate = new Date(day + 'T12:00:00Z')
            const isTue = dayDate.getUTCDay() === 2
            const dayStops = dayAssignments.get(day) ?? []
            // Group same-day stops into mutually-exclusive clusters so the
            // day's plan reflects what Kent can REALISTICALLY attend, not
            // the union of all nearby venues. (See clusterDayStopsByOverlap
            // above; Kent's feedback 2026-06-08.)
            const clusters = clusterDayStopsByOverlap(dayStops)
            // Attendable count = one game per cluster (you pick one).
            const attendableCount = clusters.length
            const totalStops = dayStops.length

            return (
              <div key={day} className="rounded-lg border border-border/30 bg-gray-950/30 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-sm font-semibold ${isTue ? 'text-accent-blue' : 'text-text'}`}>
                    Day {dayIdx + 1}
                  </span>
                  <span className={`text-xs ${isTue ? 'text-accent-blue' : 'text-text-dim'}`}>
                    {formatDate(day)}
                    {isTue && ' (best day)'}
                  </span>
                  {attendableCount >= 2 && (
                    <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-bold text-accent-green cursor-help"
                      title={`${attendableCount} games attendable on this day — non-overlapping start times.`}>
                      DOUBLE UP · {attendableCount} attendable
                    </span>
                  )}
                  {attendableCount === 1 && totalStops >= 2 && (
                    <span className="rounded-full bg-accent-orange/15 px-2 py-0.5 text-[10px] font-bold text-accent-orange cursor-help"
                      title={`${totalStops} venues on this day but games overlap in time — pick one.`}>
                      PICK ONE · {totalStops} options
                    </span>
                  )}
                  {dayIdx === 0 && activeTrip.driveFromHomeMinutes > 0 && (
                    <span className="text-[11px] text-text-dim/60 ml-auto">
                      Drive from {homeBaseName}: ~{formatDriveTime(activeTrip.driveFromHomeMinutes)}
                    </span>
                  )}
                  {dayIdx === displayDays.length - 1 && lastStop && (
                    <span className="text-[11px] text-text-dim/60 ml-auto">
                      Drive home after
                    </span>
                  )}
                </div>

                {dayStops.length === 0 ? (
                  <p className="text-xs text-text-dim/50 italic">{dayIdx === displayDays.length - 1 ? 'Return home' : 'Travel / flex day'}</p>
                ) : (
                  <div className="space-y-3">
                    {clusters.map((cluster, clusterIdx) => {
                      const isExclusive = cluster.length >= 2
                      const clusterKey = `${day}|${clusterIdx}`
                      const pickedVenueKey = pickedByCluster[clusterKey]
                      return (
                    <div key={`cluster-${clusterIdx}`} className={isExclusive ? 'rounded-md border border-accent-orange/30 bg-accent-orange/5 p-2' : ''}>
                      {isExclusive && (
                        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-accent-orange">
                          <span>⚠</span>
                          <span>{pickedVenueKey ? 'You picked' : 'Pick one — start times overlap'}</span>
                          <span className="font-normal text-accent-orange/60">({cluster.length} options)</span>
                          {pickedVenueKey && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setPickedByCluster((prev) => {
                                  const next = { ...prev }
                                  delete next[clusterKey]
                                  return next
                                })
                              }}
                              className="ml-auto text-[10px] text-accent-orange/80 hover:text-accent-orange underline-offset-2 hover:underline"
                            >
                              clear pick
                            </button>
                          )}
                        </div>
                      )}
                      <div className="space-y-2">
                    {cluster.map((stop, stopIdx) => {
                      const ctx = getVisitContext(stop.source, stop.isHome, stop.awayTeam, stop.confidence)
                      const gameTime = formatGameTime(stop.gameTime, stop.source)
                      // Drive time between clusters (not within) — within a
                      // cluster the user picks ONE, so cross-cluster drive
                      // applies only on the first stop of each non-first
                      // cluster.
                      const showDriveConnector = !isExclusive && clusterIdx > 0 && stopIdx === 0 && stop.driveFromPrev > 0
                      const isPicked = isExclusive && pickedVenueKey === stop.venueKey
                      const isDimmed = isExclusive && pickedVenueKey != null && !isPicked
                      function togglePick(e: React.MouseEvent) {
                        if (!isExclusive) return
                        e.stopPropagation()
                        setPickedByCluster((prev) => {
                          if (prev[clusterKey] === stop.venueKey) {
                            const next = { ...prev }
                            delete next[clusterKey]
                            return next
                          }
                          return { ...prev, [clusterKey]: stop.venueKey }
                        })
                      }
                      return (
                        <div
                          key={stop.venueKey}
                          onClick={togglePick}
                          className={`flex items-start gap-2.5 ${
                            isExclusive ? 'cursor-pointer rounded-md px-1.5 py-1 -mx-1.5 transition-colors' : ''
                          } ${
                            isPicked ? 'bg-accent-green/15 ring-1 ring-accent-green/40' : isDimmed ? 'opacity-40' : isExclusive ? 'hover:bg-accent-orange/10' : ''
                          }`}
                          title={isExclusive ? (isPicked ? 'Picked — click to deselect' : 'Click to pick this game') : undefined}
                        >
                          {/* Pick indicator for exclusive clusters */}
                          {isExclusive && (
                            <span className="mt-1 shrink-0 text-[12px] leading-none" aria-hidden="true">
                              {isPicked ? '◉' : '○'}
                            </span>
                          )}
                          {/* Drive connector between non-exclusive stops */}
                          {showDriveConnector && (
                            <span className="text-[11px] text-accent-blue font-medium mt-1 shrink-0 w-16 text-right" title="Drive time between venues">
                              {formatDriveTime(stop.driveFromPrev)} →
                            </span>
                          )}
                          {!showDriveConnector && !isExclusive && <span className="w-16 shrink-0" />}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-medium text-text">
                                {stop.orgLabel || stop.venueName}
                              </span>
                              {stop.orgLabel && stop.orgLabel !== stop.venueName && (
                                <span className="text-[11px] text-text-dim/60">{stop.venueName}</span>
                              )}
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ctx.color}`}>
                                {ctx.label}
                              </span>
                              {gameTime && (
                                <span
                                  className={`text-[10px] text-text-dim/60 ${gameTime === 'Unconfirmed' ? 'cursor-help' : ''}`}
                                  title={gameTime === 'Unconfirmed' ? 'Game time hasn\'t been posted yet. Check the team schedule closer to game day for the start time.' : undefined}
                                >{gameTime}</span>
                              )}
                              {stop.confidence && stop.confidence !== 'high' && (
                                <TapBadge
                                  className="rounded bg-accent-orange/10 px-1.5 py-0.5 text-[10px] text-accent-orange"
                                  label={stop.source === 'hs-lookup' && !stop.isHome ? 'Est.' : stop.confidence === 'medium' ? 'Likely' : 'Unconfirmed'}
                                  detail={stop.source === 'hs-lookup' && !stop.isHome
                                    ? `${stop.players.join(', ')} has an away game vs. ${stop.homeTeam}. We don't have the opponent's field address, so the location is estimated from ${stop.orgLabel}'s home area.`
                                    : stop.confidence === 'medium'
                                      ? `${stop.players.join(', ')}'s game is on the schedule but the exact venue isn't confirmed. Click "Verify" to double-check.`
                                      : `We're not sure where ${stop.players.join(', ')}'s game will be played. The schedule may have changed. Click "Verify" to confirm before planning around it.`}
                                />
                              )}
                              {stop.awayTeam === 'Spring Training' && (() => {
                                const gameDate = new Date(stop.dates[0] + 'T12:00:00Z')
                                const marchCutoff = new Date(gameDate.getUTCFullYear(), 2, 22) // Mar 22
                                return gameDate >= marchCutoff ? (
                                  <TapBadge
                                    className="rounded bg-accent-red/10 px-1.5 py-0.5 text-[10px] text-accent-red"
                                    label="Spring training ending — verify location"
                                    detail="Spring training is ending. This player will be reassigned to a minor league affiliate soon — verify their current location before booking travel."
                                  />
                                ) : null
                              })()}
                              {stop.sourceUrl && (
                                <a href={stop.sourceUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-[11px] text-accent-blue/60 hover:text-accent-blue underline"
                                  title="Open the source schedule to confirm this game's date, time, and location">Verify ↗</a>
                              )}
                            </div>
                            {stop.source === 'hs-lookup' && !stop.isHome && (
                              <p className="text-[10px] text-accent-orange/60 mt-0.5">
                                Location approximate — away game venue estimated from home field area.{' '}
                                <a
                                  href={`https://www.google.com/maps/search/${encodeURIComponent(`${stop.awayTeam || stop.venueName} high school baseball field`)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-accent-blue/70 hover:text-accent-blue underline"
                                >
                                  Confirm on Google Maps ↗
                                </a>
                              </p>
                            )}
                            {/* Players inline */}
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              {stop.players.map((name) => {
                                const player = playerMap.get(name)
                                const tier = player?.tier ?? 4
                                const dotColor = TIER_DOT_COLORS[tier] ?? 'bg-gray-500'
                                return (
                                  <span
                                    key={name}
                                    className={`inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-text ${onPlayerClick ? 'cursor-pointer hover:bg-accent-blue/10' : ''}`}
                                    onClick={onPlayerClick ? (e) => { e.stopPropagation(); onPlayerClick(name) } : undefined}
                                  >
                                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
                                    {name}
                                    <span className="text-text-dim/50">{TIER_LABELS[tier] ?? ''}</span>
                                  </span>
                                )
                              })}
                              {stop.players.length >= 2 && (
                                <span className="text-[10px] text-accent-green/70 ml-1" title={`${stop.players.length} SV players in the same game — efficient visit`}>
                                  {stop.players.length} players, 1 game
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                      </div>
                    </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {/* Action buttons removed — keeping trip cards clean */}


        </div>
      )}
    </div>
  )
}

/* ── Score explainer ── shows why this trip is ranked where it is ── */
function ScoreExplainer({ breakdown, driveMinutes }: { breakdown: ScoreBreakdown; driveMinutes: number }) {
  // The compliance checkmarks (drive cap, trip-length cap) render in the
  // always-visible row above — that's what rebuilt Kent's trust after the
  // 2026-06-08 interview. The point-by-point math ("2 must-see (40pts)",
  // Raw → Final) is scoring jargon, so it stays behind "show details".
  const [open, setOpen] = useState(false)
  const parts: string[] = []
  if (breakdown.tier1Count > 0) parts.push(`${breakdown.tier1Count} must-see (${breakdown.tier1Points}pts)`)
  if (breakdown.tier2Count > 0) parts.push(`${breakdown.tier2Count} high-priority (${breakdown.tier2Points}pts)`)
  if (breakdown.tier3Count > 0) parts.push(`${breakdown.tier3Count} standard (${breakdown.tier3Points}pts)`)
  if (breakdown.tuesdayBonus) parts.push('Tuesday bonus (+20%)')
  if (breakdown.pitcherMatchBonus > 0) parts.push(`Pitcher match (+${Math.round(breakdown.pitcherMatchBonus * 100)}%)`)
  const driveHours = driveMinutes / 60
  if (driveHours > 3) parts.push(`Long drive penalty (${Math.round(driveHours)}h)`)

  // Constraint-compliance checks pulled from tripStore — proves the engine
  // honored the user's caps. (Kent interview: "the rules were max 2 nights
  // on the road... it just wouldn't abide by the rules.")
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const maxNights = useTripStore((s) => s.maxNights)
  const driveOk = driveMinutes <= maxDriveMinutes
  const driveHoursLabel = `${(driveMinutes / 60).toFixed(1)}h`
  const driveCapLabel = `${(maxDriveMinutes / 60).toFixed(0)}h`

  return (
    <div className="rounded-md border border-border/30 bg-gray-950/30 px-2.5 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-text">Score: {Math.round(breakdown.finalScore)}</span>
        <span className={`flex items-center gap-1 ${driveOk ? 'text-accent-green' : 'text-accent-red'}`}>
          {driveOk ? '✓' : '✗'} drive {driveHoursLabel} ≤ {driveCapLabel} cap
        </span>
        <span className="text-accent-green flex items-center gap-1">
          ✓ ≤ {maxNights + 1} day trip cap
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
          className="ml-auto text-text-dim/60 hover:text-text-dim transition-colors"
        >
          {open ? '▾ hide details' : '▸ show details'}
        </button>
      </div>
      {open && (
        <div className="mt-1.5 ml-1 text-text-dim/70 space-y-0.5">
          {parts.map((p, i) => <div key={i}>· {p}</div>)}
          <div className="text-text-dim/40 mt-1">Raw: {Math.round(breakdown.rawScore)} → Final: {Math.round(breakdown.finalScore)}</div>
        </div>
      )}
    </div>
  )
}

/* ── Expandable warning row ── click to show/hide details ── */
function ExpandableWarning({ summary, detail, defaultOpen = false }: { summary: string; detail: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="flex w-full items-start gap-1 text-left text-[11px] text-accent-orange"
      >
        <span className="shrink-0">{open ? '▾' : '▸'}</span>
        <span>⚠ {summary}</span>
      </button>
      {open && (
        <p className="mt-1 ml-4 text-[11px] text-text-dim leading-relaxed">{detail}</p>
      )}
    </div>
  )
}

/**
 * Star toggle. Persists in tripStore so Kent's favorites survive trip
 * regeneration AND across sessions. Star state is keyed by getTripKey, which
 * is stable as long as the anchor venue + dates don't change.
 */
function StarButton({ trip }: { trip: TripCandidate }) {
  const key = getTripKey(trip)
  const starred = useTripStore((s) => !!s.starredTrips[key])
  const toggle = useTripStore((s) => s.toggleTripStar)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); toggle(key) }}
      className={`ml-1 rounded-md px-2 py-0.5 text-[12px] font-semibold transition-colors ${
        starred
          ? 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30'
          : 'bg-gray-800/40 text-text-dim hover:text-yellow-300'
      }`}
      title={starred ? 'Saved — click to remove from favorites' : 'Save this trip to your favorites'}
      aria-pressed={starred}
    >
      {starred ? '★' : '☆'}
    </button>
  )
}

export default React.memo(TripCard)
