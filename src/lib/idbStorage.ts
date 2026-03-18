import { get, set, del } from 'idb-keyval'
import type { StateStorage } from 'zustand/middleware'

// IndexedDB-backed storage adapter for Zustand persist
// Used instead of localStorage for large datasets (schedule game data)
export const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) ?? null
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value)
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name)
  },
}
