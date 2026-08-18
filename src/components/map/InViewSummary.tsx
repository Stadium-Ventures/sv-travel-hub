// "In this view" — a live inventory of the current map viewport (Tom +
// colleague, 2026-08-18): as you pan and zoom, the left rail names the
// players you're looking at, without touching filters or the origin. The
// map itself is the scope. Always visible, never behind a tab.

import { useMemo, useState } from 'react'
import type { TierMarker } from './hooks/useTierMarkers'
import { TIER_COLORS } from './hooks/useTierMarkers'
import { formatDate } from '../../lib/formatters'

const INITIAL_PLAYERS = 18

interface ViewPlayer {
  name: string
  tier: number
  level: string
  gamesInView: number
  venuesInView: number
}

export default function InViewSummary({
  markers,
  filterStart,
  filterEnd,
  onPlayerClick,
  zoomedWide,
}: {
  /** Markers currently inside the viewport (already filter-pruned). */
  markers: TierMarker[]
  filterStart: string
  filterEnd: string
  /** Opens the player's schedule panel. */
  onPlayerClick: (name: string) => void
  /** True when the viewport is roughly the whole US — the summary reads
   *  as a roster total rather than an area readout. */
  zoomedWide: boolean
}) {
  const [showAll, setShowAll] = useState(false)

  const { players, totalGames, venueCount } = useMemo(() => {
    const byName = new Map<string, ViewPlayer>()
    let totalGames = 0
    for (const m of markers) {
      const games = m.games.length || m.gameDates.length
      totalGames += games
      for (const p of m.players) {
        const cur = byName.get(p.name) ?? { name: p.name, tier: p.tier, level: p.level, gamesInView: 0, venuesInView: 0 }
        cur.venuesInView += 1
        // Games at this venue involving this player (fall back to the
        // venue's date count when per-game data is absent, e.g. ST camps)
        cur.gamesInView += m.games.length > 0
          ? m.games.filter((g) => g.players.includes(p.name)).length
          : m.gameDates.length
        byName.set(p.name, cur)
      }
    }
    const players = [...byName.values()].sort(
      (a, b) => a.tier - b.tier || b.gamesInView - a.gamesInView || a.name.localeCompare(b.name),
    )
    return { players, totalGames, venueCount: markers.length }
  }, [markers])

  const visible = showAll ? players : players.slice(0, INITIAL_PLAYERS)

  return (
    <div className="rounded-xl bg-surface border border-border/50 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-sm font-semibold text-text">{zoomedWide ? 'Across the US' : 'In this view'}</h3>
        <span className="text-[11px] text-text-dim">
          {players.length} player{players.length !== 1 ? 's' : ''} · {venueCount} venue{venueCount !== 1 ? 's' : ''} · {totalGames} game{totalGames !== 1 ? 's' : ''} · {formatDate(filterStart)} to {formatDate(filterEnd)}
        </span>
      </div>

      {players.length === 0 ? (
        <p className="mt-1.5 text-xs text-text-dim">
          No client games in this view on these dates. Zoom out (US view) or move the map.
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {visible.map((p) => (
              <button
                key={p.name}
                onClick={() => onPlayerClick(p.name)}
                className="flex items-center gap-1.5 rounded-lg bg-gray-900/50 px-2 py-1 text-[11px] text-text hover:bg-gray-800/70 transition-colors"
                title={`T${p.tier} · ${p.level} · ${p.gamesInView} game${p.gamesInView !== 1 ? 's' : ''} at ${p.venuesInView} venue${p.venuesInView !== 1 ? 's' : ''} in view. Click for full schedule.`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: TIER_COLORS[p.tier] ?? TIER_COLORS[4]! }} />
                {p.name}
                <span className="text-text-dim/60">{p.gamesInView}g</span>
              </button>
            ))}
          </div>
          {players.length > INITIAL_PLAYERS && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="mt-1.5 text-[11px] font-medium text-accent-blue/80 hover:text-accent-blue transition-colors"
            >
              {showAll ? 'Show fewer' : `Show all ${players.length}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
