// Single combobox: shows current city, click to open a dropdown with
// search + preset list + live Nominatim autocomplete (US/Canada). Used in
// both the Map's DateRangeBar and the Trip Planner's "Starting From" so
// the behavior matches across surfaces.
//
// Kent's 2026-06-08 asks rolled in:
//   - "consolidate to one box" (was: dropdown + separate type-a-city input)
//   - "i don't know how to spell albuquerque" (live autocomplete)
//   - "give me custom cities too rather than fixed" (Nominatim US+CA)

import { useEffect, useRef, useState } from 'react'
import { fetchWithTimeout } from '../../lib/fetchWithTimeout'
import { MAJOR_AIRPORTS } from '../../data/airports'

export interface CityPreset {
  name: string
  coords: { lat: number; lng: number }
}

// Agents often fly in and start the trip AT the airport (Tom 2026-08-19),
// so every origin picker offers the major-airport list alongside cities.
// Searchable by IATA code ("mco") or city name; unfiltered view shows the
// biggest hubs (the list is roughly ordered by traffic).
const AIRPORT_PRESETS: CityPreset[] = MAJOR_AIRPORTS.map((a) => ({
  name: `${a.iata} — ${a.name}`,
  coords: { lat: a.lat, lng: a.lng },
}))

interface CitySuggestion {
  lat: number
  lng: number
  label: string
  display: string
}

interface CityPickerProps {
  /** Currently selected city name (preset name or "City, State" from geocoder) */
  value: string
  /** Called when user picks any city. label = display string. */
  onChange: (coords: { lat: number; lng: number }, label: string) => void
  presets: CityPreset[]
  /** Optional label rendered before the combobox button */
  label?: string
  /** Visual width hint for the button */
  buttonClass?: string
  /** Title/tooltip text on the button */
  title?: string
  /** Shown on the button while no city is set (value === ''). */
  placeholder?: string
  /** When provided AND a city is set, renders a small ✕ that unsets it. */
  onClear?: () => void
  /** Tooltip for the ✕ — say what clearing means on THIS surface. */
  clearTitle?: string
}

