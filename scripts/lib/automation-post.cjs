#!/usr/bin/env node
'use strict';
// scripts/lib/automation-post.cjs
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE #sv-automation poster. Every automated message this repo sends to the
// channel is formatted here and claimed here — no second webhook path, no second
// formatter, no second dedup mechanism (SV Way working rule 8: "wired to
// #sv-automation through the shared notify contract, never a second webhook
// path").
//
// ── Why this exists (D130, 2026-09-08) ───────────────────────────────────────
// On 2026-09-07 the channel took 11 posts. SIX of them were one detector
// (sv-way-config-staleness) firing once per sibling repo about the same class of
// finding. BE, offered owner-routing and both: "One digest per detector per day,
// findings grouped." A detector that finds the same class in six repos posts
// once and lists the six.
//
// Unchanged by that ruling, and unchanged here: silent when healthy,
// actionable-only, the house three-parter (What broke / How we know / What to
// do), and the 🛠️/👤 tag DERIVED FROM THE BODY.
//
// ── Why a Contents-API compare-and-swap claim file ───────────────────────────
// "Already posted today" has to survive a fresh `actions/checkout`, and it has
// to be reachable from OUTSIDE an sv-registry checkout, because the six posts
// D130 names did not come from this repo at all — `sv-way-config-staleness.cjs`
// is repo-agnostic on purpose and resolves to its own checkout, and
// `sv-way-sync.yml` derives its label from `github.repository`. Six sibling
// repos each ran their own copy. So the claim store is a file in THIS repo,
// written through the GitHub Contents API:
//
//   data/reference/automation-post-ledger.json
//
// It is the only mechanism already in this repo that (a) survives a fresh
// checkout, (b) has real optimistic concurrency rather than last-writer-wins,
// and (c) can be claimed against from another repo's runner. The CAS loop is
// lifted from scripts/newsroom/persist-policy.cjs (GET blob sha → merge → PUT
// with that sha → 409/422 means somebody else claimed first). File mtime is
// ruled out: a fresh checkout resets it.
//
// EXPLICITLY NOT USED, because nothing in this repo uses them and a new
// mechanism is a new thing to maintain: actions/cache, upload/download-artifact,
// gists, issues-as-state, Vercel KV/Blob.
//
// ── What went wrong with the LAST dedup, so this one does not repeat it ──────
// scripts/ops/pulse-heartbeat.cjs wrote status/_orchestration-alert-dedup.json
// and that file is untracked, never committed, and absent from the workflow's
// `git add`. Every CI run therefore started with `seen = {}` and the 23h window
// suppressed exactly nothing. A dedup that lives in the working tree of a
// throwaway runner is not a dedup. Hence the Contents API, not the filesystem.
//
// ── FAIL CLOSED ──────────────────────────────────────────────────────────────
// If the claim cannot be established — no token, network down, the API refusing
// us — we POST. A duplicate alert is a nuisance; a missed alert is the thing the
// channel exists to prevent. Every fail-closed path says so in its reason.
//
// ── The one write door for this file ─────────────────────────────────────────
// This module is the SOLE writer of data/reference/automation-post-ledger.json.
// That is the same governed-writer precedent data/reference/alerts-subscriptions.json
// already sets (its only writer is api/alerts-subscription-update.js). The
// dossier chokepoint (scripts/lib/write-registry.cjs) governs the PLAYER layer —
// data/players/<slug>.json and its sidecars, via applyClaim/mutateDossier — and
// has no lane for data/reference/**, so routing through it is neither possible
// nor the precedent. data/reference is declared "write-home" for this repo in
// sv-way.config.json § roles; this file lives inside that declared home.
//
// USAGE (library):
//   const ap = require('./automation-post.cjs');
//   await ap.post({ detector, title, findings, howWeKnow, whatToDo });
//
// USAGE (CLI — so workflow YAML stops hand-rolling curl):
//   node scripts/lib/automation-post.cjs post \
//     --detector registry-health --title "daily health check FAILED" \
//     --findings-file - --how-we-know "…" --what-to-do "…" [--bulleted]
//
// ENV:
//   SV_AUTOMATION_WEBHOOK_URL   the #sv-automation incoming webhook. Absent ⇒
//                               print instead of send (never a job failure).
//   SV_AUTOMATION_NO_POST=1     hard test seam: never touch the network at all,
//                               neither the webhook nor the claim. Same shape as
//                               land-on-main.sh's LAND_NO_POST.
//   GITHUB_TOKEN / SV_REGISTRY_PAT   contents:write on the ledger repo. Absent ⇒
//                               fail closed (post without claiming).
//   GITHUB_REPOSITORY           used for the app label, so a sibling repo running
//                               this labels itself, not sv-registry.
//   GITHUB_SERVER_URL / GITHUB_RUN_ID   used for the run URL when not passed.

