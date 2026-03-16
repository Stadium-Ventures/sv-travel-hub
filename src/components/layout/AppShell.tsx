import { useState, type ReactNode } from 'react'
import DiagnosticsPanel from '../diagnostics/DiagnosticsPanel'
import { clearAllData } from '../../lib/cacheUtils'

export type TabId = 'roster' | 'calendar' | 'trips' | 'map'

const TABS: { id: TabId; label: string; heading: string; description: string }[] = [
  {
    id: 'roster',
    label: 'Roster',
    heading: 'Client Roster',
    description: 'Your full list of players to visit this year. This pulls from the Google Sheet and shows each player\'s tier, visit targets, and progress.',
  },
{
    id: 'calendar',
    label: 'Calendar',
    heading: 'Game Calendar',
    description: 'All your players\' games in one view — Pro, spring training, college, and high school combined. Use the filters to focus on specific levels.',
  },
  {
    id: 'trips',
    label: 'Trip Planner',
    heading: 'Trip Planner',
    description: 'Pick a date range and the app builds optimized trip options — road trips for nearby players and fly-in visits for those farther away. You can also export trips to your calendar.',
  },
  {
    id: 'map',
    label: 'Map',
    heading: 'Player Map',
    description: 'See where your players currently are. During spring training, Pro players show at their ST sites. Once game schedules are loaded, their regular season stadiums appear too. College and HS players show at their schools.',
  },
]

interface AppShellProps {
  children: Record<TabId, ReactNode>
}

export default function AppShell({ children }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<TabId>('trips')
  const currentTab = TABS.find((t) => t.id === activeTab)!

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">SV Travel Hub</h1>
          <p className="text-xs text-text-dim">Road trip planner for client visits</p>
        </div>
        <button
          onClick={() => {
            if (confirm('This will clear all cached data and reload the app. Your roster will reload from Google Sheets. Continue?')) {
              clearAllData()
              window.location.reload()
            }
          }}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-dim hover:text-accent-red hover:border-accent-red/50 transition-colors"
          title="Clear all cached schedules and app data, then reload"
        >
          Reset & Reload
        </button>
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

      {/* Tab header */}
      <div className="mb-6 rounded-xl border border-border/50 bg-surface/50 px-5 py-4">
        <h2 className="text-base font-semibold text-text">{currentTab.heading}</h2>
        <p className="mt-1 text-sm text-text-dim">{currentTab.description}</p>
      </div>

      <DiagnosticsPanel />
      <main>{children[activeTab]}</main>
    </div>
  )
}
