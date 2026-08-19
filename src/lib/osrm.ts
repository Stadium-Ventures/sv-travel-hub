import { useEffect, useState } from 'react'
import { fetchWithTimeout } from './fetchWithTimeout'

// Real road routing for DISPLAYED drive legs (Tom 2026-08-19, closing the
// 08-17 "drive-estimate honesty" item): the haversine ×1.2/95 estimate
// materially understates dense-metro corridors (ShoreTown→Yankee showed
// 1h 6m; real ~1h45+). OSRM's public router is free, keyless, and
// CORS-open. Rules of engagement:
//   - Displayed legs ONLY. The trip engine, double-up pairing, and scoring
//     keep using the instant haversine estimate — routing thousands of
//     candidate pairs through a shared demo server is bulk usage, which its
//     policy forbids (and would be slow anyway).
//   - Cache hard. Venues are fixed points; a resolved pair is good for
//     30 days in localStorage, so steady-state traffic is near zero.
//   - Fail silent. Any error keeps the haversine number on screen and a
//     circuit breaker stops hammering a downed server for the session.
// OSRM durations are free-flow (no live traffic), so UI copy stays
// "est. drive" either way — tooltips say which kind of estimate it is.

interface Coordinates {
  lat: number
  lng: number
}

export interface RealDrive {
  minutes: number
  miles: number
}

const BASE = 'https://router.project-osrm.org/route/v1/driving'
const STORAGE_KEY = 'sv-osrm-cache-v1'
const TTL_MS = 30 * 24 * 3600_000
const MAX_CONCURRENT = 3

// A→B and B→A differ only by one-way details — negligible at venue scale,
// and normalizing the key doubles cache hits.
function pairKey(a: Coordinates, b: Coordinates): string {
  const ka = `${a.lat.toFixed(4)},${a.lng.toFixed(4)}`
  const kb = `${b.lat.toFixed(4)},${b.lng.toFixed(4)}`
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

type StoredEntry = { m: number; mi: number; t: number }

const memCache = new Map<string, RealDrive>()
const inflight = new Map<string, Promise<RealDrive | null>>()
let storageLoaded = false
let consecutiveFailures = 0
let running = 0
const queue: Array<() => void> = []

function loadStorage() {
  if (storageLoaded) return
  storageLoaded = true
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as Record<string, StoredEntry>
    const now = Date.now()
    for (const [k, v] of Object.entries(data)) {
      if (now - v.t < TTL_MS) memCache.set(k, { minutes: v.m, miles: v.mi })
    }
  } catch { /* corrupt cache — start fresh */ }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      const now = Date.now()
      const out: Record<string, StoredEntry> = {}
      for (const [k, v] of memCache.entries()) out[k] = { m: v.minutes, mi: v.miles, t: now }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
    } catch { /* quota — cache stays memory-only */ }
  }, 2000)
}

function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      running++
      fn().then(resolve, reject).finally(() => {
        running--
        queue.shift()?.()
      })
    }
    if (running < MAX_CONCURRENT) run()
    else queue.push(run)
  })
}

/** Synchronous cache read — lets a first render show the road-routed
 *  number with no flicker when the pair has been seen before. */
export function getCachedDrive(from: Coordinates, to: Coordinates): RealDrive | null {
  loadStorage()
  return memCache.get(pairKey(from, to)) ?? null
}

/** Road-routed drive between two points, or null (breaker open / server
 *  down / nonsense response). Callers keep their haversine fallback. */
export function getRealDrive(from: Coordinates, to: Coordinates): Promise<RealDrive | null> {
  loadStorage()
  const key = pairKey(from, to)
  const cached = memCache.get(key)
  if (cached) return Promise.resolve(cached)
  if (consecutiveFailures >= 3) return Promise.resolve(null)
  const pending = inflight.get(key)
  if (pending) return pending

  const p = withSlot(async () => {
    try {
      const url = `${BASE}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&alternatives=false&steps=false`
      const res = await fetchWithTimeout(url, { timeoutMs: 8000 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { code?: string; routes?: Array<{ duration?: number; distance?: number }> }
      const route = data.code === 'Ok' ? data.routes?.[0] : undefined
      if (!route?.duration || !route.distance) throw new Error(data.code ?? 'no route')
      consecutiveFailures = 0
      const drive: RealDrive = {
        minutes: Math.round(route.duration / 60),
        miles: route.distance / 1609.34,
      }
      memCache.set(key, drive)
      scheduleSave()
      return drive
    } catch {
      consecutiveFailures++
      return null
    } finally {
      inflight.delete(key)
    }
  })
  inflight.set(key, p)
  return p
}

/** Road-routed drive for a rendered leg. Returns the cached value
 *  immediately when known, otherwise null while (and if ever) OSRM
 *  resolves — render the haversine estimate in the meantime. */
export function useRealDrive(from: Coordinates | null, to: Coordinates | null): RealDrive | null {
  const [drive, setDrive] = useState<RealDrive | null>(() =>
    from && to ? getCachedDrive(from, to) : null)
  useEffect(() => {
    if (!from || !to) { setDrive(null); return }
    const cached = getCachedDrive(from, to)
    setDrive(cached)
    if (cached) return
    let alive = true
    getRealDrive(from, to).then((r) => { if (alive && r) setDrive(r) })
    return () => { alive = false }
  }, [from?.lat, from?.lng, to?.lat, to?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  return drive
}
