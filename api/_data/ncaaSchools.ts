// NCAA school tables — the single source of truth, shared by the React app
// (src/data re-exports from here) AND the api/ serverless functions.
//
// Why this lives under api/: Vercel compiles only api/**/*.ts for serverless
// functions — an import reaching into src/ ships uncompiled and crashes at
// runtime with ERR_MODULE_NOT_FOUND (health-monitor found out 2026-08-05).
// The underscore prefix keeps this file from becoming an endpoint. Vite has
// no directory restriction, so the app bundles it fine through the re-exports.

// NCAA school aliases for matching roster "Org" field
export const NCAA_ALIASES: Record<string, string[]> = {
  'Texas': ['University of Texas', 'UT Austin', 'Texas Longhorns'],
  'Coastal Carolina': ['CCU', 'Coastal', 'Chanticleers'],
  'Florida': ['University of Florida', 'UF', 'Florida Gators'],
  'Florida State': ['FSU', 'Florida State Seminoles', 'Seminoles'],
  'Georgia Tech': ['GT', 'Georgia Tech Yellow Jackets'],
  'Virginia': ['UVA', 'University of Virginia', 'Cavaliers'],
  'South Carolina': ['USC', 'University of South Carolina', 'Gamecocks'],
  'Alabama': ['University of Alabama', 'Bama', 'Crimson Tide'],
  'Vanderbilt': ['Vandy', 'Vanderbilt Commodores'],
  'Dallas Baptist': ['DBU', 'Dallas Baptist Patriots'],
  'Wake Forest': ['Wake', 'Demon Deacons'],
  'SE Louisiana': ['Southeastern Louisiana', 'SELA', 'SELA Lions'],
  'Mercer': ['Mercer Bears', 'Mercer University'],
  'FIU': ['Florida International', 'Florida International University', 'FIU Panthers'],
  'UCF': ['University of Central Florida', 'UCF Knights', 'Central Florida'],
  'Auburn': ['Auburn University', 'Auburn Tigers'],
  'Ohio State': ['OSU', 'The Ohio State University', 'Buckeyes'],
  'Southern Miss': ['USM', 'University of Southern Mississippi', 'Golden Eagles'],
  'Fordham': ['Fordham University', 'Fordham Rams'],
  'Michigan': ['University of Michigan', 'Michigan Wolverines'],
  'USF': ['University of South Florida', 'South Florida', 'USF Bulls'],
  'Duke': ['Duke University', 'Blue Devils'],
  'North Carolina': ['UNC', 'University of North Carolina', 'Tar Heels'],
  'Rutgers': ['Rutgers University', 'Scarlet Knights'],
  'Sacramento State': ['Sac State', 'Sacramento State Hornets'],
  'Saint Josephs': ["Saint Joseph's", "St. Joseph's", "St. Josephs", 'Hawks'],
  'Tulane': ['Tulane University', 'Tulane Green Wave', 'Green Wave'],
  'Tennessee': ['University of Tennessee', 'Tennessee Volunteers', 'Vols', 'UT Knoxville'],
  'Hawaii': ["Hawai'i", 'University of Hawaii', "University of Hawai'i", 'Hawaii Rainbow Warriors', 'Rainbow Warriors', 'UH Manoa'],
  'Clemson': ['Clemson University', 'Clemson Tigers'],
  'Dartmouth': ['Dartmouth College', 'Dartmouth Big Green'],
  'Houston': ['University of Houston', 'Houston Cougars'],
  'Notre Dame': ['University of Notre Dame', 'Notre Dame Fighting Irish'],
  'Ole Miss': ['Mississippi', 'University of Mississippi', 'Ole Miss Rebels'],
  'Stetson': ['Stetson University', 'Stetson Hatters'],
  'Texas A&M': ['Texas A&M University', 'TAMU', 'Texas A&M Aggies'],
  'UCLA': ['University of California Los Angeles', 'UCLA Bruins'],
  'Georgia': ['University of Georgia', 'UGA', 'Georgia Bulldogs'],
  'Kentucky': ['University of Kentucky', 'Kentucky Wildcats'],
  'Miami': ['University of Miami', 'Miami (FL)', 'Miami Hurricanes'],
  'Portland': ['University of Portland', 'Portland Pilots'],
}

// Reverse lookup: alias → canonical name
export function resolveNcaaName(orgName: string, customAliases?: Record<string, string>): string | null {
  // Check custom aliases first (raw name → canonical name)
  if (customAliases) {
    const mapped = customAliases[orgName]
    if (mapped) return mapped
    // Case-insensitive custom check
    const lower = orgName.toLowerCase().trim()
    for (const [raw, canonical] of Object.entries(customAliases)) {
      if (raw.toLowerCase().trim() === lower) return canonical
    }
  }

  const lower = orgName.toLowerCase().trim()
  for (const [canonical, aliases] of Object.entries(NCAA_ALIASES)) {
    if (canonical.toLowerCase() === lower) return canonical
    if (aliases.some((a) => a.toLowerCase() === lower)) return canonical
  }
  return null
}

// Mapping from our canonical NCAA school name → D1Baseball URL slug
// URL pattern: https://d1baseball.com/team/{slug}/schedule/
// Slugs updated 2026-03-23 — D1Baseball changed to abbreviated slugs
export const D1_BASEBALL_SLUGS: Record<string, string> = {
  'Texas': 'texas',
  'Coastal Carolina': 'coastcar',
  'Florida': 'florida',
  'Florida State': 'floridast',
  'Georgia Tech': 'gatech',
  'Virginia': 'virginia',
  'South Carolina': 'scarolina',
  'Alabama': 'alabama',
  'Vanderbilt': 'vandy',
  'Dallas Baptist': 'dallasbapt',
  'Wake Forest': 'wake',
  'SE Louisiana': 'sela',
  'Mercer': 'mercer',
  'FIU': 'flinternat',
  'UCF': 'ucf',
  'Auburn': 'auburn',
  'Ohio State': 'ohiost',
  'Southern Miss': 'smiss',
  'Fordham': 'fordham',
  'Michigan': 'michigan',
  'USF': 'sflorida',
  'Duke': 'duke',
  'North Carolina': 'unc',
  'Rutgers': 'rutgers',
  'Sacramento State': 'sacstate',
  'Saint Josephs': 'stjosephs',
  'Tulane': 'tulane',
  'Tennessee': 'tennessee',
  'Hawaii': 'hawaii',
  'Clemson': 'clemson',
  'Dartmouth': 'dartmouth',
  'Houston': 'houston',
  'Notre Dame': 'notredame',
  'Ole Miss': 'olemiss',
  'Stetson': 'stetson',
  'Texas A&M': 'texasam',
  'UCLA': 'ucla',
  'Georgia': 'georgia',
  'Kentucky': 'kentucky',
  'Miami': 'miamifl', // bare "miami" 404s on D1Baseball
  'Portland': 'portland',
}
