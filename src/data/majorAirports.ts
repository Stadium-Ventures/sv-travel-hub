import type { Coordinates } from '../types/roster'

export interface Airport {
  code: string
  name: string
  coords: Coordinates
}

// Major U.S. airports — used to find nearest hub for fly-in combo trips
export const MAJOR_AIRPORTS: Airport[] = [
  { code: 'ATL', name: 'Atlanta', coords: { lat: 33.6407, lng: -84.4277 } },
  { code: 'BOS', name: 'Boston Logan', coords: { lat: 42.3656, lng: -71.0096 } },
  { code: 'BWI', name: 'Baltimore/Washington', coords: { lat: 39.1754, lng: -76.6684 } },
  { code: 'CLT', name: 'Charlotte', coords: { lat: 35.2144, lng: -80.9473 } },
  { code: 'CLE', name: 'Cleveland', coords: { lat: 41.4058, lng: -81.8540 } },
  { code: 'CMH', name: 'Columbus', coords: { lat: 39.9980, lng: -82.8919 } },
  { code: 'CVG', name: 'Cincinnati', coords: { lat: 39.0488, lng: -84.6678 } },
  { code: 'DAL', name: 'Dallas Love Field', coords: { lat: 32.8471, lng: -96.8518 } },
  { code: 'DEN', name: 'Denver', coords: { lat: 39.8561, lng: -104.6737 } },
  { code: 'DFW', name: 'Dallas/Fort Worth', coords: { lat: 32.8998, lng: -97.0403 } },
  { code: 'DTW', name: 'Detroit', coords: { lat: 42.2124, lng: -83.3534 } },
  { code: 'EWR', name: 'Newark', coords: { lat: 40.6895, lng: -74.1745 } },
  { code: 'HOU', name: 'Houston Hobby', coords: { lat: 29.6454, lng: -95.2789 } },
  { code: 'IAH', name: 'Houston Intercontinental', coords: { lat: 29.9902, lng: -95.3368 } },
  { code: 'IND', name: 'Indianapolis', coords: { lat: 39.7173, lng: -86.2944 } },
  { code: 'JAX', name: 'Jacksonville', coords: { lat: 30.4941, lng: -81.6879 } },
  { code: 'JFK', name: 'New York JFK', coords: { lat: 40.6413, lng: -73.7781 } },
  { code: 'LAS', name: 'Las Vegas', coords: { lat: 36.0840, lng: -115.1537 } },
  { code: 'LAX', name: 'Los Angeles', coords: { lat: 33.9416, lng: -118.4085 } },
  { code: 'MCI', name: 'Kansas City', coords: { lat: 39.2976, lng: -94.7139 } },
  { code: 'MCO', name: 'Orlando', coords: { lat: 28.4312, lng: -81.3081 } },
  { code: 'MEM', name: 'Memphis', coords: { lat: 35.0424, lng: -89.9767 } },
  { code: 'MSP', name: 'Minneapolis', coords: { lat: 44.8848, lng: -93.2223 } },
  { code: 'MSY', name: 'New Orleans', coords: { lat: 29.9934, lng: -90.2580 } },
  { code: 'BHM', name: 'Birmingham', coords: { lat: 33.5629, lng: -86.7535 } },
  { code: 'BNA', name: 'Nashville', coords: { lat: 36.1263, lng: -86.6774 } },
  { code: 'ORD', name: 'Chicago O\'Hare', coords: { lat: 41.9742, lng: -87.9073 } },
  { code: 'PHL', name: 'Philadelphia', coords: { lat: 39.8721, lng: -75.2411 } },
  { code: 'PHX', name: 'Phoenix', coords: { lat: 33.4373, lng: -112.0078 } },
  { code: 'PIT', name: 'Pittsburgh', coords: { lat: 40.4957, lng: -80.2413 } },
  { code: 'RDU', name: 'Raleigh-Durham', coords: { lat: 35.8801, lng: -78.7880 } },
  { code: 'RIC', name: 'Richmond', coords: { lat: 37.5052, lng: -77.3197 } },
  { code: 'SDF', name: 'Louisville', coords: { lat: 38.1744, lng: -85.7360 } },
  { code: 'SEA', name: 'Seattle', coords: { lat: 47.4502, lng: -122.3088 } },
  { code: 'SFO', name: 'San Francisco', coords: { lat: 37.6213, lng: -122.3790 } },
  { code: 'SLC', name: 'Salt Lake City', coords: { lat: 40.7899, lng: -111.9791 } },
  { code: 'STL', name: 'St. Louis', coords: { lat: 38.7487, lng: -90.3700 } },
  { code: 'TPA', name: 'Tampa', coords: { lat: 27.9756, lng: -82.5333 } },
  { code: 'TUS', name: 'Tucson', coords: { lat: 32.1161, lng: -110.9410 } },
  { code: 'ABQ', name: 'Albuquerque', coords: { lat: 35.0402, lng: -106.6090 } },
  { code: 'GSP', name: 'Greenville-Spartanburg', coords: { lat: 34.8957, lng: -82.2189 } },
  { code: 'CHS', name: 'Charleston', coords: { lat: 32.8986, lng: -80.0405 } },
  { code: 'SAV', name: 'Savannah', coords: { lat: 32.1276, lng: -81.2021 } },
]
