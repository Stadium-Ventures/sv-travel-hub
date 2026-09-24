import type { VercelRequest, VercelResponse } from '@vercel/node'
// Shared NCAA tables — same module the app resolves with (src/data re-exports
// it), so the monitor can never drift from the app. Lives under api/ because
// Vercel only compiles api/**/*.ts for functions; an import into src/ ships
// uncompiled and crashes at runtime (ERR_MODULE_NOT_FOUND, 2026-08-05).
// The .js extension is required: Vercel runs functions as strict node ESM,
// which never resolves extensionless specifiers (ERR_MODULE_NOT_FOUND).
import { resolveNcaaName, D1_BASEBALL_SLUGS } from './_data/ncaaSchools.js'
import { SUMMER_LEAGUES, parseSummerPlacementRows } from './_data/summerLeagues.js'
import type { SummerLeagueCode, SummerPlacementRow } from './_data/summerLeagues.js'

// SV Travel Hub — self health check.
//
// Travel Hub's only server-side job is the weekly Slack recap (api/slack-recap.ts,
// Vercel cron Mon ~6 AM ET (5 AM in winter — cron is 10:00 UTC)). Everything it
// depends on — the roster/schedule/events
// Google Sheets, the Heartbeat API, the MLB Stats API — can silently 404 or go
// empty WITHOUT the recap throwing: it just posts a thinner, wronger digest and
// nobody notices (see the sv-media-pipeline RSS feed that 404'd silently for a
// week). The recap only self-alerts when it fully crashes, and only to its own
// product channel.
//
// This monitor closes that gap. It runs daily (vercel.json), probes each data
// source, and runs the real recap end-to-end in dry-run mode. If anything is
// broken or degraded it posts a plain-English, product-labeled finding to the
// shared #sv-automation channel via SV_AUTOMATION_WEBHOOK_URL. Silent when
// healthy — #sv-automation is a muted channel; only things that need addressing
// should land there.
//
// Deliberately NOT monitored: the parked cross-agent visit-awareness feature
// (blocked on the Slack channels:history scope). That blocker is stable and
// documented; re-alerting about it daily would just be noise.
//
// Env (all in Vercel):
//   CRON_SECRET                    — guards this endpoint (shared with the recap)
//   SV_AUTOMATION_WEBHOOK_URL      — incoming webhook for #sv-automation
//   VITE_ROSTER_CSV_URL            — roster sheet (recap has no players without it)
//   VITE_SCHEDULE_CSV_URL          — HS/JUCO schedule sheet
//   VITE_EVENTS_CSV_URL            — events sheet (has a code default if unset)
//   VITE_SUMMER_CSV_URL            — Summer Ball Placement sheet (summer checks)
//   VITE_SUMMER_MANUAL_CSV_URL     — hand-entered summer games (Northwoods etc.)
//   SLACK_BOT_TOKEN + SLACK_CHANNEL_TRAVEL_SCHEDULE — what the Monday recap posts with
//   SELF_BASE_URL                  — override for the recap dry-run self-call
//                                    (defaults to the prod domain)
//
// Usage (every request needs the header `Authorization: Bearer <CRON_SECRET>`;
// the Vercel cron sends it automatically — the old `?secret=` query-param auth
// was removed because secrets in query strings leak into logs):
//   GET /api/health-monitor            (daily cron / manual)
//   GET /api/health-monitor?dryRun=1   (compute findings, do NOT post)
//   GET /api/health-monitor?test=1     (post a harmless test finding — verifies wiring)
//   GET /api/health-monitor?force=1    (run the Monday-only + seasonal checks now,
//                                       ignoring their date windows)

export const config = { maxDuration: 60 }

const PRODUCT = 'Travel Hub (sv-travel-hub)'
const HUB_URL = 'https://sv-travel-hub.vercel.app'
const VERCEL_ENV_URL = 'https://vercel.com/stadium-ventures/sv-travel-hub/settings/environment-variables'
const EVENTS_CSV_DEFAULT =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSWoPys4nn-twC2weVoG-DlOHu9JhzXZgYVMJXNmJwPFbNbsLPgzjMzHVK2nUNfLbp7h10itgnAlTPU/pub?output=csv'
const MLB_PROBE_URL = 'https://statsapi.mlb.com/api/v1/teams/affiliates?teamIds=147&sportIds=1,11,12,13,14'

interface Finding {
  severity: 'critical' | 'warning'
  code: boolean       // true → 🛠️ a Claude Code change; false → 👤 manual/ops step
  what: string        // "what broke"
  how: string         // "how we know"
  todo: string        // "what to do"
}

// ─── Handler ─────────────────────────────────────────────────────────────────

