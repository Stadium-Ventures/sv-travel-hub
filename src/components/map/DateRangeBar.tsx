import { useTripStore } from '../../store/tripStore'

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
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const setHomeBase = useTripStore((s) => s.setHomeBase)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  const isPresetCity = STARTING_LOCATIONS.some((l) => l.name === homeBaseName)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-surface border border-border px-3 py-2">
      {/* Date range */}
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
        <button
          onClick={onUseTripDates}
          className="rounded bg-gray-950/50 border border-border px-2 py-1 text-[11px] text-accent-blue hover:text-accent-blue/80 transition-colors"
        >
          Use trip dates
        </button>
      </div>

      <span className="mx-1 text-text-dim/20">|</span>

      {/* Home base */}
      <select
        value={isPresetCity ? homeBaseName : '__custom__'}
        onChange={(e) => {
          const loc = STARTING_LOCATIONS.find((l) => l.name === e.target.value)
          if (loc) setHomeBase({ lat: loc.coords.lat, lng: loc.coords.lng }, loc.name)
        }}
        title="Where are you based? Drag the star on the map to set a custom location."
        className="rounded bg-gray-950/50 border border-border px-2 py-1 text-xs text-text"
      >
        {!isPresetCity && (
          <option value="__custom__">{homeBaseName}</option>
        )}
        {STARTING_LOCATIONS.map((loc) => (
          <option key={loc.name} value={loc.name}>{loc.name}</option>
        ))}
      </select>

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

      <span className="ml-auto text-[11px] text-text-dim whitespace-nowrap">
        {venueCount} venue{venueCount !== 1 ? 's' : ''} with games
      </span>
    </div>
  )
}
