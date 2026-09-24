/** Browser credentials for sv-heartbeat's API.
 *
 * sv-heartbeat is moving every /api route behind SV Google auth (heartbeat
 * cutover patch 0001). A cross-origin browser caller passes by sending the
 * viewer's Google ID token as `Authorization: Bearer <id_token>`; heartbeat
 * verifies signature, audience (sv-registry's OAuth client, the same one
 * src/lib/googleAuth.ts signs in with), expiry and the @stadium-ventures.com
 * domain. Until heartbeat closes its observe window, a credential-less GET
 * from this origin still passes, so:
 *
 *   - with a token in memory we send it;
 *   - without one we send the request exactly as before (no-op today);
 *   - a 401/403 is surfaced as a sign-in (or access) problem in the page.
 *
 * A 401 NEVER drops the token or re-prompts on its own: with One Tap
 * auto-select that would re-sign and refetch forever when the problem is
 * configuration (origin, audience), not the token. */

export type HeartbeatAuthState = 'ok' | 'signed-out' | 'denied'

/** Request options for a Heartbeat GET: Bearer when we have a token, else unchanged. */
export function heartbeatRequestInit(token: string | null): RequestInit {
  return token ? { headers: { Authorization: `Bearer ${token}` } } : {}
}

/** Maps a Heartbeat status to an auth state, or null when it is not an auth answer. */
export function classifyHeartbeatAuth(status: number, sentToken: boolean): HeartbeatAuthState | null {
  if (status !== 401 && status !== 403) return null
  return sentToken ? 'denied' : 'signed-out'
}

/** Plain-English line for the page. No emojis (Kent), no jargon beyond the status code. */
export function heartbeatAuthMessage(state: HeartbeatAuthState, status?: number): string | null {
  if (state === 'signed-out') {
    return 'Heartbeat now needs you to sign in with your @stadium-ventures.com Google account. Visit counts and overdue flags are paused until you do.'
  }
  if (state === 'denied') {
    return `Heartbeat turned down this sign-in${status ? ` (HTTP ${status})` : ''}. Visit counts and overdue flags are paused. Tell Tom in #sv-automation so he can check Heartbeat's access settings.`
  }
  return null
}

/** VITE_HEARTBEAT_SIGN_IN=1 loads Google sign-in on page load (so Heartbeat's
 *  observe logs show this page sending tokens before enforcement). Unset: the
 *  sign-in only appears once Heartbeat actually answers 401. */
export function proactiveSignInEnabled(raw: string | undefined | null): boolean {
  const v = (raw ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}
