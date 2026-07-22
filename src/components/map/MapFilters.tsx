// Compact, Maptive-style filter strip for the Player Map.
//
// Filters apply on top of the existing date-range / drive-radius filtering.
// The filter state is owned by MapView and the visible tierMarkers are
// re-derived via useFilteredMarkers below.

import { useEffect, useMemo, useRef, useState } from 'react'
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
  /** All loaded venue names — powers the venue search typeahead. */
  venueNames?: string[]
}

const TIER_LABEL: Record<number, string> = { 1: 'Must-see (T1)', 2: 'High (T2)', 3: 'Standard (T3)', 4: 'Dev (T4)' }

/** How many filter categories deviate from defaults — shown as the badge
 *  on the Filters button so hidden constraints are never invisible. */
export function countActiveFilters(s: MapFilterState): number {
  let n = 0
  if (s.tiers.size < 4) n++
  if (s.levels.size < 3) n++
  if (s.overdueOnly) n++
  if (s.drivableOnly) n++
  if (s.search.trim() !== '') n++
  if (s.selectedPlayer !== '') n++
  return n
}

/** Heartbeat color key — rendered under the toolbar only while Color by is
 *  Heartbeat, so exactly one color key is on screen at a time. */
export function HeartbeatLegend() {
  return (
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
  )
}

/**
 * Filters popover — one button in the toolbar, everything inside (2026-07-21
 * "apple-fy" pass: the standalone filter strip was a second full-width bar
 * of chrome). The badge shows how many filter categories are active so a
 * narrowed map is never a mystery.
 */
export default function MapFilters({ state, setState, markerCount, totalCount, daysByPlayerKey, venueNames = [] }: MapFiltersProps) {
  void daysByPlayerKey // accepted so caller can pass; consumed by applyMapFilters below
  const players = useRosterStore((s) => s.players)
  const filtered = markerCount < totalCount
  const [open, setOpen] = useState(false)
  const [venueFocus, setVenueFocus] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const activeCount = countActiveFilters(state)

  // Venue typeahead — Kent types "Dayt" hoping for Daytona; the venue is
  // named "Jackie Robinson Ballpark", so raw substring match found nothing.
  // Suggest matching venue names as he types; picking one fills the filter.
  const venueQuery = state.search.trim().toLowerCase()
  const venueMatches = venueFocus && venueQuery.length >= 2
    ? venueNames.filter((v) => v.toLowerCase().includes(venueQuery)).slice(0, 8)
    : []

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

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
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
          activeCount > 0
            ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue'
            : 'border-border bg-gray-950/50 text-text-dim hover:text-text'
        }`}
        title="Tier, level, player, and venue filters — plus map color mode"
      >
        Filters
        {activeCount > 0 && (
          <span className="rounded-full bg-accent-blue/25 px-1.5 text-[10px] font-bold text-accent-blue">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-[360px] space-y-3 rounded-xl border border-border bg-surface p-3.5 shadow-xl">
          {/* Color-by mode (Kent's "color overdue guys" ask) */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Color by</span>
            {(['tier', 'heartbeat'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setState({ ...state, colorBy: mode })}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  state.colorBy === mode
                    ? 'bg-accent-blue/15 text-accent-blue'
                    : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
                }`}
                title={mode === 'tier' ? 'Color by player tier (T1 red, T2 orange, T3 gray)' : 'Color by Heartbeat overdue-ness'}
              >
                {mode === 'tier' ? 'Tier' : 'Heartbeat'}
              </button>
            ))}
          </div>

          {/* Quick toggles */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Show</span>
            <button
              onClick={() => setState({ ...state, overdueOnly: !state.overdueOnly })}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                state.overdueOnly ? 'bg-accent-red/15 text-accent-red' : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
              }`}
              title="Show only venues with at least one player overdue (>90d) or never visited"
            >
              Overdue only
            </button>
            <button
              onClick={() => setState({ ...state, drivableOnly: !state.drivableOnly })}
              className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                state.drivableOnly ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-dim/60 hover:text-text hover:bg-gray-800/50'
              }`}
              title="Hide venues outside the dashed drive-radius circle from your trip origin"
            >
              Drivable only
            </button>
          </div>

          {/* Tier pills — dots double as the legend in Tier color mode */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Tier</span>
            {[1, 2, 3, 4].map((t) => {
              const active = state.tiers.has(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleTier(t)}
                  className={`flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'bg-gray-800/60 text-text' : 'text-text-dim/40 line-through hover:text-text-dim'
                  }`}
                  title={TIER_LABEL[t]}
                >
                  {state.colorBy === 'tier' && (
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: TIER_COLORS[t] ?? TIER_COLORS[4]! }} />
                  )}
                  T{t}
                </button>
              )
            })}
          </div>

          {/* Level filters */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Level</span>
            {(['Pro', 'NCAA', 'HS'] as MapLevelFilter[]).map((l) => {
              const active = state.levels.has(l)
              return (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'bg-gray-800/60 text-text' : 'text-text-dim/40 line-through hover:text-text-dim'
                  }`}
                  title={`${levelCounts[l]} ${l} players in roster`}
                >
                  {l}
                </button>
              )
            })}
          </div>

          {/* Player picker (affirmative selection — Kent's 2026-06-08 ask) */}
          <div className="flex items-center gap-1.5">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Player</span>
            <PlayerSearchPicker
              value={state.selectedPlayer}
              players={players}
              placeholder="Find player..."
              onChange={(name) => setState({ ...state, selectedPlayer: name })}
              compact
            />
          </div>

          {/* Venue text search with typeahead over loaded venue names */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-text-dim/60">Venue</span>
            <div className="relative min-w-0 flex-1">
              <input
                type="text"
                value={state.search}
                onChange={(e) => setState({ ...state, search: e.target.value })}
                onFocus={() => setVenueFocus(true)}
                onBlur={() => setTimeout(() => setVenueFocus(false), 150)}
                placeholder="e.g. Bowman Field"
                className="w-full rounded-lg border border-border/40 bg-gray-950/40 px-2 py-1 text-[11px] text-text placeholder:text-text-dim/40 focus:outline-none focus:border-accent-blue/50"
              />
              {venueMatches.length > 0 && (
                <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
                  {venueMatches.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onMouseDown={() => setState({ ...state, search: v })}
                      className="block w-full truncate px-2.5 py-1.5 text-left text-[11px] text-text hover:bg-accent-blue/10 transition-colors"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer: count + clear */}
          <div className="flex items-center justify-between border-t border-border/30 pt-2 text-[10px] text-text-dim">
            <span>
              {markerCount} venue{markerCount !== 1 ? 's' : ''}
              {filtered && <span className="text-text-dim/40"> of {totalCount}</span>}
            </span>
            {activeCount > 0 && (
              <button
                onClick={() => setState({ ...DEFAULT_MAP_FILTERS, colorBy: state.colorBy })}
                className="text-accent-blue/80 hover:text-accent-blue underline-offset-2 hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}
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
