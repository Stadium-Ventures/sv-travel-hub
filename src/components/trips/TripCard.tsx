import React, { useMemo, useState } from 'react'
// import { useTripStore } from '../../store/tripStore'
import type { TripCandidate, VisitConfidence, ScheduleSource } from '../../types/schedule'
// import { generateTripIcs, downloadIcs } from '../../lib/icsExport'
import { haversineKm, HOME_BASE } from '../../lib/tripEngine'
import { formatDate, formatDriveTime, TIER_DOT_COLORS, TIER_LABELS } from '../../lib/formatters'
import type { RosterPlayer } from '../../types/roster'

interface Props {
  trip: TripCandidate
  index: number
  playerMap: Map<string, RosterPlayer>
  defaultExpanded?: boolean
  onPlayerClick?: (playerName: string) => void
  overlappingTrips?: number[]
}

function formatGameTime(timeStr?: string, source?: ScheduleSource): string {
  if (!timeStr) return ''
  if (source && source !== 'mlb-api') return 'TBD'
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

export function generateItineraryText(trip: TripCandidate, index: number, stops: VenueStop[], playerMap: Map<string, RosterPlayer>): string {
  const startDate = formatDate(trip.suggestedDays[0]!)
  const endDate = formatDate(trip.suggestedDays[trip.suggestedDays.length - 1]!)
  const dayCount = trip.suggestedDays.length
  const dateLabel = dayCount === 1 ? startDate : `${startDate} – ${endDate}`

  let text = `Trip #${index} — ${dateLabel} (${dayCount} day${dayCount !== 1 ? 's' : ''})\n`
  text += `Drive from Orlando: ~${formatDriveTime(trip.driveFromHomeMinutes)}\n`

  const dayAssignments = assignStopsToDays(stops, trip.suggestedDays)
  for (const [day, dayStops] of dayAssignments) {
    text += `\n${formatDate(day)}:\n`
    for (const stop of dayStops) {
      const label = stop.orgLabel && stop.orgLabel !== stop.venueName
        ? `${stop.orgLabel} — ${stop.venueName}`
        : stop.venueName
      const playerDescs = stop.players.map((name) => {
        const p = playerMap.get(name)
        return p ? `${name} (T${p.tier})` : name
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

function TripCard({ trip, index, playerMap, defaultExpanded = false, onPlayerClick, overlappingTrips: _overlappingTrips }: Props) {
  const stops = useMemo(() => buildVenueStops(trip, playerMap), [trip, playerMap])
  const [expanded, setExpanded] = useState(defaultExpanded)


  const allPlayers = new Set<string>()
  for (const stop of stops) {
    for (const name of stop.players) allPlayers.add(name)
  }

  const tierCounts = { t1: 0, t2: 0, t3: 0 }
  for (const name of allPlayers) {
    const tier = playerMap.get(name)?.tier
    if (tier === 1) tierCounts.t1++
    else if (tier === 2) tierCounts.t2++
    else if (tier === 3) tierCounts.t3++
  }

  // Compute total drive
  let totalDrive = trip.driveFromHomeMinutes
  for (const s of stops) totalDrive += s.driveFromPrev
  const lastStop = stops[stops.length - 1]
  if (lastStop) {
    const lastCoords = parseVenueKey(lastStop.venueKey)
    totalDrive += Math.round((haversineKm(lastCoords, HOME_BASE) * 1.3 / 90) * 60)
  }

  // Assign stops to days, then remove empty days (no reason to show "flex days" with no games)
  const { dayAssignments, displayDays } = useMemo(() => {
    const assignments = assignStopsToDays(stops, trip.suggestedDays)
    // Keep only days that have games, plus the last day as "return home" if it's after a game day
    const daysWithGames = trip.suggestedDays.filter((d) => (assignments.get(d) ?? []).length > 0)
    let days: string[]
    if (daysWithGames.length === 0) {
      days = [trip.suggestedDays[0]!] // fallback
    } else {
      const lastGameDay = daysWithGames[daysWithGames.length - 1]!
      const lastSuggested = trip.suggestedDays[trip.suggestedDays.length - 1]!
      // Add a return-home day after the last game day if there's one in the original window
      if (lastGameDay !== lastSuggested && trip.suggestedDays.indexOf(lastSuggested) > trip.suggestedDays.indexOf(lastGameDay)) {
        days = [...daysWithGames, lastSuggested]
      } else {
        days = [...daysWithGames]
      }
    }

    return { dayAssignments: assignments, displayDays: days }
  }, [stops, trip.suggestedDays])

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
              Trip #{index} <span className="text-sm">🚗</span>
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
            }).join(', ')} · ~{formatDriveTime(trip.driveFromHomeMinutes)} from Orlando
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {(tierCounts.t1 > 0 || tierCounts.t2 > 0 || tierCounts.t3 > 0) && (
            <div className="flex items-center gap-1 rounded-lg bg-gray-950/60 px-2 py-1 text-[11px] font-medium">
              {tierCounts.t1 > 0 && <span className="text-accent-red">{tierCounts.t1}x {TIER_LABELS[1]}</span>}
              {tierCounts.t1 > 0 && (tierCounts.t2 > 0 || tierCounts.t3 > 0) && <span className="text-text-dim/30">·</span>}
              {tierCounts.t2 > 0 && <span className="text-accent-orange">{tierCounts.t2}x {TIER_LABELS[2]}</span>}
              {tierCounts.t2 > 0 && tierCounts.t3 > 0 && <span className="text-text-dim/30">·</span>}
              {tierCounts.t3 > 0 && <span className="text-yellow-400">{tierCounts.t3}x {TIER_LABELS[3]}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Expanded: Day-by-day plan (each stop assigned to ONE day) */}
      {expanded && (
        <div className="mt-4 space-y-3">

          {/* Warnings — TBD times, estimated schedules */}
          {(() => {
            const warnings: string[] = []
            // Check for TBD times on multi-stop days
            for (const [day, dayStops] of dayAssignments) {
              if (dayStops.length >= 2) {
                const tbdCount = dayStops.filter(s => !formatGameTime(s.gameTime, s.source) || formatGameTime(s.gameTime, s.source) === 'TBD').length
                if (tbdCount >= 2) {
                  warnings.push(`${formatDate(day)}: ${tbdCount} games have unconfirmed start times — verify before committing to this route`)
                }
              }
            }
            // Estimated schedule stops
            const estimatedStops = stops.filter((s) => s.confidence && s.confidence !== 'high')
            if (estimatedStops.length > 0) {
              for (const s of estimatedStops) {
                if (s.confidenceNote) warnings.push(s.confidenceNote)
              }
            }
            if (warnings.length === 0) return null
            return (
              <div className="rounded-lg border border-accent-orange/20 bg-accent-orange/5 px-3 py-2">
                {warnings.map((w, i) => (
                  <p key={i} className="text-[11px] text-accent-orange">
                    ⚠ {w}
                  </p>
                ))}
              </div>
            )
          })()}

          {/* Day-by-day schedule — the core of the card */}
          {displayDays.map((day, dayIdx) => {
            const dayDate = new Date(day + 'T12:00:00Z')
            const isTue = dayDate.getUTCDay() === 2
            const dayStops = dayAssignments.get(day) ?? []

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
                  {dayStops.length >= 2 && (
                    <span className="rounded-full bg-accent-green/15 px-2 py-0.5 text-[10px] font-bold text-accent-green">
                      DOUBLE UP · {dayStops.length} games
                    </span>
                  )}
                  {dayIdx === 0 && trip.driveFromHomeMinutes > 0 && (
                    <span className="text-[11px] text-text-dim/60 ml-auto">
                      Drive from Orlando: ~{formatDriveTime(trip.driveFromHomeMinutes)}
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
                  <div className="space-y-2">
                    {dayStops.map((stop, stopIdx) => {
                      const ctx = getVisitContext(stop.source, stop.isHome, stop.awayTeam, stop.confidence)
                      const gameTime = formatGameTime(stop.gameTime, stop.source)
                      return (
                        <div key={stop.venueKey} className="flex items-start gap-2.5">
                          {/* Drive connector between stops */}
                          {stopIdx > 0 && stop.driveFromPrev > 0 && (
                            <span className="text-[11px] text-accent-blue font-medium mt-1 shrink-0 w-16 text-right" title="Drive time between venues">
                              {formatDriveTime(stop.driveFromPrev)} →
                            </span>
                          )}
                          {stopIdx === 0 && <span className="w-16 shrink-0" />}

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
                                  className={`text-[10px] text-text-dim/60 ${gameTime === 'TBD' ? 'cursor-help' : ''}`}
                                  title={gameTime === 'TBD' ? 'Game time hasn\'t been posted yet. Check the team schedule closer to game day for the start time.' : undefined}
                                >{gameTime}</span>
                              )}
                              {stop.confidence && stop.confidence !== 'high' && (
                                <span
                                  className="rounded bg-accent-orange/10 px-1.5 py-0.5 text-[10px] text-accent-orange cursor-help"
                                  title={stop.confidence === 'medium'
                                    ? 'Location is based on the team schedule but not 100% confirmed. Click "Verify" to double-check.'
                                    : 'We\'re not sure about this game\'s location — the schedule may have changed. Click "Verify" to confirm before planning around it.'}
                                >
                                  {stop.confidence === 'medium' ? 'Likely' : 'Unconfirmed'}
                                </span>
                              )}
                              {stop.awayTeam === 'Spring Training' && (() => {
                                const gameDate = new Date(stop.dates[0] + 'T12:00:00Z')
                                const marchEnd = new Date(gameDate.getUTCFullYear(), 2, 28) // Mar 28
                                return gameDate >= marchEnd ? (
                                  <span
                                    className="rounded bg-accent-red/10 px-1.5 py-0.5 text-[10px] text-accent-red cursor-help"
                                    title="Spring training is almost over. This player may be reassigned to a minor league affiliate soon — verify their location before booking travel."
                                  >
                                    ST ends soon — verify
                                  </span>
                                ) : null
                              })()}
                              {stop.sourceUrl && (
                                <a href={stop.sourceUrl} target="_blank" rel="noopener noreferrer"
                                  className="text-[10px] text-text-dim/50 hover:text-accent-blue"
                                  title="Open the source schedule to confirm this game's date, time, and location">Verify ↗</a>
                              )}
                            </div>
                            {/* Players inline */}
                            <div className="mt-1 flex flex-wrap gap-1">
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
                            </div>
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

export default React.memo(TripCard)
