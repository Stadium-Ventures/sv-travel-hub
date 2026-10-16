import type { VercelRequest, VercelResponse } from '@vercel/node'
// Shared NCAA tables — same module the app resolves with (src/data re-exports
// it), so the monitor can never drift from the app. Lives under api/ because
// Vercel only compiles api/**/*.ts for functions; an import into src/ ships
// uncompiled and crashes at runtime (ERR_MODULE_NOT_FOUND, 2026-08-05).
// The .js extension is required: Vercel runs functions as strict node ESM,
// which never resolves extensionless specifiers (ERR_MODULE_NOT_FOUND).
import { resolveNcaaName } from './_data/ncaaSchools.js'
import { SUMMER_LEAGUES, parseSummerPlacementRows } from './_data/summerLeagues.js'
import type { SummerLeagueCode, SummerPlacementRow } from './_data/summerLeagues.js'
import {
  HEARTBEAT_APP_URLS,
  heartbeatAccessFinding,
  heartbeatReadHeaders,
  heartbeatTokenConfigured,
} from './_lib/heartbeatAuth.js'
import { rosterCsvRequest, checkRowFloor, RosterConfigError, type RosterCsvRequest } from './_lib/rosterSource.js'
import { RECAP_PAUSED } from './_lib/recapStatus.js'
import { headerIndex, monthDay, normalizeIsoDate, parseCsv } from './_lib/csv.js'
import { createFetchJson, loadAflClubs, loadOrgIndex, loadRoster, MLB_BASE } from './_lib/mlbClient.js'
import { coverageFindings, runCoverageCheck } from './_lib/coverageCheck.js'
import { checkHsClientCoverage, checkHsSheetSeason, checkSpringTraining, isHsClientWindow, isHsSeasonWindow, isSpringTurnWindow } from './_lib/seasonTurnChecks.js'
import { ncaaSeasonCheck } from './_lib/ncaaSeasonCheck.js'
import { runChecksWithRecheck, type RunStats } from './_lib/monitorRunner.js'
import {
  VERCEL_ENV_URL,
  buildMessage,
  monitorCrashed,
  recap as recapCopy,
  roster as rosterCopy,
  sources,
  weekly,
  wiringTest,
} from './_lib/monitorCopy.js'
import { isSkippedClient, parseRosterClients } from './_lib/rosterClients.js'
import type { CheckContext, Finding, MonitorCheck, RosterLoad } from './_lib/monitorTypes.js'

// SV Travel Hub — daily health check, posted to #sv-automation.
//
// Two questions, every morning (Vercel cron, 13:00 UTC):
//  1. Is every source the hub reads up? The client roster (sv-registry or the
//     roster sheet), the HS/JUCO schedule sheet, the events sheet, Heartbeat
//     (all three pages the app reads) and MLB's stats service.
//  2. Can the hub actually show every client's games? The client coverage
//     check (api/_lib/coverageCheck.ts) looks every pro client up in MLB's
//     records: team found, organization matches, fields on the map.
// Mondays it also runs the data-hygiene and season-turn checks (college
// school names, the college season hook, HS/JUCO season, summer placements,
// Arizona Fall League, next spring's MLB schedule).
//
// The weekly Slack recap (api/slack-recap.ts) is paused (api/_lib/
// recapStatus.ts). While it is, every recap-only check (its Slack token and
// channel, its dry run, its empty-recap tests, its Heartbeat key) is skipped.
//
// Noise control is stateless (no storage). The cron is daily, which caps any
// lingering problem at one post a day. Total outages post on first sight. A
// partial problem (some clients, one Heartbeat page, one league) is re-checked
// after a short pause in the same run and posts only if it is still there
// (api/_lib/monitorRunner.ts). Silent when healthy; no recovery posts. Every
// message follows the plain-English contract in api/_lib/monitorCopy.ts.
//
// Liveness: the health-deadman GitHub Actions workflow probes ?dryRun=1 daily
// from outside Vercel and alerts only when the probe fails. Its curl gives up
// after 60s, so a dry run skips the re-check pass unless ?recheck=1.
//
// Env (all in Vercel):
//   CRON_SECRET                    — guards this endpoint (shared with the recap)
//   SV_AUTOMATION_WEBHOOK_URL      — incoming webhook for #sv-automation
//   VITE_ROSTER_SOURCE             — sheet (default) | registry: which roster to read
//   VITE_ROSTER_CSV_URL            — roster sheet (sheet source)
//   SV_REGISTRY_ROSTER_TOKEN       — svt_ token, read:roster-projection (registry source; server-only)
//   VITE_SCHEDULE_CSV_URL          — HS/JUCO schedule sheet
//   VITE_EVENTS_CSV_URL            — events sheet (has a code default if unset)
//   VITE_SUMMER_CSV_URL            — Summer Ball Placement sheet (summer checks)
//   VITE_SUMMER_MANUAL_CSV_URL     — hand-entered summer games (Northwoods etc.)
//   SLACK_BOT_TOKEN + SLACK_CHANNEL_TRAVEL_SCHEDULE — what the Monday recap posts with
//   HEARTBEAT_READ_TOKEN           — optional, server-only: Bearer for sv-heartbeat's
//                                    gated API (api/_lib/heartbeatAuth.ts)
//   SELF_BASE_URL                  — override for the recap dry-run self-call
//                                    (defaults to the prod domain)
//
// Usage (every request needs the header `Authorization: Bearer <CRON_SECRET>`;
// the Vercel cron sends it automatically):
//   GET /api/health-monitor                     (daily cron / manual)
//   GET /api/health-monitor?dryRun=1            (compute findings, do NOT post; one pass)
//   GET /api/health-monitor?dryRun=1&recheck=1  (same, with the real re-check pass)
//   GET /api/health-monitor?test=1              (post a harmless test finding)
//   GET /api/health-monitor?force=1             (run the Monday-only + seasonal checks
//                                                now, ignoring their date windows)