const WEBHOOK_DOWN_ERROR =
  'Findings could NOT be delivered to #sv-automation — SV_AUTOMATION_WEBHOOK_URL is unset or the webhook post failed. The monitor is effectively mute; fix the webhook.'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth: `Authorization: Bearer <CRON_SECRET>` ONLY (the Vercel cron sends it
  // automatically). The `?secret=` query-param path was removed — secrets in
  // query strings leak into request logs.
  const expected = process.env.CRON_SECRET ?? ''
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET not configured' })
  const headerSecret = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (headerSecret !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true'
  const force = req.query.force === '1' || req.query.force === 'true'

  // ?test=1 → post one harmless finding so we can confirm the #sv-automation
  // wiring end-to-end without waiting for a real outage. Never fires on cron.
  if (req.query.test === '1' || req.query.test === 'true') {
    const testFinding: Finding = {
      severity: 'warning',
      code: false,
      what: 'Health-check wiring test (ignore).',
      how: 'Someone hit /api/health-monitor?test=1 manually.',
      todo: 'No action — this confirms Travel Hub can reach #sv-automation.',
    }
    const posted = await notifyAutomation(buildMessage([testFinding]))
    if (!posted) return res.status(500).json({ test: true, posted, error: WEBHOOK_DOWN_ERROR })
    return res.status(200).json({ test: true, posted })
  }

  try {
    const findings = await runChecks(force)
    if (dryRun) {
      return res.status(200).json({ ok: findings.length === 0, findings, posted: false, dryRun: true })
    }

    if (findings.length > 0) {
      const posted = await notifyAutomation(buildMessage(findings))
      if (!posted) {
        // A monitor that finds problems but can't say so is itself broken —
        // surface it as an error instead of silently returning 200.
        return res.status(500).json({ ok: false, findings, posted: false, error: WEBHOOK_DOWN_ERROR })
      }
      return res.status(200).json({ ok: false, findings, posted })
    }

    // Silent when healthy — always. The old Monday "all monitors ran" post
    // was this endpoint's dead-man's switch; Tom killed all-clear posts
    // 2026-08-03. Liveness is covered instead by the health-deadman GitHub
    // Actions workflow, which probes this endpoint from independent
    // infrastructure and alerts #sv-automation ONLY when the probe fails.
    return res.status(200).json({ ok: true, findings, posted: false })
  } catch (e) {
    // The monitor itself failing shouldn't be silent — but only alert on REAL
    // runs. A crash during a manual ?dryRun=1 poke is visible right there in
    // the response; alerting #sv-automation about it would be noise.
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[health-monitor] error:', e)
    if (!dryRun) {
      await notifyAutomation(
        buildMessage([{
          severity: 'critical',
          code: true,
          what: 'The Travel Hub health check itself crashed.',
          how: `Automated run threw: ${msg}.`,
          todo: `Open \`sv-travel-hub\` in Claude Code and check api/health-monitor.ts.`,
        }]),
      )
    }
    return res.status(500).json({ error: msg })
  }
}

// ─── Checks ──────────────────────────────────────────────────────────────────

async function runChecks(force = false): Promise<Finding[]> {
  const findings: Finding[] = []

  // 1. Config the Monday recap can't run without.
  const botToken = process.env.SLACK_BOT_TOKEN
  const recapChannel = process.env.SLACK_CHANNEL_TRAVEL_SCHEDULE
  if (!botToken || !recapChannel) {
    findings.push({
      severity: 'critical',
      code: false,
      what: 'The weekly recap has no way to post — its Slack credentials are missing.',
      how: 'SLACK_BOT_TOKEN and/or SLACK_CHANNEL_TRAVEL_SCHEDULE are not set on the deployment.',
      todo: `Set both in Vercel (${VERCEL_ENV_URL}), then redeploy.`,
    })
  } else if (/^C0BE0ELP92Q$|sv-automation/i.test(recapChannel)) {
    // Mis-route guard: posting to #sv-automation "works" (post succeeds, the
    // credential probes pass), so without this check the digest lands in the
    // bugs-only alerts channel every Monday with nothing flagging it.
    findings.push({
      severity: 'critical',
      code: false,
      what: 'The Monday recap is pointed at #sv-automation — the team digest lands in the alerts channel, not #travel-schedule.',
      how: `SLACK_CHANNEL_TRAVEL_SCHEDULE is \`${recapChannel}\`, which is the shared #sv-automation channel. That channel is for bugs and health alerts only; the recap belongs in the product channel.`,
      todo: `Set SLACK_CHANNEL_TRAVEL_SCHEDULE to the #travel-schedule channel ID (C08CMDN82CT) in Vercel (${VERCEL_ENV_URL}) and redeploy, then re-run the recap from the hub's admin button.`,
    })
  } else {
    // 1b. Env presence isn't enough — a revoked token, archived channel, or
    // kicked bot passes the check above and Monday still fails. Actually
    // exercise the credentials.
    findings.push(...await probeSlackCredentials(botToken, recapChannel))
  }

  // 2. Data sources, probed in parallel. Each attributes a specific failure so
  //    the finding points at the exact broken sheet/API, not "recap is off."
  const rosterUrl = process.env.VITE_ROSTER_CSV_URL
  const scheduleUrl = process.env.VITE_SCHEDULE_CSV_URL
  const eventsUrl = process.env.VITE_EVENTS_CSV_URL || EVENTS_CSV_DEFAULT

  const [roster, schedule, events, heartbeat, mlb] = await Promise.all([
    rosterUrl ? probeCsv(rosterUrl) : Promise.resolve<ProbeResult>({ ok: false, reason: 'no URL configured' }),
    scheduleUrl ? probeCsv(scheduleUrl) : Promise.resolve<ProbeResult>({ ok: true, skipped: true }),
    probeCsv(eventsUrl),
    probeJson('https://sv-heartbeat.vercel.app/api/heartbeat/summary'),
    probeJson(MLB_PROBE_URL),
  ])

  let rosterCritical = false
  if (!rosterUrl) {
    rosterCritical = true
    findings.push({
      severity: 'critical',
      code: false,
      what: 'The recap has no roster — its player list source is not configured.',
      how: 'VITE_ROSTER_CSV_URL is not set on the deployment.',
      todo: `Set VITE_ROSTER_CSV_URL to the published roster sheet CSV in Vercel: ${VERCEL_ENV_URL}`,
    })
  } else if (!roster.ok) {
    rosterCritical = true
    findings.push({
      severity: 'critical',
      code: false,
      what: 'The recap can’t read the roster — every trip and overdue check depends on it.',
      how: `The roster Google Sheet CSV returned ${roster.reason}.`,
      todo: 'Confirm the roster sheet is still published-to-web and the CSV link is valid.',
    })
  }

  if (scheduleUrl && !schedule.ok) {
    findings.push({
      severity: 'warning',
      code: false,
      what: 'High-school & JUCO games are missing from the recap.',
      how: `The schedule Google Sheet CSV returned ${schedule.reason}.`,
      todo: 'Confirm the HS/JUCO schedule sheet is still published-to-web and the CSV link is valid.',
    })
  }

  if (!events.ok) {
    findings.push({
      severity: 'warning',
      code: false,
      what: 'The “Events SV is traveling to” section is missing from the recap.',
      how: `The SV Summer Coverage events sheet CSV returned ${events.reason}.`,
      todo: 'Confirm the events sheet is still published-to-web (or update VITE_EVENTS_CSV_URL).',
    })
  }

  if (!heartbeat.ok) {
    findings.push({
      severity: 'warning',
      code: false,
      what: 'The recap can’t tell who’s overdue for a visit — the “overdue T1/T2” section will be empty.',
      how: `The Heartbeat summary API returned ${heartbeat.reason}.`,
      todo: `Check that sv-heartbeat is up: ${'https://sv-heartbeat.vercel.app'}/api/heartbeat/summary`,
    })
  }

  if (!mlb.ok) {
    findings.push({
      severity: 'warning',
      code: false,
      what: 'Pro (MLB/MiLB) games are missing from the recap.',
      how: `The MLB Stats API returned ${mlb.reason}.`,
      todo: 'Usually a transient MLB Stats API outage — recheck next run; if it persists, the API shape may have changed (code fix).',
    })
  }

  // 3. End-to-end: run the real recap in dry-run mode. This is the highest-
  //    fidelity check — it exercises the exact code path Monday runs and also
  //    confirms the deployment is serving. On success we inspect the payload
  //    for silent content degradation.
  const dry = await fetchRecapDryRun()
  if (!dry.ok) {
    // Only emit a generic "build failing" finding when the sources look healthy.
    // If roster (etc.) already failed, that's the root cause — don't double-report.
    if (!rosterCritical) {
      findings.push({
        severity: 'critical',
        code: true,
        what: 'The weekly recap failed to build — Monday’s post would not go out.',
        how: `A dry run of the recap returned ${dry.reason}.`,
        todo: 'Open `sv-travel-hub` in Claude Code and debug api/slack-recap.ts.',
      })
    }
  } else {
    const body = dry.body
    const rosterSize = typeof body.rosterSize === 'number' ? body.rosterSize : null
    const gameCount = typeof body.gameCount === 'number' ? body.gameCount : null

    if (rosterSize === 0 && !rosterCritical) {
      findings.push({
        severity: 'critical',
        code: false,
        what: 'The roster loaded but has zero players — the recap would be blank.',
        how: 'The recap dry run reported a roster size of 0.',
        todo: 'Check the roster sheet still has rows and the header columns are intact.',
      })
    }

    // Zero games across ALL sources during the baseball season almost always
    // means a data source broke, not a genuinely empty calendar. Gate on the
    // active months so the offseason doesn't nag. (UTC month is fine here.)
    // Ends in September: by October MiLB is over, MLB postseason games only
    // exist on the API once a series is set, and the recap does not read
    // the Arizona Fall League, so a zero count in October is normal here.
    const month = new Date().getUTCMonth() // 0=Jan
    const inSeason = month >= 2 && month <= 8 // Mar to Sep
    if (gameCount === 0 && rosterSize !== 0 && !rosterCritical && inSeason) {
      findings.push({
        severity: 'warning',
        code: false,
        what: 'The recap found zero games anywhere in the next 5 weeks, mid-season.',
        how: 'The recap dry run reported 0 games with a non-empty roster.',
        todo: 'Likely a silently-broken schedule source — check the roster’s org/affiliate columns and the schedule sheets.',
      })
    }
  }

  // 4. Weekly data-hygiene + seasonal checks (Mondays, or ?force=1).
  //    Seasonal calendar (UTC):
  //      Dec–Jan        NCAA: client schools with no upcoming-season schedule on D1Baseball
  //      Dec–Feb        HS/JUCO: schedule sheet still only has last season's games
  //      May 15–Aug 15  Summer: unplaced college clients (through Jun 30), placement
  //                     names that don't match the roster, no-feed leagues with no
  //                     manual games, MLB-API league team names that don't match
  //      Sep 15–Nov 20  AFL: clubs missing from the MLB API; rosters empty from Oct 1
  //    These are
  //    stateless, so they re-alert every Monday until fixed — deliberate: each
  //    one is a client whose games are invisible in the app. Daily would be
  //    noise; silence would recreate the exact gap they close.
  const now = new Date()
  if (force || now.getUTCDay() === 1) {
    const seasonMonth = now.getUTCMonth() // 0=Jan

    if (roster.ok && roster.text) {
      findings.push(...checkNcaaSchoolCoverage(roster.text))

      // NCAA schedules for the upcoming season publish Sept–Dec; from December
      // on, a client school with still nothing on D1Baseball is worth flagging.
      if (force || seasonMonth === 11 || seasonMonth === 0) {
        findings.push(...await checkNcaaNextSeasonPublished(roster.text, now))
      }
    }

    // HS/JUCO schedules are hand-entered from state releases (Nov–Feb):
    // remind Dec–Feb while the sheet still only has last season's games.
    if (force || seasonMonth === 11 || seasonMonth === 0 || seasonMonth === 1) {
      if (schedule.ok && schedule.text) {
        findings.push(...checkHsSheetSeason(schedule.text, now))
      }
    }

    // Summer ball (mid-May to mid-Aug): placements are hand-entered on the
    // Summer Ball Placement sheet, and five of the eight leagues have no feed
    // at all, so those games exist only if someone types them in.
    const md = monthDay(now)
    if (force || (md >= 515 && md <= 815)) {
      findings.push(...await checkSummerCoverage(roster.ok ? roster.text : undefined, now, force))
    }

    // Arizona Fall League (mid-Sep to late Nov): the app pulls AFL rosters from
    // the MLB API by itself. This makes sure that pull still has something to
    // read, so a silent API change doesn't hide every fall client.
    if (force || (md >= 915 && md <= 1120)) {
      findings.push(...await checkAflRosters(now, force))
    }
  }

  return findings
}

// ─── Weekly data-hygiene + seasonal checks ───────────────────────────────────

/** The season runs Feb–Jun, so "the upcoming season" is next calendar year
 *  during Oct–Dec and the current year during Jan–Feb. */
function upcomingSeasonYear(now: Date): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
}

