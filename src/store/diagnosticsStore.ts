import { create } from 'zustand'

export interface DiagnosticIssue {
  level: 'error' | 'warning' | 'info'
  source: 'pro' | 'ncaa' | 'hs' | 'roster' | 'geocoding'
  message: string
  details?: string
}

interface DiagnosticsState {
  issues: DiagnosticIssue[]
  addIssue: (issue: DiagnosticIssue) => void
  addIssues: (issues: DiagnosticIssue[]) => void
  clearSource: (source: DiagnosticIssue['source']) => void
  clearAll: () => void
}

export const useDiagnosticsStore = create<DiagnosticsState>()((set) => ({
  issues: [],
  addIssue: (issue) =>
    set((state) => ({ issues: [...state.issues, issue] })),
  addIssues: (issues) =>
    set((state) => ({ issues: [...state.issues, ...issues] })),
  clearSource: (source) =>
    set((state) => ({ issues: state.issues.filter((i) => i.source !== source) })),
  clearAll: () => set({ issues: [] }),
}))