const https = require('https');

// ── constants ────────────────────────────────────────────────────────────────
const LEDGER_REPO = process.env.SV_AUTOMATION_LEDGER_REPO || 'Stadium-Ventures/sv-registry';
const LEDGER_BRANCH = process.env.SV_AUTOMATION_LEDGER_BRANCH || 'main';
const LEDGER_REPO_PATH = 'data/reference/automation-post-ledger.json';
const GITHUB_API = 'https://api.github.com';

// One digest per detector per UTC day (D130). 24h rather than "until midnight"
// so a detector that fires at 23:50Z is not un-suppressed ten minutes later.
const DIGEST_TTL_H = 24;
// Acute findings carry their own key and the house 23h window (the same
// DEDUP_H pulse-heartbeat has used since 2026-07-29) — they are NOT grouped.
const ACUTE_TTL_H = 23;
// Rows older than this are pruned on every write, the same way
// pulse-heartbeat prunes its `seen` map. The ledger is a claim store, not an
// archive; git history is the archive.
const PRUNE_DAYS = 7;
const MAX_ATTEMPTS = 8;
// Same retryable set as api/alerts-subscription-update.js. 404 is retryable on a
// PUT (a just-created file that has not propagated); on a GET it means "no file
// yet", which is a normal first-claim, not an error.
const RETRYABLE = new Set([404, 409, 422, 429, 500, 502, 503, 504]);

const LEDGER_NOTE = 'Durable "already posted today" claim store for #sv-automation (D130, 2026-09-08: '
  + '"One digest per detector per day, findings grouped"). One row per (detector, UTC date) for grouped '
  + 'digests, plus per-finding rows for acute findings that must keep paging. Written ONLY by '
  + 'scripts/lib/automation-post.cjs, through a GitHub Contents-API compare-and-swap, so a sibling repo '
  + 'running the same detector claims against the same row. Rows older than '
  + `${PRUNE_DAYS} days are pruned on every write. Delete a row to force that detector to post again.`;

// ── small helpers ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Jittered backoff, same shape as api/alerts-subscription-update.js.
const backoffMs = (attempt) => Math.min(4000, 150 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 120);

function utcDate(d) { return new Date(d).toISOString().slice(0, 10); }

// The app label. Derived from github.repository where available — sibling repos
// will use this poster too (see the fan-out follow-up), and a message from
// sv-way-sync running in sv-internal-hub must say sv-internal-hub, not
// sv-registry. Matches sv-way-sync.yml's own `cut -d/ -f2`.
function appLabel(repo) {
  const r = repo || process.env.GITHUB_REPOSITORY || LEDGER_REPO;
  return String(r).split('/').pop() || 'sv-registry';
}

function runUrlFromEnv() {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const id = process.env.GITHUB_RUN_ID;
  return server && repo && id ? `${server}/${repo}/actions/runs/${id}` : null;
}

// ── 1. THE HOUSE FORMATTER ───────────────────────────────────────────────────
// PURE — no I/O, no clock, no env beyond the app label, so the message shape is
// pinned by scripts/lib/automation-post.selftest.cjs.
//
// Shape (CLAUDE.md § "#sv-automation message contract"):
//
//   <tag> *<app> (<app>) — <title>*
//   *What broke:*
//   • finding
//   • finding
//   *How we know:* …
//   *What to do:* …
//
// A GROUPED DIGEST states the three-parter ONCE for the whole group and lists
// the findings under What broke. That is the whole of D130's "findings grouped".
//
// THE TAG IS DERIVED FROM THE BODY, and specifically from the FINDINGS ONLY —
// generalising .github/workflows/registry-health.yml's rule (any 👤 in the body
// promotes the whole header to 👤, else 🛠️). It reads the findings and not the
// whole message on purpose: registry-health's own "What to do" text contains the
// literal 👤 while explaining what a 👤 line means, and scanning it would pin
// every message to 👤 forever. A 🛠️ header on a 👤 problem is a message nobody
// acts on; a 👤 header on everything is a channel nobody reads.
function deriveTag(findingLines) {
  return findingLines.some((l) => String(l).includes('👤')) ? '👤' : '🛠️';
}