// Worst case: pass 1 (all checks in parallel, each capped at
// CHECK_TIMEOUT_MS) + RECHECK_PAUSE_MS + pass 2 (same cap) + the webhook post
// = 85 + 15 + 85 + 15 = 200s, well inside Vercel Pro's 300s. The slowest
// check on a bad day is the client coverage check: four rounds of MLB
// requests at 2 tries x 8s each (about 66s).
export const config = { maxDuration: 300 }
const CHECK_TIMEOUT_MS = 85_000
const RECHECK_PAUSE_MS = 15_000
const DRY_RUN_CHECK_TIMEOUT_MS = 45_000

const HUB_URL = 'https://sv-travel-hub.vercel.app'
const EVENTS_CSV_DEFAULT =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSWoPys4nn-twC2weVoG-DlOHu9JhzXZgYVMJXNmJwPFbNbsLPgzjMzHVK2nUNfLbp7h10itgnAlTPU/pub?output=csv'
const MLB_PROBE_URL = `${MLB_BASE}/teams/affiliates?teamIds=147&sportIds=1,11,12,13,14`

// ─── Handler ─────────────────────────────────────────────────────────────────

const WEBHOOK_DOWN_ERROR =
  'Findings could NOT be delivered to #sv-automation — SV_AUTOMATION_WEBHOOK_URL is unset or the webhook post failed. The monitor is effectively mute; fix the webhook.'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: `Authorization: Bearer <CRON_SECRET>` ONLY (the Vercel cron sends it
  // automatically). Secrets in query strings leak into request logs.
  const expected = process.env.CRON_SECRET ?? ''
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET not configured' })
  const headerSecret = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (headerSecret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const flag = (v: unknown) => v === '1' || v === 'true'
  const dryRun = flag(req.query.dryRun)
  const force = flag(req.query.force)
  const recheck = !dryRun || flag(req.query.recheck)

  // ?test=1 → post one harmless finding to confirm the #sv-automation wiring
  // end to end. Never fires on cron.
  if (flag(req.query.test)) {
    const posted = await notifyAutomation(buildMessage([wiringTest()]))
    if (!posted) return res.status(500).json({ test: true, posted, error: WEBHOOK_DOWN_ERROR })
    return res.status(200).json({ test: true, posted })
  }

  const started = Date.now()
  try {
    const { findings, stats } = await runMonitor({ now: new Date(), force, recheck, checkTimeoutMs: dryRun ? DRY_RUN_CHECK_TIMEOUT_MS : CHECK_TIMEOUT_MS })
    const posted = !dryRun && findings.length > 0 ? await notifyAutomation(buildMessage(findings)) : false
    logRunSummary(findings, stats, { posted, dryRun, ms: Date.now() - started })

    if (dryRun) return res.status(200).json({ ok: findings.length === 0, findings, stats, posted: false, dryRun: true })
    // A monitor that finds problems but can't say so is itself broken —
    // surface it as an error instead of silently returning 200.
    if (findings.length > 0 && !posted) return res.status(500).json({ ok: false, findings, posted, error: WEBHOOK_DOWN_ERROR })
    // Silent when healthy — always (Tom killed all-clear posts 2026-08-03).
    return res.status(200).json({ ok: findings.length === 0, findings, posted })
  } catch (e) {
    // The monitor itself failing shouldn't be silent, but only alert on real
    // runs: a crash during a manual ?dryRun=1 poke is visible right there.
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[health-monitor] crashed:', msg)
    if (!dryRun) await notifyAutomation(buildMessage([monitorCrashed()]))
    return res.status(500).json({ error: msg })
  }
}

/** The one log line per run: counts only (this repo is public and findings
 *  can name clients). */
function logRunSummary(findings: Finding[], stats: RunStats, run: { posted: boolean; dryRun: boolean; ms: number }): void {
  const critical = findings.filter((x) => x.severity === 'critical').length
  console.log(
    `[health-monitor] run checks=${stats.checks} findings=${findings.length} critical=${critical} warning=${findings.length - critical}` +
    ` partialSeen=${stats.partialSeen} partialConfirmed=${stats.partialConfirmed} rechecked=${stats.rechecked}` +
    ` timedOut=${stats.timedOut} errored=${stats.errored} posted=${run.posted} dryRun=${run.dryRun} ms=${run.ms}`,
  )
}

// ─── Running the checks ──────────────────────────────────────────────────────

/** Per-pass context: the generic one plus the raw probes the source checks
 *  share (each fetched once per pass). */
interface MonitorContext extends CheckContext {
  rosterProbe: () => Promise<RosterProbe>
  scheduleSheet: () => Promise<ProbeResult | null>
}

interface RosterProbe {
  load: RosterLoad
  request: RosterCsvRequest | null
  configError: RosterConfigError | null
  probe: ProbeResult
  /** Row count when the registry roster came back under its floor. */
  shortRows: number | null
}

function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null
  return () => (p ??= fn())
}

