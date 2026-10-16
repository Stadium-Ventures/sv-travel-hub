// Shared shapes for the daily health monitor (api/health-monitor.ts) and the
// check modules it runs. Type-only: nothing here runs.

/** One problem the monitor may post to #sv-automation.
 *
 *  Every text field is read cold by a non-engineer on a phone, so it is plain
 *  English: no code names, setting names, status codes, thresholds or file
 *  paths (api/_lib/__tests__/monitorCopy.test.ts enforces this). */
export interface Finding {
  /** Stable id. The in-run re-check matches a partial finding across the two
   *  passes by this key. Never shown to anyone. */
  key: string
  severity: 'critical' | 'warning'
  /** true → 🛠️ a Claude Code change; false → 👤 a manual/ops step. */
  code: boolean
  /** Short headline, e.g. "2 clients have games the map can't place". */
  title: string
  /** What broke. */
  what: string
  /** How we know. */
  how: string
  /** What to do. */
  todo: string
  /** A partial problem (some clients, one endpoint, one league). The monitor
   *  re-runs the check after a short pause and posts it only if it is still
   *  there. Total outages leave this unset and post on first sight. */
  partial?: boolean
  /** Item-level keys behind a partial finding (e.g. one per client). On the
   *  re-check pass the check receives the first pass's keys and keeps only
   *  the items it saw both times. */
  issueKeys?: string[]
}

/** GET a URL and parse JSON. Throws on a non-2xx answer, a timeout or bad
 *  JSON. Implementations may cache by URL within one pass. */
export type FetchJson = (url: string) => Promise<unknown>

/** One roster row, reduced to what the monitor's checks need. */
export interface RosterClient {
  name: string
  /** MLBAM id, or null when the roster has none. */
  mlbId: number | null
  /** Parent org (pros) or school (amateurs), as written on the roster. */
  org: string
  affiliate: string
  level: 'Pro' | 'NCAA' | 'HS'
  /** Raw roster level text ("Pro", "NCAA", "JUCO", ...). */
  levelRaw: string
  /** Roster status: '', 'Injured', 'Retired', 'Free Agent', ... */
  status: string
  isCoach: boolean
}

export interface RosterLoad {
  ok: boolean
  /** Raw CSV text when ok. */
  csv: string | null
  clients: RosterClient[]
}

/** What every check gets. Built fresh for each pass, so the re-check pass
 *  really re-fetches instead of reading the first pass's cache. */
export interface CheckContext {
  now: Date
  /** ?force=1: run the weekly and seasonal checks regardless of date. */
  force: boolean
  /** Monday's run (or ?force=1): the weekly data-hygiene checks run. */
  weekly: boolean
  /** The weekly Slack recap is paused, so its checks are skipped. */
  recapPaused: boolean
  /** The client roster (memoized per pass). */
  roster: () => Promise<RosterLoad>
  /** JSON fetcher with a per-pass cache, retries and a concurrency cap. */
  fetchJson: FetchJson
  /** Re-check pass only: the keys (finding keys and issue keys) of the
   *  partial findings the first pass raised. null on the first pass. */
  confirmKeys: Set<string> | null
}

export interface MonitorCheck<C extends CheckContext = CheckContext> {
  /** Stable id, used in keys and logs. */
  name: string
  /** Plain-English area name for the "didn't finish" finding, e.g.
   *  "client coverage". */
  label: string
  run: (ctx: C) => Promise<Finding[]>
}
