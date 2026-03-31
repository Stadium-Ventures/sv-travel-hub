import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useTripStore, getTripKey } from '../../store/tripStore'
import { useVenueStore } from '../../store/venueStore'
import { generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents, estimateDriveMinutes } from '../../lib/tripEngine'
import { formatDate, formatDriveTime } from '../../lib/formatters'
import type { GameEvent } from '../../types/schedule'
import type { Coordinates } from '../../types/roster'

const TIER_COLORS: Record<number, string> = {
  1: 'bg-accent-red/20 text-accent-red',
  2: 'bg-accent-orange/20 text-accent-orange',
  3: 'bg-yellow-400/20 text-yellow-400',
  4: 'bg-gray-500/20 text-gray-400',
}

const SOURCE_LABELS: Record<string, string> = {
  'mlb-api': 'Pro',
  'ncaa-lookup': 'NCAA',
  'hs-lookup': 'HS',
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

interface Props {
  playerName: string
  onClose: () => void
}

type ViewMode = 'summary' | 'full-schedule'

function PlayerSchedulePanel({ playerName, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const players = useRosterStore((s) => s.players)
  const player = players.find((p) => p.playerName === playerName)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGamesReal = useScheduleStore((s) => s.hsGames)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const tripStatuses = useTripStore((s) => s.tripStatuses)
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const maxFlightHours = useTripStore((s) => s.maxFlightHours)
  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const venueState = useVenueStore((s) => s.venues)

  const [viewMode, setViewMode] = useState<ViewMode>('summary')

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  // Close on escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Gather ALL games for this player from all sources (no "upcoming" filter)
  const allGames = useMemo(() => {
    const games: GameEvent[] = []

    // Pro games
    games.push(...proGames.filter((g) => g.playerNames.includes(playerName)))

    // NCAA games (real)
    games.push(...ncaaGames.filter((g) => g.playerNames.includes(playerName)))

    // Synthetic events
    if (player) {
      const stEvents = generateSpringTrainingEvents(players, startDate, endDate)
      games.push(...stEvents.filter((g) => g.playerNames.includes(playerName)))

      const ncaaPlayersWithReal = new Set(ncaaGames.flatMap((g) => g.playerNames))
      if (player.level === 'NCAA' && !ncaaPlayersWithReal.has(playerName)) {
        const syntheticNcaa = generateNcaaEvents([player], startDate, endDate)
        games.push(...syntheticNcaa.filter((g) => g.playerNames.includes(playerName)))
      }

      if (player.level === 'HS') {
        // Use real MaxPreps games if available
        const realHs = hsGamesReal.filter((g) => g.playerNames.includes(playerName))
        games.push(...realHs)
        // Fall back to synthetic if no real games
        if (realHs.length === 0) {
          const hsVenues = new Map<string, { name: string; coords: Coordinates }>()
          for (const [key, v] of Object.entries(venueState)) {
            if (v.source === 'hs-geocoded') hsVenues.set(key.replace(/^hs-/, ''), { name: v.name, coords: v.coords })
          }
          const hsEvents = generateHsEvents([player], startDate, endDate, hsVenues)
          games.push(...hsEvents.filter((g) => g.playerNames.includes(playerName)))
        }
      }
    }

    // Dedupe by ID and sort by date
    const seen = new Set<string>()
    const unique = games.filter((g) => {
      if (seen.has(g.id)) return false
      seen.add(g.id)
      return true
    })
    unique.sort((a, b) => a.date.localeCompare(b.date))
    return unique
  }, [playerName, player, players, proGames, ncaaGames, hsGamesReal, venueState, startDate, endDate])

  // For the summary view, only show upcoming games
  const upcomingGames = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]!
    return allGames.filter((g) => g.date >= today)
  }, [allGames])

  // Find which trips include this player
  const tripAssignments = useMemo(() => {
    if (!tripPlan) return []
    return tripPlan.trips
      .map((trip, i) => {
        const allNames = [
          ...trip.anchorGame.playerNames,
          ...trip.nearbyGames.flatMap((g) => g.playerNames),
        ]
        if (!allNames.includes(playerName)) return null
        const key = getTripKey(trip)
        const status = tripStatuses[key]
        return { tripNum: i + 1, trip, status }
      })
      .filter(Boolean) as Array<{ tripNum: number; trip: import('../../types/schedule').TripCandidate; status?: string }>
  }, [tripPlan, tripStatuses, playerName])

  // Compute drive minutes from home base for each game (for full schedule view)
  const gamesWithDrive = useMemo(() => {
    return allGames.map((g) => {
      const driveMin = estimateDriveMinutes(homeBase, g.venue.coords)
      return { game: g, driveMin }
    })
  }, [allGames, homeBase])

  // Determine range color for a drive time
  function getRangeInfo(driveMin: number): { label: string; color: string; borderColor: string; bgColor: string } {
    if (driveMin <= maxDriveMinutes) {
      return { label: 'Drive', color: 'text-accent-green', borderColor: 'border-accent-green/30', bgColor: 'bg-accent-green/5' }
    }
    // Estimate flight hours: convert drive minutes back to approximate km, then to flight hours
    // Using the inverse of estimateDriveMinutes: km = (driveMin / 60) * 95 / 1.2
    const approxKm = (driveMin / 60) * 95 / 1.2
    const flightHrs = approxKm / 800 + 3 // Same formula as estimateFlightHours
    if (flightHrs <= maxFlightHours) {
      return { label: 'Fly-in', color: 'text-accent-orange', borderColor: 'border-accent-orange/30', bgColor: 'bg-accent-orange/5' }
    }
    return { label: 'Remote', color: 'text-accent-red', borderColor: 'border-accent-red/30', bgColor: 'bg-accent-red/5' }
  }

  if (!player) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
        <div ref={panelRef} className="w-full max-w-md bg-surface border-l border-border p-6 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text">Player Not Found</h2>
            <button onClick={onClose} className="text-text-dim hover:text-text text-xl">&times;</button>
          </div>
          <p className="text-sm text-text-dim">Could not find player "{playerName}" in the roster.</p>
        </div>
      </div>
    )
  }

  const tierColor = TIER_COLORS[player.tier] ?? 'bg-gray-500/20 text-gray-400'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div ref={panelRef} className="w-full max-w-lg bg-surface border-l border-border overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-surface border-b border-border p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-text">{player.playerName}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tierColor}`}>
                T{player.tier}
              </span>
            </div>
            <button onClick={onClose} className="rounded-lg px-2 py-1 text-text-dim hover:text-text text-xl">&times;</button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-dim">
            <span>{player.org}</span>
            {(() => {
              const assignment = useScheduleStore.getState().playerTeamAssignments[player.playerName]
              if (assignment && assignment.teamName !== player.org) {
                return <>
                  <span className="text-text-dim/30">&rarr;</span>
                  <span className="text-accent-blue">{assignment.teamName}</span>
                </>
              }
              return null
            })()}
            <span className="text-text-dim/30">|</span>
            <span>{player.level}</span>
            <span className="text-text-dim/30">|</span>
            <span>{player.position}</span>
          </div>
          <div className="mt-2 flex gap-4 text-sm">
            <div>
              <span className="text-text-dim text-xs">Visits</span>
              <p className="font-bold text-text">{player.visitsCompleted} / {player.visitTarget2026}</p>
            </div>
            <div>
              <span className="text-text-dim text-xs">Remaining</span>
              <p className="font-bold text-accent-blue">{player.visitsRemaining}</p>
            </div>
            {player.lastVisitDate && (
              <div>
                <span className="text-text-dim text-xs">Last Visit</span>
                <p className="font-medium text-text">{formatDate(player.lastVisitDate)}</p>
              </div>
            )}
          </div>

          {/* View toggle */}
          <div className="mt-3 flex gap-1 rounded-lg bg-gray-950/50 p-0.5">
            <button
              onClick={() => setViewMode('summary')}
              className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === 'summary'
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'text-text-dim hover:text-text'
              }`}
            >
              Summary
            </button>
            <button
              onClick={() => setViewMode('full-schedule')}
              className={`flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === 'full-schedule'
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'text-text-dim hover:text-text'
              }`}
            >
              Full Schedule ({allGames.length})
            </button>
          </div>
        </div>

        {viewMode === 'summary' ? (
          <div className="p-5 space-y-6">
            {/* Trip Assignments */}
            {tripAssignments.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-text">Trip Assignments</h3>
                <div className="space-y-1.5">
                  {tripAssignments.map(({ tripNum, trip, status }) => {
                    const days = trip.suggestedDays
                    const dateLabel = days.length === 1
                      ? formatDate(days[0]!)
                      : `${formatDate(days[0]!)} – ${formatDate(days[days.length - 1]!)}`
                    return (
                      <div key={tripNum} className="flex items-center justify-between rounded-lg bg-gray-950/50 px-3 py-2 text-sm">
                        <span className="text-text">Trip #{tripNum}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-dim">{dateLabel}</span>
                          {status && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              status === 'planned' ? 'bg-accent-blue/15 text-accent-blue' : 'bg-accent-green/15 text-accent-green'
                            }`}>
                              {status === 'planned' ? 'Planned' : 'Completed'}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Upcoming Games */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-text">
                Upcoming Games
                <span className="ml-2 text-xs font-normal text-text-dim">{upcomingGames.length} events</span>
              </h3>

              {/* Natural language data source summary */}
              {upcomingGames.length > 0 && (() => {
                const sourceParts: string[] = []
                const mlbCount = upcomingGames.filter((g) => g.source === 'mlb-api').length
                const d1Count = upcomingGames.filter((g) => g.source === 'ncaa-lookup' && g.confidence === 'high').length
                const mpCount = upcomingGames.filter((g) => g.source === 'hs-lookup' && g.confidence === 'high').length
                const estCount = upcomingGames.filter((g) => g.confidence && g.confidence !== 'high').length
                if (mlbCount > 0) sourceParts.push(`confirmed MLB schedule`)
                if (d1Count > 0) sourceParts.push(`D1Baseball (${d1Count} games)`)
                if (mpCount > 0) sourceParts.push(`MaxPreps (${mpCount} games)`)
                const summary = sourceParts.length > 0 ? `Data sources: ${sourceParts.join(', ')}.` : ''
                const estNote = estCount > 0 ? ` ${estCount} event${estCount !== 1 ? 's are' : ' is'} estimated — verify before traveling.` : ''
                return (summary || estNote) ? (
                  <p className="mb-2 text-[11px] text-text-dim">{summary}{estNote}</p>
                ) : null
              })()}

              {upcomingGames.length === 0 ? (
                <div>
                  <p className="text-xs text-text-dim">No upcoming games found in the selected date range.</p>
                  {allGames.length > 0 && (
                    <button
                      onClick={() => setViewMode('full-schedule')}
                      className="mt-1 text-xs text-accent-blue hover:underline"
                    >
                      View full schedule ({allGames.length} total games)
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                    {upcomingGames.slice(0, 30).map((g) => {
                      const sourceLabel = SOURCE_LABELS[g.source] ?? 'Unknown'
                      const isPostponed = g.gameStatus === 'Postponed' || g.gameStatus === 'Suspended'
                      const confidenceLabel = g.source === 'mlb-api' ? 'Confirmed'
                        : g.source === 'ncaa-lookup' && g.confidence === 'high' ? 'D1Baseball'
                        : g.source === 'hs-lookup' && g.confidence === 'high' ? 'MaxPreps'
                        : g.confidence === 'medium' ? 'Likely'
                        : 'Estimated'
                      const confidenceBadgeStyle = confidenceLabel === 'Estimated' ? 'bg-gray-500/15 text-gray-400'
                        : confidenceLabel === 'Likely' ? 'bg-yellow-400/15 text-yellow-400'
                        : 'bg-accent-green/15 text-accent-green'
                      return (
                        <div key={g.id} className={`rounded-lg border px-3 py-2 text-sm ${
                          isPostponed
                            ? 'border-accent-red/30 bg-accent-red/5'
                            : 'border-border/30 bg-gray-950/30'
                        }`}>
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-text">{formatDate(g.date)}</span>
                            <div className="flex items-center gap-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                g.source === 'mlb-api' ? 'bg-accent-blue/15 text-accent-blue' :
                                g.source === 'ncaa-lookup' ? 'bg-accent-green/15 text-accent-green' :
                                'bg-accent-orange/15 text-accent-orange'
                              }`}>
                                {sourceLabel}
                              </span>
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceBadgeStyle}`}>
                                {confidenceLabel}
                              </span>
                              {isPostponed && (
                                <span className="rounded bg-accent-red/15 px-1.5 py-0.5 text-[10px] font-bold text-accent-red">
                                  {g.gameStatus}
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="mt-0.5 text-xs text-text-dim">
                            {g.homeTeam} vs {g.awayTeam} @ {g.venue.name}
                            {g.sourceUrl && (
                              <a
                                href={g.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1.5 text-text-dim/60 hover:text-accent-blue transition-colors"
                              >
                                Verify ↗
                              </a>
                            )}
                          </p>
                          {g.confidenceNote && (
                            <p className="mt-0.5 text-[10px] italic text-text-dim/60">{g.confidenceNote}</p>
                          )}
                        </div>
                      )
                    })}
                    {upcomingGames.length > 30 && (
                      <p className="text-xs text-text-dim text-center">+{upcomingGames.length - 30} more events</p>
                    )}
                  </div>
                  <button
                    onClick={() => setViewMode('full-schedule')}
                    className="mt-2 text-xs text-accent-blue hover:underline"
                  >
                    Show full schedule with drive times
                  </button>
                </>
              )}
            </div>

            {/* Visit History */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-text">Visit History</h3>
              <div className="rounded-lg bg-gray-950/50 px-3 py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-dim">Completed</span>
                  <span className="text-text font-medium">{player.visitsCompleted}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-text-dim">Last visit</span>
                  <span className="text-text">{player.lastVisitDate ? formatDate(player.lastVisitDate) : 'Never'}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-text-dim">Target (2026)</span>
                  <span className="text-text">{player.visitTarget2026}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-text-dim">Remaining</span>
                  <span className="text-accent-blue font-bold">{player.visitsRemaining}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Full Schedule View */
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-text">
                  Full Schedule
                  <span className="ml-2 text-xs font-normal text-text-dim">
                    {allGames.length} game{allGames.length !== 1 ? 's' : ''} in range
                  </span>
                </h3>
                <p className="mt-0.5 text-[11px] text-text-dim">
                  {formatDate(startDate)} — {formatDate(endDate)} | Drive times from {homeBaseName}
                </p>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-green" />
                <span className="text-text-dim">Drive (&le;{formatDriveTime(maxDriveMinutes)})</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-orange" />
                <span className="text-text-dim">Fly-in (&le;{maxFlightHours}h)</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-full bg-accent-red" />
                <span className="text-text-dim">Remote</span>
              </span>
            </div>

            {allGames.length === 0 ? (
              <p className="text-xs text-text-dim">No games found in the selected date range ({formatDate(startDate)} — {formatDate(endDate)}).</p>
            ) : (
              <div className="space-y-1 overflow-y-auto">
                {/* Table header */}
                <div className="grid grid-cols-[70px_36px_36px_1fr_1fr_70px] gap-1 px-2 py-1 text-[10px] font-semibold text-text-dim uppercase tracking-wider border-b border-border/30">
                  <span>Date</span>
                  <span>Day</span>
                  <span>H/A</span>
                  <span>Opponent</span>
                  <span>Venue</span>
                  <span className="text-right">Drive</span>
                </div>

                {gamesWithDrive.map(({ game: g, driveMin }) => {
                  const range = getRangeInfo(driveMin)
                  const dayName = DAY_NAMES[new Date(g.date + 'T12:00:00Z').getUTCDay()]
                  const isPostponed = g.gameStatus === 'Postponed' || g.gameStatus === 'Suspended'
                  const today = new Date().toISOString().split('T')[0]!
                  const isPast = g.date < today

                  // Determine opponent relative to the player's team
                  const opponent = g.isHome ? g.awayTeam : g.homeTeam

                  return (
                    <div
                      key={g.id}
                      className={`grid grid-cols-[70px_36px_36px_1fr_1fr_70px] gap-1 items-center rounded-md border px-2 py-1.5 text-[11px] ${
                        isPostponed
                          ? 'border-accent-red/30 bg-accent-red/5 line-through opacity-60'
                          : isPast
                            ? `${range.borderColor} ${range.bgColor} opacity-50`
                            : `${range.borderColor} ${range.bgColor}`
                      }`}
                    >
                      {/* Date */}
                      <span className="font-medium text-text whitespace-nowrap">
                        {(() => {
                          const d = new Date(g.date + 'T12:00:00Z')
                          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                          return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
                        })()}
                      </span>

                      {/* Day of week */}
                      <span className={`text-text-dim ${dayName === 'Tue' ? 'font-bold text-accent-blue' : ''}`}>
                        {dayName}
                      </span>

                      {/* Home/Away */}
                      <span className={g.isHome ? 'text-accent-green font-medium' : 'text-text-dim'}>
                        {g.isHome ? 'H' : 'A'}
                      </span>

                      {/* Opponent */}
                      <span className="text-text truncate" title={opponent}>
                        {opponent}
                        {isPostponed && (
                          <span className="ml-1 text-accent-red text-[9px] font-bold no-underline">
                            {g.gameStatus}
                          </span>
                        )}
                      </span>

                      {/* Venue */}
                      <span className="text-text-dim truncate" title={g.venue.name}>
                        {g.venue.name}
                      </span>

                      {/* Drive time + range badge */}
                      <span className={`text-right font-medium ${range.color} whitespace-nowrap`} title={`${range.label} — ${formatDriveTime(driveMin)} from ${homeBaseName}`}>
                        {formatDriveTime(driveMin)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Summary stats */}
            {allGames.length > 0 && (() => {
              const driveCount = gamesWithDrive.filter(({ driveMin }) => driveMin <= maxDriveMinutes).length
              const flyInCount = gamesWithDrive.filter(({ driveMin }) => {
                if (driveMin <= maxDriveMinutes) return false
                const approxKm = (driveMin / 60) * 95 / 1.2
                return (approxKm / 800 + 3) <= maxFlightHours
              }).length
              const remoteCount = allGames.length - driveCount - flyInCount
              const homeCount = allGames.filter((g) => g.isHome).length
              return (
                <div className="mt-3 rounded-lg bg-gray-950/50 px-3 py-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-dim">Home / Away</span>
                    <span className="text-text">{homeCount}H / {allGames.length - homeCount}A</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-accent-green">Drivable</span>
                    <span className="text-text">{driveCount} game{driveCount !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-accent-orange">Fly-in</span>
                    <span className="text-text">{flyInCount} game{flyInCount !== 1 ? 's' : ''}</span>
                  </div>
                  {remoteCount > 0 && (
                    <div className="flex justify-between mt-1">
                      <span className="text-accent-red">Remote</span>
                      <span className="text-text">{remoteCount} game{remoteCount !== 1 ? 's' : ''}</span>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}

export default React.memo(PlayerSchedulePanel)
