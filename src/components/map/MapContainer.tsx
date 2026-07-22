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
import { dispatchMapEvent, addMapEventListener } from '../../lib/mapEvents'
import { injectMapStyles } from './mapStyles'
import { buildVenuePopupHtml } from './VenuePopup'
import { TIER_COLORS } from './hooks/useTierMarkers'
import type { TierMarker } from './hooks/useTierMarkers'
import type { TripCandidate, DoubleUp } from '../../types/schedule'
import { heartbeatColorFor, type MapColorMode } from './MapFilters'
import type { EventMarker } from './hooks/useEventMarkers'


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
   *  yellow 46–90min drive, dashed = overnight) and ×2 badges on head-to-head
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
  const tripHighlightRef = useRef<import('leaflet').LayerGroup | null>(null)
  const doubleUpLayerRef = useRef<import('leaflet').LayerGroup | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [initStatus, setInitStatus] = useState('Initializing map...')

  const homeBase = useTripStore((s) => s.homeBase)
  const selectedTripIndex = useTripStore((s) => s.selectedTripIndex)
  const tripPlan = useTripStore((s) => s.tripPlan)
  // Heartbeat-driven coloring requires looking up each marker's players'
  // days-since-visit values. Subscribing to .players ensures the map repaints
  // when heartbeat data refreshes.
  const heartbeatPlayers = useHeartbeatStore((s) => s.players)
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
              useTripStore.getState().setPriorityPlayers(players.slice(0, 5))
              // "Assume the user is in the area" (Tom 2026-07-22): anchor the
              // trip engine at this venue so the itinerary is built around
              // the destination, not a home city.
              const lat = parseFloat(planEl.dataset.lat ?? '')
              const lng = parseFloat(planEl.dataset.lng ?? '')
              if (isFinite(lat) && isFinite(lng)) {
                useTripStore.getState().setHomeBase({ lat, lng }, planEl.dataset.venue || 'Trip area')
              }
              dispatchMapEvent('app:switch-tab', { tab: 'trips' })
              window.scrollTo({ top: 0 })
              map.closePopup()
            }
          }
        })
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
      if (tripHighlightRef.current) tripHighlightRef.current = null
      if (doubleUpLayerRef.current) doubleUpLayerRef.current = null
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

  // Origin scrapped (Tom 2026-07-22: "assume the user is in the area") —
  // no star marker, no drive-radius circle. Instead, fit the viewport to
  // the visible venues ONCE when they first arrive.
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
        html: `<div class="sv-venue-dot" style="width:10px;height:10px;background:${color}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const marker = L.marker([tm.coords.lat, tm.coords.lng], { icon })
      // Tag the marker with its tier so cluster bubbles can color by the
      // best tier they contain (read in iconCreateFunction above).
      ;(marker as unknown as { svTier?: number }).svTier = tm.bestTier

      marker.bindPopup(buildVenuePopupHtml(tm, { daysByPlayer, plannedByPlayer }), {
        maxWidth: 320,
        className: 'sv-dark-popup',
      })

      layerGroup.addLayer(marker)
    }

    map.addLayer(layerGroup)
    clusterGroupRef.current = layerGroup as any
  }, [loaded, tierMarkers, colorBy, heartbeatPlayers])

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
  // yellow 46–90min; dashed = overnight). Head-to-heads/tournaments get a
  // ×2 badge on the shared venue. Selecting a card zooms to that pair.
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
      const tierColor = du.driveMinutesBetween <= 45 ? '#22c55e' : '#eab308'
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

    // Zoom to the selected pair
    if (selectedDoubleUp != null && doubleUps[selectedDoubleUp]) {
      const du = doubleUps[selectedDoubleUp]!
      const pts = du.games.map((g) => L.latLng(g.venue.coords.lat, g.venue.coords.lng))
      if (pts.length === 1) map.setView(pts[0]!, 9, { animate: true })
      else map.fitBounds(L.latLngBounds(pts), { padding: [80, 80], maxZoom: 10, animate: true })
    }
  }, [loaded, doubleUps, selectedDoubleUp])

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

    // Polyline from home base through each stop (Maptive-style route)
    const linePoints: Array<[number, number]> = [
      [homeBase.lat, homeBase.lng],
      ...stops.map((s) => [s.lat, s.lng] as [number, number]),
    ]
    L.polyline(linePoints, {
      color: '#fbbf24',
      weight: 3,
      opacity: 0.85,
      dashArray: '4,6',
    }).addTo(highlight)

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

    // Fit bounds to home + all stops with some padding
    const bounds = L.latLngBounds(linePoints.map(([lat, lng]) => L.latLng(lat, lng)))
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 10 })
  }, [loaded, selectedTripIndex, tripPlan, homeBase])

  return (
    <div className="relative h-full w-full rounded-lg border border-border" style={{ minHeight: '500px' }}>
      <div ref={mapRef} className="absolute inset-0 rounded-lg" />


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

