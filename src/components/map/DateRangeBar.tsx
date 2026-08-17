import { useState, type ReactNode } from 'react'
import { useTripStore } from '../../store/tripStore'
import CityPicker from '../ui/CityPicker'
import { STARTING_LOCATIONS } from '../../data/cityPresets'

function todayISO(): string {
  return new Date().toISOString().split('T')[0]!
}

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
   *  help button here so the map has ONE toolbar (2026-07-21 apple-fy). */
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
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)

  // In-progress typing for the date inputs — see the comment at the inputs.
  const [draftStart, setDraftStart] = useState<string | null>(null)
  const [draftEnd, setDraftEnd] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-surface border border-border/50 px-3 py-2">
      {/* Date range.
          Draft-buffered: the store setters clamp past dates to today on
          EVERY change, but typing "10"/"11"/"12" in the month segment
          passes through a past month on the first keystroke ("1" = Jan),
          and the clamp re-rendered the input back to today, wiping the
          second digit (couldn't reach Oct–Dec, Tom 2026-08-11 — same
          family as the 2026-07-22 `min`-clamp wipe). So while typing, the
          input shows the raw draft; the store only receives valid non-past
          dates live, and blur commits (and clamps) whatever is left. */}
      <input
        type="date"
        value={draftStart ?? filterStart}
        onChange={(e) => {
          const v = e.target.value
          setDraftStart(v || null)
          if (v && v >= todayISO()) setFilterStart(v)
        }}
        onBlur={() => {
          if (draftStart) setFilterStart(draftStart)
          setDraftStart(null)
        }}
        className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
      />
      <span className="text-text-dim text-xs">to</span>
      <input
        type="date"
        value={draftEnd ?? filterEnd}
        onChange={(e) => {
          const v = e.target.value
          setDraftEnd(v || null)
          if (v && v >= todayISO()) setFilterEnd(v)
        }}
        onBlur={() => {
          if (draftEnd) setFilterEnd(draftEnd)
          setDraftEnd(null)
        }}
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

      <span className="mx-1 text-text-dim/20">|</span>

      {/* Starting from — the SHARED CityPicker combobox (Photon-backed
          autocomplete). This bar previously carried its own near-identical
          fork still on Nominatim, so the "philad → nothing" prefix-search
          fix never reached the Map toolbar (Tom 2026-08-17). One component,
          one behavior, both surfaces. */}
      <CityPicker
        value={homeBaseName}
        onChange={(coords, cityLabel) => setHomeBase(coords, cityLabel)}
        presets={[...STARTING_LOCATIONS]}
        label="Trip origin"
        buttonClass="min-w-[160px]"
        title="The city your trips will start from. Drive radius is measured from here. Dragging the star on the map updates this. Type any city or pick from common ones."
      />


      {/* Right-aligned slot: Filters popover + help, injected by MapView so
          the map has a single toolbar. */}
      <span className="ml-auto flex items-center gap-2 text-[11px] text-text-dim whitespace-nowrap">
        {children}
        <span className="text-text-dim/50" title="Date range, drive radius, and starting city are shared between Map and Trip Planner. Change in either, both update.">
          synced w/ Trip Planner
        </span>
      </span>
    </div>
  )
}
