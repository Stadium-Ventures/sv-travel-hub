import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RosterPlayer } from '../types/roster'
import { fetchRoster as fetchSheetRoster } from '../lib/csv'
import { getRosterSource, getRosterSourceOrNull, type RosterSource } from '../lib/rosterSource'
import {
  fetchRegistryRoster,
  RosterAuthError,
  DEFAULT_MIN_ROWS,
  DEFAULT_REGISTRY_ROSTER_URL,
} from '../lib/registryRoster'
import { getIdToken } from '../lib/googleAuth'
import { applyOverrides, pruneOverrides, overrideKeyForName, playerKey, type VisitOverride } from './rosterOverrides'
import { useDiagnosticsStore } from './diagnosticsStore'
import { ROSTER_PERSIST_VERSION, migrateRosterPersist, scrubPlayer } from './rosterPersist'
import {
  isSharpDrop,
  sharpDropMessage,
  findRenames,
  renameKeys,
  renameSeedFrom,
  type RenameSeedEntry,
} from './rosterSafety'
// Cycles with the stores below (they import us) — safe under ESM because
// both sides only ACCESS the binding at runtime, never at module init (same
// pattern as the scheduleStore ↔ rehabStore cycle).
import { useScheduleStore } from './scheduleStore'
import { useTripStore } from './tripStore'
import { useRehabStore } from './rehabStore'
import { useSummerStore } from './summerStore'

export type SortField = 'playerName' | 'tier' | 'org' | 'daysSince'
export type SortDir = 'asc' | 'desc'

interface RosterState {
  players: RosterPlayer[]
  loading: boolean
  error: string | null
  lastFetchedAt: string | null
  /** Which source produced `players` (null until the first successful load). */
  source: RosterSource | null
  /** Registry build time (_meta.generated_at). Null on the sheet source. */
  generatedAt: string | null
  /** Registry source only: no usable Google ID token, show the sign-in prompt. */
  needsSignIn: boolean
  parseWarnings: string[]
  visitOverrides: Record<string, VisitOverride> // playerKey (slug, else playerName) → override
  /** Client count of the last roster that was accepted (persisted; a count,
   *  not names). The sharp-drop guard compares against it. */
  lastGoodCount: number | null
  /** Set while the roster on screen is far smaller than the last good one.
   *  It is shown, but nobody's saved state is removed until staff confirm
   *  it. Not persisted. */
  shrinkBlocked: { count: number; previous: number } | null
  /** Registry source only: ids + names from the sheet snapshot this browser
   *  held before the switch, so the first registry load can recognise a
   *  client whose display name differs between the two. Cleared once used. */
  renameSeed: RenameSeedEntry[]
  sortColumn: SortField
  sortDirection: SortDir

  fetchRoster: () => Promise<void>
  /** Refetch and accept the roster even if it is far smaller than the last
   *  good one, removing the saved state of clients it leaves out. */
  acceptSmallerRoster: () => Promise<void>
  setVisitOverride: (playerName: string, visitsCompleted: number, lastVisitDate: string | null) => void
  clearVisitOverride: (playerName: string) => void
  setSortColumn: (column: SortField) => void
  setSortDirection: (dir: SortDir) => void
}

/** Shown when the registry answers 401 to a fresh token. Plain text for Kent. */
export const REGISTRY_REJECTED_MESSAGE =
  'The registry turned down this sign-in (HTTP 401), so the roster could not load. Signing in again will not fix it. Tell Tom in #sv-automation. The app does not fall back to the sheet.'

function registryUrl(): string {
  return (import.meta.env.VITE_REGISTRY_ROSTER_URL as string | undefined) || DEFAULT_REGISTRY_ROSTER_URL
}