function lineOf(f) {
  if (!f) return null;
  if (typeof f === 'string') return f;
  // A finding may carry its own tag (delivery-check.cjs's classifyActor already
  // computes one per finding). Render it INTO the line so the body-derived rule
  // above can see it and so the reader can see which finding needs the human.
  const line = f.line || f.text || null;
  if (!line) return null;
  return f.tag && !line.includes(f.tag) ? `${f.tag} ${line}` : line;
}

function format(opts = {}) {
  const {
    title, howWeKnow, whatToDo,
    app = appLabel(opts.repo), tag = null, bulleted = null,
  } = opts;
  const lines = (opts.findings || []).map(lineOf).filter((s) => s && String(s).trim());
  if (!lines.length) return null;                       // silent when healthy

  // One finding reads as a sentence; several read as a list. Callers that always
  // want the list form (pulse-heartbeat, whose selftest pins it) pass bulleted.
  const useBullets = bulleted == null ? lines.length > 1 : !!bulleted;
  const bullet = (s) => (String(s).trimStart().startsWith('•') ? s : `• ${s}`);
  // In the one-finding inline form the header already carries the tag, so a
  // leading tag on the sentence itself reads as a stutter. In the list form it
  // stays: there the per-finding tag is the only way to see WHICH one is 👤.
  const inline = String(lines[0]).replace(/^(🛠️|👤)\s+/, '');
  const broke = useBullets ? ['*What broke:*', ...lines.map(bullet)] : [`*What broke:* ${inline}`];

  return [
    `${tag || deriveTag(lines)} *${app} (${app}) — ${title}*`,
    ...broke,
    `*How we know:* ${howWeKnow}`,
    `*What to do:* ${whatToDo}`,
  ].join('\n');
}

// ── 2. THE DURABLE CLAIM ─────────────────────────────────────────────────────
function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sv-automation-post',
  };
}

