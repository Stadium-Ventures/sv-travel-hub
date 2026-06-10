// Typed map event system — centralizes all cross-component CustomEvent communication
// so event names and payloads are checked at compile time.

export type MapEventMap = {
  'map:open-schedule': { player: string }
  'map:toast': { message: string }
  'map:explore-pin': { lat: number; lng: number }
  /** Switch to a tab in AppShell from anywhere in the tree. */
  'app:switch-tab': { tab: 'roster' | 'trips' | 'map' | 'data' }
  /** Filter the Map to a specific player and zoom to them. Fired by
   *  the global header player search. MapView listens and sets the
   *  filterState.selectedPlayer + zooms via fitToMarkersKey. */
  'map:select-player': { playerName: string }
}

export function dispatchMapEvent<K extends keyof MapEventMap>(
  type: K,
  detail: MapEventMap[K],
) {
  window.dispatchEvent(new CustomEvent(type, { detail }))
}

export function addMapEventListener<K extends keyof MapEventMap>(
  type: K,
  handler: (detail: MapEventMap[K]) => void,
): () => void {
  function wrapper(e: Event) {
    const detail = (e as CustomEvent<MapEventMap[K]>).detail
    if (detail) handler(detail)
  }
  window.addEventListener(type, wrapper)
  return () => window.removeEventListener(type, wrapper)
}
