import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TimeDisplayMode } from '../lib/formatters'

/** Global game-time display preference. ET is the default everywhere (Tom
 *  2026-07-24); the header toggle switches every surface to venue-local. */
interface TimeState {
  mode: TimeDisplayMode
  setMode: (mode: TimeDisplayMode) => void
}

export const useTimeStore = create<TimeState>()(
  persist(
    (set) => ({
      mode: 'et',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'sv-time-display' },
  ),
)
