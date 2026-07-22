import type { ReactNode } from 'react'

// Toolbar: date range + presets, with a right-aligned slot for the Filters
// and help popovers. The trip-origin picker and drive-radius slider were
// scrapped 2026-07-22 (Tom: "assume the user is in the area — they know to
// book a flight if they need to fly").

interface DateRangeBarProps {
  filterStart: string
  filterEnd: string
  setFilterStart: (v: string) => void
  setFilterEnd: (v: string) => void
  onNext7Days: () => void
  onNext30Days: () => void
  /** @deprecated date range is unified with Trip Planner now; retained for API compat */
  onUseTripDates?: () => void
  /** Right-aligned toolbar slot — MapView injects the Filters popover and
   *  help button here so the map has ONE toolbar. */
  children?: ReactNode
}

export default function DateRangeBar({
  filterStart,
  filterEnd,
  setFilterStart,
  setFilterEnd,
  onNext7Days,
  onNext30Days,
  children,
}: DateRangeBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface border border-border/50 px-3 py-2">
      {/* NOTE: no `min` clamp and an empty-value guard — with min set,
          typing a month digit-by-digit produced transient out-of-range
          values that the browser reported as "", which our onChange wrote
          back and wiped the field. Past dates self-heal on reload. */}
      <input
        type="date"
        value={filterStart}
        onChange={(e) => { if (e.target.value) setFilterStart(e.target.value) }}
        className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
      />
      <span className="text-text-dim text-xs">to</span>
      <input
        type="date"
        value={filterEnd}
        onChange={(e) => { if (e.target.value) setFilterEnd(e.target.value) }}
        className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
      />

      <div className="flex gap-1">
        <button
          onClick={onNext7Days}
          className="rounded bg-gray-950/50 border border-border px-2 py-1 text-[11px] text-text-dim hover:text-text transition-colors"
        >
          Next 7 days
        </button>
        <button
          onClick={onNext30Days}
          className="rounded bg-gray-950/50 border border-border px-2 py-1 text-[11px] text-text-dim hover:text-text transition-colors"
        >
          Next 30 days
        </button>
      </div>

      <span className="ml-auto flex items-center gap-2 text-[11px] text-text-dim whitespace-nowrap">
        {children}
        <span className="text-text-dim/50" title="The date range is shared between Map and Trip Planner. Change in either, both update.">
          synced w/ Trip Planner
        </span>
      </span>
    </div>
  )
}