function makeContext(now: Date, force: boolean, confirmKeys: Set<string> | null): MonitorContext {
  const rosterProbe = memo(loadRosterProbe)
  return {
    now,
    force,
    weekly: force || now.getUTCDay() === 1,
    recapPaused: RECAP_PAUSED,
    roster: () => rosterProbe().then((r) => r.load),
    rosterProbe,
    scheduleSheet: memo(async () => {
      const url = process.env.VITE_SCHEDULE_CSV_URL
      return url ? probeCsv(url) : null
    }),
    fetchJson: createFetchJson(),
    confirmKeys,
  }
}

async function loadRosterProbe(): Promise<RosterProbe> {
  let request: RosterCsvRequest | null = null
  let configError: RosterConfigError | null = null
  try {
    request = rosterCsvRequest()
  } catch (e) {
    configError = e instanceof RosterConfigError ? e : new RosterConfigError(String(e), null, '')
  }
  const empty: RosterLoad = { ok: false, csv: null, clients: [] }
  if (!request) return { load: empty, request, configError, probe: { ok: false, reason: 'no roster source configured' }, shortRows: null }
  const probe = await probeCsv(request.url, request.headers)
  if (!probe.ok || !probe.text) return { load: empty, request, configError, probe, shortRows: null }
  // Registry source: a short roster is a failure (fail closed), not "ok".
  const dataRows = probe.text.split('\n').filter((l) => l.trim() !== '').length - 1
  if (checkRowFloor(request.source, dataRows)) return { load: empty, request, configError, probe, shortRows: dataRows }
  return { load: { ok: true, csv: probe.text, clients: parseRosterClients(probe.text) }, request, configError, probe, shortRows: null }
}

export interface MonitorRunOptions {
  now: Date
  force: boolean
  /** false: one pass, partial findings reported as-is (dry runs). */
  recheck: boolean
  checkTimeoutMs: number
  pauseMs?: number
}

/** Build today's check list and run it. Exported for local dry runs. */
export async function runMonitor(opts: MonitorRunOptions): Promise<{ findings: Finding[]; stats: RunStats }> {
  const weeklyRun = opts.force || opts.now.getUTCDay() === 1
  const checks: Array<MonitorCheck<MonitorContext>> = []
  if (!RECAP_PAUSED) checks.push(recapSlackCheck)
  checks.push(rosterCheck, hsSheetCheck, eventsCheck, heartbeatCheck, mlbCheck, coverageCheck, ncaaScheduleCheck)
  if (!RECAP_PAUSED) checks.push(recapDryRunCheck)
  if (weeklyRun) {
    checks.push(ncaaSchoolNamesCheck, hsSeasonCheck, summerCheck, aflRostersCheck, springTrainingCheck)
  }
  return runChecksWithRecheck(checks, {
    makeContext: (confirmKeys) => makeContext(opts.now, opts.force, confirmKeys),
    pauseMs: opts.pauseMs ?? RECHECK_PAUSE_MS,
    checkTimeoutMs: opts.checkTimeoutMs,
    // A dry run without the re-check reports partial findings straight away.
    recheck: opts.recheck,
    logError: (name, err) => console.error(`[health-monitor] check ${name} failed:`, err instanceof Error ? err.message : String(err)),
  })
}

/** College schedules: each client school's source still reads, in fall ball
 *  and the college season (the check keeps its own windows). Daily, so a
 *  site redesign mid-season is caught the next morning. */
const ncaaScheduleCheck: MonitorCheck<MonitorContext> = {
  name: 'ncaa-season',
  label: 'college schedule',
  run: ncaaSeasonCheck,
}

// ─── Daily: sources ──────────────────────────────────────────────────────────