/** NCAA roster rows (name + school), excluding JUCO (not on D1Baseball) and
 *  blank schools (sv-scouting-data's daily roster-sync already alerts those —
 *  don't double-report). */
function parseRosterNcaa(rosterCsv: string): Array<{ name: string; org: string }> {
  const rows = parseCsv(rosterCsv)
  if (rows.length < 2) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1
  const iName = col(['name', 'player name', 'player'])
  const iLevel = col(['level', 'player level'])
  const iOrg = col(['org', 'organization', 'team', 'school'])
  if (iName < 0 || iLevel < 0 || iOrg < 0) return []
  const out: Array<{ name: string; org: string }> = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const name = (row[iName] ?? '').trim()
    const level = (row[iLevel] ?? '').toLowerCase().trim()
    const org = (row[iOrg] ?? '').trim()
    if (!name || !org) continue
    const isNcaa =
      (level.includes('ncaa') || level.includes('college')) &&
      !level.includes('juco') && !level.includes('junior')
    if (isNcaa) out.push({ name, org })
  }
  return out
}

/** A roster school that resolveNcaaName can't match is silently skipped by the
 *  app's NCAA fetch — the client just has no games, and only the in-browser
 *  Diagnostics panel would ever say so. Surface it in Slack instead. (In-app
 *  custom aliases are per-browser and can only map to schools already in the
 *  table, so an unmatched school here is always worth a durable fix.) */
