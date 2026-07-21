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
| `VITE_ORS_API_KEY` | openrouteservice routing (drive times) | https://openrouteservice.org → dashboard → API keys. Ends up in the client bundle; use a free-tier key. |
| `VITE_EVENTS_CSV_URL`, `VITE_ROSTER_CSV_URL`, `VITE_SCHEDULE_CSV_URL`, `VITE_SUMMER_CSV_URL`, `VITE_SUMMER_MANUAL_CSV_URL` | Published-CSV URLs of source Google Sheets | Google Sheets → File → Share → Publish to web → CSV. Unlisted but not truly secret. |

## Conventions

- To hand a secret to a teammate, set it where they need it (Vercel env or
  `gh secret set`) rather than pasting the value in Slack.