const rosterCheck: MonitorCheck<MonitorContext> = {
  name: 'roster',
  label: 'client roster',
  run: async (ctx) => {
    const r = await ctx.rosterProbe()
    if (!r.request) {
      const source = r.configError?.source ?? null
      return [source === 'sheet' ? rosterCopy.sheetLinkMissing() : source === 'registry' ? rosterCopy.registryKeyMissing() : rosterCopy.sourceMistyped()]
    }
    if (r.shortRows != null) return [rosterCopy.tooShort(r.shortRows)]
    if (!r.probe.ok) {
      if (r.request.source === 'sheet') return [rosterCopy.sheetUnreadable()]
      if (r.probe.status === 401) return [rosterCopy.registryRefused('rejected')]
      if (r.probe.status === 403) return [rosterCopy.registryRefused('not-allowed')]
      return [rosterCopy.registryDown()]
    }
    return []
  },
}

const hsSheetCheck: MonitorCheck<MonitorContext> = {
  name: 'hs-sheet',
  label: 'high school schedule',
  run: async (ctx) => {
    const sheet = await ctx.scheduleSheet()
    return sheet && !sheet.ok ? [sources.hsSheetUnreadable()] : []
  },
}

const eventsCheck: MonitorCheck<MonitorContext> = {
  name: 'events',
  label: 'events sheet',
  run: async () => {
    const events = await probeCsv(process.env.VITE_EVENTS_CSV_URL || EVENTS_CSV_DEFAULT)
    return events.ok ? [] : [sources.eventsSheetUnreadable()]
  },
}

/** All three Heartbeat pages the app reads, not just the summary. A 401/403
 *  is an answer (Heartbeat is up); whether Travel Hub's own server key gets
 *  in only matters to the recap. */
const heartbeatCheck: MonitorCheck<MonitorContext> = {
  name: 'heartbeat',
  label: 'Heartbeat',
  run: async (ctx) => {
    const headers = heartbeatReadHeaders()
    const [summary, priority, counts] = await Promise.all([
      probeJson(HEARTBEAT_APP_URLS.summary, headers),
      probeJson(HEARTBEAT_APP_URLS.visitPriority, headers),
      probeJson(HEARTBEAT_APP_URLS.visitCounts, headers),
    ])
    const out: Finding[] = []
    if (!ctx.recapPaused) {
      const access = heartbeatAccessFinding(
        { status: summary.status ?? null, svAuth: summary.svAuth ?? null },
        { tokenSet: heartbeatTokenConfigured(), weekly: ctx.weekly, envUrl: VERCEL_ENV_URL },
      )
      if (access) out.push(access)
    }
    const answered = (p: ProbeResult) => p.ok || p.status === 401 || p.status === 403
    const down = ([['the overdue list', summary], ['visit priorities', priority], ['visit counts', counts]] as const)
      .filter(([, p]) => !answered(p))
      .map(([part]) => part)
    if (down.length === 3) out.push(sources.heartbeatDown())
    else if (down.length > 0) out.push(sources.heartbeatPartlyDown([...down]))
    return out
  },
}

const mlbCheck: MonitorCheck<MonitorContext> = {
  name: 'mlb',
  label: 'MLB schedule',
  run: async () => ((await probeJson(MLB_PROBE_URL)).ok ? [] : [sources.mlbDown()]),
}

// ─── Daily: client coverage ──────────────────────────────────────────────────

const coverageCheck: MonitorCheck<MonitorContext> = {
  name: 'coverage',
  label: 'client coverage',
  run: async (ctx) => {
    const roster = await ctx.roster()
    if (!roster.ok) return [] // the roster check reports why
    let issues = await runCoverageCheck(roster.clients, { now: ctx.now, fetchJson: ctx.fetchJson })
    // Re-check pass: keep only what the first pass also saw.
    if (ctx.confirmKeys) issues = issues.filter((i) => ctx.confirmKeys!.has(i.key))
    return coverageFindings(issues)
  },
}

// ─── Weekly recap (only while it runs) ───────────────────────────────────────

const recapSlackCheck: MonitorCheck<MonitorContext> = {
  name: 'recap-slack',
  label: 'weekly recap Slack',
  run: async () => {
    const botToken = process.env.SLACK_BOT_TOKEN
    const channel = process.env.SLACK_CHANNEL_TRAVEL_SCHEDULE
    if (!botToken || !channel) return [recapCopy.slackMissing()]
    // Mis-route guard: posting to #sv-automation "works", so nothing else
    // would flag the digest landing in the alerts channel every Monday.
    if (/^C0BE0ELP92Q$|sv-automation/i.test(channel)) return [recapCopy.misrouted()]
    return probeSlackCredentials(botToken, channel)
  },
}

