import { useState } from 'react'
import type { DestinationPick } from './hooks/useDestinationPicks'
import { useTripStore } from '../../store/tripStore'
import { dispatchMapEvent } from '../../lib/mapEvents'

const TIER_DOT_COLORS: Record<number, string> = { 1: 'bg-[#ef4444]', 2: 'bg-[#f97316]', 3: 'bg-gray-500' }

/**
 * Destination-anchored recommendation panel. Lists the top N cities (or
 * regions) Kent could go to in the current date window, ranked by
 * tier-weighted player coverage. Click a row → set as From + jump to
 * Trip Planner.
 *
 * Complements Best Windows. Best Windows answers "WHEN" assuming WHERE
 * (homeBase + drive radius). This panel answers "WHERE" assuming WHEN
 * (current date range). They use the same tier weights and player set.
 */
export default function WhereToGoPanel({ picks }: { picks: DestinationPick[] }) {
  // Open by default on desktop; collapsed on small screens so the map
  // (rendered first there) stays the star of the tab.
  const [open, setOpen] = useState(() => {
    try { return window.matchMedia('(min-width: 1024px)').matches } catch { return true }
  })
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)

  const topPick = picks[0]

  function applyDestination(p: DestinationPick) {
    setHomeBase(p.centroid, p.label)
    dispatchMapEvent('app:switch-tab', { tab: 'trips' })
    setTimeout(() => {
      useTripStore.getState().generateTrips().catch((e) => console.warn('[where-to-go] auto-generate failed:', e))
    }, 100)
  }

  return (
    <div className="rounded-lg bg-surface border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm font-semibold text-text hover:text-accent-blue transition-colors"
        >
          <span className={`text-text-dim transition-transform text-xs ${open ? 'rotate-90' : ''}`}>&#9654;</span>
          Where to go?
          {topPick && (
            <span className="text-xs font-normal text-text-dim ml-1">
              — Top: {topPick.label}, {topPick.players.length} players
            </span>
          )}
        </button>
        <span className="text-[10px] text-text-dim/60 italic">
          The best <strong className="text-text-dim/80">city</strong> to fly/drive to — searches the whole US, ignores your drive radius. (Best Windows answers <em>when</em>; this answers <em>where</em>.)
        </span>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {picks.length === 0 ? (
            <p className="text-xs text-text-dim">No reachable SV players anywhere in this date range. Try a wider window.</p>
          ) : (
            picks.map((p, i) => {
              const drivableFromHome = p.drivable
              const driveH = Math.floor(p.driveFromHomeMin / 60)
              const driveM = Math.round(p.driveFromHomeMin % 60)
              const driveLabel = driveH > 0 ? `${driveH}h${driveM > 0 ? ` ${driveM}m` : ''}` : `${driveM}m`
              const flightLabel = `${p.flightHoursFromHome.toFixed(1)}h flight`
              return (
                <div
                  key={`${p.centroid.lat},${p.centroid.lng}`}
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 border ${
                    i === 0 ? 'border-accent-blue/30 bg-accent-blue/5' : 'border-border/30 bg-gray-950/30'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {i === 0 && (
                        <span className="rounded-full bg-accent-blue/20 px-2 py-0.5 text-[10px] font-bold text-accent-blue">
                          BEST
                        </span>
                      )}
                      <span className="text-sm font-medium text-text">{p.label}</span>
                      <span className="text-[10px] text-text-dim/60">
                        from {homeBaseName}: {drivableFromHome ? `🚗 ${driveLabel}` : `✈️ ${flightLabel}`}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-text-dim">{p.players.length} player{p.players.length === 1 ? '' : 's'}</span>
                      {p.t1Count > 0 && (
                        <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[1]}`} />
                          {p.t1Count} T1
                        </span>
                      )}
                      {p.t2Count > 0 && (
                        <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[2]}`} />
                          {p.t2Count} T2
                        </span>
                      )}
                      {p.t3Count > 0 && (
                        <span className="flex items-center gap-0.5 text-[11px] text-text-dim">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${TIER_DOT_COLORS[3]}`} />
                          {p.t3Count} T3
                        </span>
                      )}
                      <span className="text-[10px] text-text-dim/40">· {p.venueCount} venue{p.venueCount === 1 ? '' : 's'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.players.slice(0, 8).map((pl) => (
                        <span key={pl.name} className="text-[10px] text-text-dim/70">
                          <span className={`inline-block h-1 w-1 rounded-full ${TIER_DOT_COLORS[pl.tier] ?? 'bg-gray-600'} mr-0.5`} />
                          {pl.name}
                        </span>
                      ))}
                      {p.players.length > 8 && (
                        <span className="text-[10px] text-text-dim/40">+{p.players.length - 8} more</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => applyDestination(p)}
                    className="ml-3 shrink-0 rounded-lg bg-accent-blue/15 px-3 py-1.5 text-[11px] font-medium text-accent-blue hover:bg-accent-blue/25 transition-colors"
                    title={`Set ${p.label} as the trip origin and generate trips`}
                  >
                    Go here →
                  </button>
                </div>
              )
            })
          )}
          {picks.length > 0 && (
            <p className="text-[10px] text-text-dim/40 mt-1">
              Each destination clusters every SV venue within a 3h drive. Tier-weighted (T1=5, T2=3, T3=1). Flight time = great-circle / 500 mph + 1h overhead.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
