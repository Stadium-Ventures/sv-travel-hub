import { useMemo, useState } from 'react'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { useVenueStore } from '../../store/venueStore'
import { generateSpringTrainingEvents, generateNcaaEvents, generateHsEvents } from '../../lib/tripEngine'
import type { GameEvent } from '../../types/schedule'
import type { Coordinates } from '../../types/roster'
import ScheduleCalendar from './ScheduleCalendar'

export default function CalendarView() {
  const players = useRosterStore((s) => s.players)
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGamesReal = useScheduleStore((s) => s.hsGames)
  const customMlbAliases = useScheduleStore((s) => s.customMlbAliases)
  const customNcaaAliases = useScheduleStore((s) => s.customNcaaAliases)
  const venueState = useVenueStore((s) => s.venues)

  const [sourceFilters, setSourceFilters] = useState<Record<string, boolean>>({
    pro: true, st: true, ncaa: true, hs: true,
  })

  const combinedGames = useMemo(() => {
    const all: GameEvent[] = []

    if (sourceFilters.pro) {
      all.push(...proGames.filter((g) => g.awayTeam !== 'Spring Training'))
    }

    if (sourceFilters.st) {
      all.push(...proGames.filter((g) => g.awayTeam === 'Spring Training'))
      const y = new Date().getFullYear()
      const stEvents = generateSpringTrainingEvents(players, `${y}-02-15`, `${y}-09-30`, customMlbAliases)
      const existingIds = new Set(all.map((g) => g.id))
      for (const e of stEvents) {
        if (!existingIds.has(e.id)) all.push(e)
      }
    }

    if (sourceFilters.ncaa) {
      all.push(...ncaaGames)
      const ncaaPlayersWithReal = new Set(ncaaGames.flatMap((g) => g.playerNames))
      const syntheticNcaa = generateNcaaEvents(
        players.filter((p) => p.level === 'NCAA' && !ncaaPlayersWithReal.has(p.playerName)),
        `${new Date().getFullYear()}-02-14`, `${new Date().getFullYear()}-06-15`,
        customNcaaAliases,
      )
      all.push(...syntheticNcaa)
    }

    if (sourceFilters.hs) {
      all.push(...hsGamesReal)
      const hsPlayersWithReal = new Set(hsGamesReal.flatMap((g) => g.playerNames))
      const hsVenues = new Map<string, { name: string; coords: Coordinates }>()
      for (const [key, v] of Object.entries(venueState)) {
        if (v.source === 'hs-geocoded') {
          hsVenues.set(key.replace(/^hs-/, ''), { name: v.name, coords: v.coords })
        }
      }
      const syntheticHs = generateHsEvents(
        players.filter((p) => p.level === 'HS' && !hsPlayersWithReal.has(p.playerName)),
        `${new Date().getFullYear()}-02-14`, `${new Date().getFullYear()}-05-15`, hsVenues,
      )
      all.push(...syntheticHs)
    }

    all.sort((a, b) => a.date.localeCompare(b.date))
    return all
  }, [proGames, ncaaGames, hsGamesReal, players, venueState, sourceFilters, customMlbAliases, customNcaaAliases])

  const hasAnyGames = proGames.length > 0 || ncaaGames.length > 0 || players.some((p) => p.level === 'NCAA' || p.level === 'HS')

  const toggleFilter = (key: string) => {
    setSourceFilters({ ...sourceFilters, [key]: !sourceFilters[key] })
  }

  if (!hasAnyGames) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center">
        <p className="text-sm text-text-dim">No games to display yet.</p>
        <p className="mt-1 text-xs text-text-dim/60">
          Go to the Data Setup tab to connect players to teams and load schedules.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Source filter toggles */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-text-dim">Show:</span>
        <button onClick={() => toggleFilter('pro')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.pro ? 'bg-accent-blue/20 text-accent-blue border-accent-blue/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>Pro</button>
        <button onClick={() => toggleFilter('st')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.st ? 'bg-pink-400/20 text-pink-400 border-pink-400/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>Spring Training</button>
        <button onClick={() => toggleFilter('ncaa')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.ncaa ? 'bg-accent-green/20 text-accent-green border-accent-green/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>College</button>
        <button onClick={() => toggleFilter('hs')} className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border ${sourceFilters.hs ? 'bg-accent-orange/20 text-accent-orange border-accent-orange/30' : 'bg-gray-800 text-text-dim/50 border-border/30'}`}>High School</button>
        <span className="text-[11px] text-text-dim/50">
          {combinedGames.length} games
        </span>
      </div>

      <ScheduleCalendar games={combinedGames} />
    </div>
  )
}
