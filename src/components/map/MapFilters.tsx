// Compact, Maptive-style filter strip for the Player Map.
//
// Filters apply on top of the existing date-range / drive-radius filtering.
// The filter state is owned by MapView and the visible tierMarkers are
// re-derived via useFilteredMarkers below.

import { useMemo } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import type { TierMarker } from './hooks/useTierMarkers'
import { TIER_COLORS } from './hooks/useTierMarkers'
import PlayerSearchPicker from '../ui/PlayerSearchPicker'

export type MapLevelFilter = 'Pro' | 'NCAA' | 'HS'
/** How to color venue dots — by player tier (default), or by Heartbeat
 *  overdue-ness (Kent's interview ask 2026-06-08: "different color of like guys
 *  that we need to see"). */
export type MapColorMode = 'tier' | 'heartbeat'

export interface MapFilterState {
  tiers: Set<number>
  levels: Set<MapLevelFilter>
  /** Free-text venue search (still useful for finding a specific stadium). */
  search: string
  /** Affirmatively picked player — narrows the map to only this player's
   *  venues. Kent's 2026-06-08 feedback: "should feel like I am SELECTING
   *  him instead of raw text." */
  selectedPlayer: string
  colorBy: MapColorMode
  /** When true, only show venues with at least one overdue (>90d) or
   *  never-visited player. Kent interview ask: "guys we need to see." */
  overdueOnly: boolean
  /** When true, hide venues outside the drive radius from the trip origin.
   *  Closes the mental-model gap where dragging the star to a new city
   *  didn't visually filter what's actually reachable. */
  drivableOnly: boolean
}

export const DEFAULT_MAP_FILTERS: MapFilterState = {
  tiers: new Set([1, 2, 3, 4]),
  levels: new Set<MapLevelFilter>(['Pro', 'NCAA', 'HS']),
  search: '',
  selectedPlayer: '',
  colorBy: 'tier',
  overdueOnly: false,
  drivableOnly: false,
}

/** Heartbeat color thresholds (days since in-person visit).
 *  These intentionally use a DIFFERENT hue family from Tier coloring
 *  (which is red/orange/gray for T1/T2/T3) so the map can be read without
 *  confusion when both schemes are visible nearby. Magenta/amber/teal/gray
 *  reads as "freshness" and tier red/orange reads as "priority". */
export const HEARTBEAT_COLORS = {
  overdue: '#ec4899',   // >90 days  (pink/magenta — distinct from tier red)
  stale:   '#eab308',   // 45-90      (amber — distinct from tier orange)
  fresh:   '#06b6d4',   // <45        (cyan/teal — distinct from any tier color)
  unknown: '#6b7280',   // no data    (gray — same gray works for both)
} as const

export function heartbeatColorFor(days: number | null | undefined): string {
  if (days == null) return HEARTBEAT_COLORS.unknown
  if (days > 90) return HEARTBEAT_COLORS.overdue
  if (days > 45) return HEARTBEAT_COLORS.stale
  return HEARTBEAT_COLORS.fresh
}

interface MapFiltersProps {
  state: MapFilterState
  setState: (s: MapFilterState) => void
  markerCount: number
  totalCount: number
  /** Pre-built lookup so the Overdue toggle and applyMapFilters share a single
   *  source of truth for days-since-visit. Built by MapView from heartbeatStore. */
  daysByPlayerKey?: Map<string, number | null>
}

const TIER_LABEL: Record<number, string> = { 1: 'Must-see (T1)', 2: 'High (T2)', 3: 'Standard (T3)', 4: 'Dev (T4)' }