const recapDryRunCheck: MonitorCheck<MonitorContext> = {
  name: 'recap-dry-run',
  label: 'weekly recap',
  run: async (ctx) => {
    const roster = await ctx.rosterProbe()
    const rosterBroken = !roster.load.ok
    const dry = await fetchRecapDryRun()
    if (!dry.ok) {
      // If the roster is down, that's the root cause and already reported.
      if (rosterBroken) return []
      console.warn('[health-monitor] recap dry run failed:', dry.reason)
      return [recapCopy.buildFailed()]
    }
    const rosterSize = typeof dry.body.rosterSize === 'number' ? dry.body.rosterSize : null
    const gameCount = typeof dry.body.gameCount === 'number' ? dry.body.gameCount : null
    if (rosterSize === 0 && !rosterBroken) return [recapCopy.emptyRoster()]
    // Zero games across every source mid-season almost always means a source
    // broke. Mar to Sep only: the recap doesn't read the fall league.
    const m = ctx.now.getUTCMonth()
    if (gameCount === 0 && rosterSize !== 0 && !rosterBroken && m >= 2 && m <= 8) return [recapCopy.zeroGames()]
    return []
  },
}

// ─── Weekly: data hygiene and season turn ────────────────────────────────────
//
// Seasonal calendar (UTC; Mondays, or any day with ?force=1):
//   every week      NCAA: client schools the hub can't match to a program
//   Nov 16–Feb 15   Pro: next spring training is in MLB's schedule per client org
//   Dec–May         HS/JUCO: the schedule the hub reads has the new season
//   Jan 5–May 15    HS/JUCO: every high school client's school has games in it
//   May 15–Aug 15   Summer: placements, no-feed leagues, team names
//   Sep 15–Nov 20   Arizona Fall League: clubs exist; rosters filled from Oct 1
// Stateless, so they re-alert every Monday until fixed — deliberate: each one
// is a client whose games are invisible in the app.

/** NCAA roster rows (name + school), excluding JUCO (not on D1Baseball) and
 *  blank schools (sv-scouting-data's daily roster-sync already alerts those).
 *  Injured, retired and free-agent clients are skipped. */
function rosterNcaa(load: RosterLoad): Array<{ name: string; org: string }> {
  return load.clients
    .filter((c) => c.level === 'NCAA' && c.org && !isSkippedClient(c))
    .filter((c) => { const l = c.levelRaw.toLowerCase(); return !l.includes('juco') && !l.includes('junior') })
    .map((c) => ({ name: c.name, org: c.org }))
}

/** A roster school resolveNcaaName can't match is silently skipped by the
 *  app's NCAA fetch — the client just has no games. */
const ncaaSchoolNamesCheck: MonitorCheck<MonitorContext> = {
  name: 'ncaa-names',
  label: 'college school names',
  run: async (ctx) => {
    const roster = await ctx.roster()
    if (!roster.ok) return []
    const unmatched = new Map<string, string[]>()
    for (const p of rosterNcaa(roster)) {
      if (resolveNcaaName(p.org)) continue
      const list = unmatched.get(p.org)
      if (list) list.push(p.name)
      else unmatched.set(p.org, [p.name])
    }
    if (unmatched.size === 0) return []
    return [weekly.ncaaSchoolsUnmatched([...unmatched.entries()].map(([school, names]) => ({ school, names })))]
  },
}

const hsSeasonCheck: MonitorCheck<MonitorContext> = {
  name: 'hs-season',
  label: 'high school season',
  run: async (ctx) => {
    if (!ctx.force && !isHsSeasonWindow(ctx.now)) return []
    const sheet = await ctx.scheduleSheet()
    if (!sheet?.ok || !sheet.text) return []
    const findings = checkHsSheetSeason(sheet.text, ctx.now)
    // Per-client coverage only once the sheet has the new season at all.
    if (findings.length > 0 || (!ctx.force && !isHsClientWindow(ctx.now))) return findings
    const roster = await ctx.roster()
    return roster.ok ? checkHsClientCoverage(sheet.text, roster.clients, ctx.now) : []
  },
}

const springTrainingCheck: MonitorCheck<MonitorContext> = {
  name: 'spring-training',
  label: 'spring training schedule',
  run: async (ctx) => {
    if (!ctx.force && !isSpringTurnWindow(ctx.now)) return []
    const roster = await ctx.roster()
    if (!roster.ok) return []
    let orgs
    try {
      // This year's club list (cached from the coverage check): club ids
      // don't change between seasons, and next year's list may not exist yet.
      orgs = await loadOrgIndex(ctx.fetchJson, ctx.now.getUTCFullYear())
    } catch {
      return [] // MLB unreachable: the MLB probe reports it
    }
    const ids = new Set<number>()
    for (const c of roster.clients) {
      if (c.level !== 'Pro' || isSkippedClient(c)) continue
      const id = orgs.resolve(c.org)
      if (id != null) ids.add(id)
    }
    return checkSpringTraining([...ids], (id) => orgs.name(id), ctx.now, ctx.fetchJson)
  },
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
}

/** Same key the app's summerStore uses to tie a placement to a roster row. */
function nameKey(s: string): string {
  return s.trim().toLowerCase()
}

