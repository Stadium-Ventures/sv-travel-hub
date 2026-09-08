#!/usr/bin/env node
'use strict';
// scripts/lib/automation-post.selftest.cjs
//
// Pins D130 (2026-09-08) — BE: "One digest per detector per day, findings
// grouped." Four assertions BE asked for by name, plus the house-contract
// assertions that must not be weakened while satisfying them.
//
//   1. One detector with SIX findings produces ONE message that lists all six.
//   2. A SECOND run the same day for that detector produces NO message.
//   3. A HEALTHY run (no findings) produces nothing at all.
//   4. A single 👤 finding ANYWHERE in a group tags the WHOLE message 👤.
//
// The network is never touched. Two seams do that, both already house patterns:
//   • SV_AUTOMATION_NO_POST=1 + an empty SV_AUTOMATION_WEBHOOK_URL — the same
//     shape scripts/ops/land-on-main.selftest.cjs:80 uses (LAND_NO_POST=1).
//   • an INJECTED in-memory claim transport, so the compare-and-swap is
//     exercised for real (including a lost race) with no GitHub call.
//
// Run: node scripts/lib/automation-post.selftest.cjs   (must print PASS)
// Wired into .github/workflows/registry-health.yml as Check 1a1p.

process.env.SV_AUTOMATION_NO_POST = '1';
process.env.SV_AUTOMATION_WEBHOOK_URL = '';
process.env.GITHUB_REPOSITORY = 'Stadium-Ventures/sv-registry';

const ap = require('./automation-post.cjs');

let failed = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

// ── an in-memory Contents-API stand-in ───────────────────────────────────────
// Same contract as githubTransport(): get() → {sha, json}; put(sha, text, msg) →
// {conflict}. A stale sha is rejected exactly as GitHub rejects one, so the CAS
// loop is really exercised and not simulated away.
function fakeTransport(initialDoc = null) {
  const state = { sha: initialDoc ? 'sha-0' : null, text: initialDoc ? JSON.stringify(initialDoc) : null, puts: 0, gets: 0, fail: null };
  return {
    state,
    get() {
      state.gets += 1;
      if (state.fail === 'get') { const e = new Error('boom'); e.status = 500; return Promise.reject(e); }
      return Promise.resolve({ sha: state.sha, json: state.text ? JSON.parse(state.text) : null });
    },
    put(sha, text) {
      state.puts += 1;
      if (state.fail === 'put') { const e = new Error('boom'); e.status = 503; return Promise.reject(e); }
      if (sha !== state.sha) return Promise.resolve({ conflict: true });      // lost the race
      state.sha = `sha-${state.puts}`;
      state.text = text;
      return Promise.resolve({ conflict: false });
    },
  };
}

const SIX = [
  'sv-registry — sv-way.config.json declares roles that no longer match the repo',
  'sv-internal-hub — sv-way.config.json declares roles that no longer match the repo',
  'sv-compliance-tracker — sv-way.config.json declares roles that no longer match the repo',
  'SV-App — sv-way.config.json declares roles that no longer match the repo',
  'sv-equipment-ordering — sv-way.config.json declares roles that no longer match the repo',
  'sv-media-pipeline — sv-way.config.json declares roles that no longer match the repo',
];
const DETECTOR = {
  detector: 'sv-way-config-staleness',
  title: 'sv-way.config.json may be stale',
  howWeKnow: "the daily sv-way-sync staleness check diffed each repo's sv-way.config.json against commits since its own date stamp.",
  whatToDo: 'have a session re-read each repo and refresh its sv-way.config.json — this check detects drift, it never rewrites the file.',
};
const NOW = '2026-09-08T12:00:00.000Z';
const LATER_SAME_DAY = '2026-09-08T21:30:00.000Z';
const NEXT_DAY = '2026-09-09T12:05:00.000Z';

