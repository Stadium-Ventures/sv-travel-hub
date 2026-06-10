import { useEffect, useState, type ReactNode } from 'react'
import { addMapEventListener } from '../../lib/mapEvents'
import StatusPill from './StatusPill'
import HeaderPlayerSearch from './HeaderPlayerSearch'

export type TabId = 'roster' | 'trips' | 'map' | 'data'

// Tab order: Map first (Kent's primary surface per interview 2026-06-08),
// then Trip Planner (recommendation engine), Data (Maptive-style spreadsheet),
// Roster (reference data).
const TABS: { id: TabId; label: string; heading: string; description: string }[] = [
  {
    id: 'map',
    label: 'Map',
    heading: 'Player Map',
    description: 'See where your players currently are. During spring training, Pro players show at their ST sites. Once game schedules are loaded, their regular season stadiums appear too. College and HS players show at their schools.',
  },
  {
    id: 'trips',
    label: 'Trip Planner',
    heading: 'Trip Planner',
    description: 'Pick a date range and the app builds optimized trip options — road trips for nearby players and fly-in visits for those farther away. You can also export trips to your calendar.',
  },
  {
    id: 'data',
    label: 'Schedule',
    heading: 'Schedule',
    description: 'Every loaded game as a sortable, filterable spreadsheet — Player · Team · Level · Date · Venue · Opponent. Scan and filter without leaving the table.',
  },
  {
    id: 'roster',
    label: 'Roster',
    heading: 'Client Roster',
    description: 'Your full list of players to visit this year. This pulls from the Google Sheet and shows each player\'s tier, visit targets, and progress.',
  },
]

interface AppShellProps {
  children: Record<TabId, ReactNode>
}

export default function AppShell({ children }: AppShellProps) {
  // Default to Map — Kent's primary planning surface per user interview 2026-06-08.
  // He filters by date, sees the map, plans from there 60-90% of sessions.
  const [activeTab, setActiveTab] = useState<TabId>('map')

  // Allow other parts of the tree (e.g. the map's "Plan trip with these
  // players" popup action) to switch tabs without prop-drilling.
  useEffect(() => addMapEventListener('app:switch-tab', (d) => setActiveTab(d.tab)), [])

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">SV Travel Hub</h1>
          <p className="text-xs text-text-dim">Road trip planner for client visits</p>
        </div>
        <div className="flex items-center gap-2">
          <HeaderPlayerSearch />
          <StatusPill />
        </div>
      </header>

      <nav className="mb-6 flex gap-1 rounded-xl border border-border bg-surface p-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-accent-blue/20 text-accent-blue'
                : 'text-text-dim hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main>{children[activeTab]}</main>
    </div>
  )
}