function checkNcaaSchoolCoverage(rosterCsv: string): Finding[] {
  const unmatched = new Map<string, string[]>()
  for (const p of parseRosterNcaa(rosterCsv)) {
    if (resolveNcaaName(p.org)) continue
    const list = unmatched.get(p.org)
    if (list) list.push(p.name)
    else unmatched.set(p.org, [p.name])
  }
  if (unmatched.size === 0) return []
  const detail = [...unmatched.entries()].map(([org, names]) => `"${org}" (${names.join(', ')})`).join('; ')
  const n = unmatched.size
  return [{
    severity: 'warning',
    code: true,
    what: `${n} roster school${n === 1 ? '' : 's'} can't be matched to an NCAA program — ${n === 1 ? 'that client’s' : 'those clients’'} games are invisible in the Travel Hub.`,
    how: `The roster sheet lists ${detail}, and none match NCAA_ALIASES — the app silently skips unmatched schools when pulling D1Baseball schedules.`,
    todo: 'Add the school to NCAA_ALIASES + D1_BASEBALL_SLUGS in src/data/ (check NCAA_VENUES has it too), or fix the Org spelling in the roster sheet. Re-alerts every Monday until resolved.',
  }]
}

/** Dec–Jan: flag client schools whose upcoming-season schedule still isn't on
 *  D1Baseball. The app scrapes those pages live, so it picks new schedules up
 *  automatically the moment they post — this check exists to catch the ones
 *  that HAVEN'T posted by the time trips need planning. */
async function checkNcaaNextSeasonPublished(rosterCsv: string, now: Date): Promise<Finding[]> {
  const schools = new Map<string, string>() // canonical name → D1Baseball slug
  for (const p of parseRosterNcaa(rosterCsv)) {
    const canonical = resolveNcaaName(p.org)
    if (!canonical) continue // unmatched schools have their own finding above
    const slug = D1_BASEBALL_SLUGS[canonical]
    if (slug) schools.set(canonical, slug)
  }
  if (schools.size === 0) return []

  const seasonYear = upcomingSeasonYear(now)
  const missing: string[] = []
  const unreachable: string[] = []

  await Promise.all([...schools.entries()].map(async ([school, slug]) => {
    try {
      const res = await fetch(`https://d1baseball.com/team/${slug}/schedule/`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SVTravelHub/HealthMonitor)' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) { unreachable.push(school); return }
      const html = await res.text()
      // Game dates appear in score-link hrefs as date=YYYYMMDD — no DOM needed.
      const years = new Set<string>()
      for (const m of html.matchAll(/date=(\d{4})\d{4}/g)) years.add(m[1]!)
      if (!years.has(String(seasonYear))) missing.push(school)
    } catch {
      unreachable.push(school)
    }
  }))

  const findings: Finding[] = []
  if (missing.length > 0) {
    missing.sort()
    findings.push({
      severity: 'warning',
      code: false,
      what: `${missing.length} client school${missing.length === 1 ? ' has' : 's have'} no ${seasonYear} schedule on D1Baseball yet: ${missing.join(', ')}.`,
      how: `Weekly Dec–Jan check: the D1Baseball team page shows no games dated in ${seasonYear}. The app scrapes those pages, so these schools show no games until the schedule posts.`,
      todo: 'Usually the school just hasn’t published yet — the recheck is automatic next Monday. If it persists into late January, verify the school’s D1Baseball page by hand; the slug or page format may have changed (code fix).',
    })
  }
  // Individual fetch failures are transient noise, but ALL failing means the
  // check itself is blind (likely D1Baseball blocking Vercel egress) — say so
  // rather than silently reporting nothing all winter.
  if (unreachable.length === schools.size) {
    findings.push({
      severity: 'warning',
      code: true,
      what: 'The NCAA schedule-publication check couldn’t reach D1Baseball for any school — it’s blind, not clean.',
      how: `All ${schools.size} D1Baseball team-page fetches from the health monitor failed or returned non-200.`,
      todo: 'D1Baseball may be blocking Vercel egress IPs — open `sv-travel-hub` in Claude Code and rework checkNcaaNextSeasonPublished in api/health-monitor.ts (e.g. route via the CORS proxy fallbacks).',
    })
  }
  return findings
}