// The real Contents-API transport. Shaped as an injectable object so the
// selftest can hand in an in-memory fake and never touch the network.
function githubTransport({ token, repo = LEDGER_REPO, branch = LEDGER_BRANCH } = {}) {
  const headers = ghHeaders(token);
  const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURI(LEDGER_REPO_PATH)}`;
  return {
    async get() {
      const r = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, { headers });
      if (r.status === 404) return { sha: null, json: null };   // first claim ever
      if (!r.ok) { const e = new Error(`GET ledger failed (${r.status})`); e.status = r.status; throw e; }
      const file = await r.json();
      return { sha: file.sha, json: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) };
    },
    async put(sha, text, message) {
      const r = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message, branch,
          ...(sha ? { sha } : {}),
          content: Buffer.from(text, 'utf8').toString('base64'),
        }),
      });
      // 409/422 is the compare-and-swap LOSING — somebody claimed while we were
      // reading. That is the mechanism working, not an error.
      if (r.status === 409 || r.status === 422) return { conflict: true };
      if (!r.ok) { const e = new Error(`PUT ledger failed (${r.status})`); e.status = r.status; throw e; }
      return { conflict: false };
    },
  };
}

function defaultTransport() {
  const token = process.env.GITHUB_TOKEN || process.env.SV_REGISTRY_PAT || null;
  if (!token) return null;                                // ⇒ fail closed
  return githubTransport({ token });
}

function normalizeLedger(json) {
  const doc = json && typeof json === 'object' ? json : {};
  return { _note: LEDGER_NOTE, posted: doc.posted && typeof doc.posted === 'object' ? { ...doc.posted } : {} };
}

function serialize(doc) { return JSON.stringify(doc, null, 2) + '\n'; }

function prune(posted, nowMs) {
  const cutoff = nowMs - PRUNE_DAYS * 24 * 3600 * 1000;
  for (const k of Object.keys(posted)) {
    const at = Date.parse(posted[k] && posted[k].at);
    if (!Number.isFinite(at) || at <= cutoff) delete posted[k];
  }
  return posted;
}

// claim() — CAS-guarded, NOT check-then-act. Exactly one caller per key gets
// {post:true}; every other caller that day gets {post:false}. A caller that is
// refused still has its findings RECORDED on the row, so the ledger is the
// audit trail of what the digest swallowed — "which six repos did this actually
// find?" is answerable from git, not only from the one runner's log.
//
// Returns:
//   { post:true,  group:[…], claimed:true  } — you own the digest; post it
//   { post:false, group:[…], claimed:true  } — someone already posted; stay quiet
//   { post:true,  group:[…], claimed:false, reason } — FAIL CLOSED; post anyway
async function claim(opts = {}) {
  const {
    key, findings = [], runUrl = null, ttlH = DIGEST_TTL_H,
  } = opts;
  const now = opts.now ? new Date(opts.now) : new Date();
  const nowMs = now.getTime();
  const transport = opts.transport !== undefined ? opts.transport : defaultTransport();

  if (!transport) {
    return {
      post: true, claimed: false, group: findings,
      reason: 'no claim transport (GITHUB_TOKEN / SV_REGISTRY_PAT absent) — failing closed, posting without a claim',
    };
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let remote;
    try {
      remote = await transport.get();
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE.has(e.status)) break;
      await sleep(backoffMs(attempt));
      continue;
    }

    const doc = normalizeLedger(remote.json);
    const row = doc.posted[key];
    const rowAt = row ? Date.parse(row.at) : NaN;
    const held = Number.isFinite(rowAt) && rowAt > nowMs - ttlH * 3600 * 1000;

    const mine = findings.map(lineOf).filter(Boolean);

    if (held) {
      // Somebody already posted this detector today. Record anything genuinely
      // new on the row (so the swallowed findings are traceable) and stay quiet.
      const known = new Set(row.findings || []);
      const added = mine.filter((f) => !known.has(f));
      if (!added.length) {
        return { post: false, claimed: true, group: row.findings || [], reason: 'already claimed — identical findings' };
      }
      const next = {
        ...doc,
        posted: prune({
          ...doc.posted,
          [key]: {
            ...row,
            findings: [...(row.findings || []), ...added].slice(0, 200),
            suppressed_runs: [...(row.suppressed_runs || []), runUrl].filter(Boolean).slice(-20),
          },
        }, nowMs),
      };
      try {
        const put = await transport.put(remote.sha, serialize(next),
          `automation-post: record ${added.length} suppressed finding(s) for ${key} [skip ci]`);
        if (put.conflict) { await sleep(backoffMs(attempt)); continue; }
      } catch (e) {
        // Failing to RECORD is not failing to claim — the claim is held, so the
        // correct behaviour is still silence. Say so and move on.
        return { post: false, claimed: true, group: row.findings || [], reason: `already claimed (could not record suppressed findings: ${e.message})` };
      }
      return { post: false, claimed: true, group: [...(row.findings || []), ...added], reason: 'already claimed today — findings recorded on the row' };
    }

    // Free (or expired). Claim it.
    const next = {
      ...doc,
      posted: prune({
        ...doc.posted,
        [key]: { at: now.toISOString(), findings: mine, run_url: runUrl },
      }, nowMs),
    };
    try {
      const put = await transport.put(remote.sha, serialize(next),
        `automation-post: claim ${key} (${mine.length} finding(s)) [skip ci]`);
      if (put.conflict) { await sleep(backoffMs(attempt)); continue; }   // lost the race — re-read
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE.has(e.status)) break;
      await sleep(backoffMs(attempt));
      continue;
    }
    return { post: true, claimed: true, group: mine, reason: 'claimed' };
  }

  return {
    post: true, claimed: false, group: findings,
    reason: `claim could not be established after ${MAX_ATTEMPTS} attempt(s)`
      + `${lastErr ? ` (${lastErr.message})` : ''} — failing closed, posting without a claim`,
  };
}

// ── 3. THE SEND ──────────────────────────────────────────────────────────────
function postWebhook(url, text) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve({ ok: false, error: 'bad_webhook_url' }); return; }
    const body = JSON.stringify({ text });
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let s = ''; res.on('data', (d) => { s += d; });
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: s }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body); req.end();
  });
}

// send() — the ONE outbound door to the #sv-automation webhook. Exposed so an
// in-process caller that has already claimed and formatted (pulse-heartbeat,
// whose claim is per-finding rather than per-day) stops hand-rolling its own
// https.request. Honours the no-post seam, and is never a job failure: a missing
// secret is a configuration state, not an outage.
async function send(text, wiring = {}) {
  if (!text) return { ok: true, sent: false, reason: 'nothing to send' };
  const noPost = process.env.SV_AUTOMATION_NO_POST === '1';
  const webhook = process.env.SV_AUTOMATION_WEBHOOK_URL || '';
  if (noPost || !webhook) {
    const why = noPost ? 'SV_AUTOMATION_NO_POST=1' : 'SV_AUTOMATION_WEBHOOK_URL unset';
    console.log(`[automation-post] ${why} — not sending. Would have posted:\n${text}`);
    return { ok: false, sent: false, reason: why };
  }
  const res = await (wiring.send || postWebhook)(webhook, text);
  if (!res.ok) console.error(`[automation-post] #sv-automation post failed: ${res.error || res.status}`);
  return { ...res, sent: !!res.ok };
}

