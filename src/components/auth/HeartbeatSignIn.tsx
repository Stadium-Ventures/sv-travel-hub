import { useEffect } from 'react'
import { initGoogleAuth, onAuthChange, peekIdToken } from '../../lib/googleAuth'
import { proactiveSignInEnabled } from '../../lib/heartbeatAuth'
import { shouldRefetchOnSignIn, useHeartbeatStore } from '../../store/heartbeatStore'
import { useRosterStore } from '../../store/rosterStore'
import { getRosterSourceOrNull } from '../../lib/rosterSource'
import GoogleSignInButton from './GoogleSignInButton'

/** Heartbeat access bar. Renders nothing while Heartbeat answers normally.
 *  With no token the store skips Heartbeat and this offers Google sign-in;
 *  when Heartbeat turns down a token it says so and stops (no re-prompt, no
 *  retry loop). A new token refetches when the last fetch went out without
 *  one, or went out with one and failed for a reason other than access. */
export default function HeartbeatSignIn() {
  const authState = useHeartbeatStore((s) => s.authState)
  // On the registry roster source the roster's own sign-in bar is showing
  // while it needs a token; one sign-in serves both, so don't show two.
  const rosterBarShowing = useRosterStore((s) => s.needsSignIn) && getRosterSourceOrNull() === 'registry'
  const error = useHeartbeatStore((s) => s.error)

  useEffect(() => {
    if (proactiveSignInEnabled(import.meta.env.VITE_HEARTBEAT_SIGN_IN as string | undefined)) {
      void initGoogleAuth()
    }
    return onAuthChange(() => {
      const hb = useHeartbeatStore.getState()
      if (peekIdToken() && shouldRefetchOnSignIn(hb)) void hb.fetchHeartbeat()
    })
  }, [])

  if (authState === 'ok' || (authState === 'signed-out' && rosterBarShowing)) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3 text-sm" role="alert">
      <span className={authState === 'denied' ? 'text-accent-orange' : 'text-text'}>{error}</span>
      {authState === 'signed-out' && (
        <GoogleSignInButton unavailableNote="Heartbeat data stays paused." />
      )}
    </div>
  )
}
