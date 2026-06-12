import { useEffect, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout'

interface CitySuggestion {
  lat: number
  lng: number
  label: string  // friendly "City, State"
  display: string // full display_name from Nominatim
}

// Same presets as TripPlanner — keep in sync
const STARTING_LOCATIONS = [
  { name: 'Orlando, FL', coords: { lat: 28.5383, lng: -81.3792 } },
  { name: 'Denver, CO', coords: { lat: 39.7392, lng: -104.9903 } },
  { name: 'Phoenix, AZ', coords: { lat: 33.4484, lng: -112.0740 } },
  { name: 'Dallas, TX', coords: { lat: 32.7767, lng: -96.7970 } },
  { name: 'Atlanta, GA', coords: { lat: 33.7490, lng: -84.3880 } },
  { name: 'Nashville, TN', coords: { lat: 36.1627, lng: -86.7816 } },
  { name: 'Charlotte, NC', coords: { lat: 35.2271, lng: -80.8431 } },
  { name: 'Miami, FL', coords: { lat: 25.7617, lng: -80.1918 } },
  { name: 'Los Angeles, CA', coords: { lat: 34.0522, lng: -118.2437 } },
  { name: 'Chicago, IL', coords: { lat: 41.8781, lng: -87.6298 } },
  { name: 'New York, NY', coords: { lat: 40.7128, lng: -74.0060 } },
  { name: 'Houston, TX', coords: { lat: 29.7604, lng: -95.3698 } },
] as const

interface DateRangeBarProps {
  filterStart: string
  filterEnd: string
  setFilterStart: (v: string) => void
  setFilterEnd: (v: string) => void
  onNext7Days: () => void
  onNext30Days: () => void
  /** @deprecated date range is unified with Trip Planner now; retained for API compat */
  onUseTripDates?: () => void
  venueCount: number
}

export default function DateRangeBar({
  filterStart,
  filterEnd,
  setFilterStart,
  setFilterEnd,
  onNext7Days,
  onNext30Days,
  venueCount,
}: DateRangeBarProps) {
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  const isPresetCity = STARTING_LOCATIONS.some((l) => l.name === homeBaseName)

  const [customCity, setCustomCity] = useState('')
  const [cityLoading, setCityLoading] = useState(false)
  const [cityError, setCityError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const searchAbortRef = useRef<AbortController | null>(null)
  const suggestContainerRef = useRef<HTMLDivElement>(null)

  // Close suggestions when clicking outside
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (suggestContainerRef.current && !suggestContainerRef.current.contains(e.target as Node)) {
        setSuggestOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function selectSuggestion(s: CitySuggestion) {
    setHomeBase({ lat: s.lat, lng: s.lng }, s.label)
    setCustomCity('')
    setSuggestOpen(false)
    setSuggestions([])
  }

  // Debounced Nominatim autocomplete — Kent's 2026-06-08 ask:
  // "I don't know how to spell albuquerque reliably and was hoping for help."
  // Fires after 250ms of no typing, when query is >= 2 chars.
  useEffect(() => {
    const q = customCity.trim()
    if (q.length < 2) { setSuggestions([]); return }
    const handle = setTimeout(async () => {
      searchAbortRef.current?.abort()
      const ac = new AbortController()
      searchAbortRef.current = ac
      try {
        // NOTE: do NOT pass featuretype=city. Nominatim's featuretype filter
        // excludes large cities that OSM tags as administrative boundaries
        // (e.g. Albuquerque), so partial queries returned zero matches.
        // Instead we keep the query open and filter to populated places
        // client-side via address class/type.
        const params = new URLSearchParams({
          q, format: 'json', limit: '10', countrycodes: 'us,ca',
          addressdetails: '1', dedupe: '1',
        })
        const res = await fetchWithTimeout(
          `https://nominatim.openstreetmap.org/search?${params}`,
          { timeoutMs: 6000, headers: { 'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures)' }, signal: ac.signal },
        )
        if (!res.ok) return
        type NomResult = {
          lat: string; lon: string; display_name: string
          class?: string; type?: string
          address?: { city?: string; town?: string; village?: string; hamlet?: string; municipality?: string; county?: string; state?: string; country_code?: string }
        }
        const results = await res.json() as NomResult[]
        const mapped: CitySuggestion[] = results
          // Keep only populated places — drop streets, POIs, buildings, etc.
          // OSM class is usually 'place' for cities/towns; 'boundary' for
          // admin polygons we also accept (catches Albuquerque).
          .filter((r) => {
            if (r.class === 'place') return true
            if (r.class === 'boundary' && r.type === 'administrative') return true
            // Fallback: if address resolved to a city/town/municipality it counts.
            const a = r.address ?? {}
            return Boolean(a.city || a.town || a.village || a.municipality)
          })
          .map((r) => {
            const a = r.address ?? {}
            const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? r.display_name.split(',')[0]
            const state = a.state ?? ''
            const label = state ? `${city}, ${state}` : (city ?? '')
            return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), label, display: r.display_name }
          })
          .filter((s) => s.label && isFinite(s.lat) && isFinite(s.lng))
        // Dedupe by label
        const seen = new Set<string>()
        const unique = mapped.filter((s) => {
          const k = s.label.toLowerCase()
          if (seen.has(k)) return false
          seen.add(k); return true
        })
        setSuggestions(unique)
        setSuggestOpen(unique.length > 0)
      } catch { /* aborted or network — fail silent */ }
    }, 250)
    return () => clearTimeout(handle)
  }, [customCity])

  // Submit (Go button or Enter) — picks the top suggestion, or runs a direct
  // geocode if suggestions haven't loaded yet.
  async function handleCustomCity(e: React.FormEvent) {
    e.preventDefault()
    if (suggestions.length > 0) {
      selectSuggestion(suggestions[0]!)
      return
    }
    const q = customCity.trim()
    if (!q) return
    setCityLoading(true); setCityError(null)
    try {
      const params = new URLSearchParams({
        q, format: 'json', limit: '1', countrycodes: 'us,ca',
      })
      const res = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { timeoutMs: 8000, headers: { 'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures)' } },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const results = await res.json() as Array<{ lat: string; lon: string; display_name: string }>
      if (!results.length) {
        setCityError('No match — try "City, State"')
        return
      }
      const r = results[0]!
      const lat = parseFloat(r.lat)
      const lng = parseFloat(r.lon)
      const parts = r.display_name.split(',').map((s) => s.trim())
      const friendly = parts.length >= 3 ? `${parts[0]}, ${parts[parts.length - 3] ?? parts[1]}` : (parts[0] ?? q)
      setHomeBase({ lat, lng }, friendly)
      setCustomCity('')
    } catch (err) {
      setCityError(err instanceof Error ? err.message : 'Geocoding failed')
    } finally {
      setCityLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface border border-border px-3 py-2">
      {/* Date range — neither end may start in the past. The end picker is
          also clamped to start so the range stays non-empty. */}
      {(() => {
        const today = new Date().toISOString().slice(0, 10)
        return (
          <>
            <input
              type="date"
              value={filterStart}
              min={today}
              onChange={(e) => setFilterStart(e.target.value)}
              className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
            />
            <span className="text-text-dim text-xs">to</span>
            <input
              type="date"
              value={filterEnd}
              min={filterStart > today ? filterStart : today}
              onChange={(e) => setFilterEnd(e.target.value)}
              className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
            />
          </>
        )
      })()}

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

      {/* Starting from — single consolidated combobox. Shows current city as
          a chip; click to open a dropdown with a search field + preset cities
          and live Nominatim autocomplete. Replaces the prior "dropdown +
          separate type-a-city input" pair. Kent's 2026-06-08 ask. */}
      <div className="relative" ref={suggestContainerRef}>
        <label className="flex items-center gap-1.5">
          <span
            className="text-[10px] uppercase tracking-wide text-text-dim/60 cursor-help"
            title="The city your trips will start from. Drive radius is measured from here; flight times are estimated from here too. Dragging the star on the map updates this."
          >
            Trip origin
          </span>
          <button
            type="button"
            onClick={() => setSuggestOpen(!suggestOpen)}
            className="flex items-center gap-1.5 rounded border border-border bg-gray-950/50 px-2 py-1 text-xs text-text hover:border-accent-blue/40 transition-colors min-w-[160px]"
            title="Click to change starting city. Type any city or pick from common ones."
          >
            <span className="truncate flex-1 text-left">{homeBaseName}</span>
            <span className={`text-text-dim/60 text-[10px] transition-transform ${suggestOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>
        </label>

        {suggestOpen && (
          <div className="absolute left-0 top-full z-30 mt-1 w-[280px] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
            {/* Search input inside the dropdown */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (suggestions.length > 0) selectSuggestion(suggestions[0]!)
                else if (customCity.trim()) handleCustomCity(e)
              }}
              className="border-b border-border/40 p-2"
            >
              <input
                type="text"
                value={customCity}
                onChange={(e) => { setCustomCity(e.target.value); setCityError(null) }}
                placeholder="Type any city..."
                autoFocus
                autoComplete="off"
                className="w-full rounded border border-border/40 bg-gray-950/40 px-2 py-1 text-xs text-text placeholder:text-text-dim/40 focus:outline-none focus:border-accent-blue"
              />
              {cityError && <p className="mt-1 text-[10px] text-accent-red">{cityError}</p>}
            </form>

            <div className="max-h-[280px] overflow-y-auto">
              {/* Live Nominatim suggestions — shown when query has matches */}
              {suggestions.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50 bg-gray-950/40">
                    Matches
                  </div>
                  {suggestions.map((s, i) => (
                    <button
                      key={`sug-${s.label}-${i}`}
                      type="button"
                      onClick={() => selectSuggestion(s)}
                      className="block w-full px-3 py-1.5 text-left text-xs text-text hover:bg-accent-blue/10 transition-colors"
                      title={s.display}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Preset cities — always shown. Filter to matches of query when typing. */}
              <div>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50 bg-gray-950/40">
                  Common cities
                </div>
                {STARTING_LOCATIONS
                  .filter((loc) => !customCity.trim() || loc.name.toLowerCase().includes(customCity.trim().toLowerCase()))
                  .map((loc) => {
                    const isCurrent = loc.name === homeBaseName
                    return (
                      <button
                        key={loc.name}
                        type="button"
                        onClick={() => {
                          setHomeBase({ lat: loc.coords.lat, lng: loc.coords.lng }, loc.name)
                          setSuggestOpen(false)
                          setCustomCity('')
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-accent-blue/10 transition-colors ${
                          isCurrent ? 'bg-accent-blue/10 text-accent-blue font-medium' : 'text-text'
                        }`}
                      >
                        {loc.name}
                        {isCurrent && <span className="ml-1.5 text-[10px] text-accent-blue/70">· current</span>}
                      </button>
                    )
                  })}
                {customCity.trim() && STARTING_LOCATIONS.filter((loc) => loc.name.toLowerCase().includes(customCity.trim().toLowerCase())).length === 0 && (
                  <p className="px-3 py-1.5 text-[10px] text-text-dim/50 italic">No preset cities match — see live matches above or hit Enter.</p>
                )}
              </div>

              {/* Show non-preset current city at top when custom */}
              {!isPresetCity && !customCity.trim() && (
                <div className="border-t border-border/40">
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50 bg-gray-950/40">
                    Currently
                  </div>
                  <div className="px-3 py-1.5 text-xs text-accent-blue/80">
                    {homeBaseName} <span className="text-[10px] text-text-dim/50">· custom</span>
                  </div>
                </div>
              )}
            </div>

            {cityLoading && (
              <div className="border-t border-border/40 px-3 py-1.5 text-[10px] text-text-dim">Searching…</div>
            )}
          </div>
        )}
      </div>

      {/* Drive radius slider */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-dim whitespace-nowrap">{Math.floor(maxDriveMinutes / 60)}h drive</span>
        <input
          type="range"
          min={120}
          max={480}
          step={30}
          value={maxDriveMinutes}
          onChange={(e) => setMaxDriveMinutes(parseInt(e.target.value))}
          title="Adjust the drive radius circle on the map"
          className="h-1 w-16 cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
        />
      </div>

      <span className="ml-auto flex items-center gap-2 text-[11px] text-text-dim whitespace-nowrap">
        <span className="text-text-dim/50" title="Date range, drive radius, and starting city are shared between Map and Trip Planner. Change in either, both update.">
          synced w/ Trip Planner
        </span>
        <span>·</span>
        <span>{venueCount} venue{venueCount !== 1 ? 's' : ''} with games</span>
      </span>
    </div>
  )
}
