import { useEffect, useState, type ReactNode } from 'react'
import { addMapEventListener } from '../../lib/mapEvents'
import StatusPill from './StatusPill'
import HeaderPlayerSearch from './HeaderPlayerSearch'

export type TabId = 'roster' | 'trips' | 'map' | 'data'

// Primary nav = Kent's two product surfaces (Map, Trip Planner). Schedule
// and Roster are reference/plumbing views, demoted to small header links
// (Tom 2026-07-22: "Kent will never look at that tab — too prominent").
const PRIMARY_TABS: { id: TabId; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'trips', label: 'Trip Planner' },
]

const UTILITY_TABS: { id: TabId; label: string; title: string }[] = [
  { id: 'data', label: 'Schedule', title: 'Every loaded game as a sortable, filterable table' },
  { id: 'roster', label: 'Data health', title: 'Roster, visit freshness, trades & promotions, and team-assignment checks' },
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

      <div className="mb-6 flex items-center gap-3">
        <nav className="flex flex-1 gap-1 rounded-xl border border-border/50 bg-surface p-1">
          {PRIMARY_TABS.map((tab) => (
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
        {/* Utility views — quiet text links, not tabs */}
        <div className="flex shrink-0 items-center gap-1">
          {UTILITY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.title}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-gray-800/60 text-text'
                  : 'text-text-dim/60 hover:text-text hover:bg-gray-800/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Breadcrumb back to the product when inside a utility view */}
      {(activeTab === 'data' || activeTab === 'roster') && (
        <div className="mb-3 flex items-center gap-2 text-xs text-text-dim">
          <button
            onClick={() => setActiveTab('map')}
            className="text-accent-blue/80 hover:text-accent-blue transition-colors"
          >
            ← Back to Map
          </button>
          <span className="text-text-dim/40">·</span>
          <span>{UTILITY_TABS.find((t) => t.id === activeTab)?.label}</span>
        </div>
      )}

      <main>{children[activeTab]}</main>
    </div>
  )
}
