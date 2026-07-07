import type { VercelRequest, VercelResponse } from '@vercel/node'

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

export const config = { maxDuration: 60 }

const PRODUCT = 'Travel Hub (sv-travel-hub)'
const HUB_URL = 'https://sv-travel-hub.vercel.app'
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
    const findings = await runChecks()
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

    // Dead-man's switch: silent-when-healthy means a dead cron looks identical
    // to a healthy one. Once a week (Mondays, UTC) post a one-line heartbeat
    // even with zero findings, so a stopped monitor becomes visible within a
    // week. Every other day stays silent-unless-actionable.
    if (new Date().getUTCDay() === 1) {
      const posted = await notifyAutomation(
        '✅ Travel Hub (sv-travel-hub) — weekly check-in: all monitors ran, no issues',
      )
      if (!posted) {
        return res.status(500).json({ ok: true, findings, heartbeat: false, error: WEBHOOK_DOWN_ERROR })
      }
      return res.status(200).json({ ok: true, findings, heartbeat: true })
    }

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

async function runChecks(): Promise<Finding[]> {
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
      todo: `Set both in Vercel → Project Settings → Environment Variables, then redeploy: ${HUB_URL}`,
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
      todo: `Set VITE_ROSTER_CSV_URL to the published roster sheet CSV in Vercel: ${HUB_URL}`,
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
    const month = new Date().getUTCMonth() // 0=Jan
    const inSeason = month >= 2 && month <= 9 // Mar–Oct
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

  return findings
}

// ─── Probes ──────────────────────────────────────────────────────────────────

interface ProbeResult { ok: boolean; reason?: string; skipped?: boolean }

/** A source is "ok" only if it responds 2xx AND returns a non-trivial body —
 *  a published sheet that got unshared often 200s with an HTML error page or an
 *  empty CSV, which is exactly the silent failure we're hunting. */
async function probeCsv(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SVTravelHub/HealthMonitor' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const text = await res.text()
    // A real published sheet CSV has a header row + at least one data row.
    const dataRows = text.split('\n').filter((l) => l.trim() !== '')
    if (dataRows.length < 2) return { ok: false, reason: 'an empty response' }
    // Google serves an HTML page (not CSV) when a sheet is unpublished/private.
    if (/^\s*<(!doctype|html)/i.test(text)) return { ok: false, reason: 'HTML instead of CSV (sheet may be unpublished)' }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: describeErr(e) }
  }
}

async function probeJson(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SVTravelHub/HealthMonitor' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    await res.json()
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: describeErr(e) }
  }
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
        findings.push({
          severity: 'critical',
          code: false,
          what: 'The recap can’t see its Slack channel — Monday’s post would fail.',
          how: `Slack conversations.info on the configured channel returned \`${info.error ?? `HTTP ${infoRes.status}`}\`.`,
          todo: `Check SLACK_CHANNEL_TRAVEL_SCHEDULE in Vercel (https://vercel.com/stadium-ventures/sv-travel-hub/settings/environment-variables) points at the right channel, and invite the bot in #travel-schedule: \`/invite @SV Travel Hub\`.`,
        })
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