/** Last name + first initial, to spot a placement typed under a nickname or
 *  misspelling ("Sammy Mitchell" for roster "Sam Mitchell"). */
function looseKey(s: string): string {
  const parts = normName(s).split(' ').filter(Boolean)
  if (parts.length < 2) return normName(s)
  return `${parts[0]![0]} ${parts[parts.length - 1]}`
}

function normTeam(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

/** Summer ball, mid-May to mid-Aug. Three gaps, each one a client with no
 *  summer games on the map:
 *   1. (through Jun 30) college clients with no row on the placement sheet;
 *   2. placements in leagues with no feed (PrestoSports + manual leagues)
 *      that have no games on the manual summer sheet;
 *   3. placements in MLB-API leagues (Cape, Draft League, Appy) whose team
 *      name doesn't match the league's team list, so no schedule is pulled. */
const summerCheck: MonitorCheck<MonitorContext> = {
  name: 'summer',
  label: 'summer ball',
  run: async (ctx) => {
    const md = monthDay(ctx.now)
    if (!ctx.force && (md < 515 || md > 815)) return []
    const findings: Finding[] = []
    const season = ctx.now.getUTCFullYear()
    const sheetUrl = process.env.VITE_SUMMER_CSV_URL
    if (!sheetUrl) return [weekly.summerSheetNotConnected()]
    const sheet = await probeCsv(sheetUrl)
    if (!sheet.ok || !sheet.text) return [weekly.summerSheetUnreadable()]
    // The roster is the source of truth: the app ignores placements for names
    // not on it. Without a roster the roster check has already raised a
    // critical.
    const roster = await ctx.roster()
    if (!roster.ok) return []
    const rosterKeys = new Set(roster.clients.map((c) => nameKey(c.name)))
    const sheetRows = parseCsv(sheet.text)
    const { placements: allPlacements } = parseSummerPlacementRows(sheetRows)
    const placements = allPlacements.filter((p) => rosterKeys.has(nameKey(p.playerName)))
    const active = placements.filter((p) => p.active)

    // 1. College clients with no placement, while placements are still landing.
    if (ctx.force || md <= 630) {
      // A row with a status but no team (e.g. "Shut Down") still means someone
      // made the call, so it counts as handled. A bare name does not.
      const handled = new Set<string>()
      const looseToSheetName = new Map<string, string>()
      for (const row of sheetRows) {
        const name = (row[0] ?? '').trim()
        if (!name || ![row[2], row[3], row[4]].some((c) => (c ?? '').trim())) continue
        handled.add(nameKey(name))
        looseToSheetName.set(looseKey(name), name)
      }
      const college = rosterNcaa(roster)
      const unplaced: string[] = []
      const misspelled: string[] = []
      for (const p of college) {
        if (handled.has(nameKey(p.name))) continue
        const near = looseToSheetName.get(looseKey(p.name))
        if (near && !rosterKeys.has(nameKey(near))) misspelled.push(`"${near}" (roster: ${p.name})`)
        else unplaced.push(p.name)
      }
      unplaced.sort()
      misspelled.sort()
      if (misspelled.length > 0) findings.push(weekly.summerMisspelled(misspelled))
      if (college.length > 0 && handled.size === 0) findings.push(weekly.summerNoPlacements(college.length))
      else if (unplaced.length > 0) findings.push(weekly.summerUnplaced(unplaced))
    }

    // 2. Leagues with no feed: games only exist if they're on the manual sheet.
    const noFeed = active.filter((p) => SUMMER_LEAGUES[p.league].source !== 'mlb-api')
    if (noFeed.length > 0) {
      const manualUrl = process.env.VITE_SUMMER_MANUAL_CSV_URL
      let covered = new Set<string>()
      let manual: 'ok' | 'not-connected' | 'unreadable' = 'ok'
      if (!manualUrl) {
        manual = 'not-connected'
      } else {
        const sheet2 = await probeCsv(manualUrl)
        if (!sheet2.ok || !sheet2.text) manual = 'unreadable'
        else covered = manualSheetPlayers(sheet2.text, season)
      }
      const missing = noFeed.filter((p) => !covered.has(normName(p.playerName)))
      if (missing.length > 0) {
        const list = missing
          .sort((a, b) => a.playerName.localeCompare(b.playerName))
          .map((p) => `${p.playerName} (${p.summerTeam}, ${SUMMER_LEAGUES[p.league].name})`)
        findings.push(weekly.summerNoFeedMissing(list, manual, season))
      }
    }

    // 3. MLB-API leagues: the team name on the sheet has to match the league's
    //    team list, or the app pulls nothing for that player.
    const byLeague = new Map<SummerLeagueCode, SummerPlacementRow[]>()
    for (const p of active) {
      if (SUMMER_LEAGUES[p.league].source !== 'mlb-api') continue
      const list = byLeague.get(p.league)
      if (list) list.push(p)
      else byLeague.set(p.league, [p])
    }
    const unmatched: string[] = []
    const blind: string[] = []
    await Promise.all([...byLeague.entries()].map(async ([code, list]) => {
      const leagueId = SUMMER_LEAGUES[code].mlbApiLeagueId
      const names = await fetchMlbTeamNames(ctx, `${MLB_BASE}/teams?leagueIds=${leagueId}&season=${season}`)
      if (!names || names.length === 0) { blind.push(SUMMER_LEAGUES[code].name); return }
      for (const p of list) {
        const target = normTeam(p.summerTeam)
        const hit = names.some((n) => { const t = normTeam(n); return t === target || t.includes(target) || target.includes(t) })
        if (!hit) unmatched.push(`${p.playerName} ("${p.summerTeam}", ${SUMMER_LEAGUES[code].name})`)
      }
    }))
    if (unmatched.length > 0) findings.push(weekly.summerTeamUnmatched(unmatched.sort()))
    if (blind.length > 0) findings.push(weekly.summerLeaguesBlind(blind.sort(), season))
    return findings
  },
}

/** Players with at least one this-season game on the manual summer sheet. */
function manualSheetPlayers(csv: string, season: number): Set<string> {
  const rows = parseCsv(csv)
  const out = new Set<string>()
  if (rows.length < 2) return out
  const iPlayer = headerIndex(rows[0]!, ['player', 'player name', 'name'])
  const iDate = headerIndex(rows[0]!, ['date'])
  if (iPlayer < 0 || iDate < 0) return out
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const d = normalizeIsoDate((row[iDate] ?? '').trim())
    if (!d.startsWith(`${season}-`)) continue
    const n = normName(row[iPlayer] ?? '')
    if (n) out.add(n)
  }
  return out
}

