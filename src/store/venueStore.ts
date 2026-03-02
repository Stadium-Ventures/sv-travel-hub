import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Coordinates } from '../types/roster'
import { NCAA_VENUES } from '../data/ncaaVenues'
import { SPRING_TRAINING_SITES } from '../data/springTraining'
import { geocodeAllHsVenues } from '../lib/geocoding'

type VenueSource = 'mlb-api' | 'ncaa-hardcoded' | 'hs-geocoded' | 'spring-training'

interface VenueInfo {
  name: string
  coords: Coordinates
  source: VenueSource
}

interface VenueState {
  venues: Record<string, VenueInfo>
  hsGeocodingProgress: { completed: number; total: number } | null
  hsGeocodingError: string | null
  hsGeocodingFailedSchools: string[]

  loadNcaaVenues: () => void
  loadSpringTrainingVenues: () => void
  addProVenue: (key: string, name: string, coords: Coordinates) => void
  geocodeHsVenues: (schools: Array<{ schoolName: string; city: string; state: string }>) => Promise<void>
  getVenue: (key: string) => VenueInfo | undefined
}

export const useVenueStore = create<VenueState>()(
  persist(
    (set, get) => ({
  venues: {},
  hsGeocodingProgress: null,
  hsGeocodingError: null,
  hsGeocodingFailedSchools: [],

  loadNcaaVenues: () => {
    const venues = { ...get().venues }
    for (const [school, data] of Object.entries(NCAA_VENUES)) {
      venues[`ncaa-${school.toLowerCase()}`] = {
        name: data.venueName,
        coords: data.coords,
        source: 'ncaa-hardcoded',
      }
    }
    set({ venues })
  },

  loadSpringTrainingVenues: () => {
    const venues = { ...get().venues }
    for (const [teamId, site] of Object.entries(SPRING_TRAINING_SITES)) {
      const key = `st-${teamId}`
      venues[key] = {
        name: site.venueName,
        coords: site.coords,
        source: 'spring-training',
      }
    }
    set({ venues })
  },

  addProVenue: (key, name, coords) => {
    set((state) => ({
      venues: {
        ...state.venues,
        [key]: { name, coords, source: 'mlb-api' },
      },
    }))
  },

  geocodeHsVenues: async (schools) => {
    set({ hsGeocodingProgress: { completed: 0, total: schools.length }, hsGeocodingError: null, hsGeocodingFailedSchools: [] })

    try {
      const results = await geocodeAllHsVenues(schools, (completed, total) => {
        set({ hsGeocodingProgress: { completed, total } })
      })

      const venues = { ...get().venues }
      const failedSchools: string[] = []

      for (const [key, coords] of results.entries()) {
        venues[`hs-${key}`] = {
          name: key.split('|')[0] ?? key,
          coords,
          source: 'hs-geocoded',
        }
      }

      // Track schools that weren't geocoded
      for (const school of schools) {
        const key = `${school.schoolName}|${school.city}, ${school.state}`
        if (!results.has(key)) {
          failedSchools.push(`${school.schoolName} (${school.city}, ${school.state})`)
        }
      }

      set({ venues, hsGeocodingProgress: null, hsGeocodingFailedSchools: failedSchools })
    } catch (e) {
      set({
        hsGeocodingError: e instanceof Error ? e.message : 'Geocoding failed',
        hsGeocodingProgress: null,
      })
    }
  },

  getVenue: (key) => get().venues[key],
}),
    {
      name: 'sv-travel-venues',
      partialize: (state) => ({
        venues: state.venues,
      }),
    },
  ),
)
