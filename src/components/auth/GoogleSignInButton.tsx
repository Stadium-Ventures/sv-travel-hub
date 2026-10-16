import { useEffect, useRef, useState } from 'react'
import { renderSignInButton } from '../../lib/googleAuth'

/** Google's sign-in button for the sign-in bars. When the Google script can't
 *  load (blocked or offline) it says so and offers Try again, which downloads
 *  the script again without reloading the page. `unavailableNote` says what
 *  stays paused meanwhile. */
export default function GoogleSignInButton({ unavailableNote }: { unavailableNote: string }) {
  const buttonRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!buttonRef.current) return
    let cancelled = false
    void renderSignInButton(buttonRef.current).then((ok) => { if (!cancelled) setFailed(!ok) })
    return () => { cancelled = true }
  }, [attempt])

  return (
    <>
      <div ref={buttonRef} />
      {failed && (
        <span className="flex flex-wrap items-center gap-2 text-xs text-accent-red">
          Google sign-in could not load (blocked script or network). {unavailableNote}
          <button
            onClick={() => { setFailed(false); setAttempt((n) => n + 1) }}
            className="rounded-md border border-border px-2 py-0.5 text-xs text-text-dim hover:text-text hover:border-accent-blue"
          >
            Try again
          </button>
        </span>
      )}
    </>
  )
}