// post() — claim, format, send. In that order, with one rule ahead of all of
// them: NO FINDINGS ⇒ SEND NOTHING, EVER, and do not even reach for the network.
//
// `acuteKey` opts out of grouping entirely: the finding claims its own key on
// its own window (pulse-heartbeat's `undelivered:<branch>` and land-on-main's
// landing failure), so an acute page is never swallowed by an unrelated digest
// that happened to fire first.
async function post(opts = {}, wiring = {}) {
  const detector = opts.detector;
  if (!detector) throw new Error('automation-post: post() needs a detector');
  const findings = (opts.findings || []).filter(Boolean);
  const now = opts.now ? new Date(opts.now) : new Date();
  const runUrl = opts.runUrl !== undefined ? opts.runUrl : runUrlFromEnv();

  // 1. SILENT WHEN HEALTHY. Before the claim, before the webhook, before
  //    anything that could cost a request or a commit.
  if (!findings.length) return { posted: false, sent: false, text: null, reason: 'no findings — silent when healthy' };
  if (!format({ ...opts, findings })) {
    return { posted: false, sent: false, text: null, reason: 'no findings after filtering — silent when healthy' };
  }

  const noPost = process.env.SV_AUTOMATION_NO_POST === '1';
  const key = opts.acuteKey || `${detector}:${utcDate(now)}`;
  const ttlH = opts.ttlH != null ? opts.ttlH : (opts.acuteKey ? ACUTE_TTL_H : DIGEST_TTL_H);

  // 2. CLAIM. The no-post seam means "touch no network at all", so with no
  //    injected transport it claims nothing and simply reports what it would say.
  const transport = wiring.claimTransport !== undefined
    ? wiring.claimTransport
    : (noPost ? null : undefined);
  const c = await claim({ key, findings, runUrl, ttlH, now, transport });
  if (!c.post) {
    return { posted: false, sent: false, text: null, key, claimed: true, group: c.group, reason: c.reason };
  }

  // 3. FORMAT the group. `c.group` is what the claim actually recorded, so a
  //    fail-closed post and a claimed post say the same thing.
  const text = format({ ...opts, findings: c.group && c.group.length ? c.group : findings });
  if (!text) return { posted: false, sent: false, text: null, reason: 'formatter returned nothing' };

  // 4. SEND.
  // `reason` always carries the CLAIM's verdict — including a fail-closed one,
  // which is the thing an operator most needs to see. The send outcome is a
  // separate field, so a no-post seam can never overwrite "I posted unclaimed
  // because the claim store was unreachable".
  const webhook = process.env.SV_AUTOMATION_WEBHOOK_URL || '';
  if (noPost || !webhook) {
    const why = noPost ? 'SV_AUTOMATION_NO_POST=1' : 'SV_AUTOMATION_WEBHOOK_URL unset';
    console.log(`[automation-post] ${why} — not sending. Would have posted:\n${text}`);
    return { posted: true, sent: false, text, key, claimed: !!c.claimed, group: c.group, reason: c.reason, sendReason: why };
  }
  const send = wiring.send || postWebhook;
  const res = await send(webhook, text);
  if (!res.ok) console.error(`[automation-post] #sv-automation post failed: ${res.error || res.status}`);
  else console.log(`[automation-post] posted ${detector} digest (${(c.group || findings).length} finding(s)) as ${key}${c.claimed ? '' : ' [UNCLAIMED — failed closed]'}`);
  return { posted: true, sent: !!res.ok, text, key, claimed: !!c.claimed, group: c.group, reason: c.reason, sendReason: res.ok ? 'sent' : (res.error || String(res.status)) };
}

