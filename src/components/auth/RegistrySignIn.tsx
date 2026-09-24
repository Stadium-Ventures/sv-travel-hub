import { useEffect, useRef, useState } from 'react'
import { getRosterSourceOrNull } from '../../lib/rosterSource'
import { getIdToken, onAuthChange, renderSignInButton } from '../../lib/googleAuth'
import { useRosterStore } from '../../store/rosterStore'

/** Registry roster source only: a Google sign-in bar shown while there is no
 *  usable ID token. Renders nothing on the sheet source. When a credential
 *  arrives (One Tap auto-select or the button), the roster is refetched. */
export default function RegistrySignIn() {
  const isRegistry = getRosterSourceOrNull() === 'registry'
  const needsSignIn = useRosterStore((s) => s.needsSignIn)
  const [signedIn, setSignedIn] = useState(() => (isRegistry ? !!getIdToken() : true))
  const [buttonFailed, setButtonFailed] = useState(false)
  const buttonRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isRegistry) return
    return onAuthChange(() => {
      const has = !!getIdToken()
      setSignedIn(has)
      if (has) void useRosterStore.getState().fetchRoster()
    })
  }, [isRegistry])

  const show = isRegistry && (!signedIn || needsSignIn)

  useEffect(() => {
    if (!show || !buttonRef.current) return
    let cancelled = false
    void renderSignInButton(buttonRef.current).then((ok) => { if (!cancelled) setButtonFailed(!ok) })
    return () => { cancelled = true }
  }, [show])

  if (!show) return null
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3 text-sm" role="alert">
      <span className="text-text">
        Sign in with your @stadium-ventures.com Google account to load the roster.
      </span>
      <div ref={buttonRef} />
      {buttonFailed && (
        <span className="text-xs text-accent-red">
          Google sign-in could not load (blocked script or network). The roster stays unavailable; it does not fall back to the sheet.
        </span>
      )}
    </div>
  )
}