/** Dec–Feb: the HS/JUCO sheet is hand-entered, so a sheet that still only has
 *  last spring's games passes every plumbing check while HS clients silently
 *  show nothing. Flag until someone enters upcoming-season games. */
function checkHsSheetSeason(scheduleCsv: string, now: Date): Finding[] {
  const rows = parseCsv(scheduleCsv)
  if (rows.length < 2) return []
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1
  const iDate = col(['date', 'game date'])
  const iLevel = col(['level', 'player level'])
  if (iDate < 0 || iLevel < 0) return []

  const seasonYear = upcomingSeasonYear(now)
  let hsRows = 0
  let latest = ''
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]!
    const level = (row[iLevel] ?? '').toLowerCase().trim()
    const isHs = level.includes('hs') || level.includes('high school') ||
      level.includes('juco') || level.includes('junior college')
    if (!isHs) continue
    hsRows++
    const d = normalizeIsoDate((row[iDate] ?? '').trim())
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d > latest) latest = d
  }
  // A sheet with zero HS rows at all is a plumbing problem the existing
  // schedule-CSV probe and in-app checks already own.
  if (hsRows === 0) return []
  if (latest >= `${seasonYear}-01-01`) return []

  return [{
    severity: 'warning',
    code: false,
    what: `The HS/JUCO schedule sheet has no ${seasonYear}-season games yet — HS clients show nothing in the Travel Hub.`,
    how: `Weekly Dec–Feb check: all ${hsRows} HS/JUCO rows in the Client Game Schedule sheet are from last season (newest game: ${latest || 'no parseable date'}).`,
    todo: `State associations release HS schedules Nov–Feb — enter the new season's HS/JUCO games into the Client Game Schedule sheet. Re-alerts every Monday until the sheet has ${seasonYear} rows.`,
  }]
}

