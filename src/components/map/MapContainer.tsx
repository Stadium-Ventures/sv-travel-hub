import { useEffect, useRef, useState } from 'react'
import { useTripStore } from '../../store/tripStore'
import { dispatchMapEvent } from '../../lib/mapEvents'
import { injectMapStyles } from './mapStyles'
import { buildVenuePopupHtml } from './VenuePopup'
import { TIER_COLORS } from './hooks/useTierMarkers'
import type { TierMarker } from './hooks/useTierMarkers'

interface MapContainerProps {
  tierMarkers: TierMarker[]
}

export default function MapContainer({ tierMarkers }: MapContainerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<import('leaflet').Map | null>(null)
  const leafletRef = useRef<typeof import('leaflet') | null>(null)
  const clusterGroupRef = useRef<import('leaflet').MarkerClusterGroup | null>(null)
  const homeMarkerRef = useRef<import('leaflet').Marker | null>(null)
  const radiusCircleRef = useRef<import('leaflet').Circle | null>(null)
  const [loaded, setLoaded] = useState(false)

  const homeBase = useTripStore((s) => s.homeBase)
  const homeBaseName = useTripStore((s) => s.homeBaseName)
  const maxDriveMinutes = useTripStore((s) => s.maxDriveMinutes)

  // Initialize Leaflet + MarkerCluster
  const mapInitialized = useRef(false)
  useEffect(() => {
    if (mapInitialized.current) return
    mapInitialized.current = true

    let cancelled = false

    async function init() {
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

      // MarkerCluster CSS
      if (!document.querySelector('link[href*="MarkerCluster.css"]')) {
        const link1 = document.createElement('link')
        link1.rel = 'stylesheet'
        link1.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css'
        document.head.appendChild(link1)

        const link2 = document.createElement('link')
        link2.rel = 'stylesheet'
        link2.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css'
        document.head.appendChild(link2)
      }

      // Load MarkerCluster JS (attaches to window.L)
      await import('leaflet.markercluster')

      // Custom styles
      injectMapStyles()

      if (cancelled || !mapRef.current) return

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
      setLoaded(true)
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

    // Home base star marker
    const starIcon = L.divIcon({
      className: '',
      html: `<div style="font-size:22px;text-shadow:0 0 6px rgba(0,0,0,0.7);line-height:1;color:#fbbf24" title="${homeBaseName}">&#9733;</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    })
    homeMarkerRef.current = L.marker([homeBase.lat, homeBase.lng], { icon: starIcon, zIndexOffset: 1000 })
      .addTo(map)
      .bindPopup(`<div style="font-family:system-ui;font-size:12px;color:#f1f5f9"><strong>${homeBaseName}</strong><br/>Home Base</div>`)

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

    // Center map on new home base
    map.setView([homeBase.lat, homeBase.lng], map.getZoom())
  }, [loaded, homeBase, homeBaseName, maxDriveMinutes])

  // Render/update markers when tierMarkers change
  useEffect(() => {
    if (!loaded || !mapInstance.current || !leafletRef.current) return
    const L = leafletRef.current
    const map = mapInstance.current

    // Remove old cluster group
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current)
      clusterGroupRef.current = null
    }

    // Create cluster group with custom icon function
    const clusterGroup = (L as any).markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster: any) => {
        const children = cluster.getAllChildMarkers()
        let bestTier = 4
        for (const child of children) {
          const tier = child.options.bestTier as number | undefined
          if (tier !== undefined && tier < bestTier) bestTier = tier
        }
        const tierClass = `sv-cluster-t${bestTier}`
        return L.divIcon({
          className: '',
          html: `<div class="sv-cluster ${tierClass}">${cluster.getChildCount()}</div>`,
          iconSize: [40, 40],
          iconAnchor: [20, 20],
        })
      },
    }) as import('leaflet').MarkerClusterGroup

    // Add venue markers
    for (const tm of tierMarkers) {
      const color = TIER_COLORS[tm.bestTier] ?? TIER_COLORS[4]!
      const icon = L.divIcon({
        className: '',
        html: `<div class="sv-venue-dot" style="width:10px;height:10px;background:${color}"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      const marker = L.marker([tm.coords.lat, tm.coords.lng], {
        icon,
        bestTier: tm.bestTier,
      } as any)

      marker.bindPopup(buildVenuePopupHtml(tm), {
        maxWidth: 300,
        className: 'sv-dark-popup',
      })

      clusterGroup.addLayer(marker)
    }

    map.addLayer(clusterGroup)
    clusterGroupRef.current = clusterGroup
  }, [loaded, tierMarkers])

  return (
    <div
      ref={mapRef}
      className="w-full flex-1 rounded-lg border border-border"
      style={{ minHeight: '400px' }}
    />
  )
}
