/**
 * Generate venue proximity data for all MLB, MiLB, NCAA, HS, and Spring Training venues.
 *
 * Run:  npx tsx scripts/generateVenueProximity.ts
 *
 * Output: src/data/venueProximity.ts
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { NCAA_VENUES } from '../src/data/ncaaVenues'
import { SPRING_TRAINING_SITES } from '../src/data/springTraining'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Coordinates {
  lat: number
  lng: number
}

interface VenueInput {
  name: string
  type: 'mlb' | 'milb' | 'ncaa' | 'hs' | 'spring-training'
  teamName?: string
  coords: Coordinates
}

// ---------------------------------------------------------------------------
// Haversine + drive estimate (mirrors src/lib/tripEngine.ts)
// ---------------------------------------------------------------------------
function haversineKm(a: Coordinates, b: Coordinates): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h =
    sinLat * sinLat +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function estimateDriveMinutes(a: Coordinates, b: Coordinates): number {
  const km = haversineKm(a, b)
  return Math.round((km * 1.2 / 95) * 60)
}

function coordKey(c: Coordinates): string {
  return `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`
}

// ---------------------------------------------------------------------------
// Orlando HOME_BASE
// ---------------------------------------------------------------------------
const HOME_BASE: Coordinates = { lat: 28.5383, lng: -81.3792 }

// ---------------------------------------------------------------------------
// MLB API data (sportId 1 = MLB, 11 = AAA, 12 = AA, 13 = High-A, 14 = Single-A)
// Fetched from: https://statsapi.mlb.com/api/v1/teams?sportIds=1,11,12,13,14&season=2026&hydrate=venue(location)
// ---------------------------------------------------------------------------

interface MlbTeamRaw {
  teamName: string
  teamId: number
  sportId: number
  venueName: string
  lat: number
  lng: number
}

const MLB_API_TEAMS: MlbTeamRaw[] = [
  // MLB (sportId 1)
  { teamName: 'Los Angeles Angels', teamId: 108, sportId: 1, venueName: 'Angel Stadium', lat: 33.80019044, lng: -117.8823996 },
  { teamName: 'Arizona Diamondbacks', teamId: 109, sportId: 1, venueName: 'Chase Field', lat: 33.445302, lng: -112.066687 },
  { teamName: 'Baltimore Orioles', teamId: 110, sportId: 1, venueName: 'Oriole Park at Camden Yards', lat: 39.283787, lng: -76.621689 },
  { teamName: 'Boston Red Sox', teamId: 111, sportId: 1, venueName: 'Fenway Park', lat: 42.346456, lng: -71.097441 },
  { teamName: 'Chicago Cubs', teamId: 112, sportId: 1, venueName: 'Wrigley Field', lat: 41.948171, lng: -87.655503 },
  { teamName: 'Cincinnati Reds', teamId: 113, sportId: 1, venueName: 'Great American Ball Park', lat: 39.097389, lng: -84.506611 },
  { teamName: 'Cleveland Guardians', teamId: 114, sportId: 1, venueName: 'Progressive Field', lat: 41.495861, lng: -81.685255 },
  { teamName: 'Colorado Rockies', teamId: 115, sportId: 1, venueName: 'Coors Field', lat: 39.756042, lng: -104.994136 },
  { teamName: 'Detroit Tigers', teamId: 116, sportId: 1, venueName: 'Comerica Park', lat: 42.3391151, lng: -83.048695 },
  { teamName: 'Houston Astros', teamId: 117, sportId: 1, venueName: 'Daikin Park', lat: 29.756967, lng: -95.355509 },
  { teamName: 'Kansas City Royals', teamId: 118, sportId: 1, venueName: 'Kauffman Stadium', lat: 39.051567, lng: -94.480483 },
  { teamName: 'Los Angeles Dodgers', teamId: 119, sportId: 1, venueName: 'Dodger Stadium', lat: 34.07368, lng: -118.24053 },
  { teamName: 'Washington Nationals', teamId: 120, sportId: 1, venueName: 'Nationals Park', lat: 38.872861, lng: -77.007501 },
  { teamName: 'New York Mets', teamId: 121, sportId: 1, venueName: 'Citi Field', lat: 40.75753012, lng: -73.84559155 },
  { teamName: 'Athletics', teamId: 133, sportId: 1, venueName: 'Sutter Health Park', lat: 38.57994, lng: -121.51246 },
  { teamName: 'Pittsburgh Pirates', teamId: 134, sportId: 1, venueName: 'PNC Park', lat: 40.446904, lng: -80.005753 },
  { teamName: 'San Diego Padres', teamId: 135, sportId: 1, venueName: 'Petco Park', lat: 32.707861, lng: -117.157278 },
  { teamName: 'Seattle Mariners', teamId: 136, sportId: 1, venueName: 'T-Mobile Park', lat: 47.591333, lng: -122.33251 },
  { teamName: 'San Francisco Giants', teamId: 137, sportId: 1, venueName: 'Oracle Park', lat: 37.778383, lng: -122.389448 },
  { teamName: 'St. Louis Cardinals', teamId: 138, sportId: 1, venueName: 'Busch Stadium', lat: 38.62256667, lng: -90.19286667 },
  { teamName: 'Tampa Bay Rays', teamId: 139, sportId: 1, venueName: 'Tropicana Field', lat: 27.767778, lng: -82.6525 },
  { teamName: 'Texas Rangers', teamId: 140, sportId: 1, venueName: 'Globe Life Field', lat: 32.747299, lng: -97.081818 },
  { teamName: 'Toronto Blue Jays', teamId: 141, sportId: 1, venueName: 'Rogers Centre', lat: 43.64155, lng: -79.38915 },
  { teamName: 'Minnesota Twins', teamId: 142, sportId: 1, venueName: 'Target Field', lat: 44.981829, lng: -93.277891 },
  { teamName: 'Philadelphia Phillies', teamId: 143, sportId: 1, venueName: 'Citizens Bank Park', lat: 39.90539086, lng: -75.16716957 },
  { teamName: 'Atlanta Braves', teamId: 144, sportId: 1, venueName: 'Truist Park', lat: 33.890672, lng: -84.467641 },
  { teamName: 'Chicago White Sox', teamId: 145, sportId: 1, venueName: 'Rate Field', lat: 41.83, lng: -87.634167 },
  { teamName: 'Miami Marlins', teamId: 146, sportId: 1, venueName: 'loanDepot park', lat: 25.77796236, lng: -80.21951795 },
  { teamName: 'New York Yankees', teamId: 147, sportId: 1, venueName: 'Yankee Stadium', lat: 40.82919482, lng: -73.9264977 },
  { teamName: 'Milwaukee Brewers', teamId: 158, sportId: 1, venueName: 'American Family Field', lat: 43.02838, lng: -87.97099 },

  // Triple-A (sportId 11)
  { teamName: 'Toledo Mud Hens', teamId: 512, sportId: 11, venueName: 'Fifth Third Field', lat: 41.64767, lng: -83.53838 },
  { teamName: 'Reno Aces', teamId: 2310, sportId: 11, venueName: 'Greater Nevada Field', lat: 39.52812, lng: -119.80901 },
  { teamName: 'Scranton/Wilkes-Barre RailRiders', teamId: 531, sportId: 11, venueName: 'PNC Field', lat: 41.360672, lng: -75.683676 },
  { teamName: 'Worcester Red Sox', teamId: 533, sportId: 11, venueName: 'Polar Park', lat: 42.25606, lng: -71.80028 },
  { teamName: 'Rochester Red Wings', teamId: 534, sportId: 11, venueName: 'ESL Ballpark', lat: 43.158301, lng: -77.619748 },
  { teamName: 'Omaha Storm Chasers', teamId: 541, sportId: 11, venueName: 'Werner Park', lat: 41.1510945, lng: -96.1057988 },
  { teamName: 'Tacoma Rainiers', teamId: 529, sportId: 11, venueName: 'Cheney Stadium', lat: 47.237981, lng: -122.497643 },
  { teamName: 'El Paso Chihuahuas', teamId: 4904, sportId: 11, venueName: 'Southwest University Park', lat: 31.759277, lng: -106.492526 },
  { teamName: 'Syracuse Mets', teamId: 552, sportId: 11, venueName: 'NBT Bank Stadium', lat: 43.079531, lng: -76.165419 },
  { teamName: 'Nashville Sounds', teamId: 556, sportId: 11, venueName: 'First Horizon Park', lat: 36.173218, lng: -86.785171 },
  { teamName: 'Salt Lake Bees', teamId: 561, sportId: 11, venueName: 'The Ballpark at America First Square', lat: 40.549067, lng: -112.023020 },
  { teamName: 'Jacksonville Jumbo Shrimp', teamId: 564, sportId: 11, venueName: 'Vystar Ballpark', lat: 30.32533, lng: -81.64256 },
  { teamName: 'Norfolk Tides', teamId: 568, sportId: 11, venueName: 'Harbor Park', lat: 36.84265, lng: -76.27803 },
  { teamName: 'Sugar Land Space Cowboys', teamId: 5434, sportId: 11, venueName: 'Constellation Field', lat: 29.62275645, lng: -95.64718344 },
  { teamName: 'Albuquerque Isotopes', teamId: 342, sportId: 11, venueName: 'Isotopes Park', lat: 35.06985, lng: -106.62802 },
  { teamName: 'Round Rock Express', teamId: 102, sportId: 11, venueName: 'Dell Diamond', lat: 30.527463, lng: -97.630397 },
  { teamName: 'Sacramento River Cats', teamId: 105, sportId: 11, venueName: 'Sutter Health Park', lat: 38.57994, lng: -121.51246 },
  { teamName: 'Las Vegas Aviators', teamId: 400, sportId: 11, venueName: 'Las Vegas Ballpark', lat: 36.152607, lng: -115.329888 },
  { teamName: 'Louisville Bats', teamId: 416, sportId: 11, venueName: 'Louisville Slugger Field', lat: 38.2557199, lng: -85.74479 },
  { teamName: 'Gwinnett Stripers', teamId: 431, sportId: 11, venueName: 'Gwinnett Field', lat: 34.0409586, lng: -83.9937909 },
  { teamName: 'Lehigh Valley IronPigs', teamId: 1410, sportId: 11, venueName: 'Coca-Cola Park', lat: 40.6253183, lng: -75.4516154 },
  { teamName: 'St. Paul Saints', teamId: 1960, sportId: 11, venueName: 'CHS Field', lat: 44.95089651, lng: -93.08457526 },
  { teamName: 'Buffalo Bisons', teamId: 422, sportId: 11, venueName: 'Sahlen Field', lat: 42.880772, lng: -78.873955 },
  { teamName: 'Durham Bulls', teamId: 234, sportId: 11, venueName: 'Durham Bulls Athletic Park', lat: 35.99158, lng: -78.90401 },
  { teamName: 'Memphis Redbirds', teamId: 235, sportId: 11, venueName: 'AutoZone Park', lat: 35.14297, lng: -90.04924 },
  { teamName: 'Charlotte Knights', teamId: 494, sportId: 11, venueName: 'Truist Field', lat: 35.22781, lng: -80.84823 },
  { teamName: 'Columbus Clippers', teamId: 445, sportId: 11, venueName: 'Huntington Park', lat: 39.96868, lng: -83.01102 },
  { teamName: 'Iowa Cubs', teamId: 451, sportId: 11, venueName: 'Principal Park', lat: 41.57998, lng: -93.61619 },
  { teamName: 'Indianapolis Indians', teamId: 484, sportId: 11, venueName: 'Victory Field', lat: 39.7657354, lng: -86.1682918 },

  // Double-A (sportId 12)
  { teamName: 'Tulsa Drillers', teamId: 260, sportId: 12, venueName: 'ONEOK Field', lat: 36.1601215, lng: -95.9888782 },
  { teamName: 'Reading Fightin Phils', teamId: 522, sportId: 12, venueName: 'FirstEnergy Stadium', lat: 40.365558, lng: -75.933816 },
  { teamName: 'Hartford Yard Goats', teamId: 538, sportId: 12, venueName: "Dunkin' Park", lat: 41.77079, lng: -72.6743078 },
  { teamName: 'Pensacola Blue Wahoos', teamId: 4124, sportId: 12, venueName: 'Blue Wahoos Stadium', lat: 30.4048409, lng: -87.2188349 },
  { teamName: 'Frisco RoughRiders', teamId: 540, sportId: 12, venueName: 'Riders Field', lat: 33.0984, lng: -96.8197 },
  { teamName: 'Portland Sea Dogs', teamId: 546, sportId: 12, venueName: 'Delta Dental Park', lat: 43.6562399, lng: -70.27873 },
  { teamName: 'Harrisburg Senators', teamId: 547, sportId: 12, venueName: 'FNB Field', lat: 40.2568294, lng: -76.8896522 },
  { teamName: 'Knoxville Smokies', teamId: 553, sportId: 12, venueName: 'Covenant Health Park', lat: 35.9724846, lng: -83.9149504 },
  { teamName: 'Rocket City Trash Pandas', teamId: 559, sportId: 12, venueName: 'Toyota Field', lat: 34.6837403, lng: -86.7274237 },
  { teamName: 'Wichita Wind Surge', teamId: 3898, sportId: 12, venueName: 'Equity Bank Park', lat: 37.6813367, lng: -97.3475531 },
  { teamName: 'Arkansas Travelers', teamId: 574, sportId: 12, venueName: 'Dickey-Stephens Park', lat: 34.75513, lng: -92.2725899 },
  { teamName: 'Northwest Arkansas Naturals', teamId: 1350, sportId: 12, venueName: 'Arvest Ballpark', lat: 36.15968, lng: -94.194624 },
  { teamName: 'Erie SeaWolves', teamId: 106, sportId: 12, venueName: 'UPMC Park', lat: 42.12706, lng: -80.0803 },
  { teamName: 'Akron RubberDucks', teamId: 402, sportId: 12, venueName: '7 17 Credit Union Park', lat: 41.07739, lng: -81.52185 },
  { teamName: 'Biloxi Shuckers', teamId: 5015, sportId: 12, venueName: 'Keesler Federal Park', lat: 30.395421, lng: -88.893217 },
  { teamName: 'Chesapeake Baysox', teamId: 418, sportId: 12, venueName: "Prince George's Stadium", lat: 38.946114, lng: -76.709334 },
  { teamName: 'Somerset Patriots', teamId: 1956, sportId: 12, venueName: 'TD Bank Ballpark', lat: 40.56081907, lng: -74.55328462 },
  { teamName: 'Montgomery Biscuits', teamId: 421, sportId: 12, venueName: 'Montgomery Riverwalk Stadium', lat: 32.382298, lng: -86.310592 },
  { teamName: 'New Hampshire Fisher Cats', teamId: 463, sportId: 12, venueName: 'Delta Dental Stadium', lat: 42.98115, lng: -71.46653 },
  { teamName: 'Springfield Cardinals', teamId: 440, sportId: 12, venueName: 'Hammons Field', lat: 37.21078, lng: -93.2797 },
  { teamName: 'Altoona Curve', teamId: 452, sportId: 12, venueName: 'Peoples Natural Gas Field', lat: 40.473826, lng: -78.394753 },
  { teamName: 'Corpus Christi Hooks', teamId: 482, sportId: 12, venueName: 'Whataburger Field', lat: 27.80995, lng: -97.39941 },
  { teamName: 'Midland RockHounds', teamId: 237, sportId: 12, venueName: 'Momentum Bank Ballpark', lat: 31.98835, lng: -102.15482 },
  { teamName: 'Columbus Clingstones', teamId: 6325, sportId: 12, venueName: 'Synovus Park', lat: 32.4523727, lng: -84.9939591 },
  { teamName: 'Richmond Flying Squirrels', teamId: 3410, sportId: 12, venueName: 'CarMax Park', lat: 37.5538, lng: -77.4603 }, // coords manually added (Richmond, VA)

  // High-A (sportId 13)
  { teamName: 'Hudson Valley Renegades', teamId: 537, sportId: 13, venueName: 'Heritage Financial Park', lat: 41.52638, lng: -73.96109 },
  { teamName: 'South Bend Cubs', teamId: 550, sportId: 13, venueName: 'Four Winds Field', lat: 41.6704099, lng: -86.25547 },
  { teamName: 'Beloit Sky Carp', teamId: 554, sportId: 13, venueName: 'ABC Supply Stadium', lat: 42.496763, lng: -89.0429539 },
  { teamName: 'Quad Cities River Bandits', teamId: 565, sportId: 13, venueName: 'Modern Woodmen Park', lat: 41.51868, lng: -90.58187 },
  { teamName: 'Wisconsin Timber Rattlers', teamId: 572, sportId: 13, venueName: 'Neuroscience Group Field', lat: 44.282871, lng: -88.469427 },
  { teamName: 'Asheville Tourists', teamId: 573, sportId: 13, venueName: 'McCormick Field', lat: 35.58668, lng: -82.5501 },
  { teamName: 'Winston-Salem Dash', teamId: 580, sportId: 13, venueName: 'Truist Stadium', lat: 36.09182, lng: -80.25527 },
  { teamName: 'West Michigan Whitecaps', teamId: 582, sportId: 13, venueName: 'LMCU Ballpark', lat: 43.040797, lng: -85.65933 },
  { teamName: 'Fort Wayne TinCaps', teamId: 584, sportId: 13, venueName: 'Parkview Field', lat: 41.07345, lng: -85.14366 },
  { teamName: 'Everett AquaSox', teamId: 403, sportId: 13, venueName: 'Funko Field', lat: 47.966664, lng: -122.202786 },
  { teamName: 'Wilmington Blue Rocks', teamId: 426, sportId: 13, venueName: 'Frawley Stadium', lat: 39.731809, lng: -75.564174 },
  { teamName: 'Jersey Shore BlueClaws', teamId: 427, sportId: 13, venueName: 'ShoreTown Ballpark', lat: 40.07495, lng: -74.18846 },
  { teamName: 'Greenville Drive', teamId: 428, sportId: 13, venueName: 'Fluor Field at the West End', lat: 34.84297, lng: -82.40893 },
  { teamName: 'Rome Emperors', teamId: 432, sportId: 13, venueName: 'AdventHealth Stadium', lat: 34.285832, lng: -85.167211 },
  { teamName: 'Hillsboro Hops', teamId: 419, sportId: 13, venueName: 'Hillsboro Hops Ballpark', lat: 45.554, lng: -122.9085 },
  { teamName: 'Bowling Green Hot Rods', teamId: 2498, sportId: 13, venueName: 'Bowling Green Ballpark', lat: 36.9957207, lng: -86.4411401 },
  { teamName: 'Vancouver Canadians', teamId: 435, sportId: 13, venueName: 'Rogers Field at Nat Bailey Stadium', lat: 49.2431966, lng: -123.1054384 },
  { teamName: 'Hub City Spartanburgers', teamId: 6324, sportId: 13, venueName: 'Fifth Third Park', lat: 34.9449402, lng: -81.9359415 },
  { teamName: 'Lake County Captains', teamId: 437, sportId: 13, venueName: 'Classic Auto Group Park', lat: 41.6424351, lng: -81.4367781 },
  { teamName: 'Peoria Chiefs', teamId: 443, sportId: 13, venueName: 'Dozer Park', lat: 40.68751, lng: -89.59781 },
  { teamName: 'Brooklyn Cyclones', teamId: 453, sportId: 13, venueName: 'Maimonides Park', lat: 40.57392, lng: -73.98473 },
  { teamName: 'Great Lakes Loons', teamId: 456, sportId: 13, venueName: 'Dow Diamond', lat: 43.6089355, lng: -84.2397878 },
  { teamName: 'Dayton Dragons', teamId: 459, sportId: 13, venueName: 'Day Air Ballpark', lat: 39.764172, lng: -84.185896 },
  { teamName: 'Tri-City Dust Devils', teamId: 460, sportId: 13, venueName: 'Gesa Stadium', lat: 46.27032, lng: -119.17079 },
  { teamName: 'Eugene Emeralds', teamId: 461, sportId: 13, venueName: 'PK Park', lat: 44.059012, lng: -123.065482 },
  { teamName: 'Greensboro Grasshoppers', teamId: 477, sportId: 13, venueName: 'First National Bank Field', lat: 36.07667, lng: -79.79487 },
  { teamName: 'Spokane Indians', teamId: 486, sportId: 13, venueName: 'Avista Stadium', lat: 47.661351, lng: -117.344426 },
  { teamName: 'Cedar Rapids Kernels', teamId: 492, sportId: 13, venueName: 'Veterans Memorial Stadium', lat: 41.96785, lng: -91.68662 },

  // Single-A (sportId 14)
  { teamName: 'Fresno Grizzlies', teamId: 259, sportId: 14, venueName: 'Chukchansi Park', lat: 36.73256, lng: -119.79157 },
  { teamName: 'Visalia Rawhide', teamId: 516, sportId: 14, venueName: 'Valley Strong Ballpark', lat: 36.3320197, lng: -119.3053325 },
  { teamName: 'Myrtle Beach Pelicans', teamId: 521, sportId: 14, venueName: 'Pelicans Ballpark', lat: 33.711404, lng: -78.88444 },
  { teamName: 'Stockton Ports', teamId: 524, sportId: 14, venueName: 'Banner Island Ballpark', lat: 37.954863, lng: -121.297357 },
  { teamName: 'Rancho Cucamonga Quakes', teamId: 526, sportId: 14, venueName: 'LoanMart Field', lat: 34.102721, lng: -117.54792 },
  { teamName: 'Palm Beach Cardinals', teamId: 279, sportId: 14, venueName: 'Roger Dean Chevrolet Stadium', lat: 26.890957, lng: -80.116365 },
  { teamName: 'Clearwater Threshers', teamId: 566, sportId: 14, venueName: 'BayCare Ballpark', lat: 27.97159, lng: -82.731714 },
  { teamName: 'Lakeland Flying Tigers', teamId: 570, sportId: 14, venueName: 'Publix Field at Joker Marchant Stadium', lat: 28.074822, lng: -81.9508415 },
  { teamName: 'Bradenton Marauders', teamId: 3390, sportId: 14, venueName: 'LECOM Park', lat: 27.48553, lng: -82.57038 },
  { teamName: 'Tampa Tarpons', teamId: 587, sportId: 14, venueName: 'George M. Steinbrenner Field', lat: 27.97997, lng: -82.50702 },
  { teamName: 'Ontario Tower Buzzers', teamId: 6482, sportId: 14, venueName: 'ONT Field', lat: 34.0184640, lng: -117.6033181 },
  { teamName: 'Delmarva Shorebirds', teamId: 548, sportId: 14, venueName: 'Arthur W. Perdue Stadium', lat: 38.369979, lng: -75.530656 },
  { teamName: 'Columbia Fireflies', teamId: 3705, sportId: 14, venueName: 'Segra Park', lat: 34.018317, lng: -81.030958 },
  { teamName: 'Fayetteville Woodpeckers', teamId: 3712, sportId: 14, venueName: 'SEGRA Stadium', lat: 35.054357, lng: -78.8851444 },
  { teamName: 'Inland Empire 66ers', teamId: 401, sportId: 14, venueName: 'San Manuel Stadium', lat: 34.097266, lng: -117.296268 },
  { teamName: 'Lake Elsinore Storm', teamId: 103, sportId: 14, venueName: 'The Diamond', lat: 33.654183, lng: -117.3010675 },
  { teamName: 'Salem RidgeYaks', teamId: 414, sportId: 14, venueName: 'Carilion Clinic Field', lat: 37.2861162, lng: -80.037161 },
  { teamName: 'Dunedin Blue Jays', teamId: 424, sportId: 14, venueName: 'TD Ballpark', lat: 27.9745812, lng: -82.7913301 },
  { teamName: 'Daytona Tortugas', teamId: 450, sportId: 14, venueName: 'Jackie Robinson Ballpark', lat: 29.20922, lng: -81.01596 },
  { teamName: 'Hickory Crawdads', teamId: 448, sportId: 14, venueName: 'L.P. Frans Stadium', lat: 35.747289, lng: -81.3778848 },
  { teamName: 'San Jose Giants', teamId: 476, sportId: 14, venueName: 'Excite Ballpark', lat: 37.32128, lng: -121.862286 },
  { teamName: 'Augusta GreenJackets', teamId: 478, sportId: 14, venueName: 'SRP Park', lat: 33.4844619, lng: -81.9764372 },
  { teamName: 'Jupiter Hammerheads', teamId: 479, sportId: 14, venueName: 'Roger Dean Chevrolet Stadium', lat: 26.890957, lng: -80.116365 },
  { teamName: 'Hill City Howlers', teamId: 481, sportId: 14, venueName: 'Bank of the James Stadium', lat: 37.3930099, lng: -79.1661 },
  { teamName: 'Kannapolis Cannon Ballers', teamId: 487, sportId: 14, venueName: 'Atrium Health Ballpark', lat: 35.4968555, lng: -80.6282677 },
  { teamName: 'Charleston RiverDogs', teamId: 233, sportId: 14, venueName: 'Joseph P. Riley, Jr. Ballpark', lat: 32.790421, lng: -79.961332 },
  { teamName: 'Fredericksburg Nationals', teamId: 436, sportId: 14, venueName: 'Virginia Credit Union Stadium', lat: 38.3181302, lng: -77.5124029 },
  { teamName: 'Corpus Christi Hooks', teamId: 482, sportId: 12, venueName: 'Whataburger Field', lat: 27.80995, lng: -97.39941 },
]

// ---------------------------------------------------------------------------
// HS venue coordinates (schools from maxprepsSlugs.ts)
// ---------------------------------------------------------------------------
const HS_VENUES: Record<string, { venueName: string; coords: Coordinates }> = {
  'Stony Brook|NY': { venueName: 'Stony Brook HS', coords: { lat: 40.9256, lng: -73.1409 } },
  'Etowah|GA': { venueName: 'Etowah HS', coords: { lat: 34.1954, lng: -84.4983 } },
  'Hernando|MS': { venueName: 'Hernando HS', coords: { lat: 34.8293, lng: -89.9937 } },
  'Christ Church|SC': { venueName: 'Christ Church Episcopal School', coords: { lat: 34.8543, lng: -82.3363 } },
  'Timber Creek|FL': { venueName: 'Timber Creek HS', coords: { lat: 28.4692, lng: -81.2537 } },
  'Suwannee|FL': { venueName: 'Suwannee HS', coords: { lat: 30.2994, lng: -82.9813 } },
  'B.R. Catholic|LA': { venueName: 'Catholic HS (Baton Rouge)', coords: { lat: 30.4129, lng: -91.1543 } },
  'Trinity|KY': { venueName: 'Trinity HS', coords: { lat: 38.2604, lng: -85.6273 } },
  'James Island|SC': { venueName: 'James Island Charter HS', coords: { lat: 32.7365, lng: -79.9619 } },
  'Sarasota HS|FL': { venueName: 'Sarasota HS', coords: { lat: 27.3269, lng: -82.5447 } },
  "St. Joseph's Prep|PA": { venueName: "St. Joseph's Prep", coords: { lat: 39.9684, lng: -75.1632 } },
  'Iona Prep|NY': { venueName: 'Iona Preparatory School', coords: { lat: 40.9509, lng: -73.8244 } },
  'Cardinal Gibbons|NC': { venueName: 'Cardinal Gibbons HS', coords: { lat: 35.8284, lng: -78.6823 } },
  'South Walton|FL': { venueName: 'South Walton HS', coords: { lat: 30.3770, lng: -86.2004 } },
  'The Hun School|NJ': { venueName: 'The Hun School of Princeton', coords: { lat: 40.3291, lng: -74.6653 } },
  'Muskego|WI': { venueName: 'Muskego HS', coords: { lat: 42.9054, lng: -88.1357 } },
  'IMG|FL': { venueName: 'IMG Academy', coords: { lat: 27.4573, lng: -82.5578 } },
  'Briarcrest|TN': { venueName: 'Briarcrest Christian School', coords: { lat: 35.0748, lng: -89.7935 } },
  'Spotswood|VA': { venueName: 'Spotswood HS', coords: { lat: 38.3959, lng: -78.9494 } },
  'N. Broward Prep|FL': { venueName: 'North Broward Preparatory School', coords: { lat: 26.2802, lng: -80.2545 } },
  'Cartersville|GA': { venueName: 'Cartersville HS', coords: { lat: 34.1649, lng: -84.8030 } },
  'Mill Creek|GA': { venueName: 'Mill Creek HS', coords: { lat: 34.1019, lng: -83.8753 } },
}

// ---------------------------------------------------------------------------
// Build unified venue list
// ---------------------------------------------------------------------------
const allVenues: VenueInput[] = []

// 1. MLB / MiLB from API
for (const t of MLB_API_TEAMS) {
  // Determine type based on sportId
  const type: VenueInput['type'] = t.sportId === 1 ? 'mlb' : 'milb'
  allVenues.push({
    name: t.venueName,
    type,
    teamName: t.teamName,
    coords: { lat: t.lat, lng: t.lng },
  })
}

// 2. NCAA venues
for (const [school, v] of Object.entries(NCAA_VENUES)) {
  allVenues.push({
    name: v.venueName,
    type: 'ncaa',
    teamName: school,
    coords: v.coords,
  })
}

// 3. Spring Training sites
for (const [, site] of Object.entries(SPRING_TRAINING_SITES)) {
  allVenues.push({
    name: site.venueName,
    type: 'spring-training',
    teamName: site.teamName,
    coords: site.coords,
  })
}

// 4. HS venues
for (const [key, v] of Object.entries(HS_VENUES)) {
  allVenues.push({
    name: v.venueName,
    type: 'hs',
    teamName: key,
    coords: v.coords,
  })
}

// ---------------------------------------------------------------------------
// Deduplicate by coordKey — if two venues share the same coords, keep the first
// but merge teamNames
// ---------------------------------------------------------------------------
interface VenueWithKey extends VenueInput {
  key: string
}

const venueMap = new Map<string, VenueWithKey>()

for (const v of allVenues) {
  const key = coordKey(v.coords)
  if (!venueMap.has(key)) {
    venueMap.set(key, { ...v, key })
  }
  // If same coords, different team — we keep the first venue entry
  // (the nearby list will reference it by key anyway)
}

const venues = Array.from(venueMap.values())

// ---------------------------------------------------------------------------
// Compute pairwise proximity & home base distances
// ---------------------------------------------------------------------------
interface NearbyEntry {
  key: string
  name: string
  driveMinutes: number
  type: 'mlb' | 'milb' | 'ncaa' | 'hs' | 'spring-training'
  teamName?: string
}

interface VenueEntryOutput {
  name: string
  type: 'mlb' | 'milb' | 'ncaa' | 'hs' | 'spring-training'
  teamName?: string
  homeMinutes: number
  nearby: NearbyEntry[]
}

const result: Record<string, VenueEntryOutput> = {}

for (const v of venues) {
  const homeMin = estimateDriveMinutes(HOME_BASE, v.coords)
  const nearby: NearbyEntry[] = []

  for (const other of venues) {
    if (other.key === v.key) continue
    const mins = estimateDriveMinutes(v.coords, other.coords)
    if (mins <= 180) {
      nearby.push({
        key: other.key,
        name: other.name,
        driveMinutes: mins,
        type: other.type,
        ...(other.teamName ? { teamName: other.teamName } : {}),
      })
    }
  }

  // Sort by drive time ascending
  nearby.sort((a, b) => a.driveMinutes - b.driveMinutes)

  result[v.key] = {
    name: v.name,
    type: v.type,
    ...(v.teamName ? { teamName: v.teamName } : {}),
    homeMinutes: homeMin,
    nearby,
  }
}

// ---------------------------------------------------------------------------
// Write output file
// ---------------------------------------------------------------------------
const outputPath = path.resolve(__dirname, '../src/data/venueProximity.ts')

let output = `// Auto-generated by scripts/generateVenueProximity.ts — do not edit manually
// Generated: ${new Date().toISOString().slice(0, 10)}

export interface NearbyVenue {
  key: string          // "lat,lng" (4 decimals)
  name: string         // venue name
  driveMinutes: number
  type: 'mlb' | 'milb' | 'ncaa' | 'hs' | 'spring-training'
  teamName?: string
}

export interface VenueEntry {
  name: string
  type: 'mlb' | 'milb' | 'ncaa' | 'hs' | 'spring-training'
  teamName?: string
  homeMinutes: number  // from Orlando
  nearby: NearbyVenue[]
}

export const VENUE_PROXIMITY: Record<string, VenueEntry> = ${JSON.stringify(result, null, 2)}
`

fs.writeFileSync(outputPath, output, 'utf-8')

// Stats
const totalVenues = Object.keys(result).length
const totalPairs = Object.values(result).reduce((sum, v) => sum + v.nearby.length, 0) / 2
const maxNearby = Math.max(...Object.values(result).map(v => v.nearby.length))

console.log(`✓ Wrote ${outputPath}`)
console.log(`  ${totalVenues} venues, ${Math.round(totalPairs)} nearby pairs (≤180 min), max ${maxNearby} neighbors`)
