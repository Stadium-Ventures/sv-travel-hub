import { useEffect, useMemo, useRef, useState } from 'react'
import { useRosterStore } from '../../store/rosterStore'
import { dispatchMapEvent } from '../../lib/mapEvents'

/**
 * Global "find a player" search in the app header. Works from any tab:
 * typing matches roster players (player name or org), Enter / click selects
 * one and jumps to the Map tab with that player filtered + zoomed.
 *
 * Reduces friction for the common Kent ask: "where is X right now?" — no
 * need to navigate to the Map first.
 */
export default function HeaderPlayerSearch() {
  const players = useRosterStore((s) => s.players)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    return players
      .filter((p) =>
        p.playerName.toLowerCase().includes(q) ||
        p.org.toLowerCase().includes(q),
      )
      .slice(0, 8)
  }, [query, players])

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Keyboard: arrow nav + Enter to commit
  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, matches.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter')     { e.preventDefault(); const m = matches[activeIndex]; if (m) commit(m.playerName) }
    if (e.key === 'Escape')    { setOpen(false); inputRef.current?.blur() }
  }

  function commit(playerName: string) {
    dispatchMapEvent('app:switch-tab', { tab: 'map' })
    // Fire the player-filter event next tick so MapView has mounted/picked
    // up the tab switch before the filter event arrives.
    setTimeout(() => dispatchMapEvent('map:select-player', { playerName }), 50)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIndex(0) }}
        onFocus={() => query.length >= 2 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Find player…"
        className="w-48 rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] text-text placeholder:text-text-dim/50 focus:border-accent-blue focus:outline-none"
      />
      {open && matches.length > 0 && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          {matches.map((p, i) => (
            <button
              key={p.playerName}
              onClick={() => commit(p.playerName)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${
                i === activeIndex ? 'bg-accent-blue/15 text-accent-blue' : 'text-text hover:bg-gray-900/40'
              }`}
            >
              <div className="font-medium">{p.playerName}</div>
              <div className="text-[10px] text-text-dim/70">
                {p.org} · {p.level} · T{p.tier}
              </div>
            </button>
          ))}
        </div>
      )}
      {open && query.length >= 2 && matches.length === 0 && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-text-dim shadow-xl">
          No players match "{query}"
        </div>
      )}
    </div>
  )
}
