// Maptive-style spreadsheet view of every loaded game, one row per
// (player, game) pair. Sortable columns, text search, level/source filters.
// Kent's 2026-06-08 ask after he showed me how he uses Maptive's data tab.
//
// Click a player → opens the existing PlayerSchedulePanel.
// Click a venue → switches to the Map tab (which auto-centers if a player
//   filter is active, otherwise just goes to map).

import { useMemo, useState } from 'react'
import { useScheduleStore } from '../../store/scheduleStore'
import { useRosterStore } from '../../store/rosterStore'
import { useSummerStore } from '../../store/summerStore'
import { useTripStore } from '../../store/tripStore'
import { dispatchMapEvent } from '../../lib/mapEvents'
import type { GameEvent } from '../../types/schedule'
import type { PlayerLevel } from '../../types/roster'
import PlayerSchedulePanel from '../roster/PlayerSchedulePanel'

interface Row {
  key: string
  playerName: string
  level: PlayerLevel | 'Summer'
  tier: number
  team: string
  date: string
  time?: string
  venueName: string
  city: string
  opponent: string
  isHome: boolean
  source: GameEvent['source']
  confidence?: GameEvent['confidence']
  sourceUrl?: string
}

type SortField = 'playerName' | 'team' | 'level' | 'date' | 'venueName' | 'opponent'
type SortDir = 'asc' | 'desc'

const PAGE_SIZE = 100

const LEVEL_COLORS: Record<string, string> = {
  Pro: 'text-accent-green',
  NCAA: 'text-accent-blue',
  HS: 'text-accent-orange',
  Summer: 'text-yellow-400',
}

// NOTE: HS/JUCO games come SOLELY from the Client Game Schedule sheet
// (manual). The old 'MaxPreps' label was a leftover from the scraping era —
// the maxpreps.com sourceUrl on those rows is just a verification link.
const SOURCE_LABELS: Record<GameEvent['source'], string> = {
  'mlb-api': 'MLB API',
  'ncaa-lookup': 'D1Baseball',
  'hs-lookup': 'Schedule Sheet',
}

