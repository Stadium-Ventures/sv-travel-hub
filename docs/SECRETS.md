# Secrets — where they live and how to get them

This file documents every secret this app uses: what it's for and where the
canonical value lives. **Never put an actual secret value in this file, in
code, or in any commit.**

All runtime env vars are set in the app's Vercel project
(Vercel dashboard → sv-travel-hub → Settings → Environment Variables; click
the eye icon to reveal a value). `VITE_*` vars are baked in at build time and
visible in the shipped bundle — treat them as public.

| Name | What it's for | Where the value comes from |
|---|---|---|
| `SV_AUTOMATION_WEBHOOK_URL` | Failure alerts → #sv-automation | Slack app → Incoming Webhooks (https://api.slack.com/apps). Reference copy: Vercel sv-heartbeat env (https://vercel.com/stadium-ventures/sv-heartbeat/settings/environment-variables). |
| `SLACK_BOT_TOKEN` | Posting the travel-schedule recap | Slack app → OAuth & Permissions |
| `SLACK_CHANNEL_TRAVEL_SCHEDULE` | Target channel ID (config, not secret) | Slack: channel details → copy channel ID |
| `CRON_SECRET` | Authenticates Vercel cron → API routes | Random string generated at setup. Regenerate freely — update Vercel env and redeploy. |
| `SELF_BASE_URL` | App's own URL for server-side fetches (config) | Set directly in Vercel env |
| `VITE_CARTO_BASEMAP_KEY` | CARTO basemap tiles (the dark map under the dots). Keyless tiles are watermarked "API KEY REQUIRED" since late Aug 2026. | https://carto.com/basemaps/apikey/ → Sign in with ttrudeau@stadium-ventures.com (registered 2026-09-18, free 5M tiles/mo, no CARTO account). Ends up in the client bundle (every tile URL carries it); protect it with a Referer restriction on the CARTO dashboard rather than by hiding it. Set in Vercel env for Production + Preview, then redeploy. |
| `VITE_ORS_API_KEY` | openrouteservice routing (drive times) | https://openrouteservice.org → dashboard → API keys. Ends up in the client bundle; use a free-tier key. |
| `HEARTBEAT_READ_TOKEN` | Bearer the two crons (`api/slack-recap.ts`, `api/health-monitor.ts`) send to sv-heartbeat once it gates its API. **Server-only: Vercel env, Production, mark Sensitive, never `VITE_`-prefixed** (a `VITE_` var is baked into the public bundle). Unset sends the same request as before; a 401 becomes a #sv-automation finding from the health monitor. | sv-heartbeat's `HEARTBEAT_READ_TOKENS` holds `sv-travel-hub:<token>`; this is the `<token>` half. Generate once (`openssl rand -hex 32`), set it in both projects the same hour. |
| `VITE_HEARTBEAT_SIGN_IN` | Config, not secret. `1` loads Google sign-in on page load so the browser sends the viewer's Google ID token to Heartbeat before Heartbeat enforces. Unset: sign-in only appears once Heartbeat answers 401. | Set in Vercel env, then redeploy (build-time). Needs `https://sv-travel-hub.vercel.app` as an Authorized JavaScript origin on the sv-registry OAuth client. |
| `VITE_EVENTS_CSV_URL`, `VITE_ROSTER_CSV_URL`, `VITE_SCHEDULE_CSV_URL`, `VITE_SUMMER_CSV_URL`, `VITE_SUMMER_MANUAL_CSV_URL` | Published-CSV URLs of source Google Sheets | Google Sheets → File → Share → Publish to web → CSV. Unlisted but not truly secret. |
| `VITE_CONTACT_CARD` | Feature flag (config, not secret). Leave unset. Shows the roster contact card only if a future gated contact door populates it (decision D4). | n/a |
| `VITE_ROSTER_SOURCE` | Roster switch (config, not secret): `sheet` (default) or `registry`. Read by the browser AND the crons. Build-time for the browser, so changing it needs a redeploy. | Set directly in Vercel env |
| `VITE_REGISTRY_ROSTER_URL` | sv-registry roster projection door (config). Default `https://sv-registry.vercel.app/api/roster-projection`. | Set directly in Vercel env (optional) |
| `VITE_ROSTER_MIN_ROWS` | Fail-closed floor for the registry roster (config). Default 50. | Set directly in Vercel env (optional) |
| `VITE_GOOGLE_CLIENT_ID` | Google Identity Services client for sign-in (public id, not a secret). Defaults to sv-registry's client, which the registry's `aud` check requires. | sv-registry `api/_lib/auth.js` `CLIENT_ID` |
| `SV_REGISTRY_ROSTER_TOKEN` | **Secret. Server-only.** Lets the crons (`/api/slack-recap`, `/api/health-monitor`) read the registry roster when `VITE_ROSTER_SOURCE=registry`. Never prefix with `VITE_` (that ships it to every browser) and never commit it: this repo is public. | sv-registry owner runs `node scripts/mint-service-token.cjs mint sv-travel-hub --scopes read:roster-projection` (plaintext shown once), then sets it in Vercel → Production (Sensitive). Rotate = revoke + mint. |

GitHub Actions secrets (repo → Settings → Secrets and variables → Actions),
used by `.github/workflows/health-deadman.yml`:

| Name | What it's for | Where the value comes from |
|---|---|---|
| `TRAVEL_HUB_CRON_SECRET` | Lets the dead-man probe call `/api/health-monitor` | Same value as the Vercel `CRON_SECRET` env (set 2026-08-05, probe armed). CRON_SECRET is flagged Sensitive in Vercel so it can never be viewed again — to re-sync, rotate: generate a new random value, overwrite CRON_SECRET (Production) in Vercel, redeploy, and `gh secret set TRAVEL_HUB_CRON_SECRET` with the same value. |
| `SV_AUTOMATION_WEBHOOK_URL` | Probe-failure alerts → #sv-automation | Slack app → Incoming Webhooks (set 2026-08-03) |

## Conventions

- To hand a secret to a teammate, set it where they need it (Vercel env or
  `gh secret set`) rather than pasting the value in Slack.
