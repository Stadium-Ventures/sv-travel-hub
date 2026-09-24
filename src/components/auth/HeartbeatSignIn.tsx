import { useEffect, useRef, useState } from 'react'
import { initGoogleAuth, onAuthChange, peekIdToken, renderSignInButton } from '../../lib/googleAuth'
import { proactiveSignInEnabled } from '../../lib/heartbeatAuth'
import { useHeartbeatStore } from '../../store/heartbeatStore'
import { useRosterStore } from '../../store/rosterStore'
import { getRosterSourceOrNull } from '../../lib/rosterSource'

/** Heartbeat access bar. Renders nothing while Heartbeat answers normally
 *  (today, and through heartbeat's observe window). When Heartbeat answers
 *  401 with no token it offers Google sign-in; when it turns down a token it
 *  says so and stops (no re-prompt, no retry loop). A new token triggers one
 *  refetch only if the last fetch went out without one. */
export default function HeartbeatSignIn() {
  const authState = useHeartbeatStore((s) => s.authState)
  // On the registry roster source the roster's own sign-in bar is showing
  // while it needs a token; one sign-in serves both, so don't show two.
  const rosterBarShowing = useRosterStore((s) => s.needsSignIn) && getRosterSourceOrNull() === 'registry'
  const error = useHeartbeatStore((s) => s.error)
  const [buttonFailed, setButtonFailed] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (proactiveSignInEnabled(import.meta.env.VITE_HEARTBEAT_SIGN_IN as string | undefined)) {
      void initGoogleAuth()
    }
    return onAuthChange(() => {
      const hb = useHeartbeatStore.getState()
      if (peekIdToken() && !hb.lastFetchSentToken) void hb.fetchHeartbeat()
    })
  }, [])

  useEffect(() => {
    if (authState !== 'signed-out' || !buttonRef.current) return
    let cancelled = false
    void renderSignInButton(buttonRef.current).then((ok) => { if (!cancelled) setButtonFailed(!ok) })
    return () => { cancelled = true }
  }, [authState])

  if (authState === 'ok' || (authState === 'signed-out' && rosterBarShowing)) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3 text-sm" role="alert">
      <span className={authState === 'denied' ? 'text-accent-orange' : 'text-text'}>{error}</span>
      {authState === 'signed-out' && <div ref={buttonRef} />}
      {authState === 'signed-out' && buttonFailed && (
        <span className="text-xs text-accent-red">
          Google sign-in could not load (blocked script or network). Heartbeat data stays paused.
        </span>
      )}
    </div>
  )
}
