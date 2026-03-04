import type { ReactNode } from 'react'

export default function Term({ tip, children }: { tip: string; children: ReactNode }) {
  return (
    <span className="group relative inline cursor-help border-b border-dotted border-text-dim/50">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-xs -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-normal text-text-dim shadow-lg group-hover:block">
        {tip}
      </span>
    </span>
  )
}