/** Month-day as a sortable number (Sep 15 → 915), UTC. */
function monthDay(d: Date): number {
  return (d.getUTCMonth() + 1) * 100 + d.getUTCDate()
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

function parseRosterNames(rosterCsv: string): Set<string> {
  const rows = parseCsv(rosterCsv)
  const out = new Set<string>()
  if (rows.length < 2) return out
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const iName = ['name', 'player name', 'player'].map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1
  if (iName < 0) return out
  for (let r = 1; r < rows.length; r++) {
    const n = nameKey(rows[r]![iName] ?? '')
    if (n) out.add(n)
  }
  return out
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
async function checkSummerCoverage(rosterCsv: string | undefined, now: Date, force: boolean): Promise<Finding[]> {
  const findings: Finding[] = []
  const season = now.getUTCFullYear()
  const sheetUrl = process.env.VITE_SUMMER_CSV_URL
  if (!sheetUrl) {
    return [{
      severity: 'warning',
      code: false,
      what: 'Summer ball is invisible in the Travel Hub. The summer placement sheet is not connected.',
      how: 'VITE_SUMMER_CSV_URL is not set on the deployment, so no client has a summer team.',
      todo: `Publish the Summer Ball Placement sheet to the web as CSV and set VITE_SUMMER_CSV_URL in Vercel (${VERCEL_ENV_URL}), then redeploy.`,
    }]
  }
  const sheet = await probeCsv(sheetUrl)
  if (!sheet.ok || !sheet.text) {
    return [{
      severity: 'warning',
      code: false,
      what: 'Summer ball is invisible in the Travel Hub. The summer placement sheet can’t be read.',
      how: `The Summer Ball Placement sheet CSV returned ${sheet.reason}.`,
      todo: 'Confirm the placement sheet is still published to the web and the CSV link in VITE_SUMMER_CSV_URL is valid.',
    }]
  }
  // The roster is the source of truth: the app ignores placements for names
  // not on it (removed clients linger on the sheet), and so does this check.
  // Without a roster there's nothing to check against, and the roster probe
  // has already raised a critical.
  if (!rosterCsv) return []
  const rosterKeys = parseRosterNames(rosterCsv)
  const sheetRows = parseCsv(sheet.text)
  const { placements: allPlacements } = parseSummerPlacementRows(sheetRows)
  const placements = allPlacements.filter((p) => rosterKeys.has(nameKey(p.playerName)))
  const active = placements.filter((p) => p.active)

  // 1. College clients with no placement, while placements are still landing.
  if (force || monthDay(now) <= 630) {
    // A row with a status but no team (e.g. "Shut Down") still means someone
    // made the call, so it counts as handled. A bare name (the NEED PLACEMENT
    // list) does not.
    const handled = new Set<string>()
    const looseToSheetName = new Map<string, string>()
    for (const row of sheetRows) {
      const name = (row[0] ?? '').trim()
      if (!name || ![row[2], row[3], row[4]].some((c) => (c ?? '').trim())) continue
      handled.add(nameKey(name))
      looseToSheetName.set(looseKey(name), name)
    }
    const college = parseRosterNcaa(rosterCsv)
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
    if (misspelled.length > 0) {
      findings.push({
        severity: 'warning',
        code: false,
        what: `${misspelled.length} summer placement${misspelled.length === 1 ? ' is' : 's are'} spelled differently from the roster, so the Travel Hub drops ${misspelled.length === 1 ? 'it' : 'them'}: ${misspelled.join(', ')}.`,
        how: 'The app only links a placement to a client when the name matches the roster exactly.',
        todo: 'Change the name on the Summer Ball Placement sheet to match the roster.',
      })
    }
    if (college.length > 0 && handled.size === 0) {
      findings.push({
        severity: 'warning',
        code: false,
        what: 'No summer placements are on the sheet yet. College clients show no summer games.',
        how: `The Summer Ball Placement sheet has no player with a team, league or status filled in, and the roster has ${college.length} college clients.`,
        todo: 'Enter each college client’s summer team and league on the Summer Ball Placement sheet. Re-alerts every Monday through June.',
      })
    } else if (unplaced.length > 0) {
      findings.push({
        severity: 'warning',
        code: false,
        what: `${unplaced.length} college client${unplaced.length === 1 ? ' has' : 's have'} no summer team on the placement sheet: ${unplaced.join(', ')}.`,
        how: 'Weekly May–June check: these roster names don’t appear on the Summer Ball Placement sheet with a team, league or status.',
        todo: 'Add them to the placement sheet with their team and league. If a player isn’t playing summer ball, give them a row with a status like "Shut Down" so this stops flagging them.',
      })
    }
  }

  // 2. Leagues with no feed: games only exist if they're on the manual sheet.
  const noFeed = active.filter((p) => SUMMER_LEAGUES[p.league].source !== 'mlb-api')
  if (noFeed.length > 0) {
    const manualUrl = process.env.VITE_SUMMER_MANUAL_CSV_URL
    let covered = new Set<string>()
    let manualNote = ''
    if (!manualUrl) {
      manualNote = 'VITE_SUMMER_MANUAL_CSV_URL is not set, so there is nowhere to enter these games yet.'
    } else {
      const manual = await probeCsv(manualUrl)
      if (!manual.ok || !manual.text) {
        manualNote = `The manual summer games sheet returned ${manual.reason}.`
      } else {
        covered = manualSheetPlayers(manual.text, season)
      }
    }
    const missing = noFeed.filter((p) => !covered.has(normName(p.playerName)))
    if (missing.length > 0) {
      const list = missing
        .sort((a, b) => a.playerName.localeCompare(b.playerName))
        .map((p) => `${p.playerName} (${p.summerTeam}, ${p.league})`)
        .join(', ')
      findings.push({
        severity: 'warning',
        code: false,
        what: `${missing.length} summer client${missing.length === 1 ? '' : 's'} play${missing.length === 1 ? 's' : ''} in a league we can’t pull automatically and ${missing.length === 1 ? 'has' : 'have'} no games entered: ${list}.`,
        how: manualNote || `The placement sheet puts them in PGCBL, NECBL, FCBL, Northwoods or Coastal Plain, and the manual summer games sheet has no ${season} rows for them.`,
        todo: manualUrl
          ? 'Copy their team schedules into the manual summer games sheet (Player, Team, League, Date, Time, Home/Away, Opponent, Venue, VenueLat, VenueLng). Re-alerts every Monday until entered.'
          : `Create a manual summer games sheet (columns: Player, Team, League, Date, Time, Home/Away, Opponent, Venue, VenueLat, VenueLng), publish it as CSV, set VITE_SUMMER_MANUAL_CSV_URL in Vercel (${VERCEL_ENV_URL}), redeploy, then enter their games.`,
      })
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
    const names = await fetchMlbTeamNames(`https://statsapi.mlb.com/api/v1/teams?leagueIds=${leagueId}&season=${season}`)
    if (!names || names.length === 0) { blind.push(SUMMER_LEAGUES[code].name); return }
    for (const p of list) {
      const target = normTeam(p.summerTeam)
      const hit = names.some((n) => { const t = normTeam(n); return t === target || t.includes(target) || target.includes(t) })
      if (!hit) unmatched.push(`${p.playerName} → "${p.summerTeam}" (${code})`)
    }
  }))
  if (unmatched.length > 0) {
    unmatched.sort()
    findings.push({
      severity: 'warning',
      code: false,
      what: `${unmatched.length} summer placement${unmatched.length === 1 ? '' : 's'} can’t be matched to a team, so no games are pulled: ${unmatched.join('; ')}.`,
      how: 'The team name on the Summer Ball Placement sheet doesn’t match any team the MLB Stats API lists for that league this season.',
      todo: 'Fix the team name on the placement sheet to the official club name (e.g. "Hyannis Harbor Hawks").',
    })
  }
  if (blind.length > 0) {
    blind.sort()
    findings.push({
      severity: 'warning',
      code: true,
      what: `Summer schedules can’t be pulled for ${blind.join(', ')}. The MLB Stats API returned no teams.`,
      how: `The ${season} team list for ${blind.length === 1 ? 'that league' : 'those leagues'} came back empty or failed, and SV clients are placed there.`,
      todo: 'Check the league ids in api/_data/summerLeagues.ts against the MLB Stats API. The league may have moved or changed id.',
    })
  }
  return findings
}

/** Players with at least one this-season game on the manual summer sheet. */
function manualSheetPlayers(csv: string, season: number): Set<string> {
  const rows = parseCsv(csv)
  const out = new Set<string>()
  if (rows.length < 2) return out
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1
  const iPlayer = col(['player', 'player name', 'name'])
  const iDate = col(['date'])
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
async function fetchMlbTeamNames(url: string): Promise<string[] | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'SVTravelHub/HealthMonitor' }, signal: AbortSignal.timeout(12_000) })
    if (!res.ok) return null
    const data = await res.json() as { teams?: Array<Record<string, unknown>> }
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
 *  own by reading the six AFL club rosters from the MLB Stats API, so the only
 *  thing to watch is that those rosters are actually there:
 *   - from Sep 15: the six clubs exist for this season;
 *   - from Oct 1 (games start early October): at least one roster has players.
 *  Zero SV clients in the AFL is a normal year, not an alert. */
