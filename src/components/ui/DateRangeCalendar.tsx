// Calendar range picker (Tom 2026-08-18: "click on this and pull up a
// calendar view for each month to see day of the week too"). One button
// showing the current range; clicking opens a month grid with weekday
// headers. Click a day to start the range, click a second day to finish
// (an earlier second click restarts). Past days are disabled — the store
// clamps them anyway. Tuesday column is accented (Kent's MiLB rule:
// Tuesdays are the best visit day for position players).

import { useEffect, useRef, useState } from 'react'
import { formatDate } from '../../lib/formatters'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function todayISO(): string {
  return new Date().toISOString().split('T')[0]!
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export default function DateRangeCalendar({
  start,
  end,
  onChange,
  buttonClass = '',
}: {
  start: string
  end: string
  /** Called once with BOTH ends when the second day is clicked. */
  onChange: (start: string, end: string) => void
  buttonClass?: string
}) {
  const [open, setOpen] = useState(false)
  // First click of an in-progress selection; null = nothing pending
  const [pending, setPending] = useState<string | null>(null)
  // Displayed month, from the current range start
  const [viewYear, setViewYear] = useState(() => parseInt(start.slice(0, 4), 10))
  const [viewMonth, setViewMonth] = useState(() => parseInt(start.slice(5, 7), 10) - 1)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) { setOpen(false); setPending(null) }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function openCalendar() {
    // Re-sync the visible month to the current range every open
    setViewYear(parseInt(start.slice(0, 4), 10))
    setViewMonth(parseInt(start.slice(5, 7), 10) - 1)
    setPending(null)
    setOpen((v) => !v)
  }

  function nav(delta: number) {
    const m = viewMonth + delta
    setViewYear(viewYear + Math.floor(m / 12))
    setViewMonth(((m % 12) + 12) % 12)
  }

  function pickDay(iso: string) {
    if (!pending) {
      setPending(iso)
      return
    }
    if (iso < pending) {
      // Clicked earlier than the pending start — restart from here
      setPending(iso)
      return
    }
    onChange(pending, iso)
    setPending(null)
    setOpen(false)
  }

  const today = todayISO()
  const firstDow = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay()
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate()
  const cells: Array<number | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={openCalendar}
        className={`flex items-center gap-1.5 rounded border border-border bg-gray-950/50 px-2.5 py-1 text-xs text-text hover:border-accent-blue/40 transition-colors ${buttonClass}`}
        title="Open a calendar to pick the date range and see days of the week"
      >
        {formatDate(start)} to {formatDate(end)}
        <span className={`text-text-dim/60 text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[260px] rounded-xl border border-border bg-surface p-2.5 shadow-xl">
          {/* Month header + nav */}
          <div className="mb-1.5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => nav(-1)}
              className="rounded px-2 py-0.5 text-sm text-text-dim hover:text-text hover:bg-gray-800/60 transition-colors"
              title="Previous month"
            >
              ‹
            </button>
            <span className="text-xs font-semibold text-text">{MONTHS[viewMonth]} {viewYear}</span>
            <button
              type="button"
              onClick={() => nav(1)}
              className="rounded px-2 py-0.5 text-sm text-text-dim hover:text-text hover:bg-gray-800/60 transition-colors"
              title="Next month"
            >
              ›
            </button>
          </div>

          {/* Weekday header — Tuesday accented (best MiLB visit day) */}
          <div className="grid grid-cols-7 text-center">
            {WEEKDAYS.map((d) => (
              <span key={d} className={`py-0.5 text-[10px] font-semibold uppercase ${d === 'Tu' ? 'text-accent-blue' : 'text-text-dim/50'}`}>
                {d}
              </span>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              if (d === null) return <span key={`pad-${i}`} />
              const iso = toISO(viewYear, viewMonth, d)
              const past = iso < today
              const isEdge = pending ? iso === pending : (iso === start || iso === end)
              const inRange = !pending && iso > start && iso < end
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={past}
                  onClick={() => pickDay(iso)}
                  className={`h-7 rounded text-xs transition-colors ${
                    past
                      ? 'cursor-not-allowed text-text-dim/20'
                      : isEdge
                        ? 'bg-accent-blue font-semibold text-white'
                        : inRange
                          ? 'bg-accent-blue/15 text-text'
                          : 'text-text hover:bg-gray-800/60'
                  }`}
                  title={iso === today ? 'Today' : undefined}
                >
                  {d}
                </button>
              )
            })}
          </div>

          <p className="mt-1.5 border-t border-border/30 pt-1.5 text-[10px] text-text-dim/60">
            {pending
              ? `Start: ${formatDate(pending)}. Now pick the end date.`
              : 'Click a start date, then an end date.'}
          </p>
        </div>
      )}
    </div>
  )
}
