// "In this view" — a live inventory of the current map viewport (Tom +
// colleague, 2026-08-18): as you pan and zoom, the left rail names the
// players you're looking at. Always visible, never behind a tab.
//
// Chip interactions (Tom 2026-08-19, v2 — name-click keeps the beloved
// pulse + player card), IN ADDITION to the Filters:
//   - click the DOT   → hide that player's events (dot hollows, name
//                       fades; click again to bring them back — a toggle)
//   - click the name  → pulse their venues + open their player card
//   - double-click name → SOLO: show only their events (again to exit)
// The full list scrolls when there are too many players for the card.

import { useMemo, useRef } from 'react'
import type { TierMarker } from './hooks/useTierMarkers'
import { TIER_COLORS } from './hooks/useTierMarkers'
import { formatDate } from '../../lib/formatters'

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
  hiddenPlayers,
  soloPlayer,
  onToggleHide,
  onSolo,
  onOpenSchedule,
  onResetChips,
  zoomedWide,
}: {
  /** Markers currently inside the viewport, BEFORE chip hiding — hidden
   *  players must stay listed (faded) or they could never be unhidden. */
  markers: TierMarker[]
  filterStart: string
  filterEnd: string
  hiddenPlayers: Set<string>
  soloPlayer: string | null
  onToggleHide: (name: string) => void
  onSolo: (name: string) => void
  onOpenSchedule: (name: string) => void
  onResetChips: () => void
  /** True when the viewport is roughly the whole US. */
  zoomedWide: boolean
}) {
  // Single-click waits briefly so a double-click can win (solo)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { players, totalGames, venueCount } = useMemo(() => {
    const byName = new Map<string, ViewPlayer>()
    let totalGames = 0
    for (const m of markers) {
      totalGames += m.games.length || m.gameDates.length
      for (const p of m.players) {
        const cur = byName.get(p.name) ?? { name: p.name, tier: p.tier, level: p.level, gamesInView: 0, venuesInView: 0 }
        cur.venuesInView += 1
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

  const chipsActive = soloPlayer != null || hiddenPlayers.size > 0
  const isFaded = (name: string) => (soloPlayer ? name !== soloPlayer : hiddenPlayers.has(name))

  // Single-click waits briefly so a double-click (solo) can win; the wait
  // is invisible inside the locate pulse that follows.
  function handleNameClick(name: string) {
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      onOpenSchedule(name)
    }, 230)
  }
  function handleNameDoubleClick(name: string) {
    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null }
    onSolo(name)
  }

  return (
    <div className="rounded-xl bg-surface border border-border/50 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h3 className="text-sm font-semibold text-text">{zoomedWide ? 'Across the US' : 'In this view'}</h3>
        <span className="text-[11px] text-text-dim">
          {players.length} player{players.length !== 1 ? 's' : ''} · {venueCount} venue{venueCount !== 1 ? 's' : ''} · {totalGames} game{totalGames !== 1 ? 's' : ''} · {formatDate(filterStart)} to {formatDate(filterEnd)}
        </span>
        {chipsActive && (
          <span className="text-[11px] text-accent-blue">
            {soloPlayer ? `only ${soloPlayer}` : `${hiddenPlayers.size} hidden`}
            <button
              onClick={onResetChips}
              className="ml-1.5 text-accent-blue/80 underline-offset-2 hover:underline"
              title="Show everyone again"
            >
              reset
            </button>
          </span>
        )}
      </div>

      {players.length === 0 ? (
        <p className="mt-1.5 text-xs text-text-dim">
          No client games in this view on these dates. Zoom out (US view) or move the map.
        </p>
      ) : (
        <>
          <div className="mt-2 flex max-h-40 flex-wrap content-start gap-1.5 overflow-y-auto pr-1">
            {players.map((p) => {
              const faded = isFaded(p.name)
              const solo = soloPlayer === p.name
              return (
                <span
                  key={p.name}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] transition-all ${
                    solo
                      ? 'bg-accent-blue/15 text-text ring-1 ring-accent-blue/50'
                      : faded
                        ? 'bg-gray-900/30 text-text-dim/40'
                        : 'bg-gray-900/50 text-text'
                  }`}
                >
                  <button
                    onClick={() => onToggleHide(p.name)}
                    className="-m-1 cursor-pointer p-1"
                    title={faded && !soloPlayer ? `Show ${p.name}'s events again` : `Hide ${p.name}'s events from the map (click again to restore)`}
                  >
                    <span
                      className="block h-2.5 w-2.5 rounded-full transition-all"
                      style={
                        faded
                          ? { background: 'transparent', border: `1.5px solid ${TIER_COLORS[p.tier] ?? TIER_COLORS[4]!}`, opacity: 0.5 }
                          : { background: TIER_COLORS[p.tier] ?? TIER_COLORS[4]! }
                      }
                    />
                  </button>
                  <button
                    onClick={() => handleNameClick(p.name)}
                    onDoubleClick={() => handleNameDoubleClick(p.name)}
                    className="cursor-pointer select-none"
                    title={`${p.name}: T${p.tier} · ${p.level} · ${p.gamesInView} game${p.gamesInView !== 1 ? 's' : ''} at ${p.venuesInView} venue${p.venuesInView !== 1 ? 's' : ''} in view. Click to flash their venues and open their card; double-click to show ONLY them${soloPlayer === p.name ? ' (double-click again to exit solo)' : ''}.`}
                  >
                    {p.name}
                  </button>
                  <span className={faded ? 'text-text-dim/30' : 'text-text-dim/60'}>{p.gamesInView}g</span>
                </span>
              )
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-text-dim/40">
            Click a name for their venues + card · double-click to show only them · click the colored dot to hide them (again to restore).
          </p>
        </>
      )}
    </div>
  )
}
