import type { Coordinates } from '../types/roster'

// Hardcoded venue coordinates for NCAA D1 baseball programs
// Source: stadium locations for each school's primary baseball venue
// Coverage: ALL ~302 NCAA Division I baseball programs (2025-2026)
export const NCAA_VENUES: Record<string, { venueName: string; coords: Coordinates }> = {
  // ── SEC (16) ─────────────────────────────────────────────────────────
  'Alabama': {
    venueName: 'Sewell-Thomas Stadium',
    coords: { lat: 33.2132, lng: -87.5464 },
  },
  'Arkansas': {
    venueName: 'Baum-Walker Stadium',
    coords: { lat: 36.0685, lng: -94.1823 },
  },
  'Auburn': {
    venueName: 'Plainsman Park',
    coords: { lat: 32.6028, lng: -85.4893 },
  },
  'Florida': {
    venueName: 'Florida Ballpark',
    coords: { lat: 29.6382, lng: -82.3458 },
  },
  'Georgia': {
    venueName: 'Foley Field',
    coords: { lat: 33.9485, lng: -83.3733 },
  },
  'Kentucky': {
    venueName: 'Kentucky Proud Park',
    coords: { lat: 38.0225, lng: -84.5053 },
  },
  'LSU': {
    venueName: 'Alex Box Stadium',
    coords: { lat: 30.4060, lng: -91.1847 },
  },
  'Mississippi State': {
    venueName: 'Dudy Noble Field',
    coords: { lat: 33.4530, lng: -88.7841 },
  },
  'Missouri': {
    venueName: 'Taylor Stadium',
    coords: { lat: 38.9510, lng: -92.3340 },
  },
  'Oklahoma': {
    venueName: 'L. Dale Mitchell Park',
    coords: { lat: 35.2058, lng: -97.4423 },
  },
  'Ole Miss': {
    venueName: 'Swayze Field',
    coords: { lat: 34.3618, lng: -89.5344 },
  },
  'South Carolina': {
    venueName: 'Founders Park',
    coords: { lat: 33.9881, lng: -81.0329 },
  },
  'Tennessee': {
    venueName: 'Lindsey Nelson Stadium',
    coords: { lat: 35.9520, lng: -83.9367 },
  },
  'Texas': {
    venueName: 'UFCU Disch-Falk Field',
    coords: { lat: 30.2833, lng: -97.7321 },
  },
  'Texas A&M': {
    venueName: 'Olsen Field at Blue Bell Park',
    coords: { lat: 30.6046, lng: -96.3418 },
  },
  'Vanderbilt': {
    venueName: 'Hawkins Field',
    coords: { lat: 36.1476, lng: -86.8127 },
  },

  // ── ACC (18) ─────────────────────────────────────────────────────────
  'Boston College': {
    venueName: 'Eddie Pellagrini Diamond at John Shea Field',
    coords: { lat: 42.3355, lng: -71.1685 },
  },
  'California': {
    venueName: 'Evans Diamond',
    coords: { lat: 37.8710, lng: -122.2530 },
  },
  'Clemson': {
    venueName: 'Doug Kingsmore Stadium',
    coords: { lat: 34.6804, lng: -82.8422 },
  },
  'Duke': {
    venueName: 'Durham Bulls Athletic Park',
    coords: { lat: 35.9941, lng: -78.9025 },
  },
  'Florida State': {
    venueName: 'Dick Howser Stadium',
    coords: { lat: 30.4393, lng: -84.2972 },
  },
  'Georgia Tech': {
    venueName: 'Russ Chandler Stadium',
    coords: { lat: 33.7723, lng: -84.3921 },
  },
  'Louisville': {
    venueName: 'Jim Patterson Stadium',
    coords: { lat: 38.2184, lng: -85.7589 },
  },
  'Miami': {
    venueName: 'Mark Light Field',
    coords: { lat: 25.7135, lng: -80.2645 },
  },
  'North Carolina': {
    venueName: 'Boshamer Stadium',
    coords: { lat: 35.9683, lng: -79.0589 },
  },
  'NC State': {
    venueName: 'Doak Field at Dail Park',
    coords: { lat: 35.7830, lng: -78.6713 },
  },
  'Notre Dame': {
    venueName: 'Frank Eck Stadium',
    coords: { lat: 41.6985, lng: -86.2290 },
  },
  'Pittsburgh': {
    venueName: 'Charles L. Cost Field',
    coords: { lat: 40.4435, lng: -79.9603 },
  },
  'SMU': {
    venueName: 'Spinks-McCullough Ballpark',
    coords: { lat: 32.8411, lng: -96.7840 },
  },
  'Stanford': {
    venueName: 'Sunken Diamond',
    coords: { lat: 37.4343, lng: -122.1617 },
  },
  'Syracuse': {
    venueName: 'NBT Bank Stadium',
    coords: { lat: 43.0571, lng: -76.1407 },
  },
  'Virginia': {
    venueName: 'Disharoon Park',
    coords: { lat: 38.0326, lng: -78.5131 },
  },
  'Virginia Tech': {
    venueName: 'English Field at Atlantic Union Bank Park',
    coords: { lat: 37.2235, lng: -80.4228 },
  },
  'Wake Forest': {
    venueName: 'David F. Couch Ballpark',
    coords: { lat: 36.1340, lng: -80.2817 },
  },

  // ── Big 12 (16) ──────────────────────────────────────────────────────
  'Arizona': {
    venueName: 'Hi Corbett Field',
    coords: { lat: 32.2218, lng: -110.9386 },
  },
  'Arizona State': {
    venueName: 'Phoenix Municipal Stadium',
    coords: { lat: 33.4454, lng: -111.9662 },
  },
  'Baylor': {
    venueName: 'Baylor Ballpark',
    coords: { lat: 31.5445, lng: -97.1165 },
  },
  'BYU': {
    venueName: 'Larry H. Miller Field',
    coords: { lat: 40.2566, lng: -111.6546 },
  },
  'Cincinnati': {
    venueName: 'UC Baseball Stadium',
    coords: { lat: 39.1303, lng: -84.5196 },
  },
  'Colorado': {
    venueName: 'CU Baseball Field',
    coords: { lat: 40.0070, lng: -105.2625 },
  },
  'Houston': {
    venueName: 'Schroeder Park',
    coords: { lat: 29.7215, lng: -95.3424 },
  },
  'Iowa State': {
    venueName: 'Cap Timm Field',
    coords: { lat: 42.0200, lng: -93.6333 },
  },
  'Kansas': {
    venueName: 'Hoglund Ballpark',
    coords: { lat: 38.9559, lng: -95.2525 },
  },
  'Kansas State': {
    venueName: 'Tointon Family Stadium',
    coords: { lat: 39.1978, lng: -96.5847 },
  },
  'Oklahoma State': {
    venueName: "O'Brate Stadium",
    coords: { lat: 36.1285, lng: -97.0703 },
  },
  'TCU': {
    venueName: 'Lupton Stadium',
    coords: { lat: 32.7107, lng: -97.3631 },
  },
  'Texas Tech': {
    venueName: 'Dan Law Field at Rip Griffin Park',
    coords: { lat: 33.5880, lng: -101.8453 },
  },
  'UCF': {
    venueName: 'John Euliano Park',
    coords: { lat: 28.6022, lng: -81.2016 },
  },
  'Utah': {
    venueName: 'Smith Ballpark',
    coords: { lat: 40.7703, lng: -111.9016 },
  },
  'West Virginia': {
    venueName: 'Monongalia County Ballpark',
    coords: { lat: 39.6490, lng: -79.9670 },
  },

  // ── Big Ten (17) ─────────────────────────────────────────────────────
  'Illinois': {
    venueName: 'Illinois Field',
    coords: { lat: 40.0977, lng: -88.2345 },
  },
  'Indiana': {
    venueName: 'Bart Kaufman Field',
    coords: { lat: 39.1797, lng: -86.5133 },
  },
  'Iowa': {
    venueName: 'Duane Banks Field',
    coords: { lat: 41.6590, lng: -91.5491 },
  },
  'Maryland': {
    venueName: 'Bob "Turtle" Smith Stadium',
    coords: { lat: 38.9870, lng: -76.9480 },
  },
  'Michigan': {
    venueName: 'Ray Fisher Stadium',
    coords: { lat: 42.2710, lng: -83.7465 },
  },
  'Michigan State': {
    venueName: 'McLane Baseball Stadium',
    coords: { lat: 42.7289, lng: -84.4815 },
  },
  'Minnesota': {
    venueName: 'Siebert Field',
    coords: { lat: 44.9765, lng: -93.2269 },
  },
  'Nebraska': {
    venueName: 'Hawks Field at Haymarket Park',
    coords: { lat: 40.8352, lng: -96.7078 },
  },
  'Northwestern': {
    venueName: 'Rocky Miller Park',
    coords: { lat: 42.0632, lng: -87.6762 },
  },
  'Ohio State': {
    venueName: 'Bill Davis Stadium',
    coords: { lat: 40.0092, lng: -83.0282 },
  },
  'Oregon': {
    venueName: 'PK Park',
    coords: { lat: 44.0588, lng: -123.0685 },
  },
  'Oregon State': {
    venueName: 'Goss Stadium at Coleman Field',
    coords: { lat: 44.5612, lng: -123.2759 },
  },
  'Penn State': {
    venueName: 'Medlar Field at Lubrano Park',
    coords: { lat: 40.8128, lng: -77.8556 },
  },
  'Purdue': {
    venueName: 'Alexander Field',
    coords: { lat: 40.4351, lng: -86.9178 },
  },
  'Rutgers': {
    venueName: 'Bainton Field',
    coords: { lat: 40.5227, lng: -74.4631 },
  },
  'UCLA': {
    venueName: 'Jackie Robinson Stadium',
    coords: { lat: 34.0695, lng: -118.4510 },
  },
  'USC': {
    venueName: 'Dedeaux Field',
    coords: { lat: 34.0170, lng: -118.2841 },
  },
  'Washington': {
    venueName: 'Husky Ballpark',
    coords: { lat: 47.6517, lng: -122.3030 },
  },
  'Washington State': {
    venueName: 'Bailey-Brayton Field',
    coords: { lat: 46.7362, lng: -117.1749 },
  },

  // ── Big East (9) ─────────────────────────────────────────────────────
  'Butler': {
    venueName: 'Bulldog Park',
    coords: { lat: 39.8403, lng: -86.1710 },
  },
  'Connecticut': {
    venueName: 'Elliot Ballpark',
    coords: { lat: 41.8067, lng: -72.2542 },
  },
  'Creighton': {
    venueName: 'TD Ameritrade Park',
    coords: { lat: 41.2565, lng: -95.9264 },
  },
  'Georgetown': {
    venueName: 'Shirley Povich Field',
    coords: { lat: 39.0024, lng: -77.1018 },
  },
  'Providence': {
    venueName: 'Bill Beck Field',
    coords: { lat: 41.8416, lng: -71.4375 },
  },
  'Seton Hall': {
    venueName: 'Owen T. Carroll Field',
    coords: { lat: 40.7422, lng: -74.2453 },
  },
  'St. Johns': {
    venueName: 'Jack Kaiser Stadium',
    coords: { lat: 40.7222, lng: -73.7947 },
  },
  'Villanova': {
    venueName: 'Villanova Ballpark at Plymouth',
    coords: { lat: 40.1012, lng: -75.2978 },
  },
  'Xavier': {
    venueName: 'Hayden Field',
    coords: { lat: 39.1489, lng: -84.4724 },
  },

  // ── AAC (American Athletic Conference) (14) ──────────────────────────
  'Charlotte': {
    venueName: 'Barnard Park',
    coords: { lat: 35.3065, lng: -80.7329 },
  },
  'East Carolina': {
    venueName: 'Clark-LeClair Stadium',
    coords: { lat: 35.6046, lng: -77.3700 },
  },
  'FAU': {
    venueName: 'FAU Baseball Stadium',
    coords: { lat: 26.3706, lng: -80.1024 },
  },
  'Memphis': {
    venueName: 'FedExPark Avron Fogelman Field',
    coords: { lat: 35.1202, lng: -89.9383 },
  },
  'Navy': {
    venueName: 'Terwilliger Brothers Field at Max Bishop Stadium',
    coords: { lat: 38.9822, lng: -76.4862 },
  },
  'North Texas': {
    venueName: 'Lovelace Stadium',
    coords: { lat: 33.2073, lng: -97.1495 },
  },
  'Rice': {
    venueName: 'Reckling Park',
    coords: { lat: 29.7152, lng: -95.4081 },
  },
  'Temple': {
    venueName: 'Skip Wilson Field',
    coords: { lat: 40.0011, lng: -75.1494 },
  },
  'Tulane': {
    venueName: 'Greer Field at Turchin Stadium',
    coords: { lat: 29.9419, lng: -90.1183 },
  },
  'Tulsa': {
    venueName: 'Capra Field',
    coords: { lat: 36.1508, lng: -95.9474 },
  },
  'UAB': {
    venueName: 'Regions Field',
    coords: { lat: 33.5124, lng: -86.8056 },
  },
  'USF': {
    venueName: 'USF Baseball Stadium',
    coords: { lat: 28.0647, lng: -82.4159 },
  },
  'UTSA': {
    venueName: 'Roadrunner Field',
    coords: { lat: 29.5821, lng: -98.6191 },
  },
  'Wichita State': {
    venueName: 'Eck Stadium',
    coords: { lat: 37.7173, lng: -97.2927 },
  },

  // ── Sun Belt (14) ────────────────────────────────────────────────────
  'Appalachian State': {
    venueName: 'Jim and Bettie Smith Stadium',
    coords: { lat: 36.2113, lng: -81.6867 },
  },
  'Arkansas State': {
    venueName: 'Tomlinson Stadium-Kell Field',
    coords: { lat: 35.8424, lng: -90.6774 },
  },
  'Coastal Carolina': {
    venueName: 'Springs Brooks Stadium',
    coords: { lat: 33.7964, lng: -79.0117 },
  },
  'Georgia Southern': {
    venueName: 'J.I. Clements Stadium',
    coords: { lat: 32.4204, lng: -81.7835 },
  },
  'Georgia State': {
    venueName: 'GSU Baseball Complex',
    coords: { lat: 33.7529, lng: -84.3884 },
  },
  'James Madison': {
    venueName: 'Veterans Memorial Park',
    coords: { lat: 38.4347, lng: -78.8684 },
  },
  'Louisiana': {
    venueName: 'M.L. Tigue Moore Field at Russo Park',
    coords: { lat: 30.2131, lng: -92.0210 },
  },
  'Louisiana-Monroe': {
    venueName: 'Warhawk Field',
    coords: { lat: 32.5278, lng: -92.0716 },
  },
  'Marshall': {
    venueName: 'Kennedy Center Field',
    coords: { lat: 38.4176, lng: -82.4312 },
  },
  'Old Dominion': {
    venueName: 'Bud Metheny Baseball Complex',
    coords: { lat: 36.8844, lng: -76.3050 },
  },
  'South Alabama': {
    venueName: 'Stanky Field',
    coords: { lat: 30.6960, lng: -88.1770 },
  },
  'Southern Miss': {
    venueName: 'Pete Taylor Park',
    coords: { lat: 31.3298, lng: -89.3345 },
  },
  'Texas State': {
    venueName: 'Bobcat Ballpark',
    coords: { lat: 29.8867, lng: -97.9285 },
  },
  'Troy': {
    venueName: 'Riddle-Pace Field',
    coords: { lat: 31.7965, lng: -85.9667 },
  },

  // ── Conference USA (11) ──────────────────────────────────────────────
  'Dallas Baptist': {
    venueName: 'Horner Ballpark',
    coords: { lat: 32.7242, lng: -96.9114 },
  },
  'FIU': {
    venueName: 'FIU Baseball Stadium',
    coords: { lat: 25.7562, lng: -80.3735 },
  },
  'Jacksonville State': {
    venueName: 'Rudy Abbott Field at Jim Case Stadium',
    coords: { lat: 33.8229, lng: -85.7639 },
  },
  'Kennesaw State': {
    venueName: 'Stillwell Stadium',
    coords: { lat: 34.0378, lng: -84.5823 },
  },
  'Liberty': {
    venueName: 'Liberty Baseball Stadium',
    coords: { lat: 37.3528, lng: -79.1816 },
  },
  'Louisiana Tech': {
    venueName: 'J.C. Love Field at Pat Patterson Park',
    coords: { lat: 32.5281, lng: -92.6481 },
  },
  'Middle Tennessee': {
    venueName: 'Reese Smith Jr. Field',
    coords: { lat: 35.8515, lng: -86.3719 },
  },
  'New Mexico State': {
    venueName: 'Presley Askew Field',
    coords: { lat: 32.2800, lng: -106.7473 },
  },
  'Sam Houston': {
    venueName: 'Don Sanders Stadium',
    coords: { lat: 30.7168, lng: -95.5462 },
  },
  'Western Kentucky': {
    venueName: 'Nick Denes Field',
    coords: { lat: 36.9798, lng: -86.4474 },
  },
  'Jacksonville': {
    venueName: 'John Sessions Stadium',
    coords: { lat: 30.3455, lng: -81.6040 },
  },

  // ── Missouri Valley Conference (8) ───────────────────────────────────
  'Bradley': {
    venueName: 'Dozer Park',
    coords: { lat: 40.6974, lng: -89.6025 },
  },
  'Evansville': {
    venueName: 'German American Bank Field at Charles H. Braun Stadium',
    coords: { lat: 37.9745, lng: -87.5300 },
  },
  'Illinois State': {
    venueName: 'Duffy Bass Field',
    coords: { lat: 40.5131, lng: -88.9961 },
  },
  'Indiana State': {
    venueName: 'Bob Warn Field at Sycamore Stadium',
    coords: { lat: 39.4677, lng: -87.3960 },
  },
  'Missouri State': {
    venueName: 'Hammons Field',
    coords: { lat: 37.2011, lng: -93.2792 },
  },
  'Southern Illinois': {
    venueName: 'Itchy Jones Stadium',
    coords: { lat: 37.7130, lng: -89.2168 },
  },
  'Valparaiso': {
    venueName: 'Emory G. Bauer Field',
    coords: { lat: 41.4547, lng: -87.0412 },
  },
  'Belmont': {
    venueName: 'E.S. Rose Park',
    coords: { lat: 36.1295, lng: -86.7962 },
  },

  // ── Colonial Athletic Association (CAA) (13) ─────────────────────────
  'Charleston': {
    venueName: 'Patriots Point Baseball Stadium',
    coords: { lat: 32.7908, lng: -79.9041 },
  },
  'College of Charleston': {
    venueName: 'Patriots Point Baseball Stadium',
    coords: { lat: 32.7908, lng: -79.9041 },
  },
  'Delaware': {
    venueName: 'Bob Hannah Stadium',
    coords: { lat: 39.6784, lng: -75.7539 },
  },
  'Elon': {
    venueName: 'Latham Park',
    coords: { lat: 36.1014, lng: -79.5045 },
  },
  'Hampton': {
    venueName: 'Armstrong Stadium',
    coords: { lat: 37.0218, lng: -76.3370 },
  },
  'Hofstra': {
    venueName: 'University Field',
    coords: { lat: 40.7162, lng: -73.6014 },
  },
  'Monmouth': {
    venueName: 'Monmouth Baseball Field',
    coords: { lat: 40.2775, lng: -74.0044 },
  },
  'Northeastern': {
    venueName: 'Friedman Diamond',
    coords: { lat: 42.3398, lng: -71.0908 },
  },
  'North Carolina A&T': {
    venueName: 'War Memorial Stadium',
    coords: { lat: 36.0706, lng: -79.7830 },
  },
  'Stony Brook': {
    venueName: 'Joe Nathan Field',
    coords: { lat: 40.9116, lng: -73.1199 },
  },
  'Towson': {
    venueName: 'John B. Schuerholz Park',
    coords: { lat: 39.3920, lng: -76.6090 },
  },
  'UNCW': {
    venueName: 'Brooks Field',
    coords: { lat: 34.2273, lng: -77.8723 },
  },
  'William & Mary': {
    venueName: 'Plumeri Park',
    coords: { lat: 37.2667, lng: -76.7232 },
  },

  // ── Mountain West (7) ────────────────────────────────────────────────
  'Air Force': {
    venueName: 'Falcon Field',
    coords: { lat: 38.9961, lng: -104.8576 },
  },
  'Fresno State': {
    venueName: 'Pete Beiden Field at Bob Bennett Stadium',
    coords: { lat: 36.8127, lng: -119.7526 },
  },
  'Nevada': {
    venueName: 'Peccole Park',
    coords: { lat: 39.5422, lng: -119.8146 },
  },
  'New Mexico': {
    venueName: 'Santa Ana Star Field',
    coords: { lat: 35.0794, lng: -106.6194 },
  },
  'San Diego State': {
    venueName: 'Tony Gwynn Stadium',
    coords: { lat: 32.7741, lng: -117.0714 },
  },
  'San Jose State': {
    venueName: 'Excite Ballpark',
    coords: { lat: 37.3448, lng: -121.8771 },
  },
  'UNLV': {
    venueName: 'Earl E. Wilson Stadium',
    coords: { lat: 36.1068, lng: -115.1469 },
  },

  // ── West Coast Conference (9) ────────────────────────────────────────
  'Gonzaga': {
    venueName: 'Patterson Baseball Complex',
    coords: { lat: 47.6626, lng: -117.3998 },
  },
  'Loyola Marymount': {
    venueName: 'Page Stadium',
    coords: { lat: 33.9696, lng: -118.4178 },
  },
  'Pacific': {
    venueName: 'Klein Family Field',
    coords: { lat: 37.9782, lng: -121.3101 },
  },
  'Pepperdine': {
    venueName: 'Eddy D. Field Stadium',
    coords: { lat: 34.0376, lng: -118.7110 },
  },
  'Portland': {
    venueName: 'Joe Etzel Field',
    coords: { lat: 45.5745, lng: -122.7264 },
  },
  'Saint Marys': {
    venueName: 'Louis Guisto Field',
    coords: { lat: 37.8406, lng: -122.1133 },
  },
  'San Diego': {
    venueName: 'Fowler Park',
    coords: { lat: 32.7720, lng: -117.1884 },
  },
  'San Francisco': {
    venueName: 'Benedetti Diamond',
    coords: { lat: 37.7761, lng: -122.4518 },
  },
  'Santa Clara': {
    venueName: 'Stephen Schott Stadium',
    coords: { lat: 37.3515, lng: -121.9425 },
  },

  // ── Big West (11) ────────────────────────────────────────────────────
  'Cal Poly': {
    venueName: 'Baggett Stadium',
    coords: { lat: 35.3045, lng: -120.6606 },
  },
  'Cal State Fullerton': {
    venueName: 'Goodwin Field',
    coords: { lat: 33.8833, lng: -117.8872 },
  },
  'Cal State Northridge': {
    venueName: 'Matador Field',
    coords: { lat: 34.2394, lng: -118.5279 },
  },
  'CSU Bakersfield': {
    venueName: 'Hardt Field',
    coords: { lat: 35.3477, lng: -119.1018 },
  },
  'Hawaii': {
    venueName: 'Les Murakami Stadium',
    coords: { lat: 21.2975, lng: -157.8154 },
  },
  'Long Beach State': {
    venueName: 'Blair Field',
    coords: { lat: 33.7835, lng: -118.1627 },
  },
  'UC Davis': {
    venueName: 'Dobbins Baseball Stadium',
    coords: { lat: 38.5382, lng: -121.7640 },
  },
  'UC Irvine': {
    venueName: 'Cicerone Field',
    coords: { lat: 33.6667, lng: -117.8467 },
  },
  'UC Riverside': {
    venueName: 'Riverside Sports Complex',
    coords: { lat: 33.9750, lng: -117.3264 },
  },
  'UC San Diego': {
    venueName: 'Triton Ballpark',
    coords: { lat: 32.8715, lng: -117.2361 },
  },
  'UC Santa Barbara': {
    venueName: 'Caesar Uyesaka Stadium',
    coords: { lat: 34.4146, lng: -119.8486 },
  },

  // ── Atlantic 10 (14) ─────────────────────────────────────────────────
  'Davidson': {
    venueName: 'Wilson Field',
    coords: { lat: 35.5012, lng: -80.8438 },
  },
  'Dayton': {
    venueName: 'Woerner Field',
    coords: { lat: 39.7399, lng: -84.1795 },
  },
  'Fordham': {
    venueName: 'Houlihan Park',
    coords: { lat: 40.8612, lng: -73.8855 },
  },
  'George Mason': {
    venueName: 'Spuhler Field',
    coords: { lat: 38.8326, lng: -77.3073 },
  },
  'George Washington': {
    venueName: 'Barcroft Park',
    coords: { lat: 38.8555, lng: -77.0966 },
  },
  'La Salle': {
    venueName: 'Hank DeVincent Field',
    coords: { lat: 40.0364, lng: -75.1546 },
  },
  'Massachusetts': {
    venueName: 'Earl Lorden Field',
    coords: { lat: 42.3884, lng: -72.5276 },
  },
  'Rhode Island': {
    venueName: 'Bill Beck Field',
    coords: { lat: 41.4869, lng: -71.5265 },
  },
  'Richmond': {
    venueName: 'Pitt Field',
    coords: { lat: 37.5760, lng: -77.5403 },
  },
  'Saint Josephs': {
    venueName: "Smithson Field",
    coords: { lat: 40.0045, lng: -75.2446 },
  },
  'Saint Louis': {
    venueName: 'Billiken Sports Center',
    coords: { lat: 38.6370, lng: -90.2335 },
  },
  'St. Bonaventure': {
    venueName: 'Fred Handler Park',
    coords: { lat: 42.0772, lng: -78.4850 },
  },
  'VCU': {
    venueName: 'The Diamond',
    coords: { lat: 37.5596, lng: -77.4749 },
  },

  // ── Ivy League (8) ───────────────────────────────────────────────────
  'Brown': {
    venueName: 'Murray Stadium',
    coords: { lat: 41.8289, lng: -71.3988 },
  },
  'Columbia': {
    venueName: 'Robertson Field at Satow Stadium',
    coords: { lat: 40.7546, lng: -73.9676 },
  },
  'Cornell': {
    venueName: 'Booth Field',
    coords: { lat: 42.4466, lng: -76.4796 },
  },
  'Dartmouth': {
    venueName: 'Red Rolfe Field at Biondi Park',
    coords: { lat: 43.7044, lng: -72.2862 },
  },
  'Harvard': {
    venueName: "O'Donnell Field",
    coords: { lat: 42.3720, lng: -71.1279 },
  },
  'Pennsylvania': {
    venueName: 'Meiklejohn Stadium',
    coords: { lat: 39.9508, lng: -75.1919 },
  },
  'Princeton': {
    venueName: 'Bill Clarke Field',
    coords: { lat: 40.3456, lng: -74.6594 },
  },
  'Yale': {
    venueName: 'Yale Field',
    coords: { lat: 41.3115, lng: -72.9601 },
  },

  // ── America East (8) ─────────────────────────────────────────────────
  'Albany': {
    venueName: 'Varsity Field',
    coords: { lat: 42.6855, lng: -73.8253 },
  },
  'Binghamton': {
    venueName: 'Bearcats Baseball Complex',
    coords: { lat: 42.0899, lng: -75.9667 },
  },
  'Bryant': {
    venueName: 'Conaty Park',
    coords: { lat: 41.8470, lng: -71.5268 },
  },
  'Maine': {
    venueName: 'Mahaney Diamond',
    coords: { lat: 44.8997, lng: -68.6726 },
  },
  'NJIT': {
    venueName: 'Yogi Berra Stadium',
    coords: { lat: 40.8638, lng: -74.2012 },
  },
  'UMBC': {
    venueName: 'UMBC Baseball Stadium',
    coords: { lat: 39.2559, lng: -76.7122 },
  },
  'UMass Lowell': {
    venueName: 'LeLacheur Park',
    coords: { lat: 42.6477, lng: -71.2986 },
  },
  'Vermont': {
    venueName: 'Centennial Field',
    coords: { lat: 44.4760, lng: -73.2001 },
  },

  // ── Patriot League (5) ───────────────────────────────────────────────
  'Army': {
    venueName: 'Johnson Stadium at Doubleday Field',
    coords: { lat: 41.3901, lng: -73.9625 },
  },
  'Bucknell': {
    venueName: 'Depew Field',
    coords: { lat: 40.9553, lng: -76.8826 },
  },
  'Holy Cross': {
    venueName: 'Hanover Insurance Park at Fitton Field',
    coords: { lat: 42.2375, lng: -71.8077 },
  },
  'Lafayette': {
    venueName: 'Kamine Stadium',
    coords: { lat: 40.6996, lng: -75.2150 },
  },
  'Lehigh': {
    venueName: 'J. David Walker Field at Legacy Park',
    coords: { lat: 40.6065, lng: -75.3747 },
  },

  // ── Southern Conference (SoCon) (10) ─────────────────────────────────
  'The Citadel': {
    venueName: 'Joe Riley Park',
    coords: { lat: 32.7812, lng: -79.9568 },
  },
  'Chattanooga': {
    venueName: 'Frost Stadium',
    coords: { lat: 35.0486, lng: -85.2785 },
  },
  'East Tennessee State': {
    venueName: 'Thomas Stadium',
    coords: { lat: 36.3048, lng: -82.3705 },
  },
  'Furman': {
    venueName: 'Latham Baseball Stadium',
    coords: { lat: 34.9236, lng: -82.4361 },
  },
  'Mercer': {
    venueName: 'OrthoGeorgia Park',
    coords: { lat: 32.8262, lng: -83.6515 },
  },
  'Samford': {
    venueName: 'Joe Lee Griffin Field',
    coords: { lat: 33.4639, lng: -86.7920 },
  },
  'UNC Greensboro': {
    venueName: 'UNCG Baseball Stadium',
    coords: { lat: 36.0678, lng: -79.8105 },
  },
  'VMI': {
    venueName: 'Gray-Minor Stadium',
    coords: { lat: 37.7881, lng: -79.4430 },
  },
  'Western Carolina': {
    venueName: 'Hennon Stadium',
    coords: { lat: 35.3087, lng: -83.1870 },
  },
  'Wofford': {
    venueName: 'Russell C. King Field',
    coords: { lat: 34.9523, lng: -81.9298 },
  },

  // ── ASUN (Atlantic Sun) (12) ─────────────────────────────────────────
  'Austin Peay': {
    venueName: 'Raymond C. Hand Park',
    coords: { lat: 36.5402, lng: -87.3539 },
  },
  'Bellarmine': {
    venueName: 'Knights Field',
    coords: { lat: 38.2088, lng: -85.6828 },
  },
  'Central Arkansas': {
    venueName: 'Bear Stadium',
    coords: { lat: 35.0744, lng: -92.4530 },
  },
  'Eastern Kentucky': {
    venueName: 'Earle Combs Stadium',
    coords: { lat: 37.7366, lng: -84.2945 },
  },
  'FGCU': {
    venueName: 'FGCU Baseball Complex',
    coords: { lat: 26.4630, lng: -81.7730 },
  },
  'High Point': {
    venueName: 'Willard Stadium',
    coords: { lat: 35.9554, lng: -80.0052 },
  },
  'Lipscomb': {
    venueName: 'Dugan Field',
    coords: { lat: 36.1062, lng: -86.8040 },
  },
  'North Alabama': {
    venueName: 'Mike D. Lane Field',
    coords: { lat: 34.8017, lng: -87.6750 },
  },
  'North Florida': {
    venueName: 'Harmon Stadium',
    coords: { lat: 30.2720, lng: -81.5110 },
  },
  'Queens': {
    venueName: 'Stick Williams Dream Fields',
    coords: { lat: 35.1888, lng: -80.9485 },
  },
  'Stetson': {
    venueName: 'Melching Field at Conrad Park',
    coords: { lat: 29.0381, lng: -81.3034 },
  },

  // ── Southland Conference (10) ────────────────────────────────────────
  'Houston Christian': {
    venueName: 'Husky Field',
    coords: { lat: 29.7164, lng: -95.5579 },
  },
  'Incarnate Word': {
    venueName: 'Sullivan Field',
    coords: { lat: 29.4620, lng: -98.4685 },
  },
  'Lamar': {
    venueName: 'Vincent-Beck Stadium',
    coords: { lat: 30.0534, lng: -94.0830 },
  },
  'McNeese': {
    venueName: 'Joe Miller Ballpark',
    coords: { lat: 30.2056, lng: -93.2175 },
  },
  'New Orleans': {
    venueName: 'Maestri Field at Privateer Park',
    coords: { lat: 30.0283, lng: -90.0640 },
  },
  'Nicholls': {
    venueName: 'Ray E. Didier Field',
    coords: { lat: 29.4463, lng: -90.8150 },
  },
  'Northwestern State': {
    venueName: 'Brown-Stroud Field',
    coords: { lat: 31.7562, lng: -93.0863 },
  },
  'SE Louisiana': {
    venueName: 'Alumni Field',
    coords: { lat: 30.5154, lng: -90.4622 },
  },
  'Texas A&M-Corpus Christi': {
    venueName: 'Chapman Field',
    coords: { lat: 27.7122, lng: -97.3262 },
  },

  // ── Ohio Valley Conference (OVC) (9) ─────────────────────────────────
  'Eastern Illinois': {
    venueName: 'Coaches Stadium',
    coords: { lat: 39.4738, lng: -88.1744 },
  },
  'Lindenwood': {
    venueName: 'Lou Brock Sports Complex',
    coords: { lat: 38.8044, lng: -90.4991 },
  },
  'Little Rock': {
    venueName: 'Gary Hogan Field',
    coords: { lat: 34.7248, lng: -92.3356 },
  },
  'Morehead State': {
    venueName: 'Allen Field',
    coords: { lat: 38.1899, lng: -83.4350 },
  },
  'Murray State': {
    venueName: 'Johnny Reagan Field',
    coords: { lat: 36.6175, lng: -88.3267 },
  },
  'Southeast Missouri State': {
    venueName: 'Capaha Field',
    coords: { lat: 37.3029, lng: -89.5451 },
  },
  'Southern Indiana': {
    venueName: 'USI Baseball Field',
    coords: { lat: 38.0068, lng: -87.6742 },
  },
  'Tennessee-Martin': {
    venueName: 'Skyhawk Field',
    coords: { lat: 36.3538, lng: -88.8630 },
  },
  'Tennessee Tech': {
    venueName: 'Quillen Field at Bush Stadium',
    coords: { lat: 36.1726, lng: -85.5048 },
  },

  // ── Northeast Conference (NEC) (12) ──────────────────────────────────
  'Central Connecticut': {
    venueName: 'CCSU Baseball Field',
    coords: { lat: 41.6846, lng: -72.7879 },
  },
  'Fairleigh Dickinson': {
    venueName: 'FDU Baseball Field',
    coords: { lat: 40.8954, lng: -74.0777 },
  },
  'Le Moyne': {
    venueName: 'Rockwell Field',
    coords: { lat: 43.0406, lng: -76.0743 },
  },
  'Long Island': {
    venueName: 'LIU Baseball Field',
    coords: { lat: 40.6895, lng: -73.9794 },
  },
  'Mercyhurst': {
    venueName: 'Mercyhurst Baseball Field',
    coords: { lat: 42.0949, lng: -80.1080 },
  },
  'Merrimack': {
    venueName: 'Warrior Baseball Diamond',
    coords: { lat: 42.7237, lng: -71.1360 },
  },
  'Mount St. Marys': {
    venueName: 'E.T. Straw Family Stadium',
    coords: { lat: 39.6949, lng: -77.3700 },
  },
  'New Haven': {
    venueName: 'Frank Vieira Field',
    coords: { lat: 41.2894, lng: -72.9616 },
  },
  'Sacred Heart': {
    venueName: 'Pioneer Park',
    coords: { lat: 41.2203, lng: -73.2293 },
  },
  'Stonehill': {
    venueName: 'Lou Gorman Field',
    coords: { lat: 42.1037, lng: -71.1050 },
  },
  'Wagner': {
    venueName: 'Richmond County Bank Ballpark',
    coords: { lat: 40.6406, lng: -74.0762 },
  },

  // ── MAAC (Metro Atlantic Athletic Conference) (10) ───────────────────
  'Canisius': {
    venueName: 'Demske Sports Complex',
    coords: { lat: 42.9349, lng: -78.8426 },
  },
  'Fairfield': {
    venueName: 'Alumni Baseball Diamond',
    coords: { lat: 41.1673, lng: -73.2387 },
  },
  'Iona': {
    venueName: 'City Park',
    coords: { lat: 40.9216, lng: -73.8188 },
  },
  'Manhattan': {
    venueName: 'Dutchess Stadium',
    coords: { lat: 41.5988, lng: -73.8813 },
  },
  'Marist': {
    venueName: 'McCann Baseball Field',
    coords: { lat: 41.6294, lng: -73.9028 },
  },
  'Niagara': {
    venueName: 'Bobo Field',
    coords: { lat: 43.1391, lng: -79.0377 },
  },
  'Quinnipiac': {
    venueName: 'QU Baseball Field',
    coords: { lat: 41.4197, lng: -72.8921 },
  },
  'Rider': {
    venueName: 'Sonny Pittaro Field',
    coords: { lat: 40.2812, lng: -74.7498 },
  },
  'Saint Peters': {
    venueName: 'Joseph J. Jaroschak Field',
    coords: { lat: 40.7484, lng: -74.0543 },
  },
  'Siena': {
    venueName: 'Connors Park',
    coords: { lat: 42.7174, lng: -73.7535 },
  },

  // ── MAC (Mid-American Conference) (11) ───────────────────────────────
  'Akron': {
    venueName: 'Siebert Field',
    coords: { lat: 41.0769, lng: -81.5081 },
  },
  'Ball State': {
    venueName: 'Ball Diamond at First Merchants Ballpark Complex',
    coords: { lat: 40.2052, lng: -85.4042 },
  },
  'Bowling Green': {
    venueName: 'Steller Field',
    coords: { lat: 41.3798, lng: -83.6258 },
  },
  'Central Michigan': {
    venueName: 'Theunissen Stadium',
    coords: { lat: 43.5768, lng: -84.7677 },
  },
  'Eastern Michigan': {
    venueName: 'Oestrike Stadium',
    coords: { lat: 42.2497, lng: -83.6240 },
  },
  'Kent State': {
    venueName: 'Schoonover Stadium',
    coords: { lat: 41.1415, lng: -81.3394 },
  },
  'Miami (OH)': {
    venueName: 'McKie Field at Hayden Park',
    coords: { lat: 39.5103, lng: -84.7327 },
  },
  'Northern Illinois': {
    venueName: 'Ralph McKinzie Field',
    coords: { lat: 41.9344, lng: -88.7730 },
  },
  'Ohio': {
    venueName: 'Bob Wren Stadium',
    coords: { lat: 39.3236, lng: -82.1089 },
  },
  'Toledo': {
    venueName: 'Scott Park',
    coords: { lat: 41.6548, lng: -83.5942 },
  },
  'Western Michigan': {
    venueName: 'Robert J. Bobb Stadium at Hyames Field',
    coords: { lat: 42.2834, lng: -85.6135 },
  },

  // ── Horizon League (6) ───────────────────────────────────────────────
  'Cleveland State': {
    venueName: 'Cleveland State Baseball Field',
    coords: { lat: 41.5028, lng: -81.6777 },
  },
  'Milwaukee': {
    venueName: 'Henry Aaron Field',
    coords: { lat: 43.0806, lng: -87.8835 },
  },
  'Northern Kentucky': {
    venueName: 'Bill Aker Baseball Complex',
    coords: { lat: 39.0289, lng: -84.4616 },
  },
  'Oakland': {
    venueName: 'Oakland Baseball Field',
    coords: { lat: 42.6743, lng: -83.2158 },
  },
  'Wright State': {
    venueName: 'Nischwitz Stadium',
    coords: { lat: 39.7815, lng: -84.0608 },
  },
  'Youngstown State': {
    venueName: 'Eastwood Field',
    coords: { lat: 41.1015, lng: -80.6567 },
  },

  // ── Summit League (7) ────────────────────────────────────────────────
  'Kansas City': {
    venueName: 'Kangaroo Field',
    coords: { lat: 39.0035, lng: -94.5736 },
  },
  'North Dakota State': {
    venueName: 'Newman Outdoor Field',
    coords: { lat: 46.8948, lng: -96.7967 },
  },
  'Omaha': {
    venueName: 'Tal Anderson Field',
    coords: { lat: 41.2592, lng: -96.0117 },
  },
  'Oral Roberts': {
    venueName: 'J.L. Johnson Stadium',
    coords: { lat: 36.0588, lng: -95.9405 },
  },
  'South Dakota State': {
    venueName: 'Erv Huether Field',
    coords: { lat: 44.3164, lng: -96.7918 },
  },
  'St. Thomas': {
    venueName: 'Koch Diamond',
    coords: { lat: 44.9386, lng: -93.1884 },
  },
  'Western Illinois': {
    venueName: 'Alfred D. Boyer Stadium',
    coords: { lat: 40.4649, lng: -90.6876 },
  },

  // ── WAC (Western Athletic Conference) (12) ───────────────────────────
  'Abilene Christian': {
    venueName: 'Crutcher Scott Field',
    coords: { lat: 32.4383, lng: -99.7585 },
  },
  'California Baptist': {
    venueName: 'Totman Stadium',
    coords: { lat: 33.9316, lng: -117.4065 },
  },
  'Grand Canyon': {
    venueName: 'Brazell Stadium at GCU Ballpark',
    coords: { lat: 33.5076, lng: -112.1270 },
  },
  'Sacramento State': {
    venueName: 'John Smith Field',
    coords: { lat: 38.5582, lng: -121.4235 },
  },
  'Seattle': {
    venueName: 'Bannerwood Park',
    coords: { lat: 47.5849, lng: -122.1496 },
  },
  'Stephen F. Austin': {
    venueName: 'Jaycees Field',
    coords: { lat: 31.6243, lng: -94.6495 },
  },
  'Tarleton': {
    venueName: 'Tarleton Baseball Complex',
    coords: { lat: 32.2224, lng: -98.2179 },
  },
  'UT Arlington': {
    venueName: 'Clay Gould Ballpark',
    coords: { lat: 32.7268, lng: -97.1148 },
  },
  'UT Rio Grande Valley': {
    venueName: 'UTRGV Baseball Stadium',
    coords: { lat: 26.3066, lng: -98.1718 },
  },
  'Utah Tech': {
    venueName: 'Bruce Hurst Field',
    coords: { lat: 37.1030, lng: -113.5686 },
  },
  'Utah Valley': {
    venueName: 'UCCU Ballpark',
    coords: { lat: 40.2783, lng: -111.7101 },
  },
  'Southern Utah': {
    venueName: 'Thunderbird Baseball Field',
    coords: { lat: 37.6742, lng: -113.0658 },
  },

  // ── SWAC (Southwestern Athletic Conference) (11) ─────────────────────
  'Alabama A&M': {
    venueName: 'Bulldog Field',
    coords: { lat: 34.7859, lng: -86.5649 },
  },
  'Alabama State': {
    venueName: 'Wheeler-Watkins Baseball Complex',
    coords: { lat: 32.3647, lng: -86.2955 },
  },
  'Alcorn State': {
    venueName: 'Foster Baseball Field',
    coords: { lat: 31.8748, lng: -90.7776 },
  },
  'Arkansas-Pine Bluff': {
    venueName: 'Torii Hunter Baseball Complex',
    coords: { lat: 34.2290, lng: -91.9615 },
  },
  'Bethune-Cookman': {
    venueName: 'Jackie Robinson Ballpark',
    coords: { lat: 29.2187, lng: -81.0207 },
  },
  'Grambling': {
    venueName: 'Wilbert Ellis Baseball Stadium',
    coords: { lat: 32.5237, lng: -92.7152 },
  },
  'Jackson State': {
    venueName: 'Braddy Field',
    coords: { lat: 32.2972, lng: -90.2094 },
  },
  'Mississippi Valley State': {
    venueName: 'Magnolia Field',
    coords: { lat: 33.4987, lng: -90.3144 },
  },
  'Prairie View': {
    venueName: 'Tankersley Field',
    coords: { lat: 30.0868, lng: -95.9894 },
  },
  'Southern': {
    venueName: 'Lee-Hines Field',
    coords: { lat: 30.5247, lng: -91.1896 },
  },
  'Texas Southern': {
    venueName: 'MacGregor Park Baseball Field',
    coords: { lat: 29.7105, lng: -95.3363 },
  },

  // ── MEAC (Mid-Eastern Athletic Conference) (6) ───────────────────────
  'Coppin State': {
    venueName: 'Joe Cannon Stadium',
    coords: { lat: 39.3385, lng: -76.6613 },
  },
  'Delaware State': {
    venueName: 'Soldier Field',
    coords: { lat: 39.1672, lng: -75.5382 },
  },
  'Howard': {
    venueName: 'Banneker Recreation Center Field',
    coords: { lat: 38.9196, lng: -77.0203 },
  },
  'Maryland-Eastern Shore': {
    venueName: 'Hawk Stadium',
    coords: { lat: 38.4088, lng: -75.6124 },
  },
  'Norfolk State': {
    venueName: 'Marty L. Miller Field',
    coords: { lat: 36.8467, lng: -76.2626 },
  },
  'North Carolina Central': {
    venueName: 'Durham Athletic Park',
    coords: { lat: 36.0015, lng: -78.8928 },
  },

  // ── Big South (9) ────────────────────────────────────────────────────
  'Campbell': {
    venueName: 'Jim Perry Stadium',
    coords: { lat: 35.4193, lng: -78.7194 },
  },
  'Charleston Southern': {
    venueName: 'Nielsen Field at CSU Ballpark',
    coords: { lat: 32.9685, lng: -80.0476 },
  },
  'Gardner-Webb': {
    venueName: 'John Henry Moss Stadium',
    coords: { lat: 35.2271, lng: -81.6749 },
  },
  'Longwood': {
    venueName: 'Lancer Field',
    coords: { lat: 37.2953, lng: -78.3950 },
  },
  'Presbyterian': {
    venueName: 'PC Baseball Complex',
    coords: { lat: 34.3731, lng: -81.6222 },
  },
  'Radford': {
    venueName: 'Carter Memorial Field',
    coords: { lat: 37.1347, lng: -80.5468 },
  },
  'UNC Asheville': {
    venueName: 'Greenwood Field',
    coords: { lat: 35.6163, lng: -82.5678 },
  },
  'USC Upstate': {
    venueName: 'Cleveland S. Harley Baseball Park',
    coords: { lat: 34.9448, lng: -81.9822 },
  },
  'Winthrop': {
    venueName: 'Winthrop Ballpark',
    coords: { lat: 34.9401, lng: -81.0299 },
  },

  // ── Additional programs & aliases ────────────────────────────────────
  'Florida A&M': {
    venueName: 'Moore-Kittles Field',
    coords: { lat: 30.4250, lng: -84.2855 },
  },
  'Florida Atlantic': {
    venueName: 'FAU Baseball Stadium',
    coords: { lat: 26.3706, lng: -80.1024 },
  },
  'Florida International': {
    venueName: 'FIU Baseball Stadium',
    coords: { lat: 25.7562, lng: -80.3735 },
  },
  'Northern Colorado': {
    venueName: 'Jackson Field',
    coords: { lat: 40.4065, lng: -104.6984 },
  },
  'West Georgia': {
    venueName: 'Cole Field',
    coords: { lat: 33.5800, lng: -85.1020 },
  },
  'South Florida': {
    venueName: 'USF Baseball Stadium',
    coords: { lat: 28.0647, lng: -82.4159 },
  },
  'Illinois-Chicago': {
    venueName: 'Granderson Stadium',
    coords: { lat: 41.8719, lng: -87.6508 },
  },
  'UNC Wilmington': {
    venueName: 'Brooks Field',
    coords: { lat: 34.2273, lng: -77.8723 },
  },
  'Southeastern Louisiana': {
    venueName: 'Alumni Field',
    coords: { lat: 30.5154, lng: -90.4622 },
  },
  'Florida Gulf Coast': {
    venueName: 'FGCU Baseball Complex',
    coords: { lat: 26.4630, lng: -81.7730 },
  },
}
