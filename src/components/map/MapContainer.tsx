import { useEffect, useRef, useState } from 'react'
// Static CSS import — bundled by Vite so the map never depends on unpkg.com
// being reachable. Previously a <link> to unpkg was injected at runtime which
// could hang the init flow if the CDN was slow.
import 'leaflet/dist/leaflet.css'
// Marker-cluster CSS is safe to import statically (no window.L dependency). The
// plugin JS itself is loaded dynamically in init() AFTER window.L is set — a
// static plugin import gets hoisted ahead of that and breaks under Vite.
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { useTripStore } from '../../store/tripStore'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useTimeStore } from '../../store/timeStore'
import { dispatchMapEvent, addMapEventListener } from '../../lib/mapEvents'
import { injectMapStyles } from './mapStyles'
import { buildVenuePopupHtml } from './VenuePopup'
import { TIER_COLORS } from './hooks/useTierMarkers'
import type { TierMarker } from './hooks/useTierMarkers'
import type { TripCandidate, DoubleUp } from '../../types/schedule'
import { heartbeatColorFor, type MapColorMode } from './MapFilters'
import { estimateDriveMinutes } from '../../lib/tripEngine'
import { formatDriveTime } from '../../lib/formatters'
import type { EventMarker } from './hooks/useEventMarkers'

/** Straight-line miles — for the click-and-drag measure readout. */
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const km = 6371 * 2 * Math.asin(Math.sqrt(
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2,
  ))
  return km * 0.621371
}

function measureLabelHtml(fromName: string, toName: string | null, miles: number, driveMin: number): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const dest = toName ? esc(toName) : 'dropped point'
  return `<div style="background:rgba(15,23,42,0.92);border:1px solid rgba(96,165,250,0.5);border-radius:6px;padding:4px 8px;font-family:system-ui,sans-serif;font-size:11px;color:#f1f5f9;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.5);transform:translate(14px,-50%);pointer-events:none">`
    + `<div style="color:#94a3b8">${esc(fromName)} to ${dest}</div>`
    + `<div style="font-weight:700">${Math.round(miles)} mi <span style="color:#60a5fa">· ${formatDriveTime(driveMin)} est. drive</span></div>`
    + `</div>`
}