module.exports = {
  format, claim, post, send, deriveTag, appLabel, githubTransport, normalizeLedger,
  LEDGER_REPO_PATH, DIGEST_TTL_H, ACUTE_TTL_H, PRUNE_DAYS, MAX_ATTEMPTS, RETRYABLE, LEDGER_NOTE,
};

// ── CLI ──────────────────────────────────────────────────────────────────────
// So workflow YAML calls this instead of hand-rolling curl + jq. Every flag is
// optional except --detector and (--title with findings, or --text).
if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'post';
  const get = (name, def = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : def;
  };
  const has = (name) => argv.includes(`--${name}`);
  const all = (name) => argv.reduce((acc, a, i) => (a === `--${name}` && argv[i + 1] !== undefined ? [...acc, argv[i + 1]] : acc), []);

  const findings = all('finding');
  const ff = get('findings-file');
  if (ff) {
    const fs = require('fs');
    const raw = ff === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(ff, 'utf8');
    for (const l of raw.split('\n').map((s) => s.trim()).filter(Boolean)) findings.push(l);
  }
  const preformatted = get('text');

  const opts = {
    detector: get('detector'),
    title: get('title'),
    findings,
    howWeKnow: get('how-we-know'),
    whatToDo: get('what-to-do'),
    tag: get('tag'),
    bulleted: has('bulleted') ? true : (has('inline') ? false : null),
    acuteKey: get('acute-key'),
    ttlH: get('ttl-h') ? Number(get('ttl-h')) : null,
    runUrl: get('run-url'),
    repo: get('repo'),
  };
  if (opts.ttlH == null) delete opts.ttlH;
  if (opts.runUrl == null) delete opts.runUrl;

  (async () => {
    if (cmd !== 'post') { console.error(`[automation-post] unknown command "${cmd}" (expected: post)`); process.exit(2); }
    if (!opts.detector) { console.error('[automation-post] --detector is required'); process.exit(2); }

    let r;
    if (preformatted) {
      // The caller already produced a house-contract message through format()
      // (scripts/ops/land-on-main.cjs does exactly this). Claim and send it as
      // one finding — do not wrap a formatted message in a second header.
      const { detector, acuteKey } = opts;
      const now = new Date();
      const key = acuteKey || `${detector}:${utcDate(now)}`;
      const ttlH = opts.ttlH != null ? opts.ttlH : (acuteKey ? ACUTE_TTL_H : DIGEST_TTL_H);
      const noPost = process.env.SV_AUTOMATION_NO_POST === '1';
      const c = await claim({
        key, findings: [preformatted.slice(0, 200)], runUrl: opts.runUrl !== undefined ? opts.runUrl : runUrlFromEnv(),
        ttlH, now, transport: noPost ? null : undefined,
      });
      if (!c.post) { console.log(`[automation-post] ${key} — ${c.reason}; staying silent`); process.exit(0); }
      const webhook = process.env.SV_AUTOMATION_WEBHOOK_URL || '';
      if (noPost || !webhook) {
        console.log(`[automation-post] ${noPost ? 'SV_AUTOMATION_NO_POST=1' : 'SV_AUTOMATION_WEBHOOK_URL unset'} — not sending. Would have posted:\n${preformatted}`);
        process.exit(0);
      }
      const res = await postWebhook(webhook, preformatted);
      if (!res.ok) console.error(`[automation-post] post failed: ${res.error || res.status}`);
      process.exit(0);
    }

    if (!opts.title) { console.error('[automation-post] --title is required (or use --text)'); process.exit(2); }
    r = await post(opts);
    if (!r.posted) console.log(`[automation-post] ${opts.detector} — no message sent (${r.reason})`);
    process.exit(0);
  })().catch((e) => {
    // A poster that fails the job it is reporting on turns one problem into two.
    console.error('[automation-post] error:', e.message);
    process.exit(0);
  });
}
