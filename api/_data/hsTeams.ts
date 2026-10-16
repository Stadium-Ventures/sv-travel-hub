// High school and JUCO teams as typed in the Client Game Schedule sheet's
// Team column, mapped to the roster's org|state key plus home detection
// hints. Shared by the app (src/lib/hsCsvShared.ts re-exports it) and the
// health monitor's per-client coverage check. Pure data, no imports.
//
// A sheet team NOT listed here still loads when its name matches the
// roster school exactly (see parseScheduleCsv); listing it adds home-city
// and home-ballpark hints for telling home games from away games.

export interface TeamInfo {
  key: string           // roster org|state key
  homeCity?: string     // for isHome fallback when ballpark is empty
  homeBallparks?: string[] // additional ballpark names that indicate home
}

export const CSV_TEAM_INFO: Record<string, TeamInfo> = {
  'Briarcrest': { key: 'Briarcrest|TN', homeCity: 'Eads' },
  'Cardinal Gibbons': { key: 'Cardinal Gibbons|NC', homeCity: 'Raleigh' },
  'Cartersville': { key: 'Cartersville|GA', homeCity: 'Cartersville' },
  'Catholic': { key: 'B.R. Catholic|LA', homeCity: 'Baton Rouge' },
  'Christ Church': { key: 'Christ Church|SC', homeCity: 'Greenville', homeBallparks: ['CCES'] },
  'Coral Springs Charter': { key: 'Coral Springs Charter|FL', homeCity: 'Coral Springs' },
  'Etowah': { key: 'Etowah|GA', homeCity: 'Woodstock' },
  'Hernando': { key: 'Hernando|MS', homeCity: 'Hernando' },
  'Hun School': { key: 'The Hun School|NJ', homeCity: 'Princeton', homeBallparks: ['Hun'] },
  'IMG': { key: 'IMG|FL', homeCity: 'Bradenton', homeBallparks: ['IMG'] },
  'Iona Prep': { key: 'Iona Prep|NY', homeCity: 'New Rochelle' },
  'James Island': { key: 'James Island|SC', homeCity: 'Charleston' },
  'Mill Creek': { key: 'Mill Creek|GA', homeCity: 'Hoschton' },
  'Muskego': { key: 'Muskego|WI', homeCity: 'Muskego' },
  'North Broward Prep': { key: 'N. Broward Prep|FL', homeCity: 'Coconut Creek' },
  'Sarasota': { key: 'Sarasota HS|FL', homeCity: 'Sarasota' },
  'SCF': { key: 'SCF|FL', homeCity: 'Bradenton', homeBallparks: ['Robert C. Wynn'] },
  'South Walton': { key: 'South Walton|FL', homeCity: 'Santa Rosa Beach' },
  'Spotswood': { key: 'Spotswood|VA', homeCity: 'Penn Laird' },
  "St. Joseph's Prep": { key: "St. Joseph's Prep|PA", homeCity: 'Philadelphia', homeBallparks: ["St. Joseph's", 'SJP'] },
  'Stony Brook': { key: 'Stony Brook|NY', homeCity: 'Stony Brook' },
  'Suwannee': { key: 'Suwannee|FL', homeCity: 'Live Oak' },
  'Timber Creek': { key: 'Timber Creek|FL', homeCity: 'Orlando' },
  'Trinity': { key: 'Trinity|KY', homeCity: 'Louisville' },
}