async function main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // BE ASSERTION 1 — six findings ⇒ ONE message that lists all six
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n[BE 1] one detector · six findings · ONE message listing all six');
  const t = fakeTransport();
  const first = await ap.post({ ...DETECTOR, findings: SIX, now: NOW, runUrl: 'https://example/run/1' }, { claimTransport: t });

  ok('a message is produced', first.posted === true && typeof first.text === 'string', first.reason);
  ok('the claim was actually taken (not a fail-closed post)', first.claimed === true, first.reason);
  const bullets = String(first.text).split('\n').filter((l) => l.startsWith('• '));
  ok('ONE message, not six', t.state.puts === 1 && String(first.text).split('*What broke:*').length === 2,
    `puts=${t.state.puts}`);
  ok('all SIX findings are listed in it', bullets.length === 6, `got ${bullets.length} bullet(s)`);
  ok('every repo is named', SIX.every((f) => String(first.text).includes(f)));
  ok('the three-parter is stated ONCE for the whole group',
    String(first.text).split('*How we know:*').length === 2
    && String(first.text).split('*What to do:*').length === 2, first.text);
  ok('the ledger row records the group under one (detector, UTC date) key',
    JSON.parse(t.state.text).posted['sv-way-config-staleness:2026-09-08'].findings.length === 6,
    t.state.text);

  // ═══════════════════════════════════════════════════════════════════════════
  // BE ASSERTION 2 — a second run the SAME DAY produces NO message
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n[BE 2] a second run the same day for that detector says NOTHING');
  const second = await ap.post({ ...DETECTOR, findings: SIX, now: LATER_SAME_DAY, runUrl: 'https://example/run/2' }, { claimTransport: t });
  ok('no message at all', second.posted === false && second.text === null, `${second.reason} / text=${second.text}`);
  ok('it stayed quiet because the day was already claimed, not because it broke',
    second.claimed === true && /already claimed/.test(String(second.reason)), second.reason);
  ok('identical findings cost no extra write', t.state.puts === 1, `puts=${t.state.puts}`);

  // …but a genuinely NEW finding the same day is still RECORDED on the row, so
  // the digest is auditable even where it is deliberately silent.
  const third = await ap.post({
    ...DETECTOR, findings: [...SIX, 'sv-scores — sv-way.config.json declares roles that no longer match the repo'],
    now: LATER_SAME_DAY, runUrl: 'https://example/run/3',
  }, { claimTransport: t });
  ok('a NEW finding the same day is still silent (D130 is one digest per day)', third.posted === false && third.text === null, third.reason);
  ok('…but it is recorded on the row so nothing is lost from the audit trail',
    JSON.parse(t.state.text).posted['sv-way-config-staleness:2026-09-08'].findings.length === 7, t.state.text);

  // The NEXT day is a new key and posts again — the suppression is a day, not forever.
  const tomorrow = await ap.post({ ...DETECTOR, findings: SIX, now: NEXT_DAY, runUrl: 'https://example/run/4' }, { claimTransport: t });
  ok('the next UTC day is a new key and posts again', tomorrow.posted === true && tomorrow.key === 'sv-way-config-staleness:2026-09-09', tomorrow.reason);

  // ═══════════════════════════════════════════════════════════════════════════
  // BE ASSERTION 3 — a HEALTHY run produces nothing at all
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n[BE 3] a healthy run (no findings) produces nothing at all');
  const th = fakeTransport();
  const healthy = await ap.post({ ...DETECTOR, findings: [], now: NOW }, { claimTransport: th });
  ok('no message', healthy.posted === false && healthy.text === null, healthy.reason);
  ok('and NO claim was written — a healthy run does not even reach for the store',
    th.state.gets === 0 && th.state.puts === 0, `gets=${th.state.gets} puts=${th.state.puts}`);
  const healthy2 = await ap.post({ ...DETECTOR, findings: [null, '', undefined], now: NOW }, { claimTransport: th });
  ok('findings that filter down to nothing are also silent', healthy2.posted === false && healthy2.text === null, healthy2.reason);
  ok('the formatter alone is silent when handed nothing',
    ap.format({ ...DETECTOR, findings: [] }) === null && ap.format({ ...DETECTOR }) === null);

  // ═══════════════════════════════════════════════════════════════════════════
  // BE ASSERTION 4 — one 👤 finding anywhere tags the WHOLE message 👤
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\n[BE 4] a single 👤 finding anywhere in a group tags the WHOLE message 👤');
  const mixed = [...SIX.slice(0, 5), '👤 sv-media-pipeline — the branch does not merge cleanly; a human must rebase it'];
  const tagged = ap.format({ ...DETECTOR, findings: mixed });
  ok('the header wears 👤', String(tagged).split('\n')[0].startsWith('👤 '), String(tagged).split('\n')[0]);
  ok('an all-🛠️ group still wears 🛠️', String(ap.format({ ...DETECTOR, findings: SIX })).split('\n')[0].startsWith('🛠️ '));
  ok('the 👤 wins from ANY position, not just the last',
    String(ap.format({ ...DETECTOR, findings: ['👤 a human must act', ...SIX] })).split('\n')[0].startsWith('👤 ')
    && String(ap.format({ ...DETECTOR, findings: [SIX[0], '👤 a human must act', SIX[1]] })).split('\n')[0].startsWith('👤 '));
  ok('a per-finding {line,tag} promotes the header too (delivery-check\'s classifyActor shape)',
    String(ap.format({ ...DETECTOR, findings: [SIX[0], { line: 'the branch does not merge cleanly', tag: '👤' }] })).split('\n')[0].startsWith('👤 '));
  ok('…and that finding\'s own tag is rendered into its line, so the reader can see WHICH one needs a person',
    String(ap.format({ ...DETECTOR, findings: [SIX[0], { line: 'the branch does not merge cleanly', tag: '👤' }] }))
      .includes('• 👤 the branch does not merge cleanly'));
  ok('the tag is derived from the FINDINGS, not from What-to-do prose that merely mentions 👤',
    String(ap.format({ ...DETECTOR, findings: SIX, whatToDo: 'a 🛠️ line is agent-fixable; a 👤 line needs a person.' }))
      .split('\n')[0].startsWith('🛠️ '));

  // ═══════════════════════════════════════════════════════════════════════════
  // HOUSE CONTRACT — unchanged by D130, so asserted alongside it
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nhouse contract (CLAUDE.md § #sv-automation message contract)');
  const one = ap.format({ ...DETECTOR, findings: [SIX[0]] });
  const L = String(first.text).split('\n');
  ok('the header labels the app both ways round: `sv-registry (sv-registry) — …`',
    L[0].includes('*sv-registry (sv-registry) — sv-way.config.json may be stale*'), L[0]);
  ok('the tag LEADS the header — it is never appended to the end',
    /^(🛠️|👤) \*/.test(L[0]) && !/(🛠️|👤)\*?$/.test(L[0]), L[0]);
  ok('all three parts are present and BOLD',
    L.includes('*What broke:*') && L.some((l) => l.startsWith('*How we know:*')) && L.some((l) => l.startsWith('*What to do:*')), first.text);
  ok('a single finding reads as a sentence, not a one-item list', one.split('\n')[1].startsWith('*What broke:* '), one);
  ok('…unless the caller pins the list form', ap.format({ ...DETECTOR, findings: [SIX[0]], bulleted: true }).split('\n')[1] === '*What broke:*');
  ok('the app label follows github.repository, so a sibling repo labels ITSELF',
    ap.appLabel('Stadium-Ventures/sv-internal-hub') === 'sv-internal-hub'
    && String(ap.format({ ...DETECTOR, findings: [SIX[0]], repo: 'Stadium-Ventures/sv-internal-hub' })).includes('*sv-internal-hub (sv-internal-hub) —'));

  // ═══════════════════════════════════════════════════════════════════════════
  // ACUTE PATH — must bypass grouping and keep paging
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nthe acute path bypasses grouping and keeps paging');
  const ta = fakeTransport();
  const a1 = await ap.post({
    detector: 'pulse-heartbeat', title: 'routine reported success, delivered nothing',
    findings: ['branch claude/a carries 1 run-ledger entry not on main'],
    acuteKey: 'undelivered:claude/a', howWeKnow: 'x', whatToDo: 'y', now: NOW,
  }, { claimTransport: ta });
  const a2 = await ap.post({
    detector: 'pulse-heartbeat', title: 'routine reported success, delivered nothing',
    findings: ['branch claude/b carries 1 run-ledger entry not on main'],
    acuteKey: 'undelivered:claude/b', howWeKnow: 'x', whatToDo: 'y', now: LATER_SAME_DAY,
  }, { claimTransport: ta });
  ok('a SECOND acute finding the same day still pages — it is not swallowed by the first',
    a1.posted === true && a2.posted === true, `${a1.reason} / ${a2.reason}`);
  ok('each acute finding claims its OWN key, not the day key',
    a1.key === 'undelivered:claude/a' && a2.key === 'undelivered:claude/b');
  const a1repeat = await ap.post({
    detector: 'pulse-heartbeat', title: 'routine reported success, delivered nothing',
    findings: ['branch claude/a carries 1 run-ledger entry not on main'],
    acuteKey: 'undelivered:claude/a', howWeKnow: 'x', whatToDo: 'y', now: LATER_SAME_DAY,
  }, { claimTransport: ta });
  ok('the SAME acute finding inside the 23h window is still suppressed', a1repeat.posted === false, a1repeat.reason);
  ok('acute keeps the house 23h window; digests get 24h', ap.ACUTE_TTL_H === 23 && ap.DIGEST_TTL_H === 24);

  // ═══════════════════════════════════════════════════════════════════════════
  // FAIL CLOSED — a missed alert is worse than a duplicate
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nfail closed — an unavailable claim store must never silence an alert');
  const noTransport = await ap.post({ ...DETECTOR, findings: SIX, now: NOW }, { claimTransport: null });
  ok('no token / no transport ⇒ POST anyway', noTransport.posted === true && noTransport.claimed === false, noTransport.reason);
  ok('and it says WHY it posted unclaimed', /failing closed/.test(String(noTransport.reason)), noTransport.reason);
  const tg = fakeTransport(); tg.state.fail = 'get';
  const getDown = await ap.post({ ...DETECTOR, findings: SIX, now: NOW }, { claimTransport: tg });
  ok('the claim store erroring on read ⇒ POST anyway', getDown.posted === true && getDown.claimed === false, getDown.reason);
  const tp = fakeTransport(); tp.state.fail = 'put';
  const putDown = await ap.post({ ...DETECTOR, findings: SIX, now: NOW }, { claimTransport: tp });
  ok('the claim store erroring on write ⇒ POST anyway', putDown.posted === true && putDown.claimed === false, putDown.reason);
  ok('retryable set matches the house list {404,409,422,429,5xx}',
    [404, 409, 422, 429, 500, 502, 503, 504].every((s) => ap.RETRYABLE.has(s)) && !ap.RETRYABLE.has(403));

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPARE-AND-SWAP — not check-then-act
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\ncompare-and-swap — exactly one caller wins a contested key');
  {
    // Two callers read the same empty ledger, then both try to write. The second
    // PUT carries a stale sha, GitHub-style 409s it, and the retry re-reads and
    // finds the row already there — so it stays silent instead of double-posting.
    const tc = fakeTransport();
    const base = await tc.get();
    const win = await ap.claim({ key: 'k:2026-09-08', findings: ['f1'], now: NOW, transport: tc });
    const racer = {
      state: tc.state,
      get: () => Promise.resolve(base),                       // the stale read
      put: (sha, text) => tc.put(sha, text),
    };
    let reads = 0;
    racer.get = () => { reads += 1; return reads === 1 ? Promise.resolve(base) : tc.get(); };
    const lose = await ap.claim({ key: 'k:2026-09-08', findings: ['f1'], now: NOW, transport: racer });
    ok('the first caller claims', win.post === true && win.claimed === true, win.reason);
    ok('the racer\'s stale-sha PUT is rejected and it re-reads', reads >= 2, `reads=${reads}`);
    ok('the racer then finds the key held and does NOT post', lose.post === false, lose.reason);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRUNING — the claim store is a claim store, not an archive
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\npruning');
  {
    const old = { _note: 'x', posted: {
      'ancient:2026-08-01': { at: '2026-08-01T00:00:00.000Z', findings: ['old'] },
      'recent:2026-09-07': { at: '2026-09-07T00:00:00.000Z', findings: ['new'] },
    } };
    const tp2 = fakeTransport(old);
    await ap.claim({ key: 'fresh:2026-09-08', findings: ['f'], now: NOW, transport: tp2 });
    const doc = JSON.parse(tp2.state.text);
    ok(`rows older than ~${ap.PRUNE_DAYS} days are dropped on write`, !doc.posted['ancient:2026-08-01'], Object.keys(doc.posted).join(','));
    ok('rows inside the window survive', !!doc.posted['recent:2026-09-07'] && !!doc.posted['fresh:2026-09-08']);
    ok('the note is rewritten so the file explains itself', String(doc._note).includes('One digest per detector per day'));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // THE NO-POST SEAM — the test path is inert, always
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('\nthe no-post seam is genuinely inert');
  ok('SV_AUTOMATION_NO_POST=1 sends nothing even when a message was produced',
    first.sent === false && tomorrow.sent === false);
  ok('the ledger path is the declared one', ap.LEDGER_REPO_PATH === 'data/reference/automation-post-ledger.json');

  console.log(failed === 0
    ? '\nPASS — all automation-post self-tests green\n'
    : `\nFAIL — ${failed} assertion(s) failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('automation-post.selftest error:', e); process.exit(1); });