// Nearest preset city name for a dragged custom location
const STARTING_LOCATIONS = [
  { name: 'Orlando, FL', lat: 28.5383, lng: -81.3792 },
  { name: 'Denver, CO', lat: 39.7392, lng: -104.9903 },
  { name: 'Phoenix, AZ', lat: 33.4484, lng: -112.0740 },
  { name: 'Dallas, TX', lat: 32.7767, lng: -96.7970 },
  { name: 'Atlanta, GA', lat: 33.7490, lng: -84.3880 },
  { name: 'Nashville, TN', lat: 36.1627, lng: -86.7816 },
  { name: 'Charlotte, NC', lat: 35.2271, lng: -80.8431 },
  { name: 'Miami, FL', lat: 25.7617, lng: -80.1918 },
  { name: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  { name: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
  { name: 'New York, NY', lat: 40.7128, lng: -74.0060 },
  { name: 'Houston, TX', lat: 29.7604, lng: -95.3698 },
]

function nearestCityLabel(lat: number, lng: number): string {
  let best = STARTING_LOCATIONS[0]!
  let bestDist = Infinity
  for (const loc of STARTING_LOCATIONS) {
    const d = (loc.lat - lat) ** 2 + (loc.lng - lng) ** 2
    if (d < bestDist) { bestDist = d; best = loc }
  }
  // If within ~50 miles (~0.7 deg) of a preset, use its name
  if (bestDist < 0.5) return best.name
  return `Custom (near ${best.name})`
}

/** Reverse geocode lat/lng → "City, ST" via Nominatim. Returns null on any
 *  error so the caller can keep the optimistic preset-proximity label. */
async function reverseGeocodeLabel(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=10`
    const res = await fetch(url, { headers: { 'User-Agent': 'SVTravelHub/1.0 (Stadium Ventures)' } })
    if (!res.ok) return null
    const data = await res.json() as { address?: { city?: string; town?: string; village?: string; municipality?: string; county?: string; state?: string } }
    const a = data.address ?? {}
    const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county
    const state = a.state
    if (!city) return null
    // US state names → 2-letter abbreviation for compactness.
    const ab = US_STATE_ABBR[(state ?? '').toLowerCase()] ?? state ?? ''
    return ab ? `${city}, ${ab}` : city
  } catch {
    return null
  }
}

const US_STATE_ABBR: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
}

interface MapContainerProps {
  tierMarkers: TierMarker[]
  colorBy: MapColorMode
  /** Non-game events (Combine, showcases) SV travels to — rendered as distinct
   *  pins so Kent can see "who's where" alongside player venues. */
  eventMarkers?: EventMarker[]
  /** When set, map auto-fits bounds to the visible tierMarkers (so picking
   *  a player jumps to wherever he is — "find him for me"). */
  fitToMarkersKey?: string
  /** Double-up overlay — connector lines between paired venues (green ≤45min,
   *  yellow 46–90min, orange 91min–2h drive, dashed = overnight) and ×2 badges on head-to-head
   *  venues. Populated only while the Suggestions panel's Double Ups tab is
   *  active so the map stays clean otherwise. */
  doubleUps?: DoubleUp[]
  /** Index into doubleUps to zoom/highlight ("Show on map"). */
  selectedDoubleUp?: number | null
}

export default function MapContainer({ tierMarkers, colorBy, eventMarkers = [], fitToMarkersKey, doubleUps = [], selectedDoubleUp = null }: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<import('leaflet').Map | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const clusterGroupRef = useRef<import('leaflet').LayerGroup | null>(null)
  const eventLayerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const homeMarkerRef = useRef<import('leaflet').Marker | null>(null)
  const radiusCircleRef = useRef<import('leaflet').Circle | null>(null)
  const tripHighlightRef = useRef<import('leaflet').LayerGroup | null>(null)
  const doubleUpLayerRef = useRef<import('leaflet').LayerGroup | null>(null)
  // Click-and-hold measure tool (Tom 2026-08-18: drag from a venue to
  // another venue/point → miles + est. drive). The finished measurement
  // stays on the map until the next map interaction or a new measure.
  const measureLayerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const measureActiveRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [initStatus, setInitStatus] = useState('Initializing map...')

  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const selectedTripIndex = useTripStore((s) => s.selectedTripIndex)
  const tripPlan = useTripStore((s) => s.tripPlan)
  const mapFocus = useTripStore((s) => s.mapFocus)
  // Heartbeat-driven coloring requires looking up each marker's players'
  // days-since-visit values. Subscribing to .players ensures the map repaints
  // when heartbeat data refreshes.
  const heartbeatPlayers = useHeartbeatStore((s) => s.players)
  const timeMode = useTimeStore((s) => s.mode)
  const dragOriginRef = useRef(false) // suppress map re-center after drag

  // Initialize Leaflet. The cleanup function tears down any map instance so
  // that React StrictMode's double-mount in dev doesn't leak a dead init.
  useEffect(() => {
    // Already have a live map — nothing to do (e.g. tab switch back and forth)
    if (mapInstance.current) return

    let cancelled = false

    async function init() {
      try {
      setInitStatus('Loading Leaflet...')
      const L = await import('leaflet')
      if (cancelled) return
      leafletRef.current = L

      // MarkerCluster is a UMD plugin that augments L via window.L. Set it,
      // THEN dynamically import the plugin (sequential, so window.L exists when
      // it runs). Wrapped so a plugin load failure degrades to un-clustered
      // markers instead of breaking the whole map.
      // Plugin augments the underlying default object — point window.L at it
      // (not the ESM namespace) so the runtime-added markerClusterGroup sticks.
      ;(window as any).L = (L as any).default ?? L
      try {
        await import('leaflet.markercluster')
      } catch (e) {
        console.warn('[map] markercluster plugin failed to load — markers will not cluster', e)
      }
      if (cancelled) return

      // Custom styles (Leaflet CSS is statically imported above)
      injectMapStyles()

      if (cancelled || !mapRef.current) return

      setInitStatus('Creating map...')
      const map = L.map(mapRef.current).setView([37.8, -96.9], 4)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }).addTo(map)

      // Popup click handler — delegate clicks on player name spans
      map.on('popupopen', (e: import('leaflet').PopupEvent) => {
        const container = e.popup.getElement()
        if (!container) return

        container.addEventListener('click', (evt: Event) => {
          const target = evt.target as HTMLElement
          const scheduleEl = target.closest('[data-action="schedule"]') as HTMLElement | null
          if (scheduleEl) {
            const playerName = scheduleEl.dataset.player
            if (playerName) {
              dispatchMapEvent('map:open-schedule', { player: playerName })
              map.closePopup()
              return
            }
          }
          const planEl = target.closest('[data-action="plan-trip"]') as HTMLElement | null
          if (planEl) {
            const raw = planEl.dataset.players ?? ''
            const players = raw.split('||').filter(Boolean)
            if (players.length > 0) {
              // Seed Priority Players on the trip store. Matches TripPlanner's
              // 5-slot UI (Kent interview 2026-06-08: "if I select five players...").
              // No setHomeBase — the origin is user-owned (Tom 2026-08-18:
              // only the picker and star-drag move it); the trip engine
              // anchors itself at the first priority player's earliest game.
              useTripStore.getState().setPriorityPlayers(players.slice(0, 5))
              dispatchMapEvent('app:switch-tab', { tab: 'trips' })
              window.scrollTo({ top: 0 })
              map.closePopup()
            }
          }
        })
      })

      // A finished measurement clears on the next map interaction (pan or
      // click) — marker mousedowns don't reach here, so starting a NEW
      // measure from a dot won't wipe itself.
      map.on('mousedown', () => {
        if (measureActiveRef.current) return
        if (measureLayerRef.current) {
          map.removeLayer(measureLayerRef.current)
          measureLayerRef.current = null
        }
      })

      mapInstance.current = map
      setInitStatus('')
      setLoaded(true)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('Map init failed:', err)
        setInitError(msg)
        setInitStatus('')
      }
    }

    init()
    return () => {
      cancelled = true
      // Tear down map so the next mount can re-init cleanly. This makes the
      // StrictMode double-effect pair work: first cycle init+teardown, second
      // cycle init succeeds.
      if (mapInstance.current) {
        mapInstance.current.remove()
        mapInstance.current = null
      }
      if (clusterGroupRef.current) clusterGroupRef.current = null
      if (eventLayerRef.current) eventLayerRef.current = null
      if (homeMarkerRef.current) homeMarkerRef.current = null
      if (radiusCircleRef.current) radiusCircleRef.current = null
      if (tripHighlightRef.current) tripHighlightRef.current = null
      if (doubleUpLayerRef.current) doubleUpLayerRef.current = null
      if (measureLayerRef.current) measureLayerRef.current = null
      setLoaded(false)
    }
  }, [])

  // Fit the viewport to an explicit set of points — fired by "Go here" so
  // the whole destination cluster is visible instead of a tight recenter
  // at whatever zoom the user happened to be on.
  useEffect(() => {
    if (!loaded) return
    return addMapEventListener('map:fit-points', ({ points }) => {
      const L = leafletRef.current
      const map = mapInstance.current
      if (!L || !map || points.length === 0) return
      dragOriginRef.current = true // suppress the homeBase-change recenter
      // Regional zoom, not street zoom — Kent needs to see the surrounding
      // venues after "Go here", not one block of a city (Tom 2026-07-22)
      if (points.length === 1) {
        map.setView(L.latLng(points[0]!.lat, points[0]!.lng), 7, { animate: true })
      } else {
        const bounds = L.latLngBounds(points.map((p) => L.latLng(p.lat, p.lng)))
        map.fitBounds(bounds, { padding: [90, 90], maxZoom: 7, animate: true })
      }
    })
  }, [loaded])

  // Fly to a point — typing a Trip Origin should take you there (the star
  // already moves with homeBase; the viewport now follows too).
  useEffect(() => {
    if (!loaded) return
    return addMapEventListener('map:fly-to', ({ lat, lng, zoom }) => {
      const L = leafletRef.current
      const map = mapInstance.current
      if (!L || !map) return
      dragOriginRef.current = true // suppress the homeBase-change recenter
      map.setView(L.latLng(lat, lng), zoom ?? 7, { animate: true })
    })
  }, [loaded])

  // One-click zoom back out to the whole US (Tom 2026-08-17: "instead of
  // having to minus minus minus minus and move things around").
  useEffect(() => {
    if (!loaded) return
    return addMapEventListener('map:reset-view', () => {
      const L = leafletRef.current
      const map = mapInstance.current
      if (!L || !map) return
      map.fitBounds(L.latLngBounds(L.latLng(24.5, -125), L.latLng(49.5, -66.5)), { animate: true })
    })
  }, [loaded])

  // Update home base marker + drive radius circle when homeBase changes
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstance.current

    // Remove old
    if (homeMarkerRef.current) { map.removeLayer(homeMarkerRef.current); homeMarkerRef.current = null }
    if (radiusCircleRef.current) { map.removeLayer(radiusCircleRef.current); radiusCircleRef.current = null }

    // No origin set — no star, no radius circle (Tom 2026-08-18: neither
    // exists until the user enables the origin filter).
    if (!homeBase) return

    // Home base star marker — draggable. Anchored at its BOTTOM TIP so the
    // star floats just above the location: when the star sits ON a venue
    // (every "Show on map"/plan action moves it onto the anchor venue), the
    // venue's dot stays visible underneath instead of being covered (Tom
    // 2026-07-22: "why are there no visible dots?" — the star was on top).
    const starIcon = L.divIcon({
      className: '',
      html: `<div style="font-size:22px;text-shadow:0 0 6px rgba(0,0,0,0.7);line-height:1;color:#fbbf24;cursor:grab" title="Drag to move home base">&#9733;</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 26],
    })
    homeMarkerRef.current = L.marker([homeBase.lat, homeBase.lng], {
      icon: starIcon,
      zIndexOffset: 400,
      draggable: true,
    })
      .addTo(map)
      .bindPopup(`<div style="font-family:system-ui;font-size:12px;color:#f1f5f9"><strong>${homeBaseName}</strong><br/>Home Base · Drag to move</div>`)

    // Update store when marker is dragged to a new position. Set an
    // optimistic label immediately (preset proximity), then upgrade it via
    // Nominatim reverse geocode so "Custom (near Atlanta, GA)" becomes the
    // actual nearest city like "Columbus, GA" once the lookup returns.
    homeMarkerRef.current.on('dragend', () => {
      const pos = homeMarkerRef.current?.getLatLng()
      if (!pos) return
      dragOriginRef.current = true // prevent map re-center
      const optimistic = nearestCityLabel(pos.lat, pos.lng)
      useTripStore.getState().setHomeBase({ lat: pos.lat, lng: pos.lng }, optimistic)
      void reverseGeocodeLabel(pos.lat, pos.lng).then((label) => {
        if (!label) return
        const cur = useTripStore.getState()
        // Only upgrade if user hasn't moved again, cleared, or set a preset since.
        if (!cur.homeBase) return
        const dlat = Math.abs(cur.homeBase.lat - pos.lat)
        const dlng = Math.abs(cur.homeBase.lng - pos.lng)
        if (dlat < 0.001 && dlng < 0.001) {
          cur.setHomeBase({ lat: pos.lat, lng: pos.lng }, label)
        }
      })
    })

    // Drive radius circle
    const radiusKm = (maxDriveMinutes / 60) * 95 / 1.2
    const radiusMeters = radiusKm * 1000
    radiusCircleRef.current = L.circle([homeBase.lat, homeBase.lng], {
      radius: radiusMeters,
      color: '#3b82f6',
      weight: 2,
      dashArray: '8,6',
      fillColor: '#3b82f6',
      fillOpacity: 0.03,
    }).addTo(map)

    // Center map on new home base (skip if change came from dragging the marker)
    if (dragOriginRef.current) {
      dragOriginRef.current = false
    } else {
      map.setView([homeBase.lat, homeBase.lng], map.getZoom())
    }
  }, [loaded, homeBase, homeBaseName, maxDriveMinutes])

  // First-load fit: frame the roster's venues once (the star effect above
  // recenters on origin changes after that).
  const didInitialFit = useRef(false)
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    if (didInitialFit.current || tierMarkers.length === 0) return
    didInitialFit.current = true
    const L = leafletRef.current
    const bounds = L.latLngBounds(tierMarkers.map((tm) => L.latLng(tm.coords.lat, tm.coords.lng)))
    mapInstance.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 7 })
  }, [loaded, tierMarkers])

  // Render/update markers when tierMarkers change
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstance.current

    // Remove old marker layer
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current)
      clusterGroupRef.current = null
    }

    // Cluster overlapping venues into count badges that expand on zoom (113
    // venues overlap badly when zoomed out). Falls back to a plain layer group
    // if the plugin didn't load, so the map always renders.
    // markerClusterGroup is added at runtime; under Vite's CJS interop it lands
    // on the default object, not the ESM namespace — check both.
    const makeCluster = ((L as any).markerClusterGroup ?? (L as any).default?.markerClusterGroup) as
      | ((opts?: Record<string, unknown>) => L.LayerGroup)
      | undefined
    // Custom cluster bubbles — sized by venue count and colored by the best
    // tier inside, so a zoomed-out view shows HOW populated each area is
    // (Tom 2026-07-21: the default tiny numbers hid density).
    const layerGroup: L.LayerGroup = typeof makeCluster === 'function'
      ? makeCluster({
          chunkedLoading: true,
          maxClusterRadius: 50,
          showCoverageOnHover: false,
          spiderfyOnMaxZoom: true,
          iconCreateFunction: (cluster: { getAllChildMarkers: () => L.Marker[] }) => {
            const children = cluster.getAllChildMarkers()
            const count = children.length
            let bestTier = 4
            for (const m of children) {
              const t = (m as unknown as { svTier?: number }).svTier
              if (t && t < bestTier) bestTier = t
            }
            const color = TIER_COLORS[bestTier] ?? TIER_COLORS[4]!
            const size = count >= 10 ? 44 : count >= 5 ? 36 : 28
            return L.divIcon({
              className: '',
              html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color}2e;border:2px solid ${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${count >= 10 ? 13 : 12}px;text-shadow:0 1px 2px rgba(0,0,0,0.8);box-shadow:0 0 10px ${color}55">${count}</div>`,
              iconSize: [size, size],
              iconAnchor: [size / 2, size / 2],
            })
          },
        })
      : L.layerGroup()

    // Build lookups used for both dot color and popup enrichment.
    // We always populate daysByPlayer (popup needs it even in Tier color mode)
    // — the colorBy flag only controls the marker color, not the popup detail.
    const daysByPlayer = new Map<string, number | null>()
    for (const p of heartbeatPlayers) {
      daysByPlayer.set(p.name.trim().toLowerCase(), p.daysSinceInPerson ?? null)
    }
    const plannedByPlayer = new Map<string, { date: string; agent: string | null }>()
    const heartbeatState = useHeartbeatStore.getState()
    for (const vc of Object.values(heartbeatState.visitCounts)) {
      if (vc.nextPlannedDate) {
        plannedByPlayer.set(vc.name.trim().toLowerCase(), {
          date: vc.nextPlannedDate,
          agent: vc.nextPlannedAgent,
        })
      }
    }

    // ── Click-and-hold measure (Tom 2026-08-18) ──
    // Hold on a venue dot, drag: a dashed line + live readout of straight-
    // line miles and the est. drive follows the cursor, snapping to other
    // venues and the star. Release keeps the measurement on screen until
    // the next map interaction. A plain click (under ~8px of movement)
    // opens the popup exactly as before.
    function beginMeasure(startTm: TierMarker, marker: import('leaflet').Marker) {
      if (measureLayerRef.current) { map.removeLayer(measureLayerRef.current); measureLayerRef.current = null }
      measureActiveRef.current = true
      map.dragging.disable()

      const start = L.latLng(startTm.coords.lat, startTm.coords.lng)
      // Snap candidates (other venues + the star), pre-projected once —
      // the map can't pan while measuring, so container points stay valid.
      const candidates = [
        ...tierMarkers
          .filter((t) => t.key !== startTm.key)
          .map((t) => ({ name: t.venueName, ll: L.latLng(t.coords.lat, t.coords.lng) })),
        ...(homeBase ? [{ name: homeBaseName || 'Trip origin', ll: L.latLng(homeBase.lat, homeBase.lng) }] : []),
      ].map((c) => ({ ...c, pt: map.latLngToContainerPoint(c.ll) }))
      const startPt = map.latLngToContainerPoint(start)

      let dragged = false
      let group: import('leaflet').LayerGroup | null = null
      let line: import('leaflet').Polyline | null = null
      let label: import('leaflet').Marker | null = null
      const popup = marker.getPopup()

      const onMove = (e: MouseEvent) => {
        const pt = map.mouseEventToContainerPoint(e)
        if (!dragged) {
          if (pt.distanceTo(startPt) < 8) return
          dragged = true
          // A real drag began — suppress the popup the trailing click would
          // open (rebound after the click settles, in onUp).
          if (popup) marker.unbindPopup()
          group = L.layerGroup().addTo(map)
          line = L.polyline([start, start], { color: '#60a5fa', weight: 2, dashArray: '6,6', interactive: false }).addTo(group)
          label = L.marker(start, { icon: L.divIcon({ className: '', html: '' }), interactive: false, zIndexOffset: 1200 }).addTo(group)
        }
        // Snap to the nearest venue/star within 26px of the cursor
        let end: import('leaflet').LatLng = map.containerPointToLatLng(pt)
        let endName: string | null = null
        let best = 26
        for (const c of candidates) {
          const d = pt.distanceTo(c.pt)
          if (d < best) { best = d; end = c.ll; endName = c.name }
        }
        line!.setLatLngs([start, end])
        const miles = haversineMiles(startTm.coords, { lat: end.lat, lng: end.lng })
        const driveMin = Math.round(estimateDriveMinutes(startTm.coords, { lat: end.lat, lng: end.lng }))
        label!.setLatLng(end)
        label!.setIcon(L.divIcon({ className: '', html: measureLabelHtml(startTm.venueName, endName, miles, driveMin), iconSize: [0, 0] }))
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        map.dragging.enable()
        measureActiveRef.current = false
        if (!dragged) return // plain click — popup opens normally
        setTimeout(() => { if (popup) marker.bindPopup(popup) }, 80)
        measureLayerRef.current = group // stays until the next map interaction
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }

    // Add venue markers
    for (const tm of tierMarkers) {
      let color: string
      if (colorBy === 'heartbeat') {
        // Use the MOST-overdue player at this venue as the color driver.
        // "No record" is shown as gray (its own category, matching legend) —
        // earlier we treated null as red, but with sparse Heartbeat data the
        // map floods red and loses signal. Gray correctly says "unknown."
        let worstDays: number | null = null
        let knownAny = false
        for (const p of tm.players) {
          const d = daysByPlayer.get(p.name.trim().toLowerCase()) ?? null
          if (d == null) continue
          knownAny = true
          if (worstDays == null || d > worstDays) worstDays = d
        }
        color = knownAny ? heartbeatColorFor(worstDays) : heartbeatColorFor(null)
      } else {
        color = TIER_COLORS[tm.bestTier] ?? TIER_COLORS[4]!
      }
      const icon = L.divIcon({
        className: '',
        html: `<div class="sv-venue-dot" style="width:10px;height:10px;background:${color}" title="Click for details. Hold and drag to measure distance"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const marker = L.marker([tm.coords.lat, tm.coords.lng], { icon })
      // Tag the marker with its tier so cluster bubbles can color by the
      // best tier they contain (read in iconCreateFunction above).
      ;(marker as unknown as { svTier?: number }).svTier = tm.bestTier

      // Click-and-hold measure (Tom 2026-08-18): hold on a dot and drag to
      // another venue, the star, or any point → live miles + est. drive.
      // A plain click (no drag) still opens the popup as before; map
      // panning is untouched because it only starts on a VENUE mousedown.
      marker.on('mousedown', (ev: import('leaflet').LeafletMouseEvent) => {
        L.DomEvent.preventDefault(ev.originalEvent)
        beginMeasure(tm, marker)
      })

      marker.bindPopup(buildVenuePopupHtml(tm, {
        daysByPlayer,
        plannedByPlayer,
        timeMode,
        // Drive-from-origin line only exists once an origin does
        origin: homeBase ? { name: homeBaseName || 'trip origin', driveMinutes: estimateDriveMinutes(homeBase, tm.coords) } : undefined,
      }), {
        maxWidth: 320,
        className: 'sv-dark-popup',
      })

      layerGroup.addLayer(marker)
    }

    map.addLayer(layerGroup)
    clusterGroupRef.current = layerGroup as any
  }, [loaded, tierMarkers, colorBy, heartbeatPlayers, timeMode, homeBase, homeBaseName])

  // Render non-game event pins — distinct amber 📌 markers, separate from the
  // round player-venue dots, so "who's where" reads at a glance.
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstance.current

    if (eventLayerRef.current) {
      map.removeLayer(eventLayerRef.current)
      eventLayerRef.current = null
    }
    if (eventMarkers.length === 0) return

    const fmt = (iso: string) => {
      const d = new Date(iso + 'T00:00:00Z')
      const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
      return `${m} ${d.getUTCDate()}`
    }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    const layer = L.layerGroup()
    for (const e of eventMarkers) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#f59e0b;color:#1a1a1a;font-size:13px;box-shadow:0 0 0 2px rgba(245,158,11,0.4)"></div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })
      const dr = e.startDate === e.endDate ? fmt(e.startDate) : `${fmt(e.startDate)}–${fmt(e.endDate)}`
      const loc = e.city && e.state ? `${e.city}, ${e.state}` : (e.city || '')
      const clients = e.clients.length > 0
        ? `<div style="margin-top:4px"><span style="color:#94a3b8">Clients:</span> ${esc(e.clients.join(', '))}</div>`
        : ''
      const staff = e.staff ? `<div style="margin-top:4px"><span style="color:#94a3b8">SV:</span> ${esc(e.staff)}</div>` : ''
      const html = `<div style="font-family:system-ui;font-size:12px;color:#f1f5f9;min-width:180px">`
        + `<div style="font-weight:700;color:#f59e0b">${esc(e.event)}</div>`
        + `<div style="margin-top:2px">${dr}${loc ? ` · ${esc(loc)}` : ''}</div>`
        + staff + clients + `</div>`
      L.marker([e.coords.lat, e.coords.lng], { icon, zIndexOffset: 500 })
        .bindPopup(html, { className: 'sv-dark-popup' })
        .addTo(layer)
    }
    map.addLayer(layer)
    eventLayerRef.current = layer
  }, [loaded, eventMarkers])

  // Auto-fit the map to the visible markers whenever the filter narrows in
  // a "find this for me" way (e.g. user picks a specific player). Keyed off
  // a string the caller controls so we only fit when intent is clear — not
  // on every tier toggle. Kent's 2026-06-08: "I enter Jake Munroe, I have
  // no idea where he is, shouldn't it find him for me?"
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    if (!fitToMarkersKey) return // no fit signal — leave map as-is
    if (tierMarkers.length === 0) return
    const L = leafletRef.current
    const map = mapInstance.current
    const points = tierMarkers.map((tm) => L.latLng(tm.coords.lat, tm.coords.lng))
    if (points.length === 1) {
      // Single venue — fly to it at a comfortable city-level zoom
      map.setView(points[0]!, 9, { animate: true })
    } else {
      const bounds = L.latLngBounds(points)
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 9, animate: true })
    }
  }, [loaded, fitToMarkersKey, tierMarkers])

  // Double-up overlay — active while the Suggestions panel's Double Ups tab
  // is open. Same-day/stay-over pairs get a connector line (green ≤45min,
  // yellow 46–90min, orange 91min–2h; dashed = overnight). Head-to-heads/
  // tournaments get a ×2 badge on the shared venue. Selecting a card zooms
  // to that pair.
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstance.current

    if (doubleUpLayerRef.current) {
      map.removeLayer(doubleUpLayerRef.current)
      doubleUpLayerRef.current = null
    }
    if (doubleUps.length === 0) return

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const layer = L.layerGroup()

    doubleUps.forEach((du, i) => {
      const isSelected = selectedDoubleUp === i
      const tierColor = du.driveMinutesBetween <= 45 ? '#22c55e' : du.driveMinutesBetween <= 90 ? '#eab308' : '#f97316'
      const label = `${esc(du.playerNames.join(' + '))} · ${du.dates.length > 1 ? `${du.dates.length}-game series` : du.date}`

      if (du.games.length >= 2 && du.driveMinutesBetween > 0) {
        const [g1, g2] = [du.games[0]!, du.games[du.games.length - 1]!]
        L.polyline(
          [[g1.venue.coords.lat, g1.venue.coords.lng], [g2.venue.coords.lat, g2.venue.coords.lng]],
          {
            color: tierColor,
            weight: isSelected ? 5 : 3,
            opacity: isSelected ? 0.95 : 0.65,
            dashArray: du.type === 'stay-over' ? '4,8' : undefined,
          },
        )
          .bindTooltip(`${label} · ${Math.round(du.driveMinutesBetween)} min apart`, { sticky: true })
          .addTo(layer)
      } else {
        // Shared venue (head-to-head / tournament) — ×2 badge
        const v = du.games[0]!.venue
        const badge = L.divIcon({
          className: '',
          html: `<div style="display:flex;align-items:center;justify-content:center;width:${isSelected ? 30 : 24}px;height:${isSelected ? 30 : 24}px;border-radius:50%;background:#a855f7;color:#fff;font-weight:800;font-size:11px;box-shadow:0 0 0 2px rgba(168,85,247,0.5),0 0 12px rgba(168,85,247,0.8)">×2</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        })
        L.marker([v.coords.lat, v.coords.lng], { icon: badge, zIndexOffset: 800 })
          .bindTooltip(label, { direction: 'top', offset: [0, -12] })
          .addTo(layer)
      }
    })

    map.addLayer(layer)
    doubleUpLayerRef.current = layer

    // Zoom to the selected pair — framed WITH the drive-radius circle so
    // the dashed circle is actually visible (Tom 2026-07-22)
    if (selectedDoubleUp != null && doubleUps[selectedDoubleUp]) {
      const du = doubleUps[selectedDoubleUp]!
      const pts = du.games.map((g) => L.latLng(g.venue.coords.lat, g.venue.coords.lng))
      const b = L.latLngBounds(pts)
      const c = b.getCenter()
      const radiusKm = (useTripStore.getState().maxDriveMinutes / 60) * 95 / 1.2
      const dLat = radiusKm / 111
      const dLng = radiusKm / (111 * Math.cos((c.lat * Math.PI) / 180))
      b.extend([c.lat + dLat, c.lng + dLng])
      b.extend([c.lat - dLat, c.lng - dLng])
      map.fitBounds(b, { padding: [40, 40], animate: true })
    }
  }, [loaded, doubleUps, selectedDoubleUp])

  // "Show on map" focus — fit the viewport to the trip's own venues. Store-
  // driven (not a map event) because this component mounts AFTER the click
  // on the Trip Planner tab; fly-in cards' fit-points events used to be
  // dispatched into the void (Tom 2026-08-12). Runs for road trips too:
  // isolating the trip's AREA means its venues, never the trip origin.
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current || !mapFocus) return
    if (mapFocus.points.length === 0) return
    const L = leafletRef.current
    const bounds = L.latLngBounds(mapFocus.points.map((p) => L.latLng(p.lat, p.lng)))
    mapInstance.current.fitBounds(bounds, { padding: [70, 70], maxZoom: 10, animate: true })
  }, [loaded, mapFocus])

  // Highlight the currently selected trip — draws a yellow polyline through
  // its venues and zooms the map to fit them. Driven by tripStore.selectedTripIndex
  // which TripCard's "Show on Map" button sets.
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstance.current

    // Clear prior highlight
    if (tripHighlightRef.current) {
      map.removeLayer(tripHighlightRef.current)
      tripHighlightRef.current = null
    }

    if (selectedTripIndex == null || !tripPlan) return
    const trip: TripCandidate | undefined = tripPlan.trips[selectedTripIndex]
    if (!trip) return

    // Collect unique venues in route order: anchor first, then nearby games
    const stops: Array<{ lat: number; lng: number; name: string }> = []
    const seen = new Set<string>()
    const pushStop = (coords: { lat: number; lng: number }, name: string) => {
      const key = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`
      if (seen.has(key)) return
      seen.add(key)
      stops.push({ ...coords, name })
    }
    pushStop(trip.anchorGame.venue.coords, trip.anchorGame.venue.name)
    for (const g of trip.nearbyGames) pushStop(g.venue.coords, g.venue.name)
    if (stops.length === 0) return

    const highlight = L.layerGroup()

    // Polyline through the STOPS only. The old home-base leg (Maptive relic)
    // meant previewing a DC trip from a Phoenix origin drew a cross-country
    // line and the fit-bounds below showed the whole US instead of the
    // trip's area (Tom 2026-08-12). No return-home assumptions.
    const linePoints: Array<[number, number]> = stops.map((s) => [s.lat, s.lng] as [number, number])
    if (linePoints.length >= 2) {
      L.polyline(linePoints, {
        color: '#fbbf24',
        weight: 3,
        opacity: 0.85,
        dashArray: '4,6',
      }).addTo(highlight)
    }

    // Numbered halo on each stop
    stops.forEach((s, i) => {
      const labelIcon = L.divIcon({
        className: '',
        html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#fbbf24;color:#000;font-weight:700;font-size:12px;box-shadow:0 0 0 2px #fbbf24,0 0 10px rgba(251,191,36,0.7)">${i + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      })
      L.marker([s.lat, s.lng], { icon: labelIcon, zIndexOffset: 900 })
        .bindTooltip(`Stop ${i + 1}: ${s.name}`, { direction: 'top', offset: [0, -10] })
        .addTo(highlight)
    })

    map.addLayer(highlight)
    tripHighlightRef.current = highlight

    // Fit bounds to the stops only — the trip's area, not origin-to-area
    const bounds = L.latLngBounds(linePoints.map(([lat, lng]) => L.latLng(lat, lng)))
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 10 })
  }, [loaded, selectedTripIndex, tripPlan])

  return (
    <div className="relative h-full w-full rounded-lg border border-border" style={{ minHeight: '500px' }}>
      <div ref={mapRef} className="absolute inset-0 rounded-lg" />

      {/* Drive-radius chip — adjusts the dashed circle around the star */}
      <DriveRadiusChip />


      {(initStatus || initError) && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface/80 z-[1000]">
          <div className="text-center">
            {initError ? (
              <p className="text-sm text-accent-red">Map failed to load: {initError}</p>
            ) : (
              <p className="text-sm text-text-dim">{initStatus}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Compact chip + popover for the drive radius slider. Sits at top-right of
 * the map so visual cause-and-effect (slider → dashed circle) happens in
 * the same place. Click to expand the slider, click outside to close.
 */
function DriveRadiusChip() {
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const setMaxDriveMinutes = useTripStore((s) => s.setMaxDriveMinutes)
  // The radius is measured FROM the origin — no origin, no Drive chip
  // (Tom 2026-08-18). The US-view button stays regardless.
  const homeBase = useTripStore((s) => s.homeBase)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const hours = Math.floor(maxDriveMinutes / 60)
  const mins = maxDriveMinutes % 60
  const display = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`

  return (
    <div ref={wrapRef} className="absolute right-3 top-3 z-[400] flex items-start gap-1.5">
      <button
        onClick={() => dispatchMapEvent('map:reset-view', {})}
        className="rounded-md border border-border/80 bg-surface/95 backdrop-blur px-2.5 py-1.5 text-[11px] font-medium text-text shadow-md hover:border-accent-blue/50 transition-colors"
        title="Zoom back out to the full US map"
      >
        US view
      </button>
      {homeBase && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md border border-border/80 bg-surface/95 backdrop-blur px-2.5 py-1.5 text-[11px] font-medium text-text shadow-md hover:border-accent-blue/50 transition-colors"
          title="Adjust the dashed drive-radius circle around your starting city"
        >
          <span className="inline-block h-1.5 w-3 rounded-full border border-dashed border-accent-blue" />
          Drive: {display}
          <span className={`text-text-dim/60 text-[9px] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>
      )}
      {homeBase && open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border border-border bg-surface p-3 shadow-xl">
          <label className="block text-[10px] uppercase tracking-wide text-text-dim/60 mb-1.5">
            Drive radius — {display}
          </label>
          <input
            type="range"
            min={120}
            max={480}
            step={30}
            value={maxDriveMinutes}
            onChange={(e) => setMaxDriveMinutes(parseInt(e.target.value))}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-accent-blue"
          />
          <div className="mt-1 flex justify-between text-[9px] text-text-dim/50">
            <span>2h</span>
            <span>4h</span>
            <span>6h</span>
            <span>8h</span>
          </div>
          <p className="mt-2 text-[10px] text-text-dim/60 leading-relaxed">
            Sets the dashed circle around your starting city. Estimates only — actual drive times depend on traffic + route.
          </p>
        </div>
      )}
    </div>
  )
}

