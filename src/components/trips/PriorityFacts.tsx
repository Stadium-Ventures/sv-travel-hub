// Facts before planning (Kent via Tom 2026-08-18): when "Plan this trip"
// lands here with 2-5 priority players, lay the facts out plainly FIRST —
// each player's venue and game time on each date in the window, plus a
// collapsible distance tracker between the venues involved (and the trip
// origin, when set). The user builds the trip themself from this, or asks
// for suggestions with Generate Trips below. No auto-generation.

import { useMemo, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { useScheduleStore } from '../../store/scheduleStore'
import { useSummerStore } from '../../store/summerStore'
import { useTimeStore } from '../../store/timeStore'
import { estimateDriveMinutes } from '../../lib/tripEngine'
import { formatDate, formatDriveTime, formatGameTimeDisplay, TIER_DOT_COLORS } from '../../lib/formatters'
import type { RosterPlayer } from '../../types/roster'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface CellGame {
  venueName: string
  coords: { lat: number; lng: number }
  time?: string
  tz?: string
  isRealTime: boolean
  opponent?: string
}

/** Straight-line miles (display only — the drive estimate stays the shared
 *  haversine-based one so numbers agree across the app). */
function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const km = 6371 * 2 * Math.asin(Math.sqrt(
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2,
  ))
  return km * 0.621371
}

