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
  `
  document.head.appendChild(style)
}