async function checkAflRosters(now: Date, force: boolean): Promise<Finding[]> {
  const season = now.getUTCFullYear()
  let teams: Array<{ id: number; name: string }> = []
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/teams?sportId=17&season=${season}`, {
      headers: { 'User-Agent': 'SVTravelHub/HealthMonitor' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return [] // a flaky API response is covered by the daily MLB probe
    const data = await res.json() as { teams?: Array<{ id: number; name: string; league?: { name?: string } }> }
    teams = (data.teams ?? []).filter((t) => /arizona fall league/i.test(t.league?.name ?? ''))
  } catch {
    return []
  }
  if (teams.length === 0) {
    return [{
      severity: 'warning',
      code: true,
      what: 'Fall league clients won’t show in the Travel Hub. The MLB Stats API lists no Arizona Fall League clubs this year.',
      how: `The ${season} team list for sportId 17 has no teams in a league named "Arizona Fall League", which is how the app finds the six clubs.`,
      todo: 'Open `sv-travel-hub` in Claude Code and check fetchAflTeams in src/lib/mlbApi.ts. The league may have been renamed or moved to a new sport id. Until then, check the AFL rosters on mlb.com/arizona-fall-league for SV clients by hand.',
    }]
  }
  if (!force && monthDay(now) < 1001) return []

  const counts = await Promise.all(teams.map(async (t) => {
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/teams/${t.id}/roster?rosterType=fullRoster&season=${season}`, {
        headers: { 'User-Agent': 'SVTravelHub/HealthMonitor' },
        signal: AbortSignal.timeout(12_000),
      })
      if (!res.ok) return -1
      const data = await res.json() as { roster?: unknown[] }
      return (data.roster ?? []).length
    } catch {
      return -1
    }
  }))
  if (counts.some((c) => c > 0)) return []
  if (counts.every((c) => c < 0)) return [] // unreachable, not empty; the daily MLB probe owns outages
  return [{
    severity: 'warning',
    code: false,
    what: 'Fall league clients won’t show in the Travel Hub. The Arizona Fall League rosters are empty.',
    how: `All ${teams.length} AFL club rosters on the MLB Stats API have no players, and fall league games are underway.`,
    todo: 'MLB usually fills these by the first week of October. If it persists past mid-October, check the AFL rosters on mlb.com/arizona-fall-league for SV clients and let the team know who is playing where. If the rosters are there on mlb.com, it’s a code fix in assignAflPlayers (src/store/scheduleStore.ts).',
  }]
}

// ─── Probes ──────────────────────────────────────────────────────────────────

interface ProbeResult { ok: boolean; reason?: string; skipped?: boolean; text?: string }

/** Google's published-CSV endpoint (and any remote API) intermittently stalls
 *  or drops a single request while perfectly healthy — a one-shot probe turns
 *  every such blip into a false alert. Only report a source down after it
 *  fails every attempt. Per-attempt timeout is 10s so the worst case
 *  (3 × 10s + pauses) still fits the function's 60s budget with probes
 *  running in parallel. */
async function withRetry(probe: () => Promise<ProbeResult>, attempts = 3): Promise<ProbeResult> {
  let last: ProbeResult = { ok: false, reason: 'not probed' }
  for (let i = 0; i < attempts; i++) {
    last = await probe()
    if (last.ok) return last
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500))
  }
  return { ...last, reason: `${last.reason} on ${attempts} attempts` }
}

/** A source is "ok" only if it responds 2xx AND returns a non-trivial body —
 *  a published sheet that got unshared often 200s with an HTML error page or an
 *  empty CSV, which is exactly the silent failure we're hunting. */
function probeCsv(url: string): Promise<ProbeResult> {
  return withRetry(async () => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SVTravelHub/HealthMonitor' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
      const text = await res.text()
      // A real published sheet CSV has a header row + at least one data row.
      const dataRows = text.split('\n').filter((l) => l.trim() !== '')
      if (dataRows.length < 2) return { ok: false, reason: 'an empty response' }
      // Google serves an HTML page (not CSV) when a sheet is unpublished/private.
      if (/^\s*<(!doctype|html)/i.test(text)) return { ok: false, reason: 'HTML instead of CSV (sheet may be unpublished)' }
      return { ok: true, text }
    } catch (e) {
      return { ok: false, reason: describeErr(e) }
    }
  })
}

function probeJson(url: string): Promise<ProbeResult> {
  return withRetry(async () => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SVTravelHub/HealthMonitor' },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
      await res.json()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: describeErr(e) }
    }
  })
}

/** Verify the recap's Slack credentials actually WORK: auth.test proves the
 *  bot token is live, and conversations.info on the recap channel catches an
 *  archived channel / kicked bot / wrong channel ID — all of which would make
 *  Monday's post silently fail. Probe errors (network blips) come back as a
 *  warning, not a critical. */