export default function PriorityFacts({
  playerMap,
  onPlayerClick,
}: {
  playerMap: Map<string, RosterPlayer>
  onPlayerClick: (name: string) => void
}) {
  const priorityPlayers = useTripStore((s) => s.priorityPlayers)
  const startDate = useTripStore((s) => s.startDate)
  const endDate = useTripStore((s) => s.endDate)
  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const summerGames = useSummerStore((s) => s.summerGames)
  const timeMode = useTimeStore((s) => s.mode)

  const [trackerOpen, setTrackerOpen] = useState(false)

  const { dates, byDatePlayer, legs } = useMemo(() => {
    const picked = new Set(priorityPlayers)
    const byDatePlayer = new Map<string, Map<string, CellGame[]>>()
    const venueByName = new Map<string, { lat: number; lng: number }>()
    if (picked.size > 0) {
      for (const g of [...proGames, ...ncaaGames, ...hsGames, ...summerGames]) {
        if (g.date < startDate || g.date > endDate) continue
        if (g.venue.coords.lat === 0 && g.venue.coords.lng === 0) continue
        const names = g.playerNames.filter((n) => picked.has(n))
        if (names.length === 0) continue
        venueByName.set(g.venue.name, g.venue.coords)
        const cell: CellGame = {
          venueName: g.venue.name,
          coords: g.venue.coords,
          time: g.time,
          tz: g.venue.tz,
          isRealTime: g.source === 'mlb-api' && !!g.time,
          opponent: g.isHome
            ? (g.awayTeam ? `vs ${g.awayTeam}` : undefined)
            : (g.homeTeam ? `@ ${g.homeTeam}` : undefined),
        }
        const perPlayer = byDatePlayer.get(g.date) ?? new Map<string, CellGame[]>()
        for (const n of names) {
          const arr = perPlayer.get(n) ?? []
          // One game can appear via several sources — dedupe by venue+time
          if (!arr.some((c) => c.venueName === cell.venueName && c.time === cell.time)) arr.push(cell)
          perPlayer.set(n, arr)
        }
        byDatePlayer.set(g.date, perPlayer)
      }
    }
    const dates = [...byDatePlayer.keys()].sort()

    // Distance tracker: origin to each venue first (when set), then every
    // venue pair — the numbers Kent decides visit order with.
    const venues = [...venueByName.entries()].slice(0, 8)
    const legs: Array<{ from: string; to: string; miles: number; driveMin: number }> = []
    if (homeBase) {
      for (const [name, coords] of venues) {
        legs.push({
          from: homeBaseName || 'Trip origin',
          to: name,
          miles: milesBetween(homeBase, coords),
          driveMin: Math.round(estimateDriveMinutes(homeBase, coords)),
        })
      }
    }
    for (let i = 0; i < venues.length; i++) {
      for (let j = i + 1; j < venues.length; j++) {
        const [aName, a] = venues[i]!
        const [bName, b] = venues[j]!
        legs.push({
          from: aName,
          to: bName,
          miles: milesBetween(a, b),
          driveMin: Math.round(estimateDriveMinutes(a, b)),
        })
      }
    }
    return { dates, byDatePlayer, legs }
  }, [priorityPlayers, proGames, ncaaGames, hsGames, summerGames, startDate, endDate, homeBase, homeBaseName])

  if (priorityPlayers.length === 0) return null

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/40 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-text">The facts first</h3>
        <span className="text-[11px] text-text-dim">
          where {priorityPlayers.length === 1 ? 'this player is' : `these ${priorityPlayers.length} are`} each day, {formatDate(startDate)} to {formatDate(endDate)}. Build the trip yourself from this, or Generate Trips below for suggestions.
        </span>
      </div>

      {dates.length === 0 ? (
        <p className="px-4 py-3 text-xs text-text-dim">
          No games for {priorityPlayers.join(', ')} in these dates. Widen the date range, or their schedules may not be loaded yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30 text-left text-[10px] uppercase tracking-wide text-text-dim/60">
                <th className="px-4 py-2 font-semibold">Date</th>
                {priorityPlayers.map((name) => {
                  const p = playerMap.get(name)
                  return (
                    <th key={name} className="px-3 py-2 font-semibold">
                      <button
                        onClick={() => onPlayerClick(name)}
                        className="inline-flex items-center gap-1.5 normal-case text-text hover:text-accent-blue transition-colors"
                        title={`See ${name}'s full schedule`}
                      >
                        <span className={`h-2 w-2 rounded-full ${TIER_DOT_COLORS[p?.tier ?? 4] ?? 'bg-gray-500'}`} />
                        {name}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/20">
              {dates.map((d) => {
                const perPlayer = byDatePlayer.get(d)!
                const day = DAY_NAMES[new Date(d + 'T12:00:00Z').getUTCDay()]
                return (
                  <tr key={d} className="align-top hover:bg-gray-900/40 transition-colors">
                    <td className="whitespace-nowrap px-4 py-2 font-medium text-text-dim">
                      <span className={day === 'Tue' ? 'font-bold text-accent-blue' : ''}>{day}</span> {formatDate(d)}
                    </td>
                    {priorityPlayers.map((name) => {
                      const cells = perPlayer.get(name)
                      if (!cells || cells.length === 0) {
                        return <td key={name} className="px-3 py-2 text-text-dim/30">no game</td>
                      }
                      return (
                        <td key={name} className="px-3 py-2">
                          {cells.map((c, i) => (
                            <div key={i} className={i > 0 ? 'mt-1' : ''}>
                              <span className="text-text" title={c.opponent}>{c.venueName}</span>
                              <span className="ml-1.5 text-text-dim/60">
                                {c.isRealTime
                                  ? formatGameTimeDisplay(c.time, timeMode, { coords: c.coords, tz: c.tz })
                                  : ''}
                              </span>
                            </div>
                          ))}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {legs.length > 0 && (
        <div className="border-t border-border/40">
          <button
            onClick={() => setTrackerOpen((v) => !v)}
            className="block w-full px-4 py-2 text-left text-[11px] font-medium text-text-dim hover:text-text transition-colors"
          >
            {trackerOpen ? '▾' : '▸'} Distance tracker · {legs.length} leg{legs.length !== 1 ? 's' : ''}
            {!homeBase && <span className="ml-2 font-normal text-text-dim/50">(set a Trip origin to add from-origin legs)</span>}
          </button>
          {trackerOpen && (
            <div className="divide-y divide-border/20 pb-1">
              {legs.map((l, i) => (
                <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-1.5 text-xs">
                  <span className="text-text-dim">
                    <span className="text-text">{l.from}</span> to <span className="text-text">{l.to}</span>
                  </span>
                  <span className="whitespace-nowrap font-medium text-text">
                    {Math.round(l.miles)} mi · {formatDriveTime(l.driveMin)} <span className="font-normal text-text-dim/60">est. drive</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
