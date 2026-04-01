import { useEffect, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { dispatchMapEvent } from '../../lib/mapEvents'
import { injectMapStyles } from './mapStyles'
import { buildVenuePopupHtml } from './VenuePopup'
import { TIER_COLORS } from './hooks/useTierMarkers'
import type { TierMarker } from './hooks/useTierMarkers'

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

interface MapContainerProps {
  tierMarkers: TierMarker[]
}

export default function MapContainer({ tierMarkers }: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<import('leaflet').Map | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const clusterGroupRef = useRef<import('leaflet').LayerGroup | null>(null)
  const homeMarkerRef = useRef<import('leaflet').Marker | null>(null)
  const radiusCircleRef = useRef<import('leaflet').Circle | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [initStatus, setInitStatus] = useState('Initializing map...')

  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)
  const dragOriginRef = useRef(false) // suppress map re-center after drag

  // Initialize Leaflet + MarkerCluster
  const mapInitialized = useRef(false)
  useEffect(() => {
    if (mapInitialized.current) return
    mapInitialized.current = true

    let cancelled = false

    async function init() {
      try {
      setInitStatus('Loading Leaflet...')
      const L = await import('leaflet')
      leafletRef.current = L

      // MarkerCluster expects L on window — attach before importing
      ;(window as any).L = L

      // Leaflet CSS
      if (!document.querySelector('link[href*="leaflet@1"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
        document.head.appendChild(link)
      }


      // Custom styles
      injectMapStyles()

      if (cancelled || !mapRef.current) return

      setInitStatus('Creating map...')
      const { homeBase: hb } = useTripStore.getState()
      const map = L.map(mapRef.current).setView([hb.lat, hb.lng], 6)

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
          const el = target.closest('[data-action="schedule"]') as HTMLElement | null
          if (!el) return
          const playerName = el.dataset.player
          if (playerName) {
            dispatchMapEvent('map:open-schedule', { player: playerName })
            map.closePopup()
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
    return () => { cancelled = true }
  }, [])

  // Update home base marker + drive radius circle when homeBase changes
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstance.current

    // Remove old
    if (homeMarkerRef.current) { map.removeLayer(homeMarkerRef.current); homeMarkerRef.current = null }
    if (radiusCircleRef.current) { map.removeLayer(radiusCircleRef.current); radiusCircleRef.current = null }

    // Home base star marker — draggable
    const starIcon = L.divIcon({
      className: '',
      html: `<div style="font-size:22px;text-shadow:0 0 6px rgba(0,0,0,0.7);line-height:1;color:#fbbf24;cursor:grab" title="Drag to move home base">&#9733;</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
    homeMarkerRef.current = L.marker([homeBase.lat, homeBase.lng], {
      icon: starIcon,
      zIndexOffset: 1000,
      draggable: true,
    })
      .addTo(map)
      .bindPopup(`<div style="font-family:system-ui;font-size:12px;color:#f1f5f9"><strong>${homeBaseName}</strong><br/>Home Base · Drag to move</div>`)

    // Update store when marker is dragged to a new position
    homeMarkerRef.current.on('dragend', () => {
      const pos = homeMarkerRef.current?.getLatLng()
      if (!pos) return
      const label = nearestCityLabel(pos.lat, pos.lng)
      dragOriginRef.current = true // prevent map re-center
      useTripStore.getState().setHomeBase({ lat: pos.lat, lng: pos.lng }, label)
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

    // Use a simple layer group (markercluster removed — Vite module compat issue)
    const layerGroup = L.layerGroup()

    // Add venue markers
    for (const tm of tierMarkers) {
      const color = TIER_COLORS[tm.bestTier] ?? TIER_COLORS[4]!
      const icon = L.divIcon({
        className: '',
        html: `<div class="sv-venue-dot" style="width:10px;height:10px;background:${color}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const marker = L.marker([tm.coords.lat, tm.coords.lng], { icon })

      marker.bindPopup(buildVenuePopupHtml(tm), {
        maxWidth: 300,
        className: 'sv-dark-popup',
      })

      layerGroup.addLayer(marker)
    }

    map.addLayer(layerGroup)
    clusterGroupRef.current = layerGroup as any
  }, [loaded, tierMarkers])

  return (
    <div className="relative w-full rounded-lg border border-border" style={{ height: 'calc(100vh - 160px)', minHeight: '500px' }}>
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