async function probeSlackCredentials(botToken: string, channel: string): Promise<Finding[]> {
  const findings: Finding[] = []
  try {
    const authRes = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${botToken}` },
      signal: AbortSignal.timeout(12_000),
    })
    const auth = await authRes.json() as { ok: boolean; error?: string }
    if (!auth.ok) {
      findings.push({
        severity: 'critical',
        code: false,
        what: 'The recap’s Slack token no longer works — Monday’s post would silently fail.',
        how: `Slack auth.test returned \`${auth.error ?? `HTTP ${authRes.status}`}\`.`,
        todo: `Reinstall the “SV Travel Hub” Slack app (or regenerate its bot token) at https://api.slack.com/apps, then update SLACK_BOT_TOKEN in Vercel (https://vercel.com/stadium-ventures/sv-travel-hub/settings/environment-variables) and redeploy.`,
      })
      return findings // channel probe would just echo the same auth error
    }

    // conversations.info needs a channel ID; if the env var holds a "#name",
    // skip this half rather than false-alarm.
    if (/^[CG][A-Z0-9]+$/.test(channel)) {
      const infoRes = await fetch(`https://slack.com/api/conversations.info?channel=${encodeURIComponent(channel)}`, {
        headers: { Authorization: `Bearer ${botToken}` },
        signal: AbortSignal.timeout(12_000),
      })
      const info = await infoRes.json() as { ok: boolean; error?: string; channel?: { is_archived?: boolean; is_member?: boolean } }
      if (!info.ok) {
        if (info.error === 'missing_scope') {
          // The bot lacks channels:read / groups:read, so this probe can't
          // introspect the channel — but that does NOT stop the recap from
          // posting. chat.postMessage only needs chat:write plus the bot being
          // in the channel; reading channel metadata is unrelated. This is a
          // monitoring blind spot, not a recap failure, and Tom has decided not
          // to grant the scope — so stay silent rather than flag it every day.
          // (To make this check truly verify the channel later: add channels:read
          // + groups:read to the "SV Travel Hub" Slack app and reinstall.)
          console.warn('[health-monitor] channel probe skipped: bot lacks channels:read/groups:read (missing_scope) — recap posting is unaffected')
        } else {
          findings.push({
            severity: 'critical',
            code: false,
            what: 'The recap can’t see its Slack channel — Monday’s post would fail.',
            how: `Slack conversations.info on the configured channel returned \`${info.error ?? `HTTP ${infoRes.status}`}\`.`,
            todo: `Check SLACK_CHANNEL_TRAVEL_SCHEDULE in Vercel (https://vercel.com/stadium-ventures/sv-travel-hub/settings/environment-variables) points at the right channel, and invite the bot in #travel-schedule: \`/invite @SV Travel Hub\`.`,
          })
        }
      } else if (info.channel?.is_archived) {
        findings.push({
          severity: 'critical',
          code: false,
          what: 'The recap channel has been archived — Monday’s post would fail.',
          how: 'Slack conversations.info reports the configured channel is archived.',
          todo: 'Unarchive #travel-schedule, or point SLACK_CHANNEL_TRAVEL_SCHEDULE at the replacement channel in Vercel and redeploy.',
        })
      } else if (info.channel?.is_member === false) {
        findings.push({
          severity: 'critical',
          code: false,
          what: 'The recap bot is not in its channel — Monday’s post would fail with not_in_channel.',
          how: 'Slack conversations.info reports the bot is not a member of the configured channel.',
          todo: 'In #travel-schedule, run `/invite @SV Travel Hub`.',
        })
      }
    }
  } catch (e) {
    findings.push({
      severity: 'warning',
      code: false,
      what: 'Couldn’t verify the recap’s Slack credentials this run.',
      how: `The Slack API probe failed: ${describeErr(e)}.`,
      todo: 'Likely a transient Slack/network blip — recheck on the next daily run; if it repeats, investigate.',
    })
  }
  return findings
}

interface DryRunResult { ok: boolean; reason?: string; body: Record<string, unknown> }

/** Call the real recap endpoint in dry-run mode on this same deployment.
 *  Auth goes in the Authorization header (never the query string — it would
 *  land in request logs). */
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
      try { const b = await res.json() as { error?: string }; if (b.error) detail += ` — ${b.error}` } catch { /* ignore */ }
      return { ok: false, reason: detail, body: {} }
    }
    const body = await res.json() as Record<string, unknown>
    return { ok: true, body }
  } catch (e) {
    return { ok: false, reason: describeErr(e), body: {} }
  }
}

/** Tiny RFC-4180-ish CSV parser — same one api/slack-recap.ts uses. Handles
 *  quoted fields with commas and doubled-quote escapes; skips empty rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') { inQuote = false }
      else { cur += c }
    } else {
      if (c === '"') { inQuote = true }
      else if (c === ',') { row.push(cur); cur = '' }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
      else { cur += c }
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

function normalizeIsoDate(s: string): string {
  // Accepts YYYY-MM-DD, M/D/YYYY, MM/DD/YYYY, M/D/YY → YYYY-MM-DD. The Client
  // Game Schedule sheet writes two-digit years ("5/5/26").
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/)
  if (m) {
    const mm = m[1]!.padStart(2, '0')
    const dd = m[2]!.padStart(2, '0')
    const yyyy = m[3]!.length === 2 ? `20${m[3]}` : m[3]
    return `${yyyy}-${mm}-${dd}`
  }
  return s
}

function describeErr(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError') return 'a timeout (no response)'
    return e.message
  }
  return String(e)
}

// ─── Notify + message ─────────────────────────────────────────────────────────

/** Post to the shared #sv-automation channel via incoming webhook. Mirrors the
 *  cross-product SV automation contract (SV_AUTOMATION_WEBHOOK_URL). Never throws. */
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
    })
    if (!res.ok) { console.error(`[health-monitor] webhook HTTP ${res.status}`); return false }
    return true
  } catch (e) {
    console.error('[health-monitor] webhook failed:', e)
    return false
  }
}

/** Product-labeled, plain-English message. Each finding is a 3-line contract
 *  (what broke · how we know · what to do) tagged 🛠️ code vs 👤 manual, with a
 *  footer roll-up — the shared #sv-automation format. */
function buildMessage(findings: Finding[]): string {
  const hasCritical = findings.some((f) => f.severity === 'critical')
  const emoji = hasCritical ? ':red_circle:' : ':large_yellow_circle:'
  const state = hasCritical ? 'needs attention' : 'degraded'
  const lines: string[] = []
  lines.push(`${emoji} *${PRODUCT} — ${state}*`)
  lines.push('')
  for (const f of findings) {
    const tag = f.code ? '🛠️ Code change' : '👤 Manual'
    lines.push(`*${f.what}*  _(${tag})_`)
    lines.push(`   • _How we know:_ ${f.how}`)
    lines.push(`   • _What to do:_ ${f.todo}`)
    lines.push('')
  }
  const codeCount = findings.filter((f) => f.code).length
  const n = findings.length
  lines.push(
    `_${codeCount} of ${n} finding${n === 1 ? '' : 's'} recommend a code change — open \`sv-travel-hub\` in Claude Code._`,
  )
  return lines.join('\n')
}
