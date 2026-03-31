interface DateRangeBarProps {
  filterStart: string
  filterEnd: string
  setFilterStart: (v: string) => void
  setFilterEnd: (v: string) => void
  onNext7Days: () => void
  onNext30Days: () => void
  onUseTripDates: () => void
  venueCount: number
}

export default function DateRangeBar({
  filterStart,
  filterEnd,
  setFilterStart,
  setFilterEnd,
  onNext7Days,
  onNext30Days,
  onUseTripDates,
  venueCount,
}: DateRangeBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface border border-border px-3 py-2">
      <input
        type="date"
        value={filterStart}
        onChange={(e) => setFilterStart(e.target.value)}
        className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
      />
      <span className="text-text-dim text-xs">to</span>
      <input
        type="date"
        value={filterEnd}
        onChange={(e) => setFilterEnd(e.target.value)}
        className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
      />

      <div className="flex gap-1 ml-1">
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
        <button
          onClick={onUseTripDates}
          className="rounded bg-gray-950/50 border border-border px-2 py-1 text-[11px] text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          Use trip dates
        </button>
      </div>

      <span className="ml-auto text-[11px] text-text-dim whitespace-nowrap">
        {venueCount} venue{venueCount !== 1 ? 's' : ''} with games
      </span>
    </div>
  )
}