export default function DataTab() {
  const proGames = useScheduleStore((s) => s.proGames)
  const ncaaGames = useScheduleStore((s) => s.ncaaGames)
  const hsGames = useScheduleStore((s) => s.hsGames)
  const summerGames = useSummerStore((s) => s.summerGames)
  const players = useRosterStore((s) => s.players)

  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<Set<string>>(new Set(['Pro', 'NCAA', 'HS', 'Summer']))
  const [confidenceFilter, setConfidenceFilter] = useState<'all' | 'high' | 'low'>('all')
  // Hide past games by default — cached spring schedules (e.g. a drafted
  // player's old HS games) otherwise dominate page 1 and read as wrong data
  const [showPast, setShowPast] = useState(false)
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(0)
  const [schedulePanelPlayer, setSchedulePanelPlayer] = useState<string | null>(null)

  // Build row list (one per player × game), then apply filters + sort + page.
  const allRows = useMemo<Row[]>(() => {
    const playerMap = new Map(players.map((p) => [p.playerName, p]))
    function levelFor(g: GameEvent, playerName: string): Row['level'] {
      // Summer-league games have id prefix `summer-`
      if (g.id.startsWith('summer-')) return 'Summer'
      const p = playerMap.get(playerName)
      return p?.level ?? 'Pro'
    }
    function teamFor(g: GameEvent): string {
      // Display the team the player is ON for this game (home vs away)
      return g.isHome ? g.homeTeam : g.awayTeam
    }
    function opponentFor(g: GameEvent): string {
      return g.isHome ? `vs ${g.awayTeam}` : `@ ${g.homeTeam}`
    }
    function cityFor(): string {
      // We don't store city on GameEvent.venue today — the venue name is
      // usually the stadium. Leaving as a column placeholder for now.
      return ''
    }
    const rows: Row[] = []
    const seen = new Set<string>()
    const allGames = [...proGames, ...ncaaGames, ...hsGames, ...summerGames]
    for (const g of allGames) {
      for (const name of g.playerNames) {
        const k = `${g.id}|${name}`
        if (seen.has(k)) continue
        seen.add(k)
        const p = playerMap.get(name)
        rows.push({
          key: k,
          playerName: name,
          level: levelFor(g, name),
          tier: p?.tier ?? 4,
          team: teamFor(g),
          date: g.date,
          time: g.time,
          venueName: g.venue.name,
          city: cityFor(),
          opponent: opponentFor(g),
          isHome: g.isHome,
          source: g.source,
          confidence: g.confidence,
          sourceUrl: g.sourceUrl,
        })
      }
    }
    return rows
  }, [proGames, ncaaGames, hsGames, summerGames, players])

  const { filtered, hiddenPastCount } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const today = new Date().toISOString().split('T')[0]!
    const rows: Row[] = []
    let hiddenPast = 0
    for (const r of allRows) {
      if (!levelFilter.has(r.level)) continue
      if (confidenceFilter === 'high' && r.confidence !== 'high') continue
      if (confidenceFilter === 'low' && r.confidence === 'high') continue
      if (q) {
        const hay = `${r.playerName} ${r.team} ${r.venueName} ${r.opponent}`.toLowerCase()
        if (!hay.includes(q)) continue
      }
      // Matches every filter except the date cutoff — count it so the
      // empty state can explain "your rows exist, they're just past games"
      // (NCAA/HS seasons are over → deselecting Pro showed a bare zero)
      if (!showPast && r.date < today) { hiddenPast++; continue }
      rows.push(r)
    }
    return { filtered: rows, hiddenPastCount: hiddenPast }
  }, [allRows, levelFilter, confidenceFilter, search, showPast])

  const sorted = useMemo(() => {
    const mul = sortDir === 'asc' ? 1 : -1
    const copy = [...filtered]
    copy.sort((a, b) => {
      const av = (a[sortField] ?? '') as string | number
      const bv = (b[sortField] ?? '') as string | number
      if (typeof av === 'number' && typeof bv === 'number') return mul * (av - bv)
      return mul * String(av).localeCompare(String(bv))
    })
    return copy
  }, [filtered, sortField, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function toggleSort(f: SortField) {
    if (sortField === f) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortField(f); setSortDir('asc') }
  }
  function sortIndicator(f: SortField) {
    if (sortField !== f) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }
  function toggleLevel(l: string) {
    const next = new Set(levelFilter)
    if (next.has(l)) next.delete(l); else next.add(l)
    if (next.size === 0) next.add(l)
    setLevelFilter(next); setPage(0)
  }

  function jumpToVenueOnMap() {
    dispatchMapEvent('app:switch-tab', { tab: 'map' })
  }

  return (
    <div className="space-y-3">
      {/* Filter toolbar */}
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Find</span>
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
              placeholder="player, team, venue, opponent..."
              className="min-w-0 flex-1 max-w-[360px] rounded-md border border-border/40 bg-gray-950/40 px-2 py-0.5 text-[12px] text-text placeholder:text-text-dim/40 focus:outline-none focus:border-accent-blue/50"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Level</span>
            {(['Pro', 'NCAA', 'HS', 'Summer'] as const).map((l) => {
              const active = levelFilter.has(l)
              return (
                <button
                  key={l}
                  onClick={() => toggleLevel(l)}
                  className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'border-border bg-gray-800/60 text-text' : 'border-border/30 bg-transparent text-text-dim/40 line-through'
                  }`}
                >
                  {l}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-dim/60">Quality</span>
            {(['all', 'high', 'low'] as const).map((c) => (
              <button
                key={c}
                onClick={() => { setConfidenceFilter(c); setPage(0) }}
                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  confidenceFilter === c ? 'border-accent-blue/40 bg-accent-blue/15 text-accent-blue' : 'border-border/30 bg-transparent text-text-dim/60 hover:text-text'
                }`}
                title={c === 'high' ? 'Only games verified from an official source' : c === 'low' ? 'Only estimated games (venue may be approximate)' : 'Show all'}
              >
                {c === 'all' ? 'All' : c === 'high' ? 'Verified' : 'Estimated'}
              </button>
            ))}
          </div>

          <button
            onClick={() => { setShowPast(!showPast); setPage(0) }}
            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
              showPast ? 'border-border bg-gray-800/60 text-text' : 'border-border/30 bg-transparent text-text-dim/60 hover:text-text'
            }`}
            title={showPast ? 'Showing all games including past dates' : 'Past games hidden — click to include them'}
          >
            {showPast ? 'Hide past games' : 'Show past games'}
          </button>

          <div className="ml-auto flex items-center gap-2 text-[11px] text-text-dim">
            <span>
              {sorted.length.toLocaleString()} row{sorted.length !== 1 ? 's' : ''}
              {sorted.length !== allRows.length && (
                <span className="text-text-dim/40"> of {allRows.length.toLocaleString()}</span>
              )}
            </span>
            <span className="text-text-dim/30">·</span>
            <span>
              Page {page + 1}/{totalPages}
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="ml-2 rounded px-1.5 py-0.5 text-text-dim hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
              >‹</button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="rounded px-1.5 py-0.5 text-text-dim hover:text-text disabled:opacity-30 disabled:cursor-not-allowed"
              >›</button>
            </span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface text-left text-xs font-medium text-text-dim">
              <th className="cursor-pointer px-3 py-2 hover:text-text whitespace-nowrap" onClick={() => toggleSort('playerName')}>
                Player{sortIndicator('playerName')}
              </th>
              <th className="cursor-pointer px-3 py-2 hover:text-text whitespace-nowrap" onClick={() => toggleSort('team')}>
                Team{sortIndicator('team')}
              </th>
              <th className="cursor-pointer px-3 py-2 hover:text-text whitespace-nowrap" onClick={() => toggleSort('level')}>
                Level{sortIndicator('level')}
              </th>
              <th className="cursor-pointer px-3 py-2 hover:text-text whitespace-nowrap" onClick={() => toggleSort('date')}>
                Date{sortIndicator('date')}
              </th>
              <th className="px-3 py-2 whitespace-nowrap">Time</th>
              <th className="cursor-pointer px-3 py-2 hover:text-text whitespace-nowrap" onClick={() => toggleSort('venueName')}>
                Venue{sortIndicator('venueName')}
              </th>
              <th className="cursor-pointer px-3 py-2 hover:text-text whitespace-nowrap" onClick={() => toggleSort('opponent')}>
                Opponent{sortIndicator('opponent')}
              </th>
              <th className="px-3 py-2 whitespace-nowrap">Source</th>
              <th className="px-3 py-2 whitespace-nowrap text-right">Plan</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-text-dim">
                  {hiddenPastCount > 0 ? (
                    <>
                      No <span className="text-text">upcoming</span> games match — but {hiddenPastCount.toLocaleString()} past game{hiddenPastCount !== 1 ? 's' : ''} do
                      (NCAA and HS seasons are over until spring).{' '}
                      <button
                        onClick={() => { setShowPast(true); setPage(0) }}
                        className="text-accent-blue hover:underline underline-offset-2"
                      >
                        Show past games
                      </button>
                    </>
                  ) : (
                    'No rows match. Try clearing filters or loading more schedules from the Trip Planner tab.'
                  )}
                </td>
              </tr>
            ) : pageRows.map((r) => (
              <tr key={r.key} className="border-b border-border/40 hover:bg-surface-hover">
                <td className="px-3 py-1.5">
                  <button
                    onClick={() => setSchedulePanelPlayer(r.playerName)}
                    className="text-text hover:text-accent-blue hover:underline text-left"
                  >
                    {r.playerName}
                  </button>
                </td>
                <td className="px-3 py-1.5 text-text-dim">{r.team}</td>
                <td className="px-3 py-1.5">
                  <span className={`text-[11px] font-medium ${LEVEL_COLORS[r.level] ?? 'text-text-dim'}`}>{r.level}</span>
                </td>
                <td className="px-3 py-1.5 text-text-dim whitespace-nowrap">{r.date}</td>
                <td className="px-3 py-1.5 text-text-dim whitespace-nowrap text-[11px]">{formatTime(r.time)}</td>
                <td className="px-3 py-1.5">
                  <button
                    onClick={jumpToVenueOnMap}
                    className="text-left text-text-dim hover:text-accent-blue hover:underline"
                    title="Open Map tab"
                  >
                    {r.venueName}
                  </button>
                  {r.isHome && <span className="ml-1.5 text-[9px] text-accent-green/70">home</span>}
                </td>
                <td className="px-3 py-1.5 text-text-dim text-[12px]">{r.opponent}</td>
                <td className="px-3 py-1.5 text-[11px]">
                  <span className={r.confidence === 'high' ? 'text-accent-green/80' : 'text-accent-orange/80'} title={r.confidence === 'high' ? 'Verified from source' : 'Estimated — verify before planning'}>
                    {SOURCE_LABELS[r.source] ?? r.source}
                  </span>
                  {r.sourceUrl && (
                    <a
                      href={r.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1.5 text-[10px] text-accent-blue/60 hover:text-accent-blue underline"
                    >↗</a>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => {
                      // Build a trip around this game: set player as priority,
                      // narrow date window to ±5 days, jump to Trip Planner,
                      // auto-Generate. Closes the "I saw a game I want to
                      // attend → build me a trip" loop in one click.
                      const store = useTripStore.getState()
                      store.setPriorityPlayers([r.playerName])
                      const d = new Date(r.date + 'T12:00:00Z')
                      const start = new Date(d); start.setUTCDate(start.getUTCDate() - 2)
                      const end = new Date(d); end.setUTCDate(end.getUTCDate() + 5)
                      const today = new Date().toISOString().slice(0, 10)
                      const startIso = start.toISOString().slice(0, 10)
                      store.setDateRange(startIso < today ? today : startIso, end.toISOString().slice(0, 10))
                      dispatchMapEvent('app:switch-tab', { tab: 'trips' })
                      setTimeout(() => { store.generateTrips().catch((e) => console.warn('[data] auto-generate failed:', e)) }, 100)
                    }}
                    className="rounded-md bg-accent-blue/15 px-2 py-0.5 text-[10px] font-semibold text-accent-blue hover:bg-accent-blue/25"
                    title={`Build a trip around ${r.playerName}'s game on ${r.date}`}
                  >
                    Plan trip →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {schedulePanelPlayer && (
        <PlayerSchedulePanel
          playerName={schedulePanelPlayer}
          onClose={() => setSchedulePanelPlayer(null)}
        />
      )}
    </div>
  )
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' }) + ' ET'
}
