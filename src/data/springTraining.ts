import type { Coordinates } from '../types/roster'

// Spring Training sites — last verified: March 2026
// Update when teams relocate (rare, ~1 per 2-3 years)

// Spring Training typically runs mid-February through late March
export const SPRING_TRAINING_START = '02-15' // MM-DD
export const SPRING_TRAINING_END = '03-28'   // MM-DD

export function isSpringTraining(dateStr: string): boolean {
  const mmdd = dateStr.slice(5) // "YYYY-MM-DD" → "MM-DD"
  return mmdd >= SPRING_TRAINING_START && mmdd <= SPRING_TRAINING_END
}

export interface SpringTrainingSite {
  venueName: string
  coords: Coordinates
  league: 'Grapefruit' | 'Cactus'
  teamName: string
  complexName: string
  streetAddress: string
  cityState: string
  zip: string
}

// MLB parent team ID → Spring Training facility
// Grapefruit League = Florida, Cactus League = Arizona
export const SPRING_TRAINING_SITES: Record<number, SpringTrainingSite> = {
  // --- Grapefruit League (Florida) — within Orlando driving range ---
  147: { // Yankees
    venueName: 'George M. Steinbrenner Field',
    coords: { lat: 27.9789, lng: -82.5034 },
    league: 'Grapefruit',
    teamName: 'New York Yankees',
    complexName: 'George M. Steinbrenner Field',
    streetAddress: '1 Steinbrenner Dr',
    cityState: 'Tampa, FL',
    zip: '33614',
  },
  111: { // Red Sox
    venueName: 'JetBlue Park',
    coords: { lat: 26.5560, lng: -81.8465 },
    league: 'Grapefruit',
    teamName: 'Boston Red Sox',
    complexName: 'JetBlue Park at Fenway South',
    streetAddress: '11500 Fenway South Dr',
    cityState: 'Fort Myers, FL',
    zip: '33913',
  },
  141: { // Blue Jays
    venueName: 'TD Ballpark',
    coords: { lat: 28.0222, lng: -82.7473 },
    league: 'Grapefruit',
    teamName: 'Toronto Blue Jays',
    complexName: 'TD Ballpark',
    streetAddress: '373 Douglas Ave',
    cityState: 'Dunedin, FL',
    zip: '34698',
  },
  146: { // Marlins
    venueName: 'Roger Dean Chevrolet Stadium',
    coords: { lat: 26.8901, lng: -80.1156 },
    league: 'Grapefruit',
    teamName: 'Miami Marlins',
    complexName: 'Roger Dean Chevrolet Stadium',
    streetAddress: '4751 Main St',
    cityState: 'Jupiter, FL',
    zip: '33458',
  },
  138: { // Cardinals
    venueName: 'Roger Dean Chevrolet Stadium',
    coords: { lat: 26.8901, lng: -80.1156 },
    league: 'Grapefruit',
    teamName: 'St. Louis Cardinals',
    complexName: 'Roger Dean Chevrolet Stadium',
    streetAddress: '4751 Main St',
    cityState: 'Jupiter, FL',
    zip: '33458',
  },
  120: { // Nationals
    venueName: 'The Ballpark of the Palm Beaches',
    coords: { lat: 26.7525, lng: -80.1227 },
    league: 'Grapefruit',
    teamName: 'Washington Nationals',
    complexName: 'The Ballpark of the Palm Beaches',
    streetAddress: '5444 Haverhill Rd',
    cityState: 'West Palm Beach, FL',
    zip: '33407',
  },
  144: { // Braves
    venueName: 'CoolToday Park',
    coords: { lat: 27.0229, lng: -82.2360 },
    league: 'Grapefruit',
    teamName: 'Atlanta Braves',
    complexName: 'CoolToday Park',
    streetAddress: '18800 West Villages Pkwy',
    cityState: 'Venice, FL',
    zip: '34293',
  },
  142: { // Twins
    venueName: 'Hammond Stadium at CenturyLink Sports Complex',
    coords: { lat: 26.5549, lng: -81.8087 },
    league: 'Grapefruit',
    teamName: 'Minnesota Twins',
    complexName: 'Hammond Stadium at CenturyLink Sports Complex',
    streetAddress: '14100 Six Mile Cypress Pkwy',
    cityState: 'Fort Myers, FL',
    zip: '33912',
  },
  139: { // Rays
    venueName: 'Charlotte Sports Park',
    coords: { lat: 26.9609, lng: -82.1133 },
    league: 'Grapefruit',
    teamName: 'Tampa Bay Rays',
    complexName: 'Charlotte Sports Park',
    streetAddress: '2300 El Jobean Rd',
    cityState: 'Port Charlotte, FL',
    zip: '33948',
  },
  116: { // Tigers
    venueName: 'Publix Field at Joker Marchant Stadium',
    coords: { lat: 28.0672, lng: -81.7539 },
    league: 'Grapefruit',
    teamName: 'Detroit Tigers',
    complexName: 'Publix Field at Joker Marchant Stadium',
    streetAddress: '2301 Lakeland Hills Blvd',
    cityState: 'Lakeland, FL',
    zip: '33805',
  },
  143: { // Phillies
    venueName: 'BayCare Ballpark',
    coords: { lat: 27.9772, lng: -82.7293 },
    league: 'Grapefruit',
    teamName: 'Philadelphia Phillies',
    complexName: 'BayCare Ballpark',
    streetAddress: '601 N Old Coachman Rd',
    cityState: 'Clearwater, FL',
    zip: '33765',
  },
  134: { // Pirates
    venueName: 'LECOM Park',
    coords: { lat: 27.4960, lng: -82.5591 },
    league: 'Grapefruit',
    teamName: 'Pittsburgh Pirates',
    complexName: 'LECOM Park',
    streetAddress: '1611 9th St W',
    cityState: 'Bradenton, FL',
    zip: '34205',
  },
  110: { // Orioles
    venueName: 'Ed Smith Stadium',
    coords: { lat: 27.3373, lng: -82.5259 },
    league: 'Grapefruit',
    teamName: 'Baltimore Orioles',
    complexName: 'Ed Smith Stadium',
    streetAddress: '2700 12th St',
    cityState: 'Sarasota, FL',
    zip: '34237',
  },
  121: { // Mets
    venueName: 'Clover Park',
    coords: { lat: 27.3069, lng: -80.3667 },
    league: 'Grapefruit',
    teamName: 'New York Mets',
    complexName: 'Clover Park',
    streetAddress: '525 NW Peacock Blvd',
    cityState: 'Port St. Lucie, FL',
    zip: '34986',
  },
  117: { // Astros
    venueName: 'The Ballpark of the Palm Beaches',
    coords: { lat: 26.7525, lng: -80.1227 },
    league: 'Grapefruit',
    teamName: 'Houston Astros',
    complexName: 'The Ballpark of the Palm Beaches',
    streetAddress: '5444 Haverhill Rd',
    cityState: 'West Palm Beach, FL',
    zip: '33407',
  },

  // --- Cactus League (Arizona) — NOT within Orlando driving range ---
  113: { // Reds
    venueName: 'Goodyear Ballpark',
    coords: { lat: 33.4394, lng: -112.3988 },
    league: 'Cactus',
    teamName: 'Cincinnati Reds',
    complexName: 'Goodyear Ballpark',
    streetAddress: '1933 S Ballpark Way',
    cityState: 'Goodyear, AZ',
    zip: '85338',
  },
  136: { // Mariners
    venueName: 'Peoria Sports Complex',
    coords: { lat: 33.5812, lng: -112.2385 },
    league: 'Cactus',
    teamName: 'Seattle Mariners',
    complexName: 'Peoria Sports Complex',
    streetAddress: '16101 N 83rd Ave',
    cityState: 'Peoria, AZ',
    zip: '85382',
  },
  114: { // Guardians
    venueName: 'Goodyear Ballpark',
    coords: { lat: 33.4394, lng: -112.3988 },
    league: 'Cactus',
    teamName: 'Cleveland Guardians',
    complexName: 'Goodyear Ballpark',
    streetAddress: '1933 S Ballpark Way',
    cityState: 'Goodyear, AZ',
    zip: '85338',
  },
  108: { // Angels
    venueName: 'Tempe Diablo Stadium',
    coords: { lat: 33.3945, lng: -111.9668 },
    league: 'Cactus',
    teamName: 'Los Angeles Angels',
    complexName: 'Tempe Diablo Stadium',
    streetAddress: '2200 W Alameda Dr',
    cityState: 'Tempe, AZ',
    zip: '85282',
  },
  133: { // Athletics
    venueName: 'Hohokam Stadium',
    coords: { lat: 33.4378, lng: -111.8270 },
    league: 'Cactus',
    teamName: 'Oakland Athletics',
    complexName: 'Hohokam Stadium',
    streetAddress: '1235 N Center St',
    cityState: 'Mesa, AZ',
    zip: '85201',
  },
  119: { // Dodgers
    venueName: 'Camelback Ranch',
    coords: { lat: 33.5076, lng: -112.3199 },
    league: 'Cactus',
    teamName: 'Los Angeles Dodgers',
    complexName: 'Camelback Ranch',
    streetAddress: '10710 W Camelback Rd',
    cityState: 'Phoenix, AZ',
    zip: '85037',
  },
  115: { // Rockies
    venueName: 'Salt River Fields at Talking Stick',
    coords: { lat: 33.5453, lng: -111.8852 },
    league: 'Cactus',
    teamName: 'Colorado Rockies',
    complexName: 'Salt River Fields at Talking Stick',
    streetAddress: '7555 N Pima Rd',
    cityState: 'Scottsdale, AZ',
    zip: '85258',
  },
  112: { // Cubs
    venueName: 'Sloan Park',
    coords: { lat: 33.4353, lng: -111.8291 },
    league: 'Cactus',
    teamName: 'Chicago Cubs',
    complexName: 'Sloan Park',
    streetAddress: '2330 W Rio Salado Pkwy',
    cityState: 'Mesa, AZ',
    zip: '85201',
  },
  145: { // White Sox
    venueName: 'Camelback Ranch',
    coords: { lat: 33.5076, lng: -112.3199 },
    league: 'Cactus',
    teamName: 'Chicago White Sox',
    complexName: 'Camelback Ranch',
    streetAddress: '10710 W Camelback Rd',
    cityState: 'Phoenix, AZ',
    zip: '85037',
  },
  158: { // Brewers
    venueName: 'American Family Fields of Phoenix',
    coords: { lat: 33.5260, lng: -112.1494 },
    league: 'Cactus',
    teamName: 'Milwaukee Brewers',
    complexName: 'American Family Fields of Phoenix',
    streetAddress: '3805 N 53rd Ave',
    cityState: 'Phoenix, AZ',
    zip: '85031',
  },
  135: { // Padres
    venueName: 'Peoria Sports Complex',
    coords: { lat: 33.5812, lng: -112.2385 },
    league: 'Cactus',
    teamName: 'San Diego Padres',
    complexName: 'Peoria Sports Complex',
    streetAddress: '16101 N 83rd Ave',
    cityState: 'Peoria, AZ',
    zip: '85382',
  },
  137: { // Giants
    venueName: 'Scottsdale Stadium',
    coords: { lat: 33.4886, lng: -111.9260 },
    league: 'Cactus',
    teamName: 'San Francisco Giants',
    complexName: 'Scottsdale Stadium',
    streetAddress: '7408 E Osborn Rd',
    cityState: 'Scottsdale, AZ',
    zip: '85251',
  },
  109: { // Diamondbacks
    venueName: 'Salt River Fields at Talking Stick',
    coords: { lat: 33.5453, lng: -111.8852 },
    league: 'Cactus',
    teamName: 'Arizona Diamondbacks',
    complexName: 'Salt River Fields at Talking Stick',
    streetAddress: '7555 N Pima Rd',
    cityState: 'Scottsdale, AZ',
    zip: '85258',
  },
  140: { // Rangers
    venueName: 'Surprise Stadium',
    coords: { lat: 33.6290, lng: -112.3697 },
    league: 'Cactus',
    teamName: 'Texas Rangers',
    complexName: 'Surprise Stadium',
    streetAddress: '15850 N Bullard Ave',
    cityState: 'Surprise, AZ',
    zip: '85374',
  },
  118: { // Royals
    venueName: 'Surprise Stadium',
    coords: { lat: 33.6290, lng: -112.3697 },
    league: 'Cactus',
    teamName: 'Kansas City Royals',
    complexName: 'Surprise Stadium',
    streetAddress: '15850 N Bullard Ave',
    cityState: 'Surprise, AZ',
    zip: '85374',
  },
}

// Get the spring training site for a parent org, if it exists
export function getSpringTrainingSite(parentTeamId: number): SpringTrainingSite | null {
  return SPRING_TRAINING_SITES[parentTeamId] ?? null
}

// Check if a team's ST site is in the Grapefruit League (Florida = drivable from Orlando)
export function isGrapefruitLeague(parentTeamId: number): boolean {
  return SPRING_TRAINING_SITES[parentTeamId]?.league === 'Grapefruit'
}

// Validate that all spring training site coordinates fall within FL or AZ
export function validateSpringTrainingSites(): string[] {
  const warnings: string[] = []
  for (const [teamIdStr, site] of Object.entries(SPRING_TRAINING_SITES)) {
    // Basic coordinate validation: all ST sites should be in FL or AZ
    const { lat, lng } = site.coords
    const inFlorida = lat >= 25.5 && lat <= 30.5 && lng >= -82.5 && lng <= -80.0
    const inArizona = lat >= 31.5 && lat <= 34.0 && lng >= -113.0 && lng <= -111.0
    if (!inFlorida && !inArizona) {
      warnings.push(`Team ${teamIdStr} (${site.venueName}): coordinates (${lat}, ${lng}) not in FL or AZ`)
    }
  }
  return warnings
}
