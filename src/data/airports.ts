// Major US airports for the map's Airports overlay (Tom 2026-08-18) —
// the hubs a scout would actually fly into. Static, hand-maintained; this
// file is the write-home. IATA codes render as the map badges (text, no
// emojis — Kent-facing surface).

export interface Airport {
  iata: string
  name: string
  lat: number
  lng: number
}

export const MAJOR_AIRPORTS: Airport[] = [
  { iata: 'ATL', name: 'Atlanta Hartsfield-Jackson', lat: 33.6407, lng: -84.4277 },
  { iata: 'DFW', name: 'Dallas/Fort Worth', lat: 32.8998, lng: -97.0403 },
  { iata: 'DEN', name: 'Denver', lat: 39.8561, lng: -104.6737 },
  { iata: 'ORD', name: 'Chicago O\'Hare', lat: 41.9742, lng: -87.9073 },
  { iata: 'MDW', name: 'Chicago Midway', lat: 41.7868, lng: -87.7522 },
  { iata: 'LAX', name: 'Los Angeles', lat: 33.9416, lng: -118.4085 },
  { iata: 'CLT', name: 'Charlotte', lat: 35.2144, lng: -80.9473 },
  { iata: 'MCO', name: 'Orlando', lat: 28.4312, lng: -81.3081 },
  { iata: 'LAS', name: 'Las Vegas', lat: 36.0840, lng: -115.1537 },
  { iata: 'PHX', name: 'Phoenix Sky Harbor', lat: 33.4373, lng: -112.0078 },
  { iata: 'MIA', name: 'Miami', lat: 25.7959, lng: -80.2870 },
  { iata: 'FLL', name: 'Fort Lauderdale', lat: 26.0742, lng: -80.1506 },
  { iata: 'TPA', name: 'Tampa', lat: 27.9755, lng: -82.5332 },
  { iata: 'SEA', name: 'Seattle-Tacoma', lat: 47.4502, lng: -122.3088 },
  { iata: 'IAH', name: 'Houston Bush', lat: 29.9902, lng: -95.3368 },
  { iata: 'JFK', name: 'New York JFK', lat: 40.6413, lng: -73.7781 },
  { iata: 'LGA', name: 'New York LaGuardia', lat: 40.7769, lng: -73.8740 },
  { iata: 'EWR', name: 'Newark', lat: 40.6895, lng: -74.1745 },
  { iata: 'MSP', name: 'Minneapolis-St. Paul', lat: 44.8848, lng: -93.2223 },
  { iata: 'SFO', name: 'San Francisco', lat: 37.6213, lng: -122.3790 },
  { iata: 'DTW', name: 'Detroit', lat: 42.2162, lng: -83.3554 },
  { iata: 'BOS', name: 'Boston Logan', lat: 42.3656, lng: -71.0096 },
  { iata: 'PHL', name: 'Philadelphia', lat: 39.8744, lng: -75.2424 },
  { iata: 'BWI', name: 'Baltimore-Washington', lat: 39.1774, lng: -76.6684 },
  { iata: 'DCA', name: 'Washington Reagan', lat: 38.8512, lng: -77.0402 },
  { iata: 'IAD', name: 'Washington Dulles', lat: 38.9531, lng: -77.4565 },
  { iata: 'SLC', name: 'Salt Lake City', lat: 40.7899, lng: -111.9791 },
  { iata: 'SAN', name: 'San Diego', lat: 32.7338, lng: -117.1933 },
  { iata: 'AUS', name: 'Austin', lat: 30.1975, lng: -97.6664 },
  { iata: 'SAT', name: 'San Antonio', lat: 29.5337, lng: -98.4698 },
  { iata: 'BNA', name: 'Nashville', lat: 36.1263, lng: -86.6774 },
  { iata: 'MSY', name: 'New Orleans', lat: 29.9934, lng: -90.2580 },
  { iata: 'RDU', name: 'Raleigh-Durham', lat: 35.8801, lng: -78.7880 },
  { iata: 'PIT', name: 'Pittsburgh', lat: 40.4919, lng: -80.2352 },
  { iata: 'STL', name: 'St. Louis', lat: 38.7500, lng: -90.3700 },
  { iata: 'CLE', name: 'Cleveland', lat: 41.4058, lng: -81.8539 },
  { iata: 'CVG', name: 'Cincinnati', lat: 39.0533, lng: -84.6630 },
  { iata: 'MCI', name: 'Kansas City', lat: 39.2976, lng: -94.7139 },
  { iata: 'SMF', name: 'Sacramento', lat: 38.6954, lng: -121.5908 },
  { iata: 'PDX', name: 'Portland', lat: 45.5898, lng: -122.5951 },
  { iata: 'JAX', name: 'Jacksonville', lat: 30.4941, lng: -81.6879 },
  { iata: 'PBI', name: 'West Palm Beach', lat: 26.6832, lng: -80.0956 },
  { iata: 'RSW', name: 'Fort Myers', lat: 26.5362, lng: -81.7552 },
  { iata: 'ABQ', name: 'Albuquerque', lat: 35.0494, lng: -106.6170 },
  { iata: 'OKC', name: 'Oklahoma City', lat: 35.3931, lng: -97.6007 },
  { iata: 'MEM', name: 'Memphis', lat: 35.0424, lng: -89.9767 },
  { iata: 'IND', name: 'Indianapolis', lat: 39.7173, lng: -86.2944 },
  { iata: 'CMH', name: 'Columbus', lat: 39.9980, lng: -82.8919 },
  { iata: 'BUF', name: 'Buffalo', lat: 42.9405, lng: -78.7322 },
]