/** Team names from an MLB Stats API /teams call. null = request failed. */
async function fetchMlbTeamNames(ctx: CheckContext, url: string): Promise<string[] | null> {
  try {
    const data = await ctx.fetchJson(url) as { teams?: Array<Record<string, unknown>> }
    const names: string[] = []
    for (const t of data.teams ?? []) {
      for (const k of ['name', 'teamName', 'shortName', 'locationName', 'clubName', 'franchiseName']) {
        const v = t[k]
        if (typeof v === 'string' && v.trim()) names.push(v.trim())
      }
    }
    return names
  } catch {
    return null
  }
}

/** Arizona Fall League, mid-Sep to late Nov. The app finds fall clients on its
 *  own by reading the six AFL club rosters from the MLB Stats API, so the
 *  thing to watch is that those rosters are there:
 *   - from Sep 15: the six clubs exist for this season;
 *   - from Oct 1 (games start early October): at least one roster has players.
 *  Zero SV clients in the AFL is a normal year, not an alert. (Which clients
 *  are there, and whether we can link them, is the daily coverage check.) */
const aflRostersCheck: MonitorCheck<MonitorContext> = {
  name: 'afl-rosters',
  label: 'fall league',
  run: async (ctx) => {
    const md = monthDay(ctx.now)
    if (!ctx.force && (md < 915 || md > 1120)) return []
    const season = ctx.now.getUTCFullYear()
    let clubs
    try {
      clubs = await loadAflClubs(ctx.fetchJson, season)
    } catch {
      return [] // a flaky API response is covered by the daily MLB probe
    }
    if (clubs.length === 0) return [weekly.aflNoClubs(season)]
    if (!ctx.force && md < 1001) return []
    const counts = await Promise.all(clubs.map((c) => loadRoster(ctx.fetchJson, c.id, season).then((r) => r.length).catch(() => -1)))
    if (counts.some((c) => c > 0)) return []
    if (counts.every((c) => c < 0)) return [] // unreachable, not empty; the MLB probe owns outages
    return [weekly.aflRostersEmpty(clubs.length)]
  },
}

// ─── Probes ──────────────────────────────────────────────────────────────────

interface ProbeResult {
  ok: boolean
  reason?: string
  text?: string
  /** HTTP status of the last attempt. */
  status?: number
  /** `x-sv-auth` verdict header, when the source has an SV auth gate. */
  svAuth?: string | null
}

/** Google's published-CSV endpoint (and any remote API) intermittently stalls
 *  or drops a single request while perfectly healthy — a one-shot probe turns
 *  every such blip into a false alert. Only report a source down after it
 *  fails every attempt (3 × 10s + pauses). */
async function withRetry(probe: () => Promise<ProbeResult>, attempts = 3): Promise<ProbeResult> {
  let last: ProbeResult = { ok: false, reason: 'not probed' }
  for (let i = 0; i < attempts; i++) {
    last = await probe()
    if (last.ok) return last
    // An auth answer is not a blip; retrying only repeats it.
    if (last.status === 401 || last.status === 403) break
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500))
  }
  return last
}