function minRows(): number {
  const n = parseInt((import.meta.env.VITE_ROSTER_MIN_ROWS as string | undefined) ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_ROWS
}

/** Move name-keyed state in the other stores from a client's old display
 *  name to the new one, so the prune that follows does not treat a renamed
 *  client as removed. Summer placements are keyed by the placement sheet's
 *  own spelling and reload from it, so they are left alone. */
function carryRenamesIntoStores(renames: Record<string, string>) {
  const sched = useScheduleStore.getState()
  useScheduleStore.setState({
    playerTeamAssignments: renameKeys(sched.playerTeamAssignments, renames),
    aflAssignments: renameKeys(sched.aflAssignments, renames),
    ...(sched.playerVerifiedAt ? { playerVerifiedAt: renameKeys(sched.playerVerifiedAt, renames) } : {}),
  })
  const priority = useTripStore.getState().priorityPlayers
  if (priority.some((n) => n in renames)) {
    useTripStore.setState({ priorityPlayers: priority.map((n) => renames[n] ?? n) })
  }
  const lower = (n: string) => n.trim().toLowerCase()
  useRehabStore.setState({ windows: renameKeys(useRehabStore.getState().windows, renames, lower) })
}

/** Set only for the duration of acceptSmallerRoster's fetch. */
let allowShrinkOnce = false

export const useRosterStore = create<RosterState>()(
  persist(
    (set, get) => ({
      players: [],
      loading: false,
      error: null,
      lastFetchedAt: null,
      source: null,
      generatedAt: null,
      needsSignIn: false,
      parseWarnings: [],
      visitOverrides: {},
      lastGoodCount: null,
      shrinkBlocked: null,
      renameSeed: [],
      sortColumn: 'tier',
      sortDirection: 'asc',

      fetchRoster: async () => {
        if (get().loading) return
        const allowShrink = allowShrinkOnce
        set({ loading: true, error: null, parseWarnings: [], shrinkBlocked: null })
        let source: RosterSource | null = null
        try {
          source = getRosterSource()
          // ROSTER_SOURCE switch. The registry branch NEVER falls back to the
          // sheet: a failure keeps the previous roster and shows the error.
          const result = source === 'registry'
            ? await fetchRegistryRoster({ url: registryUrl(), getToken: getIdToken, minRows: minRows() })
            : { ...(await fetchSheetRoster()), generatedAt: null }
          // Zero players from a "successful" fetch is a failure in disguise
          // (wrong document, shifted columns). Keep whatever roster we had
          // and surface the problem instead of stamping a fresh timestamp.
          if (result.players.length === 0) {
            set({ loading: false, needsSignIn: false, error: source === 'registry'
              ? 'Registry roster returned 0 players'
              : 'Roster sheet parsed to 0 players — sheet unreachable or columns changed' })
            return
          }
          // A client whose display name changed (the registry's canon name vs
          // the sheet's spelling) is the same client: carry their name-keyed
          // state over before anything prunes against the new names.
          const prior = get().players.length > 0 ? renameSeedFrom(get().players) : get().renameSeed
          const renames = findRenames(prior, result.players)
          const hasRenames = Object.keys(renames).length > 0
          if (hasRenames) carryRenamesIntoStores(renames)
          // A roster far smaller than the last good one is shown, but nothing
          // is pruned and the last good count stays put until staff confirm
          // it: pruning is permanent, and a broken sheet view or truncated
          // registry build would otherwise wipe real clients' saved state.
          // It used to be held back instead, which on the registry source
          // (never saved in the browser) left the app empty on every reload.
          const previous = get().lastGoodCount ?? (get().players.length || null)
          if (!allowShrink && previous && isSharpDrop(previous, result.players.length)) {
            const message = sharpDropMessage(result.players.length, previous)
            set({
              players: applyOverrides(result.players, hasRenames ? renameKeys(get().visitOverrides, renames) : get().visitOverrides),
              loading: false,
              lastFetchedAt: new Date().toISOString(),
              source,
              generatedAt: result.generatedAt,
              needsSignIn: false,
              parseWarnings: result.warnings,
              ...(hasRenames ? { visitOverrides: renameKeys(get().visitOverrides, renames) } : {}),
              renameSeed: [],
              shrinkBlocked: { count: result.players.length, previous },
            })
            const diag = useDiagnosticsStore.getState()
            diag.clearSource('roster')
            diag.addIssue({ level: 'warning', source: 'roster', message })
            return
          }
          // Prune stale visitOverrides for players no longer on the roster
          // (and move name-keyed ones onto the slug when the registry has one).
          const overrides = hasRenames ? renameKeys(get().visitOverrides, renames) : get().visitOverrides
          const prunedOverrides = pruneOverrides(overrides, result.players)
          const players = applyOverrides(result.players, prunedOverrides)
          set({
            players,
            loading: false,
            lastFetchedAt: new Date().toISOString(),
            source,
            generatedAt: result.generatedAt,
            needsSignIn: false,
            parseWarnings: result.warnings,
            visitOverrides: prunedOverrides,
            lastGoodCount: players.length,
            renameSeed: [],
          })

          // Removed from the master sheet = removed from the app (Tom
          // 2026-08-17). Persisted names outlive the roster otherwise —
          // team assignments keep stamping ex-clients onto games, and
          // priority picks / rehab windows / summer assignments keep
          // surfacing them elsewhere. Prune every persisted name store
          // against the fresh roster.
          useScheduleStore.getState().pruneRemovedPlayers()
          useTripStore.getState().pruneRemovedPlayers()
          useRehabStore.getState().pruneRemovedPlayers()
          useSummerStore.getState().pruneRemovedPlayers()

          // Diagnostics
          const diag = useDiagnosticsStore.getState()
          diag.clearSource('roster')
          if (result.warnings.length > 0) {
            for (const warning of result.warnings) {
              diag.addIssue({
                level: 'warning',
                source: 'roster',
                message: warning,
              })
            }
          }
        } catch (e) {
          if (e instanceof RosterAuthError) {
            if (e.status === 401) {
              // The registry rejected a token we thought was fresh. That is a
              // configuration problem (OAuth origin, audience, consumer entry),
              // not a stale sign-in, so do NOT drop the token or re-prompt:
              // with One Tap auto-select that re-signed and refetched in a
              // loop. Show the error and stop; the sheet is not a fallback.
              const message = REGISTRY_REJECTED_MESSAGE
              set({ loading: false, needsSignIn: false, error: message })
              useDiagnosticsStore.getState().addIssue({ level: 'error', source: 'roster', message })
              return
            }
            // No usable token yet: show the sign-in bar. Not an error: the
            // Roster tab shows a sign-in prompt, and a roster already on
            // screen (token expired on Refresh) stays on screen.
            set({ loading: false, needsSignIn: true, error: null })
            return
          }
          // Any other outcome happened with a token in hand (or on the sheet),
          // so the sign-in bar must go and the real error show instead.
          set({ loading: false, needsSignIn: false, error: e instanceof Error ? e.message : 'Unknown error' })
          if (source === 'registry') {
            useDiagnosticsStore.getState().addIssue({
              level: 'error',
              source: 'roster',
              message: `Registry roster load failed (no sheet fallback): ${e instanceof Error ? e.message : String(e)}`,
            })
          }
        }
      },

      acceptSmallerRoster: async () => {
        allowShrinkOnce = true
        try {
          await get().fetchRoster()
        } finally {
          allowShrinkOnce = false
        }
      },

      setVisitOverride: (playerName, visitsCompleted, lastVisitDate) => {
        const key = overrideKeyForName(get().players, playerName)
        const overrides = { ...get().visitOverrides, [key]: { visitsCompleted, lastVisitDate, appliedAt: new Date().toISOString() } }
        const players = applyOverrides(get().players, overrides)
        set({ visitOverrides: overrides, players })
      },

      clearVisitOverride: (playerName) => {
        const overrides = { ...get().visitOverrides }
        const p = get().players.find((x) => x.playerName === playerName)
        delete overrides[playerName]
        if (p) delete overrides[playerKey(p)]
        set({ visitOverrides: overrides })
      },

      setSortColumn: (column) => set({ sortColumn: column }),
      setSortDirection: (dir) => set({ sortDirection: dir }),
    }),
    {
      name: 'sv-travel-roster',
      version: ROSTER_PERSIST_VERSION,
      migrate: (persisted, version) => migrateRosterPersist(persisted, version) as RosterState,
      partialize: (state) => ({
        // Defence in depth: RosterPlayer no longer carries contact fields, but
        // scrub anyway so a future field can't quietly land in localStorage.
        // Registry source: never persist the roster. The door answers
        // `private, no-store` and the SOP says not to cache it beyond a few
        // minutes, so a signed-out browser must not keep a copy.
        players: getRosterSourceOrNull() === 'registry' ? [] : state.players.map(scrubPlayer),
        lastFetchedAt: state.lastFetchedAt,
        visitOverrides: state.visitOverrides,
        lastGoodCount: state.lastGoodCount,
        // Only pending until the first registry load uses it (then []).
        renameSeed: getRosterSourceOrNull() === 'registry' ? state.renameSeed : [],
        sortColumn: state.sortColumn,
        sortDirection: state.sortDirection,
      }),
      merge: (persisted, current) => {
        const p = persisted as any
        const registry = getRosterSourceOrNull() === 'registry'
        return {
          ...current,
          ...(p ?? {}),
          // Registry source starts empty: a snapshot left by the sheet build
          // must not paint as if it came from the registry. Its fetch time
          // goes too, so nothing calls an empty roster current.
          players: registry ? [] : (p?.players ?? []),
          lastFetchedAt: registry ? null : (p?.lastFetchedAt ?? null),
          // That sheet snapshot still says who each client was by slug or
          // MLB id, so keep just that for the first registry load.
          renameSeed: registry
            ? (Array.isArray(p?.renameSeed) && p.renameSeed.length > 0 ? p.renameSeed : renameSeedFrom(Array.isArray(p?.players) ? p.players : []))
            : [],
          // Snapshots from before the count was kept: the persisted roster's
          // size is the last good count (so a build that also flips to the
          // registry is still guarded on its first load).
          lastGoodCount: typeof p?.lastGoodCount === 'number'
            ? p.lastGoodCount
            : (Array.isArray(p?.players) && p.players.length > 0 ? p.players.length : null),
          shrinkBlocked: null,
          visitOverrides: p?.visitOverrides ?? {},
          sortColumn: p?.sortColumn ?? 'tier',
          sortDirection: p?.sortDirection ?? 'asc',
        }
      },
    },
  ),
)
