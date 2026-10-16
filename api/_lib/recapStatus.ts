// One switch for the weekly Slack recap, shared by the recap itself
// (api/slack-recap.ts) and the daily health monitor (api/health-monitor.ts).
//
// Paused INDEFINITELY per Kent (2026-08-25): "Can we remove these alerts
// please?" While paused the recap posts nothing on its own schedule, and the
// monitor skips every check that only matters to the recap (its Slack token
// and channel, the dry run, the empty-recap test), so a paused feature never
// pages anyone. To resume, flip this to false: both files follow.
export const RECAP_PAUSED = true

export const RECAP_PAUSED_REASON = 'Recap paused indefinitely per Kent (2026-08-25)'