export default function MapFilters({ state, setState, markerCount, totalCount, daysByPlayerKey }: MapFiltersProps) {
  void daysByPlayerKey // accepted so caller can pass; consumed by applyMapFilters below
  const players = useRosterStore((s) => s.players)
  const filtered = markerCount < totalCount

  // Count players per level so users see what each toggle would hide
  const levelCounts = useMemo(() => {
    const c: Record<MapLevelFilter, number> = { Pro: 0, NCAA: 0, HS: 0 }
    for (const p of players) c[p.level]++
    return c
  }, [players])

  function toggleTier(t: number) {
    const next = new Set(state.tiers)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    if (next.size === 0) next.add(t) // never empty — re-add
    setState({ ...state, tiers: next })
  }
  function toggleLevel(l: MapLevelFilter) {
    const next = new Set(state.levels)
    if (next.has(l)) next.delete(l)
    else next.add(l)
    if (next.size === 0) next.add(l)
    setState({ ...state, levels: next })
  }

  return (
    <div className="rounded-lg bg-surface border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Color-by mode (Kent's "color overdue guys" ask) */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Color by</span>
          {(['tier', 'heartbeat'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setState({ ...state, colorBy: mode })}
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                state.colorBy === mode
                  ? 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue'
                  : 'border-border/30 bg-transparent text-text-dim/60 hover:text-text'
              }`}
              title={mode === 'tier' ? 'Color by player tier (T1 red, T2 orange, T3 gray)' : 'Color by Heartbeat overdue-ness (>90d red, 45-90d orange, <45d green)'}
            >
              {mode === 'tier' ? 'Tier' : 'Heartbeat'}
            </button>
          ))}
        </div>

        {/* Overdue-only quick filter (Kent's "guys we need to see") */}
        <button
          onClick={() => setState({ ...state, overdueOnly: !state.overdueOnly })}
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            state.overdueOnly
              ? 'border-accent-red/40 bg-accent-red/15 text-accent-red'
              : 'border-border/30 bg-transparent text-text-dim/60 hover:text-text'
          }`}
          title="Show only venues with at least one player overdue (>90d) or never visited"
        >
          {state.overdueOnly ? '✓ Overdue only' : 'Overdue only'}
        </button>

        {/* Drivable-only quick filter — hides venues outside the drive radius. */}
        <button
          onClick={() => setState({ ...state, drivableOnly: !state.drivableOnly })}
          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            state.drivableOnly
              ? 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue'
              : 'border-border/30 bg-transparent text-text-dim/60 hover:text-text'
          }`}
          title="Hide venues outside the dashed drive-radius circle from your trip origin"
        >
          {state.drivableOnly ? '✓ Drivable only' : 'Drivable only'}
        </button>

        {/* Visual ▏ Filter — thin separator to help the eye group the
            "how it looks" controls vs the "what to show" controls. */}
        <span className="h-5 w-px bg-border/40" aria-hidden />

        {/* One color key at a time (Tom 2026-07-21): in Tier mode the tier
            pills ARE the legend; in Heartbeat mode the heartbeat legend
            takes their place entirely. (Any tier filtering set beforehand
            still applies — the "N venues of M" count + clear link show it.) */}
        {state.colorBy === 'tier' ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Tier</span>
            {[1, 2, 3, 4].map((t) => {
              const active = state.tiers.has(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleTier(t)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-border bg-gray-800/60 text-text'
                      : 'border-border/30 bg-transparent text-text-dim/40 line-through'
                  }`}
                  title={TIER_LABEL[t]}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: TIER_COLORS[t] ?? TIER_COLORS[4]! }}
                  />
                  T{t}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-dim">
            <span className="uppercase tracking-wide text-text-dim/60">Map dots</span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.overdue }} />
              Overdue (&gt;90d)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.stale }} />
              Stale (45–90d)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.fresh }} />
              Fresh (&lt;45d)
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: HEARTBEAT_COLORS.unknown }} />
              No visit on record
            </span>
          </div>
        )}

        {/* Level filters */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Level</span>
          {(['Pro', 'NCAA', 'HS'] as MapLevelFilter[]).map((l) => {
            const active = state.levels.has(l)
            return (
              <button
                key={l}
                onClick={() => toggleLevel(l)}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-border bg-gray-800/60 text-text'
                    : 'border-border/30 bg-transparent text-text-dim/40 line-through'
                }`}
                title={`${levelCounts[l]} ${l} players in roster`}
              >
                {l}
              </button>
            )
          })}
        </div>

        {/* Filter ▏ Find — separator between "narrow what's visible" and
            "look up a specific player or venue." */}
        <span className="h-5 w-px bg-border/40" aria-hidden />

        {/* Player picker (affirmative selection — Kent's 2026-06-08 ask) */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Player</span>
          <PlayerSearchPicker
            value={state.selectedPlayer}
            players={players}
            placeholder="Find player..."
            onChange={(name) => setState({ ...state, selectedPlayer: name })}
            compact
          />
        </div>

        {/* Venue text search (kept as secondary find — e.g. "Lowell Park") */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Venue</span>
          <input
            type="text"
            value={state.search}
            onChange={(e) => setState({ ...state, search: e.target.value })}
            placeholder="e.g. Daytona, Bowman Field"
            className="min-w-0 w-[180px] rounded-md border border-border/40 bg-gray-950/40 px-2 py-0.5 text-[11px] text-text placeholder:text-text-dim/40 focus:outline-none focus:border-accent-blue/50"
          />
        </div>

        {/* Count + clear */}
        <div className="flex items-center gap-2 text-[10px] text-text-dim ml-auto">
          <span>
            {markerCount} venue{markerCount !== 1 ? 's' : ''}
            {filtered && <span className="text-text-dim/40"> of {totalCount}</span>}
          </span>
          {filtered && (
            <button
              onClick={() => setState(DEFAULT_MAP_FILTERS)}
              className="text-accent-blue/80 hover:text-accent-blue underline-offset-2 hover:underline"
            >
              clear filters
            </button>
          )}
        </div>
      </div>

    </div>
  )
}

/**
 * Apply the filter state to a list of TierMarkers. Returns markers whose
 * surviving player list (after tier/level/search/overdue) is non-empty; players
 * inside each marker are also pruned so the popup matches.
 */
/** Optional drive context for the Drivable-only toggle. */
export interface DriveContext {
  homeBase: { lat: number; lng: number }
  maxDriveMinutes: number
}

function estimateDriveMin(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  const km = R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
  return (km * 1.2 / 95) * 60
}

export function applyMapFilters(
  markers: TierMarker[],
  state: MapFilterState,
  daysByPlayerKey?: Map<string, number | null>,
  drive?: DriveContext,
): TierMarker[] {
  const search = state.search.trim().toLowerCase()
  const selectedPlayer = state.selectedPlayer.trim().toLowerCase()
  return markers
    .map((m) => {
      // Venue-name search: when set, only keep markers whose venue matches.
      if (search !== '' && !m.venueName.toLowerCase().includes(search)) return null
      // Drivable-only: drop venues outside the drive radius from home base.
      if (state.drivableOnly && drive) {
        const driveMin = estimateDriveMin(drive.homeBase, m.coords)
        if (driveMin > drive.maxDriveMinutes) return null
      }
      const survivors = m.players.filter((p) => {
        if (!state.tiers.has(p.tier)) return false
        if (!state.levels.has(p.level as MapLevelFilter)) return false
        // Affirmative player selection: keep only this exact player.
        if (selectedPlayer !== '' && p.name.toLowerCase() !== selectedPlayer) return false
        if (state.overdueOnly) {
          if (!daysByPlayerKey) return false
          const days = daysByPlayerKey.get(p.name.trim().toLowerCase())
          // Overdue = no visit on record, OR more than 90 days since last visit
          if (days != null && days <= 90) return false
        }
        return true
      })
      if (survivors.length === 0) return null
      return {
        ...m,
        players: survivors,
        playerCount: survivors.length,
        bestTier: Math.min(...survivors.map((p) => p.tier)),
      } as TierMarker
    })
    .filter((m): m is TierMarker => m !== null)
}