/** A source is "ok" only if it responds 2xx AND returns a non-trivial body —
 *  a published sheet that got unshared often 200s with an HTML error page or an
 *  empty CSV, which is exactly the silent failure we're hunting. */
function probeCsv(url: string, extraHeaders: Record<string, string> = {}): Promise<ProbeResult> {
  return withRetry(async () => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SVTravelHub/HealthMonitor', ...extraHeaders },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, status: res.status }
      const text = await res.text()
      // A real published sheet CSV has a header row + at least one data row.
      const dataRows = text.split('\n').filter((l) => l.trim() !== '')
      if (dataRows.length < 2) return { ok: false, reason: 'an empty response', status: res.status }
      // Google serves an HTML page (not CSV) when a sheet is unpublished/private.
      if (/^\s*<(!doctype|html)/i.test(text)) return { ok: false, reason: 'HTML instead of CSV', status: res.status }
      return { ok: true, text, status: res.status }
    } catch (e) {
      return { ok: false, reason: describeErr(e) }
    }
  })
}

function probeJson(url: string, extraHeaders: Record<string, string> = {}): Promise<ProbeResult> {
  return withRetry(async () => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SVTravelHub/HealthMonitor', ...extraHeaders },
        signal: AbortSignal.timeout(10_000),
      })
      const svAuth = res.headers.get('x-sv-auth')
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}`, status: res.status, svAuth }
      await res.json()
      return { ok: true, status: res.status, svAuth }
    } catch (e) {
      return { ok: false, reason: describeErr(e) }
    }
  })
}

/** Verify the recap's Slack credentials actually WORK: auth.test proves the
 *  bot token is live, and conversations.info on the recap channel catches an
 *  archived channel / kicked bot / wrong channel ID — all of which would make
 *  Monday's post silently fail. Probe errors (network blips) come back as a
 *  partial warning, re-checked before posting. All 12s calls run in sequence
 *  (the channel probe needs a live token), well inside the check's limit. */
async function probeSlackCredentials(botToken: string, channel: string): Promise<Finding[]> {
  try {
    const authRes = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(12_000),
    })
    const auth = await authRes.json() as { ok: boolean; error?: string }
    if (!auth.ok) return [recapCopy.tokenDead()]

    // conversations.info needs a channel ID; with a "#name", skip this half.
    if (!/^[CG][A-Z0-9]+$/.test(channel)) return []
    const infoRes = await fetch(`https://slack.com/api/conversations.info?channel=${encodeURIComponent(channel)}`, {
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(12_000),
    })
    const info = await infoRes.json() as { ok: boolean; error?: string; channel?: { is_archived?: boolean; is_member?: boolean } }
    if (!info.ok) {
      // missing_scope: the bot lacks channels:read / groups:read, so this
      // probe can't introspect the channel. That does NOT stop the recap from
      // posting (chat.postMessage needs only chat:write + membership), and Tom
      // decided not to grant the scope, so stay silent.
      return info.error === 'missing_scope' ? [] : [recapCopy.channelMissing()]
    }
    if (info.channel?.is_archived) return [recapCopy.channelArchived()]
    if (info.channel?.is_member === false) return [recapCopy.botNotInChannel()]
    return []
  } catch {
    return [recapCopy.slackUnverified()]
  }
}

interface DryRunResult { ok: boolean; reason?: string; body: Record<string, unknown> }

/** Call the real recap endpoint in dry-run mode on this same deployment.
 *  Auth goes in the Authorization header (never the query string). */
async function fetchRecapDryRun(): Promise<DryRunResult> {
  const base = process.env.SELF_BASE_URL || HUB_URL
  const secret = process.env.CRON_SECRET ?? ''
  const url = `${base.replace(/\/$/, '')}/api/slack-recap?dryRun=1`
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SVTravelHub/HealthMonitor', Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try { const b = await res.json() as { error?: string }; if (b.error) detail += `: ${b.error}` } catch { /* ignore */ }
      return { ok: false, reason: detail, body: {} }
    }
    return { ok: true, body: await res.json() as Record<string, unknown> }
  } catch (e) {
    return { ok: false, reason: describeErr(e), body: {} }
  }
}

function describeErr(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError') return 'a timeout (no response)'
    return e.message
  }
  return String(e)
}

// ─── Notify ──────────────────────────────────────────────────────────────────

/** Post to the shared #sv-automation channel via incoming webhook (the
 *  cross-product SV automation contract). Never throws. */
async function notifyAutomation(text: string): Promise<boolean> {
  const url = process.env.SV_AUTOMATION_WEBHOOK_URL
  if (!url) {
    console.warn('[health-monitor] SV_AUTOMATION_WEBHOOK_URL not set — skipping post')
    return false
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) { console.error(`[health-monitor] webhook HTTP ${res.status}`); return false }
    return true
  } catch (e) {
    console.error('[health-monitor] webhook failed:', e instanceof Error ? e.message : String(e))
    return false
  }
}
