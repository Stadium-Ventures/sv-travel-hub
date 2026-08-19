import { TIER_COLORS } from './hooks/useTierMarkers'

const STYLE_ID = 'sv-map-cluster-css'

/**
 * Inject CSS for dark-themed markercluster icons and venue dot markers.
 */
export function injectMapStyles() {
  if (document.getElementById(STYLE_ID)) return

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    /* Player-locate pulse (Tom 2026-08-18): halos flash on a player's
       visible venues before their schedule panel opens */
    @keyframes svPulse {
      0%   { transform: scale(0.35); opacity: 1; }
      100% { transform: scale(1.35); opacity: 0.1; }
    }
    .sv-pulse-halo {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: 3px solid #60a5fa;
      box-shadow: 0 0 20px rgba(96,165,250,0.9), inset 0 0 12px rgba(96,165,250,0.5);
      animation: svPulse 0.5s ease-out 1;
    }

    /* Venue dot markers */
    .sv-venue-dot {
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,0.6);
      box-shadow: 0 0 6px rgba(0,0,0,0.5);
    }

    /* Override default MarkerCluster styles with dark theme */
    .marker-cluster-small,
    .marker-cluster-medium,
    .marker-cluster-large {
      background: transparent !important;
    }
    .marker-cluster-small div,
    .marker-cluster-medium div,
    .marker-cluster-large div {
      background: transparent !important;
    }

    /* Custom tier-colored cluster icons */
    .sv-cluster {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      color: #fff;
      font-weight: 700;
      font-size: 14px;
      font-family: system-ui, sans-serif;
      border: 2px solid rgba(255,255,255,0.3);
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    }
    .sv-cluster-t1 { background: ${TIER_COLORS[1]}; }
    .sv-cluster-t2 { background: ${TIER_COLORS[2]}; }
    .sv-cluster-t3 { background: ${TIER_COLORS[3]}; }
    .sv-cluster-t4 { background: ${TIER_COLORS[4]}; }

    /* Dark popup theme */
    .leaflet-popup-content-wrapper {
      background: #1e293b !important;
      color: #f1f5f9 !important;
      border-radius: 10px !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
    }
    .leaflet-popup-tip {
      background: #1e293b !important;
    }
    .leaflet-popup-close-button {
      color: #94a3b8 !important;
    }
    .leaflet-popup-close-button:hover {
      color: #f1f5f9 !important;
    }
  `
  document.head.appendChild(style)
}
