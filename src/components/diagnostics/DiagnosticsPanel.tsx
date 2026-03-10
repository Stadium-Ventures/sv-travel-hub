import { useState } from 'react'
import { useDiagnosticsStore, type DiagnosticIssue } from '../../store/diagnosticsStore'

const SOURCE_LABELS: Record<DiagnosticIssue['source'], string> = {
  pro: 'Pro',
  ncaa: 'NCAA',
  hs: 'HS',
  roster: 'Roster',
  geocoding: 'Geocoding',
}

const LEVEL_COLORS: Record<DiagnosticIssue['level'], { badge: string; text: string; border: string }> = {
  error: { badge: 'bg-red-500/20 text-red-400', text: 'text-red-400', border: 'border-red-500/30' },
  warning: { badge: 'bg-yellow-500/20 text-yellow-400', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  info: { badge: 'bg-blue-500/20 text-blue-400', text: 'text-blue-400', border: 'border-blue-500/30' },
}

export default function DiagnosticsPanel() {
  const issues = useDiagnosticsStore((s) => s.issues)
  const [open, setOpen] = useState(false)
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set())

  if (issues.length === 0) return null

  // Group by source
  const grouped = new Map<DiagnosticIssue['source'], DiagnosticIssue[]>()
  for (const issue of issues) {
    const list = grouped.get(issue.source)
    if (list) list.push(issue)
    else grouped.set(issue.source, [issue])
  }

  const errorCount = issues.filter((i) => i.level === 'error').length
  const warningCount = issues.filter((i) => i.level === 'warning').length

  const toggleSource = (source: string) => {
    setExpandedSources((prev) => {
      const next = new Set(prev)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return next
    })
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-surface">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-dim">Diagnostics</span>
          {errorCount > 0 && (
            <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
              {warningCount} warning{warningCount !== 1 ? 's' : ''}
            </span>
          )}
          {errorCount === 0 && warningCount === 0 && (
            <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
              {issues.length} info
            </span>
          )}
        </div>
        <span className="text-xs text-text-dim">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {[...grouped.entries()].map(([source, sourceIssues]) => {
            const isExpanded = expandedSources.has(source)
            const worstLevel = sourceIssues.some((i) => i.level === 'error')
              ? 'error'
              : sourceIssues.some((i) => i.level === 'warning')
                ? 'warning'
                : 'info'
            const colors = LEVEL_COLORS[worstLevel]

            return (
              <div key={source} className={`rounded-lg border ${colors.border} px-3 py-2`}>
                <button
                  onClick={() => toggleSource(source)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold ${colors.text}`}>
                      {SOURCE_LABELS[source]}
                    </span>
                    <span className="text-xs text-text-dim">
                      {sourceIssues.length} issue{sourceIssues.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="text-xs text-text-dim">{isExpanded ? '-' : '+'}</span>
                </button>

                {!isExpanded && (
                  <p className="mt-1 text-xs text-text-dim truncate">
                    {sourceIssues[0]!.message}
                    {sourceIssues.length > 1 ? ` (+${sourceIssues.length - 1} more)` : ''}
                  </p>
                )}

                {isExpanded && (
                  <ul className="mt-2 space-y-1.5">
                    {sourceIssues.map((issue, idx) => {
                      const lc = LEVEL_COLORS[issue.level]
                      return (
                        <li key={idx} className="text-xs">
                          <span className={`inline-block rounded px-1.5 py-0.5 ${lc.badge} mr-1.5`}>
                            {issue.level}
                          </span>
                          <span className="text-text-dim">{issue.message}</span>
                          {issue.details && (
                            <p className="mt-0.5 ml-2 text-text-dim/70">{issue.details}</p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