export default function CityPicker({
  value,
  onChange,
  presets,
  label,
  buttonClass = 'min-w-[180px]',
  title = 'Click to change starting city. Type any city or pick from common ones.',
  placeholder = 'Pick a city...',
  onClear,
  clearTitle = 'Clear the trip origin (removes the star and drive radius)',
}: CityPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isPreset = presets.some((p) => p.name === value) || AIRPORT_PRESETS.some((a) => a.name === value)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Debounced live autocomplete via Photon (komoot's OSM geocoder).
  // Nominatim /search is a full-name geocoder with NO prefix matching —
  // "philad" returned nothing and "phila" buried Philadelphia under
  // township alt-name matches (Kent + Tom, 2026-08-17). Photon is built
  // for search-as-you-type: prefix matching + importance ranking, so the
  // big city comes first. Enter-submit still geocodes via Nominatim below.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setSuggestions([]); return }
    const handle = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      try {
        const params = new URLSearchParams({ q, limit: '12', lang: 'en' })
        const res = await fetchWithTimeout(
          `https://photon.komoot.io/api/?${params}`,
          { timeoutMs: 6000, signal: ac.signal },
        )
        if (!res.ok) return
        type PhotonFeature = {
          geometry?: { coordinates?: [number, number] }
          properties?: {
            name?: string; state?: string; countrycode?: string
            osm_key?: string; osm_value?: string
          }
        }
        const data = await res.json() as { features?: PhotonFeature[] }
        const PLACE_VALUES = new Set(['city', 'town', 'village', 'borough', 'municipality', 'hamlet'])
        const mapped: CitySuggestion[] = (data.features ?? [])
          .filter((f) => {
            const p = f.properties ?? {}
            if (p.countrycode !== 'US' && p.countrycode !== 'CA') return false
            return p.osm_key === 'place' && PLACE_VALUES.has(p.osm_value ?? '')
          })
          .map((f) => {
            const p = f.properties!
            const [lng, lat] = f.geometry?.coordinates ?? [NaN, NaN]
            const labelText = p.state ? `${p.name}, ${p.state}` : (p.name ?? '')
            const country = p.countrycode === 'CA' ? 'Canada' : 'United States'
            return { lat, lng, label: labelText, display: `${labelText}, ${country}` }
          })
          .filter((s) => s.label && isFinite(s.lat) && isFinite(s.lng))
        const seen = new Set<string>()
        const unique = mapped.filter((s) => {
          const k = s.label.toLowerCase()
          if (seen.has(k)) return false
          seen.add(k); return true
        })
        setSuggestions(unique.slice(0, 8))
      } catch { /* aborted or network — silent */ }
    }, 250)
    return () => clearTimeout(handle)
  }, [query])

  function pickSuggestion(s: CitySuggestion) {
    onChange({ lat: s.lat, lng: s.lng }, s.label)
    setOpen(false); setQuery(''); setSuggestions([])
  }

  function pickPreset(p: CityPreset) {
    onChange({ lat: p.coords.lat, lng: p.coords.lng }, p.name)
    setOpen(false); setQuery('')
  }

  // Submit via Enter: pick top suggestion or geocode raw query
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (suggestions.length > 0) { pickSuggestion(suggestions[0]!); return }
    const q = query.trim()
    if (!q) return
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'us,ca' })
      const res = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?${params}`,
        { timeoutMs: 8000, headers: { 'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures)' } },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const results = await res.json() as Array<{ lat: string; lon: string; display_name: string }>
      if (!results.length) { setError('No match — try "City, State"'); return }
      const r = results[0]!
      const parts = r.display_name.split(',').map((s) => s.trim())
      const friendly = parts.length >= 3 ? `${parts[0]}, ${parts[parts.length - 3] ?? parts[1]}` : (parts[0] ?? q)
      onChange({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) }, friendly)
      setOpen(false); setQuery('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Geocoding failed')
    } finally {
      setLoading(false)
    }
  }

  const filteredPresets = !query.trim()
    ? presets
    : presets.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))

  // Airports: all 50 are searchable, but the unfiltered dropdown only shows
  // the top hubs so cities stay one scroll away.
  const filteredAirports = !query.trim()
    ? AIRPORT_PRESETS.slice(0, 8)
    : AIRPORT_PRESETS.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="relative" ref={containerRef}>
      <label className="flex items-center gap-1.5">
        {label && <span className="text-[10px] uppercase tracking-wide text-text-dim/60">{label}</span>}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={`flex items-center gap-1.5 rounded border border-border bg-gray-950/50 px-2 py-1 text-xs text-text hover:border-accent-blue/40 transition-colors ${buttonClass}`}
          title={title}
        >
          <span className={`truncate flex-1 text-left ${value ? '' : 'text-text-dim/50'}`}>{value || placeholder}</span>
          <span className={`text-text-dim/60 text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
        </button>
        {onClear && value && (
          <button
            type="button"
            onClick={() => { onClear(); setOpen(false); setQuery('') }}
            className="text-text-dim/50 hover:text-text text-xs px-0.5"
            title={clearTitle}
          >
            ✕
          </button>
        )}
      </label>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[280px] overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          <form onSubmit={handleSubmit} className="border-b border-border/40 p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setError(null) }}
              placeholder="Type any city..."
              autoFocus
              autoComplete="off"
              className="w-full rounded border border-border/40 bg-gray-950/40 px-2 py-1 text-xs text-text placeholder:text-text-dim/40 focus:outline-none focus:border-accent-blue"
            />
            {error && <p className="mt-1 text-[10px] text-accent-red">{error}</p>}
            {loading && <p className="mt-1 text-[10px] text-text-dim">Searching…</p>}
          </form>

          <div className="max-h-[280px] overflow-y-auto">
            {suggestions.length > 0 && (
              <div>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50 bg-gray-950/40">
                  Matches
                </div>
                {suggestions.map((s, i) => (
                  <button
                    key={`sug-${s.label}-${i}`}
                    type="button"
                    onClick={() => pickSuggestion(s)}
                    className="block w-full px-3 py-1.5 text-left text-xs text-text hover:bg-accent-blue/10 transition-colors"
                    title={s.display}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {(filteredPresets.length > 0 || filteredAirports.length === 0) && (
            <div>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50 bg-gray-950/40">
                Common cities
              </div>
              {filteredPresets.length === 0 ? (
                <p className="px-3 py-1.5 text-[10px] text-text-dim/50 italic">No preset cities match — see live matches above or hit Enter.</p>
              ) : filteredPresets.map((p) => {
                const isCurrent = p.name === value
                return (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => pickPreset(p)}
                    className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-accent-blue/10 transition-colors ${
                      isCurrent ? 'bg-accent-blue/10 text-accent-blue font-medium' : 'text-text'
                    }`}
                  >
                    {p.name}
                    {isCurrent && <span className="ml-1.5 text-[10px] text-accent-blue/70">· current</span>}
                  </button>
                )
              })}
            </div>
            )}

            {filteredAirports.length > 0 && (
              <div>
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50 bg-gray-950/40">
                  Airports{!query.trim() ? ' · type a code or city to search all' : ''}
                </div>
                {filteredAirports.map((a) => {
                  const isCurrent = a.name === value
                  return (
                    <button
                      key={a.name}
                      type="button"
                      onClick={() => pickPreset(a)}
                      className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-accent-blue/10 transition-colors ${
                        isCurrent ? 'bg-accent-blue/10 text-accent-blue font-medium' : 'text-text'
                      }`}
                      title={`Start from ${a.name} — useful when you're flying in`}
                    >
                      {a.name}
                      {isCurrent && <span className="ml-1.5 text-[10px] text-accent-blue/70">· current</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {value !== '' && !isPreset && !query.trim() && (
              <div className="border-t border-border/40">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-dim/50 bg-gray-950/40">
                  Currently
                </div>
                <div className="px-3 py-1.5 text-xs text-accent-blue/80">
                  {value} <span className="text-[10px] text-text-dim/50">· custom</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
